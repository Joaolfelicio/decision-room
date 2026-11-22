export const LIMITS = {
  minOptions: 3,
  maxOptions: 6,
  optionMaxLength: 80,
  titleMaxLength: 80,
  nameMaxLength: 24,
  maxParticipants: 20,
  minGroupSize: 2,
  maxGroupSize: 12,
  roomTtlMinutes: 60,
} as const;

export interface RoomOption {
  id: string;
  label: string;
  url: string | null;
}

export type RoomStatus = "open" | "closed";
export type ClosedReason = "host" | "everyone";

export interface PublicParticipant {
  id: string;
  name: string;
  done: boolean;
}

export interface OptionResult {
  optionId: string;
  yes: number;
  no: number;
}

export interface Winner {
  optionId: string;
  tieBroken: boolean;
  tiedWith: string[];
}

export interface PublicRoom {
  id: string;
  title: string;
  options: RoomOption[];
  groupSize: number | null;
  createdAt: string;
  expiresAt: string;
  status: RoomStatus;
  closedReason: ClosedReason | null;
  participants: PublicParticipant[];
  doneCount: number;
  results: OptionResult[] | null;
  winner: Winner | null;
}

export interface CreateRoomInput {
  title?: string;
  options: string[];
  groupSize?: number | null;
}

export interface CreateRoomResult {
  room: PublicRoom;
  hostToken: string;
}

export interface JoinResult {
  participantId: string;
  participantToken: string;
  name: string;
  room: PublicRoom;
}

export type Votes = Record<string, boolean>;
