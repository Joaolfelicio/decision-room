import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import fs from "node:fs";
import path from "node:path";
import {
  buildPublicRoom,
  generateToken,
  isRoomExpired,
  pickParticipantName,
  validateCreateRoomInput,
  type StoredParticipant,
  type StoredRoomMeta,
} from "../../shared/roomLogic.ts";
import { LIMITS, type CreateRoomInput, type Votes } from "../../shared/types.ts";

interface KeyValueRoomStore {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown): Promise<void>;
  listByPrefix<T>(prefix: string): Promise<T[]>;
}

const LOCAL_STORE_FILE = path.resolve(process.cwd(), ".local-rooms.json");

function readLocalFileMap(): Record<string, unknown> {
  try {
    if (!fs.existsSync(LOCAL_STORE_FILE)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeLocalFileMap(map: Record<string, unknown>): void {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(map, null, 2), "utf8");
  } catch {
    // ignore local write errors in read-only environments
  }
}

const memoryFallback: Record<string, unknown> = {};

function createLocalStore(): KeyValueRoomStore {
  return {
    async getJson<T>(key: string): Promise<T | null> {
      const fileMap = readLocalFileMap();
      const val = key in fileMap ? fileMap[key] : memoryFallback[key];
      return (val as T | undefined) ?? null;
    },
    async setJson(key: string, value: unknown): Promise<void> {
      memoryFallback[key] = value;
      const fileMap = readLocalFileMap();
      fileMap[key] = value;
      writeLocalFileMap(fileMap);
    },
    async listByPrefix<T>(prefix: string): Promise<T[]> {
      const fileMap = { ...memoryFallback, ...readLocalFileMap() };
      const out: T[] = [];
      for (const [k, v] of Object.entries(fileMap)) {
        if (k.startsWith(prefix) && v !== undefined && v !== null) {
          out.push(v as T);
        }
      }
      return out;
    },
  };
}

function getRoomStore(context?: Context): KeyValueRoomStore {
  const hasNetlifyEnv =
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) ||
    Boolean(context?.site?.id);

  if (!hasNetlifyEnv) {
    return createLocalStore();
  }

  try {
    const isProd = context?.deploy?.context === "production";
    const storeName = isProd ? "decision-room-prod" : "decision-room-preview";
    const blobStore = getStore({ name: storeName, consistency: "strong" });

    return {
      async getJson<T>(key: string): Promise<T | null> {
        const res = await blobStore.get(key, { type: "json" });
        return (res as T | null) ?? null;
      },
      async setJson(key: string, value: unknown): Promise<void> {
        await blobStore.setJSON(key, value);
      },
      async listByPrefix<T>(prefix: string): Promise<T[]> {
        const { blobs } = await blobStore.list({ prefix });
        const items = await Promise.all(
          blobs.map(
            (b) => blobStore.get(b.key, { type: "json" }) as Promise<unknown>
          )
        );
        return items.filter((item): item is T => item !== null && item !== undefined);
      },
    };
  } catch {
    return createLocalStore();
  }
}

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
};

function metaKey(roomId: string): string {
  return `rooms/${roomId.toUpperCase()}/meta`;
}

function participantPrefix(roomId: string): string {
  return `rooms/${roomId.toUpperCase()}/p/`;
}

function participantKey(roomId: string, participantId: string): string {
  return `rooms/${roomId.toUpperCase()}/p/${participantId}`;
}

async function loadRoomAndParticipants(
  store: KeyValueRoomStore,
  roomId: string
): Promise<{ meta: StoredRoomMeta; participants: StoredParticipant[] } | null> {
  const id = roomId.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(id)) return null;

  const meta = await store.getJson<StoredRoomMeta>(metaKey(id));
  if (!meta) return null;
  if (isRoomExpired(meta)) return null;

  const participants = await store.listByPrefix<StoredParticipant>(participantPrefix(id));
  return { meta, participants };
}

