import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import fs from "node:fs";
import path from "node:path";
import {
  computeWinnerSummary,
  generateRoomCode,
  generateToken,
  pickGuestName,
  toPublicRoom,
  validateOptionsInput,
} from "../../src/roomLogic.ts";
import {
  LIMITS,
  type RoomRecord,
  type VoteChoice,
  type VoteMap,
} from "../../src/types.ts";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
};

interface RoomStoreAdapter {
  getRoom(roomId: string): Promise<RoomRecord | null>;
  saveRoom(roomId: string, room: RoomRecord): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
}

const LOCAL_STORE_FILE = path.resolve(process.cwd(), ".local-rooms.json");
const memoryRooms: Record<string, RoomRecord> = {};

function readLocalRoomsMap(): Record<string, RoomRecord> {
  try {
    if (!fs.existsSync(LOCAL_STORE_FILE)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, "utf8")) as Record<
      string,
      RoomRecord
    >;
  } catch {
    return {};
  }
}

function writeLocalRoomsMap(map: Record<string, RoomRecord>): void {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(map, null, 2), "utf8");
  } catch {
    // ignore local write errors
  }
}

function createLocalRoomStore(): RoomStoreAdapter {
  return {
    async getRoom(roomId: string): Promise<RoomRecord | null> {
      const key = roomId.toLowerCase();
      const fileMap = readLocalRoomsMap();
      return fileMap[key] ?? memoryRooms[key] ?? null;
    },
    async saveRoom(roomId: string, room: RoomRecord): Promise<void> {
      const key = roomId.toLowerCase();
      memoryRooms[key] = room;
      const fileMap = readLocalRoomsMap();
      fileMap[key] = room;
      writeLocalRoomsMap(fileMap);
    },
    async deleteRoom(roomId: string): Promise<void> {
      const key = roomId.toLowerCase();
      delete memoryRooms[key];
      const fileMap = readLocalRoomsMap();
      delete fileMap[key];
      writeLocalRoomsMap(fileMap);
    },
  };
}

function getRoomStore(context?: Context): RoomStoreAdapter {
  const hasNetlifyEnv =
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) || Boolean(context?.site?.id);

  if (!hasNetlifyEnv) {
    return createLocalRoomStore();
  }

  try {
    const isProd = context?.deploy?.context === "production";
    const storeName = isProd ? "decision-rooms-prod" : "decision-rooms-preview";
    const store = getStore({ name: storeName, consistency: "strong" });

    return {
      async getRoom(roomId: string): Promise<RoomRecord | null> {
        const key = `rooms/${roomId.toLowerCase()}.json`;
        const res = await store.get(key, { type: "json" });
        return (res as RoomRecord | null) ?? null;
      },
      async saveRoom(roomId: string, room: RoomRecord): Promise<void> {
        const key = `rooms/${roomId.toLowerCase()}.json`;
        await store.setJSON(key, room);
      },
      async deleteRoom(roomId: string): Promise<void> {
        const key = `rooms/${roomId.toLowerCase()}.json`;
        await store.delete(key);
      },
    };
  } catch {
    return createLocalRoomStore();
  }
}

