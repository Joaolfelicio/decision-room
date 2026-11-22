import {
  LIMITS,
  type ClosedReason,
  type CreateRoomInput,
  type OptionResult,
  type PublicParticipant,
  type PublicRoom,
  type RoomOption,
  type RoomStatus,
  type Votes,
  type Winner,
} from "./types.ts";

export interface StoredParticipant {
  id: string;
  token: string;
  name: string;
  joinedAt: string;
  updatedAt: string;
  votes: Votes;
}

export interface StoredRoomMeta {
  id: string;
  hostToken: string;
  title: string;
  options: RoomOption[];
  groupSize: number | null;
  createdAt: string;
  expiresAt: string;
  status: RoomStatus;
  closedReason: ClosedReason | null;
}

const AUTO_NAMES = [
  "Taco Ninja",
  "Night Owl",
  "Pizza Wizard",
  "Chill Capybara",
  "Cosmic Otter",
  "Ramen Ranger",
  "Boba Bandit",
  "Popcorn Fox",
  "Spicy Falcon",
  "Neon Badger",
  "Lucky Gecko",
  "Waffle Bear",
];

const ROOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateRoomId(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * ROOM_ALPHABET.length);
    out += ROOM_ALPHABET[idx];
  }
  return out;
}

export function generateToken(length = 24): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function parseOptionEntry(raw: string, index: number): RoomOption | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const urlMatch = /(https?:\/\/[^\s)]+)/i.exec(trimmed);
  let url: string | null = null;
  let label = trimmed;

  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[1]);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        url = parsed.toString();
      }
    } catch {
      url = null;
    }
    const stripped = trimmed
      .replace(urlMatch[1], "")
      .replace(/[\s\-|—–:()]+$/g, "")
      .replace(/^[\s\-|—–:()]+/g, "")
      .trim();

    if (stripped.length > 0) {
      label = stripped;
    } else if (url) {
      try {
        const u = new URL(url);
        label = u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
      } catch {
        label = trimmed;
      }
    }
  }

  return {
    id: `opt-${index + 1}`,
    label: label.slice(0, LIMITS.optionMaxLength),
    url,
  };
}

export function validateCreateRoomInput(
  input: CreateRoomInput,
  now = new Date()
): { meta: StoredRoomMeta } | { error: string } {
  if (!input || !Array.isArray(input.options)) {
    return { error: "Provide between 3 and 6 options." };
  }

  const parsedOptions: RoomOption[] = [];
  const seenLabels = new Set<string>();

  for (const rawOpt of input.options) {
    if (typeof rawOpt !== "string") continue;
    const parsed = parseOptionEntry(rawOpt, parsedOptions.length);
    if (!parsed) continue;
    const key = parsed.label.toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    parsedOptions.push(parsed);
    if (parsedOptions.length >= LIMITS.maxOptions) break;
  }

  if (parsedOptions.length < LIMITS.minOptions) {
    return {
      error: `Add at least ${LIMITS.minOptions} distinct options (up to ${LIMITS.maxOptions}).`,
    };
  }

  const rawTitle = typeof input.title === "string" ? input.title.trim() : "";
  const title = (rawTitle || "Where should we go?").slice(0, LIMITS.titleMaxLength);

  let groupSize: number | null = null;
  if (typeof input.groupSize === "number" && Number.isFinite(input.groupSize)) {
    const rounded = Math.round(input.groupSize);
    if (rounded >= LIMITS.minGroupSize && rounded <= LIMITS.maxGroupSize) {
      groupSize = rounded;
    }
  }

  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + LIMITS.roomTtlMinutes * 60 * 1000
  ).toISOString();

  return {
    meta: {
      id: generateRoomId(6),
      hostToken: generateToken(24),
      title,
      options: parsedOptions,
      groupSize,
      createdAt,
      expiresAt,
      status: "open",
      closedReason: null,
    },
  };
}

export function isRoomExpired(meta: StoredRoomMeta, now = new Date()): boolean {
  const exp = Date.parse(meta.expiresAt);
  return Number.isNaN(exp) || now.getTime() > exp;
}

export function pickParticipantName(
  requestedName: string | undefined,
  existingParticipants: StoredParticipant[]
): string {
  const cleaned = (requestedName ?? "").trim().slice(0, LIMITS.nameMaxLength);
  if (cleaned.length > 0) {
    return cleaned;
  }
  const used = new Set(existingParticipants.map((p) => p.name.toLowerCase()));
  for (const candidate of AUTO_NAMES) {
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `Guest #${existingParticipants.length + 1}`;
}

export function isParticipantDone(
  participant: StoredParticipant,
  options: RoomOption[]
): boolean {
  return options.every((opt) => typeof participant.votes[opt.id] === "boolean");
}

export function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tallyVotes(
  meta: StoredRoomMeta,
  participants: StoredParticipant[]
): { results: OptionResult[]; winner: Winner } {
  const counts = new Map<string, { yes: number; no: number }>();
  for (const opt of meta.options) {
    counts.set(opt.id, { yes: 0, no: 0 });
  }

  for (const p of participants) {
    for (const opt of meta.options) {
      const v = p.votes[opt.id];
      const entry = counts.get(opt.id)!;
      if (v === true) entry.yes += 1;
      else if (v === false) entry.no += 1;
    }
  }

  const rawResults: OptionResult[] = meta.options.map((opt) => {
    const c = counts.get(opt.id)!;
    return {
      optionId: opt.id,
      yes: c.yes,
      no: c.no,
    };
  });

  const ranked = [...rawResults].sort((a, b) => {
    if (b.yes !== a.yes) return b.yes - a.yes;
    if (a.no !== b.no) return a.no - b.no;
    const hashA = deterministicHash(`${meta.id}:${a.optionId}:${a.yes}:${a.no}`);
    const hashB = deterministicHash(`${meta.id}:${b.optionId}:${b.yes}:${b.no}`);
    return hashB - hashA;
  });

  const top = ranked[0];
  const tiedTop = ranked.filter((r) => r.yes === top.yes && r.no === top.no);
  const tieBroken = tiedTop.length > 1;
  const tiedWith = tieBroken
    ? tiedTop.filter((r) => r.optionId !== top.optionId).map((r) => r.optionId)
    : [];

  return {
    results: ranked,
    winner: {
      optionId: top.optionId,
      tieBroken,
      tiedWith,
    },
  };
}

export function buildPublicRoom(
  meta: StoredRoomMeta,
  participants: StoredParticipant[]
): PublicRoom {
  const orderedParticipants = [...participants].sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt)
  );

  const publicParticipants: PublicParticipant[] = orderedParticipants.map((p) => ({
    id: p.id,
    name: p.name,
    done: isParticipantDone(p, meta.options),
  }));

  const doneCount = publicParticipants.filter((p) => p.done).length;

  let status = meta.status;
  let closedReason = meta.closedReason;

  if (
    status === "open" &&
    meta.groupSize !== null &&
    doneCount >= meta.groupSize &&
    publicParticipants.length >= meta.groupSize
  ) {
    status = "closed";
    closedReason = "everyone";
  }

  const closed = status === "closed";
  const tally = closed ? tallyVotes(meta, orderedParticipants) : null;

  return {
    id: meta.id,
    title: meta.title,
    options: meta.options,
    groupSize: meta.groupSize,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    status,
    closedReason,
    participants: publicParticipants,
    doneCount,
    results: tally ? tally.results : null,
    winner: tally ? tally.winner : null,
  };
}
