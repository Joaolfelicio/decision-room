export const LIMITS = {
  minOptions: 3,
  maxOptions: 6,
  optionMaxLength: 160,
  titleMaxLength: 60,
  nameMaxLength: 28,
  maxParticipants: 24,
  roomTtlMinutes: 60,
} as const;

export type VoteChoice = "pick" | "pass";
export type VoteMap = Record<string, VoteChoice>;

export interface RoomOption {
  id: string;
  label: string;
  url: string | null;
}

export interface RoomParticipant {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: string;
  done: boolean;
  votes: VoteMap;
}

export interface OptionBreakdown {
  optionId: string;
  label: string;
  url: string | null;
  picks: number;
  passes: number;
  totalVoters: number;
  percentage: number;
}

export interface WinnerSummary {
  optionId: string;
  label: string;
  url: string | null;
  picks: number;
  totalVoters: number;
  tieBreakApplied: boolean;
  allPassed: boolean;
  tiedOptionLabels: string[];
  breakdown: OptionBreakdown[];
  closedAt: string;
}

export interface RoomRecord {
  id: string;
  hostToken: string;
  hostParticipantId: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  status: "open" | "closed";
  options: RoomOption[];
  participants: Record<string, RoomParticipant>;
  winner: WinnerSummary | null;
  tieBreakSeed: number;
}

export interface PublicRoom {
  id: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  status: "open" | "closed";
  options: RoomOption[];
  participants: Array<{
    id: string;
    name: string;
    isHost: boolean;
    joinedAt: string;
    done: boolean;
  }>;
  doneCount: number;
  winner: WinnerSummary | null;
}
