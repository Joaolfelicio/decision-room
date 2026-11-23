import {
  LIMITS,
  type OptionBreakdown,
  type PublicRoom,
  type RoomOption,
  type RoomParticipant,
  type RoomRecord,
  type WinnerSummary,
} from "./types.ts";

export const GUEST_ANIMALS = [
  "Guest Panda",
  "Guest Fox",
  "Guest Otter",
  "Guest Owl",
  "Guest Koala",
  "Guest Tiger",
  "Guest Penguin",
  "Guest Capybara",
  "Guest Falcon",
  "Guest Badger",
  "Guest Gecko",
  "Guest Dolphin",
];

const ROOM_CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateRoomCode(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
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

export function isUrlString(val: string): boolean {
  const t = val.trim();
  return /^https?:\/\/\S+$/i.test(t);
}

export function parseOptionRaw(raw: string, index: number): RoomOption | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Check if entire string is a URL
  if (isUrlString(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        const cleanHost = parsed.hostname.replace(/^www\./i, "");
        const cleanPath =
          parsed.pathname && parsed.pathname !== "/"
            ? parsed.pathname.replace(/\/$/, "")
            : "";
        const displayLabel = `${cleanHost}${cleanPath}`.slice(0, 80) || trimmed;
        return {
          id: `opt-${index + 1}`,
          label: displayLabel,
          url: parsed.toString(),
        };
      }
    } catch {
      // fall through
    }
  }

  // Check if string contains an embedded URL (e.g. "Marugame Udon https://marugameudon.com")
  const match = /(https?:\/\/[^\s)]+)/i.exec(trimmed);
  if (match) {
    let validUrl: string | null = null;
    try {
      const parsed = new URL(match[1]);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        validUrl = parsed.toString();
      }
    } catch {
      validUrl = null;
    }

    const stripped = trimmed
      .replace(match[1], "")
      .replace(/[\s\-|—–:()]+$/g, "")
      .replace(/^[\s\-|—–:()]+/g, "")
      .trim();

    if (validUrl) {
      let fallbackLabel = stripped;
      if (!fallbackLabel) {
        try {
          const u = new URL(validUrl);
          fallbackLabel = u.hostname.replace(/^www\./i, "");
        } catch {
          fallbackLabel = validUrl;
        }
      }
      return {
        id: `opt-${index + 1}`,
        label: fallbackLabel.slice(0, 80),
        url: validUrl,
      };
    }
  }

  return {
    id: `opt-${index + 1}`,
    label: trimmed.slice(0, 80),
    url: null,
  };
}

export function validateOptionsInput(
  rawOptions: unknown
): { options: RoomOption[] } | { error: string } {
  if (!Array.isArray(rawOptions)) {
    return { error: "Add at least 3 options." };
  }

  const nonBlank: string[] = [];
  for (const item of rawOptions) {
    if (typeof item === "string" && item.trim().length > 0) {
      nonBlank.push(item.trim());
    }
  }

  if (nonBlank.length < LIMITS.minOptions) {
    return { error: "Add at least 3 options." };
  }
  if (nonBlank.length > LIMITS.maxOptions) {
    return { error: "Maximum of 6 options allowed." };
  }

  const parsed: RoomOption[] = [];
  const seenKeys = new Set<string>();

  for (const raw of nonBlank) {
    const opt = parseOptionRaw(raw, parsed.length);
    if (!opt) continue;
    const dedupeKey = (opt.url ? `${opt.label}|${opt.url}` : opt.label).toLowerCase();
    if (seenKeys.has(dedupeKey)) {
      return { error: `Duplicate option "${opt.label}" — make each option distinct.` };
    }
    seenKeys.add(dedupeKey);
    parsed.push(opt);
  }

  if (parsed.length < LIMITS.minOptions) {
    return { error: "Add at least 3 options." };
  }

  return { options: parsed };
}

export function pickGuestName(
  requestedName: string | undefined,
  existingParticipants: RoomParticipant[]
): string {
  const cleaned = (requestedName ?? "").trim().slice(0, LIMITS.nameMaxLength);
  if (cleaned.length > 0) return cleaned;

  const used = new Set(existingParticipants.map((p) => p.name.toLowerCase()));
  for (const candidate of GUEST_ANIMALS) {
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `Guest #${existingParticipants.length + 1}`;
}

export function deterministicHash(input: string, seed: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function computeWinnerSummary(room: RoomRecord): WinnerSummary {
  const allParticipants = Object.values(room.participants);
  const doneVoters = allParticipants.filter((p) => p.done);
  const activeVoters = doneVoters.length > 0 ? doneVoters : allParticipants;
  const totalVoters = activeVoters.length;

  const counts = new Map<string, { picks: number; passes: number }>();
  for (const opt of room.options) {
    counts.set(opt.id, { picks: 0, passes: 0 });
  }

  for (const voter of activeVoters) {
    for (const opt of room.options) {
      const choice = voter.votes[opt.id];
      const entry = counts.get(opt.id)!;
      if (choice === "pick") entry.picks += 1;
      else if (choice === "pass") entry.passes += 1;
    }
  }

  const rawBreakdown: OptionBreakdown[] = room.options.map((opt) => {
    const c = counts.get(opt.id)!;
    const percentage =
      totalVoters > 0 ? Math.round((c.picks / totalVoters) * 100) : 0;
    return {
      optionId: opt.id,
      label: opt.label,
      url: opt.url,
      picks: c.picks,
      passes: c.passes,
      totalVoters,
      percentage,
    };
  });

  // Sort by highest picks, then deterministic seed hash
  const sorted = [...rawBreakdown].sort((a, b) => {
    if (b.picks !== a.picks) return b.picks - a.picks;
    const ha = deterministicHash(`${room.id}:${a.optionId}`, room.tieBreakSeed);
    const hb = deterministicHash(`${room.id}:${b.optionId}`, room.tieBreakSeed);
    return hb - ha;
  });

  const top = sorted[0];
  const maxPicks = top.picks;
  const allPassed = maxPicks === 0;
  const tiedAtTop = sorted.filter((item) => item.picks === maxPicks);
  const tieBreakApplied = allPassed || tiedAtTop.length > 1;

  return {
    optionId: top.optionId,
    label: top.label,
    url: top.url,
    picks: top.picks,
    totalVoters,
    tieBreakApplied,
    allPassed,
    tiedOptionLabels: tiedAtTop.map((t) => t.label),
    breakdown: sorted,
    closedAt: new Date().toISOString(),
  };
}

export function toPublicRoom(room: RoomRecord): PublicRoom {
  const orderedParticipants = Object.values(room.participants).sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt)
  );
  const doneCount = orderedParticipants.filter((p) => p.done).length;

  return {
    id: room.id,
    title: room.title,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    status: room.status,
    options: room.options,
    participants: orderedParticipants.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      joinedAt: p.joinedAt,
      done: p.done,
    })),
    doneCount,
    winner: room.winner,
  };
}