export default async (req: Request, context?: Context) => {
  const url = new URL(req.url);
  const store = getRoomStore(context);

  if (req.method === "GET") {
    const roomId = url.searchParams.get("id") ?? "";
    const loaded = await loadRoomAndParticipants(store, roomId);
    if (!loaded) {
      return Response.json(
        { error: "Room not found or expired (rooms auto-expire after 60 minutes)." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const participantId = url.searchParams.get("participantId") ?? "";
    const participantToken = url.searchParams.get("participantToken") ?? "";
    const me = loaded.participants.find(
      (p) => p.id === participantId && p.token === participantToken
    );

    const publicRoom = buildPublicRoom(loaded.meta, loaded.participants);
    if (publicRoom.status === "closed") {
      loaded.meta.status = "closed";
      loaded.meta.closedReason = publicRoom.closedReason;
      await store.setJson(metaKey(loaded.meta.id), loaded.meta);
    }

    return Response.json(
      {
        room: publicRoom,
        myVotes: me ? me.votes : null,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: NO_STORE_HEADERS }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const action = (url.searchParams.get("action") ?? (body.action as string | undefined) ?? "create").toLowerCase();

  if (action === "create") {
    const validated = validateCreateRoomInput({
      title: typeof body.title === "string" ? body.title : undefined,
      options: Array.isArray(body.options) ? (body.options as string[]) : [],
      groupSize: typeof body.groupSize === "number" ? body.groupSize : null,
    } satisfies CreateRoomInput);

    if ("error" in validated) {
      return Response.json(
        { error: validated.error },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { meta } = validated;
    await store.setJson(metaKey(meta.id), meta);

    return Response.json(
      {
        room: buildPublicRoom(meta, []),
        hostToken: meta.hostToken,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  }

  const roomId = typeof body.roomId === "string" ? body.roomId.trim().toUpperCase() : "";
  const loaded = await loadRoomAndParticipants(store, roomId);
  if (!loaded) {
    return Response.json(
      { error: "Room not found or expired." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  if (action === "join") {
    const existingId = typeof body.participantId === "string" ? body.participantId : "";
    const existingToken = typeof body.participantToken === "string" ? body.participantToken : "";
    const requestedName = typeof body.name === "string" ? body.name : undefined;

    const existing = loaded.participants.find(
      (p) => p.id === existingId && p.token === existingToken
    );

    if (existing) {
      if (requestedName && requestedName.trim().length > 0) {
        existing.name = requestedName.trim().slice(0, LIMITS.nameMaxLength);
        existing.updatedAt = new Date().toISOString();
        await store.setJson(participantKey(loaded.meta.id, existing.id), existing);
      }
      return Response.json(
        {
          participantId: existing.id,
          participantToken: existing.token,
          name: existing.name,
          myVotes: existing.votes,
          room: buildPublicRoom(loaded.meta, loaded.participants),
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (loaded.participants.length >= LIMITS.maxParticipants) {
      return Response.json(
        { error: `This room already has the maximum of ${LIMITS.maxParticipants} participants.` },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const nowIso = new Date().toISOString();
    const newParticipant: StoredParticipant = {
      id: `p-${generateToken(10)}`,
      token: generateToken(24),
      name: pickParticipantName(requestedName, loaded.participants),
      joinedAt: nowIso,
      updatedAt: nowIso,
      votes: {},
    };

    await store.setJson(participantKey(loaded.meta.id, newParticipant.id), newParticipant);
    const updatedParticipants = [...loaded.participants, newParticipant];

    return Response.json(
      {
        participantId: newParticipant.id,
        participantToken: newParticipant.token,
        name: newParticipant.name,
        myVotes: newParticipant.votes,
        room: buildPublicRoom(loaded.meta, updatedParticipants),
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  }

  if (action === "vote") {
    if (loaded.meta.status === "closed") {
      return Response.json(
        { error: "Voting has already closed for this room." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const participantId = typeof body.participantId === "string" ? body.participantId : "";
    const participantToken = typeof body.participantToken === "string" ? body.participantToken : "";
    const participant = loaded.participants.find(
      (p) => p.id === participantId && p.token === participantToken
    );

    if (!participant) {
      return Response.json(
        { error: "Participant session not found. Rejoin the room." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const validOptionIds = new Set(loaded.meta.options.map((o) => o.id));
    const incomingVotes = (body.votes ?? {}) as Record<string, unknown>;
    const nextVotes: Votes = { ...participant.votes };

    for (const [optId, decision] of Object.entries(incomingVotes)) {
      if (validOptionIds.has(optId) && typeof decision === "boolean") {
        nextVotes[optId] = decision;
      }
    }

    participant.votes = nextVotes;
    participant.updatedAt = new Date().toISOString();
    await store.setJson(participantKey(loaded.meta.id, participant.id), participant);

    const publicRoom = buildPublicRoom(loaded.meta, loaded.participants);
    if (publicRoom.status === "closed") {
      loaded.meta.status = "closed";
      loaded.meta.closedReason = publicRoom.closedReason;
      await store.setJson(metaKey(loaded.meta.id), loaded.meta);
    }

    return Response.json(
      {
        room: publicRoom,
        myVotes: participant.votes,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  if (action === "close") {
    const hostToken = typeof body.hostToken === "string" ? body.hostToken : "";
    const participantId = typeof body.participantId === "string" ? body.participantId : "";
    const participantToken = typeof body.participantToken === "string" ? body.participantToken : "";

    const isHost = hostToken && hostToken === loaded.meta.hostToken;
    const isParticipant = loaded.participants.some(
      (p) => p.id === participantId && p.token === participantToken
    );

    if (!isHost && !isParticipant) {
      return Response.json(
        { error: "Only the room host or an active participant can reveal the winner." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    loaded.meta.status = "closed";
    loaded.meta.closedReason = isHost ? "host" : "everyone";
    await store.setJson(metaKey(loaded.meta.id), loaded.meta);

    return Response.json(
      {
        room: buildPublicRoom(loaded.meta, loaded.participants),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  return Response.json(
    { error: `Unknown action "${action}"` },
    { status: 400, headers: NO_STORE_HEADERS }
  );
};