export default async (req: Request, context?: Context) => {
  const url = new URL(req.url);
  const store = getRoomStore(context);

  if (req.method === "GET") {
    const roomId = (url.searchParams.get("id") ?? "").trim().toLowerCase();
    if (!/^[a-z0-9]{3,10}$/.test(roomId)) {
      return Response.json(
        { error: "Invalid room code", expired: true },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const room = await store.getRoom(roomId);
    if (!room) {
      return Response.json(
        { error: "Room not found or expired", expired: true },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    if (Date.now() > Date.parse(room.expiresAt)) {
      await store.deleteRoom(roomId);
      return Response.json(
        { error: "This room has expired", expired: true },
        { status: 410, headers: NO_STORE_HEADERS }
      );
    }

    const participantId = (url.searchParams.get("participantId") ?? "").trim();
    const me = participantId ? room.participants[participantId] : undefined;

    return Response.json(
      {
        room: toPublicRoom(room),
        myParticipant: me ?? null,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "Invalid JSON body" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const action = typeof body.action === "string" ? body.action : "";

    if (action === "create") {
      const validated = validateOptionsInput(body.options);
      if ("error" in validated) {
        return Response.json(
          { error: validated.error },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const rawTitle =
        typeof body.title === "string"
          ? body.title.trim().slice(0, LIMITS.titleMaxLength)
          : "";
      const title = rawTitle || "Group Decision";

      const now = Date.now();
      const roomId = generateRoomCode(4);
      const hostToken = generateToken(24);
      const hostParticipantId =
        typeof body.participantId === "string" &&
        /^[A-Za-z0-9_-]{4,48}$/.test(body.participantId)
          ? body.participantId
          : `p-${generateToken(10)}`;

      const room: RoomRecord = {
        id: roomId,
        hostToken,
        hostParticipantId,
        title,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(
          now + LIMITS.roomTtlMinutes * 60 * 1000
        ).toISOString(),
        status: "open",
        options: validated.options,
        participants: {},
        winner: null,
        tieBreakSeed: Math.floor(Math.random() * 0x7fffffff),
      };

      await store.saveRoom(roomId, room);
      return Response.json(
        {
          room: toPublicRoom(room),
          hostToken,
          hostParticipantId,
        },
        { status: 201, headers: NO_STORE_HEADERS }
      );
    }

    const roomId =
      typeof body.roomId === "string" ? body.roomId.trim().toLowerCase() : "";
    if (!/^[a-z0-9]{3,10}$/.test(roomId)) {
      return Response.json(
        { error: "Invalid room code", expired: true },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const room = await store.getRoom(roomId);
    if (!room) {
      return Response.json(
        { error: "Room not found or expired", expired: true },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    if (Date.now() > Date.parse(room.expiresAt)) {
      await store.deleteRoom(roomId);
      return Response.json(
        { error: "This room has expired", expired: true },
        { status: 410, headers: NO_STORE_HEADERS }
      );
    }

    if (action === "join") {
      const rawPid =
        typeof body.participantId === "string" &&
        /^[A-Za-z0-9_-]{4,48}$/.test(body.participantId)
          ? body.participantId
          : `p-${generateToken(10)}`;
      const requestedName =
        typeof body.name === "string" ? body.name : undefined;
      const providedHostToken =
        typeof body.hostToken === "string" ? body.hostToken : "";
      const isHost =
        Boolean(providedHostToken && providedHostToken === room.hostToken) ||
        rawPid === room.hostParticipantId;

      const existing = room.participants[rawPid];
      if (existing) {
        if (requestedName && requestedName.trim().length > 0) {
          existing.name = requestedName.trim().slice(0, LIMITS.nameMaxLength);
        }
        if (isHost) existing.isHost = true;
      } else {
        const existingList = Object.values(room.participants);
        const assignedName = pickGuestName(requestedName, existingList);
        room.participants[rawPid] = {
          id: rawPid,
          name: assignedName,
          isHost,
          joinedAt: new Date().toISOString(),
          done: false,
          votes: {},
        };
      }

      await store.saveRoom(roomId, room);
      return Response.json(
        {
          room: toPublicRoom(room),
          participant: room.participants[rawPid],
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (action === "submitVotes") {
      if (room.status === "closed") {
        return Response.json(
          { room: toPublicRoom(room) },
          { status: 200, headers: NO_STORE_HEADERS }
        );
      }

      const rawPid =
        typeof body.participantId === "string" &&
        /^[A-Za-z0-9_-]{4,48}$/.test(body.participantId)
          ? body.participantId
          : "";
      if (!rawPid) {
        return Response.json(
          { error: "Missing participantId" },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const providedHostToken =
        typeof body.hostToken === "string" ? body.hostToken : "";
      const isHost =
        Boolean(providedHostToken && providedHostToken === room.hostToken) ||
        rawPid === room.hostParticipantId;

      if (!room.participants[rawPid]) {
        const existingList = Object.values(room.participants);
        const requestedName =
          typeof body.name === "string" ? body.name : undefined;
        room.participants[rawPid] = {
          id: rawPid,
          name: pickGuestName(requestedName, existingList),
          isHost,
          joinedAt: new Date().toISOString(),
          done: false,
          votes: {},
        };
      }

      const participant = room.participants[rawPid];
      const rawVotes =
        body.votes && typeof body.votes === "object"
          ? (body.votes as Record<string, unknown>)
          : {};
      const validOptionIds = new Set(room.options.map((o) => o.id));
      const cleanVotes: VoteMap = {};

      for (const [optId, choice] of Object.entries(rawVotes)) {
        if (
          validOptionIds.has(optId) &&
          (choice === "pick" || choice === "pass")
        ) {
          cleanVotes[optId] = choice as VoteChoice;
        }
      }

      participant.votes = cleanVotes;
      participant.done = room.options.every((o) => Boolean(cleanVotes[o.id]));

      // Auto-reveal winner if all joined participants (>= 2) have finished voting
      const participantsList = Object.values(room.participants);
      const allDone =
        participantsList.length >= 2 &&
        participantsList.every((p) => p.done);

      if (allDone) {
        room.status = "closed";
        room.winner = computeWinnerSummary(room);
      }

      await store.saveRoom(roomId, room);
      return Response.json(
        {
          room: toPublicRoom(room),
          participant,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (action === "reveal") {
      const providedHostToken =
        typeof body.hostToken === "string" ? body.hostToken : "";
      if (!providedHostToken || providedHostToken !== room.hostToken) {
        return Response.json(
          { error: "Only the room host can reveal the winner early." },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }

      if (room.status !== "closed") {
        room.status = "closed";
        room.winner = computeWinnerSummary(room);
        await store.saveRoom(roomId, room);
      }

      return Response.json(
        { room: toPublicRoom(room) },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    return Response.json(
      { error: "Unknown action" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: NO_STORE_HEADERS }
  );
};

export const config: Config = {
  path: "/api/room",
  method: ["GET", "POST"],
};
