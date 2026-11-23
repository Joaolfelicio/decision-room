import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GUEST_ANIMALS, generateToken, validateOptionsInput } from "./roomLogic";
import {
  LIMITS,
  type PublicRoom,
  type RoomParticipant,
  type VoteChoice,
  type VoteMap,
} from "./types";

type ScreenPhase = "create" | "lobby" | "swipe" | "waiting" | "winner" | "expired";

function getRoomCodeFromUrl(): string | null {
  const pathMatch = window.location.pathname.match(/^\/r\/([a-zA-Z0-9]{3,10})\/?$/);
  if (pathMatch) return pathMatch[1].toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const qRoom = params.get("room");
  if (qRoom && /^[a-zA-Z0-9]{3,10}$/.test(qRoom.trim())) {
    return qRoom.trim().toLowerCase();
  }
  return null;
}

function getStorageSlotPrefix(): string {
  const params = new URLSearchParams(window.location.search);
  const userSlot = params.get("user");
  return userSlot ? `dr_v1_u${userSlot}_` : "dr_v1_";
}

function getSessionValue(roomCode: string, key: string): string | null {
  const prefix = getStorageSlotPrefix();
  const fullKey = `${prefix}${roomCode.toLowerCase()}_${key}`;
  try {
    return sessionStorage.getItem(fullKey) || localStorage.getItem(fullKey);
  } catch {
    return null;
  }
}

function setSessionValue(roomCode: string, key: string, value: string): void {
  const prefix = getStorageSlotPrefix();
  const fullKey = `${prefix}${roomCode.toLowerCase()}_${key}`;
  try {
    sessionStorage.setItem(fullKey, value);
    localStorage.setItem(fullKey, value);
  } catch {
    // ignore storage quota issues
  }
}

function getOrCreateParticipantId(roomCode: string): string {
  const existing = getSessionValue(roomCode, "participantId");
  if (existing && /^[A-Za-z0-9_-]{4,48}$/.test(existing)) {
    return existing;
  }
  const fresh = `p-${generateToken(10)}`;
  setSessionValue(roomCode, "participantId", fresh);
  return fresh;
}

function formatTtlMinutes(expiresAtIso: string, nowMs: number): string {
  const diffMs = Date.parse(expiresAtIso) - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) return "0m";
  const mins = Math.max(1, Math.ceil(diffMs / 60000));
  return `${mins}m`;
}

function hasUrlIndicator(raw: string): boolean {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) || /(https?:\/\/[^\s)]+)/i.test(trimmed);
}

export default function App() {
  const [roomCode, setRoomCode] = useState<string | null>(() => getRoomCodeFromUrl());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Screen 1: Create Room state
  const [promptInput, setPromptInput] = useState<string>("");
  const [optionRows, setOptionRows] = useState<string[]>(["", "", ""]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Active Room state (/r/:code)
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState<boolean>(false);
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [pollError, setPollError] = useState<boolean>(false);

  // Screen 2: Lobby state
  const [nameInput, setNameInput] = useState<string>("");
  const [hasJoined, setHasJoined] = useState<boolean>(false);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isSubmittingVotes, setIsSubmittingVotes] = useState<boolean>(false);
  const [isRevealing, setIsRevealing] = useState<boolean>(false);

  // Screen 3: Swipe & Vote state
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [localVotes, setLocalVotes] = useState<VoteMap>({});
  const [hasSubmittedVotes, setHasSubmittedVotes] = useState<boolean>(false);
  const [dragDx, setDragDx] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [flyDirection, setFlyDirection] = useState<VoteChoice | null>(null);
  const dragStartXRef = useRef<number>(0);

  // Copy feedback states
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedResult, setCopiedResult] = useState<boolean>(false);

  // Navigation helper
  const navigateToRoom = useCallback((nextCode: string | null) => {
    const url = new URL(window.location.href);
    if (nextCode) {
      url.pathname = `/r/${nextCode.toLowerCase()}`;
      url.searchParams.delete("room");
    } else {
      url.pathname = "/";
      url.searchParams.delete("room");
    }
    window.history.pushState({}, "", url.toString());
    setRoomCode(nextCode ? nextCode.toLowerCase() : null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoomCode(getRoomCodeFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const hostToken = useMemo(() => {
    if (!roomCode) return null;
    return getSessionValue(roomCode, "hostToken");
  }, [roomCode, room]);

  // Fetch room on initial load or poll
  const loadRoom = useCallback(
    async (code: string, isInitial: boolean) => {
      const pid = getOrCreateParticipantId(code);
      if (isInitial) {
        setIsLoadingRoom(true);
        setIsExpired(false);
      }

      try {
        const res = await fetch(
          `/api/room?id=${encodeURIComponent(code)}&participantId=${encodeURIComponent(pid)}`,
          { cache: "no-store" }
        );

        if (res.status === 404 || res.status === 410) {
          setIsExpired(true);
          setRoom(null);
          return;
        }

        const data = (await res.json()) as {
          room?: PublicRoom;
          myParticipant?: RoomParticipant | null;
        };

        if (!res.ok || !data.room) {
          if (isInitial) setIsExpired(true);
          else setPollError(true);
          return;
        }

        setPollError(false);
        setRoom(data.room);

        if (isInitial && data.myParticipant) {
          setHasJoined(true);
          setNameInput(data.myParticipant.name);
          if (data.myParticipant.votes && Object.keys(data.myParticipant.votes).length > 0) {
            setLocalVotes(data.myParticipant.votes);
          }
          if (data.myParticipant.done) {
            setHasSubmittedVotes(true);
          }
        }
      } catch {
        if (!isInitial) {
          setPollError(true);
        } else {
          setPollError(true);
        }
      } finally {
        if (isInitial) {
          setIsLoadingRoom(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!roomCode) {
      setRoom(null);
      setIsExpired(false);
      setHasJoined(false);
      setHasSubmittedVotes(false);
      setLocalVotes({});
      setCurrentIdx(0);
      setPollError(false);
      return;
    }

    loadRoom(roomCode, true);
  }, [roomCode, loadRoom]);

  // Determine current screen phase
  const screenPhase: ScreenPhase = useMemo(() => {
    if (!roomCode) return "create";
    if (isExpired) return "expired";
    if (!room) return "lobby";
    if (room.status === "closed" && room.winner) return "winner";
    if (hasSubmittedVotes) return "waiting";
    if (hasJoined) return "swipe";
    return "lobby";
  }, [roomCode, isExpired, room, hasSubmittedVotes, hasJoined]);

  // Short-poll every 1.8s when on Lobby, Swipe, or Waiting; stop immediately when Closed or Expired
  useEffect(() => {
    if (!roomCode || !room || isExpired || room.status === "closed") {
      return;
    }

    const interval = window.setInterval(() => {
      loadRoom(roomCode, false);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [roomCode, room, isExpired, loadRoom]);

  // Non-empty option count for Create Room validation
  const nonBlankOptionsCount = useMemo(() => {
    return optionRows.filter((r) => r.trim().length > 0).length;
  }, [optionRows]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;

    const validation = validateOptionsInput(optionRows);
    if ("error" in validation) {
      setCreateError(validation.error);
      return;
    }

    setCreateError(null);
    setIsCreating(true);

    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: promptInput.trim(),
          options: optionRows,
        }),
      });

      const data = (await res.json()) as {
        room?: PublicRoom;
        hostToken?: string;
        hostParticipantId?: string;
        error?: string;
      };

      if (!res.ok || !data.room || !data.hostToken) {
        setCreateError(data.error || "Could not create room. Please try again.");
        return;
      }

      const code = data.room.id.toLowerCase();
      setSessionValue(code, "hostToken", data.hostToken);
      if (data.hostParticipantId) {
        setSessionValue(code, "participantId", data.hostParticipantId);
      }

      setRoom(data.room);
      setHasJoined(false);
      setHasSubmittedVotes(false);
      setLocalVotes({});
      setCurrentIdx(0);
      navigateToRoom(code);
    } catch {
      setCreateError("Network error while creating room.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartSwiping = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!roomCode || !room || isJoining) return;

    setIsJoining(true);
    const pid = getOrCreateParticipantId(roomCode);
    const savedHostToken = getSessionValue(roomCode, "hostToken") || "";

    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomId: roomCode,
          participantId: pid,
          name: nameInput.trim(),
          hostToken: savedHostToken,
        }),
      });

      const data = (await res.json()) as {
        room?: PublicRoom;
        participant?: RoomParticipant;
      };

      if (res.ok && data.room) {
        setRoom(data.room);
        if (data.participant) {
          setNameInput(data.participant.name);
        }
        setHasJoined(true);
        setCurrentIdx(0);
      }
    } finally {
      setIsJoining(false);
    }
  };

  const submitAllVotesToServer = useCallback(
    async (finalVotes: VoteMap) => {
      if (!roomCode || !room || isSubmittingVotes) return;
      setIsSubmittingVotes(true);
      setHasSubmittedVotes(true);

      const pid = getOrCreateParticipantId(roomCode);
      const savedHostToken = getSessionValue(roomCode, "hostToken") || "";

      try {
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submitVotes",
            roomId: roomCode,
            participantId: pid,
            name: nameInput.trim(),
            hostToken: savedHostToken,
            votes: finalVotes,
          }),
        });

        const data = (await res.json()) as { room?: PublicRoom };
        if (res.ok && data.room) {
          setRoom(data.room);
        }
      } catch {
        setPollError(true);
      } finally {
        setIsSubmittingVotes(false);
      }
    },
    [roomCode, room, isSubmittingVotes, nameInput]
  );

  const commitCardVote = useCallback(
    (choice: VoteChoice) => {
      if (!room || flyDirection !== null) return;
      const currentOption = room.options[currentIdx];
      if (!currentOption) return;

      const updatedVotes: VoteMap = {
        ...localVotes,
        [currentOption.id]: choice,
      };
      setLocalVotes(updatedVotes);
      setFlyDirection(choice);
      setDragDx(0);

      window.setTimeout(() => {
        setFlyDirection(null);
        if (currentIdx < room.options.length - 1) {
          setCurrentIdx((prev) => prev + 1);
        } else {
          submitAllVotesToServer(updatedVotes);
        }
      }, 220);
    },
    [room, flyDirection, currentIdx, localVotes, submitAllVotesToServer]
  );

  const handleUndoCard = useCallback(() => {
    if (!room || currentIdx <= 0 || flyDirection !== null) return;
    const prevIdx = currentIdx - 1;
    const prevOpt = room.options[prevIdx];
    setCurrentIdx(prevIdx);
    if (prevOpt) {
      setLocalVotes((prev) => {
        const next = { ...prev };
        delete next[prevOpt.id];
        return next;
      });
    }
  }, [room, currentIdx, flyDirection]);

  const handleToggleTrayVote = (optionId: string) => {
    if (!localVotes[optionId]) return;
    setLocalVotes((prev) => ({
      ...prev,
      [optionId]: prev[optionId] === "pick" ? "pass" : "pick",
    }));
  };

  // Keyboard shortcuts on Swipe screen: Left = Pass, Right = Pick, Z = Undo
  useEffect(() => {
    if (screenPhase !== "swipe") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        commitCardVote("pick");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        commitCardVote("pass");
      } else if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndoCard();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screenPhase, commitCardVote, handleUndoCard]);

  const handleHostRevealNow = async () => {
    if (!roomCode || !hostToken || isRevealing) return;
    setIsRevealing(true);
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reveal",
          roomId: roomCode,
          hostToken,
        }),
      });
      const data = (await res.json()) as { room?: PublicRoom };
      if (res.ok && data.room) {
        setRoom(data.room);
      }
    } finally {
      setIsRevealing(false);
    }
  };

  const shareUrlDisplay = useMemo(() => {
    if (!roomCode) return "";
    const host = window.location.host || "decisionroom.app";
    return `${host}/r/${roomCode}`;
  }, [roomCode]);

  const fullShareUrl = useMemo(() => {
    if (!roomCode) return "";
    return `${window.location.origin}/r/${roomCode}`;
  }, [roomCode]);

  const handleCopyShareLink = async () => {
    if (!fullShareUrl) return;
    try {
      await navigator.clipboard.writeText(fullShareUrl);
    } catch {
      // fallback
    }
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1600);
  };

  const handleCopyResultForGroupChat = async () => {
    if (!room || !room.winner) return;
    const summary = room.winner.allPassed
      ? `🎲 ${room.winner.label} (Randomizer pick) - ${room.title}`
      : `🏆 ${room.winner.label} (${room.winner.picks}/${room.winner.totalVoters} picks) - ${room.title}`;
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      // ignore
    }
    setCopiedResult(true);
    window.setTimeout(() => setCopiedResult(false), 1600);
  };

  const guestPlaceholder = useMemo(() => {
    const count = room ? room.participants.length : 0;
    const animal = GUEST_ANIMALS[count % GUEST_ANIMALS.length];
    return `${animal} (auto-assigned if blank)`;
  }, [room]);

  const showHeaderMeta =
    screenPhase !== "create" && screenPhase !== "expired" && room !== null;

  const pickStampOpacity =
    flyDirection === "pick"
      ? 1
      : dragDx > 0
        ? Math.min(1, Math.max(0, (Math.abs(dragDx) - 20) / 70))
        : 0;

  const passStampOpacity =
    flyDirection === "pass"
      ? 1
      : dragDx < 0
        ? Math.min(1, Math.max(0, (Math.abs(dragDx) - 20) / 70))
        : 0;

  const cardTransformStyle = useMemo(() => {
    if (flyDirection === "pick") {
      return "translateX(280px) rotate(12deg)";
    }
    if (flyDirection === "pass") {
      return "translateX(-280px) rotate(-12deg)";
    }
    if (dragDx !== 0) {
      return `translateX(${dragDx}px) rotate(${dragDx * 0.05}deg)`;
    }
    return "translateX(0px) rotate(0deg)";
  }, [flyDirection, dragDx]);

  return (
    <div
      className={`min-h-[100dvh] bg-[#FAF8F5] text-[#141413] flex flex-col ${
        screenPhase === "swipe" ? "overflow-x-hidden" : ""
      }`}
    >
      {/* Persistent 56px Top Header */}
      <header className="sticky top-0 z-30 h-14 px-5 border-b border-[#E8E4DC] bg-[#FAF8F5]/90 backdrop-blur-md shrink-0">
        <div className="max-w-[920px] mx-auto h-full flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigateToRoom(null)}
            className="font-display font-extrabold text-base tracking-[-0.02em] flex items-center gap-2 text-[#141413] cursor-pointer min-h-[44px]"
          >
            <span className="w-6 h-6 rounded-lg bg-[#FF5A36] text-white grid place-items-center text-[13px] leading-none">
              ⚡
            </span>
            <span>Decision Room</span>
          </button>

          {showHeaderMeta && room && (
            <div className="flex items-center gap-2">
              <span
                data-testid="header-people-pill"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-live-dot" />
                <span>{Math.max(1, room.participants.length)} in room</span>
              </span>
              <span
                data-testid="header-ttl-pill"
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-mono bg-white border border-[#E8E4DC] text-[#6B6860]"
              >
                {formatTtlMinutes(room.expiresAt, nowMs)}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Non-blocking Network Hiccup Banner */}
      {pollError && (
        <div
          role="status"
          className="bg-[#FEF3C7] border-b border-[#FDE68A] text-[#92400E] px-4 py-2 text-center text-xs font-semibold"
        >
          Connection hiccup — retrying…
        </div>
      )}

      {/* Main Content Shell */}
      <main className="flex-1 flex flex-col items-center px-4 py-5 sm:py-9">
        {screenPhase === "create" && (
          /* ================= SCREEN 1: CREATE ROOM (/) ================= */
          <section
            data-testid="screen-create"
            className="w-full max-w-[460px] sm:max-w-[500px] flex flex-col gap-[18px]"
          >
            <div>
              <h1 className="font-display text-[26px] sm:text-[28px] font-extrabold leading-[1.15] text-[#141413]">
                End group-chat indecision.
              </h1>
              <p className="text-sm text-[#6B6860] leading-[1.45] mt-1.5">
                Add 3–6 options, share one link, and let everyone swipe. Rooms auto-expire in 60 min.
              </p>
            </div>

            <form onSubmit={handleCreateRoom} className="flex flex-col gap-[18px]">
              <div className="bg-white border border-[#E8E4DC] rounded-3xl p-5 shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08),0_2px_6px_rgba(20,20,19,0.04)] flex flex-col gap-4">
                {/* Room Prompt Input */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.04em] text-[#6B6860] mb-2">
                    <label htmlFor="room-prompt-input">Room Prompt (Optional)</label>
                    <span className="font-mono">{promptInput.length}/60</span>
                  </div>
                  <input
                    id="room-prompt-input"
                    type="text"
                    value={promptInput}
                    maxLength={60}
                    onChange={(e) => setPromptInput(e.target.value)}
                    placeholder="e.g., Friday dinner? Movie night?"
                    className="w-full h-[46px] px-3.5 rounded-[14px] border-[1.5px] border-[#E8E4DC] bg-[#FAF8F5] text-[15px] text-[#141413] placeholder:text-[#6B6860]/60 focus:border-[#141413] focus:bg-white focus:outline-none transition-colors"
                  />
                </div>

                {/* Options List (3-6) */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.04em] text-[#6B6860] mb-2">
                    <span>Options (3–6)</span>
                    <span className="font-mono">{optionRows.length} of 6</span>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {optionRows.map((val, idx) => {
                      const isLink = hasUrlIndicator(val);
                      const canRemove = optionRows.length > LIMITS.minOptions;
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="w-[26px] h-[26px] rounded-lg bg-[#F3EFE8] text-[#6B6860] font-mono text-xs font-semibold grid place-items-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={val}
                              maxLength={LIMITS.optionMaxLength}
                              aria-label={`Option ${idx + 1}`}
                              placeholder={
                                idx === 0
                                  ? "e.g., Ramen Nagi"
                                  : idx === 1
                                    ? "e.g., Tacos El Gordo"
                                    : idx === 2
                                      ? "e.g., https://marugameudon.com"
                                      : `Option ${idx + 1}`
                              }
                              onChange={(e) => {
                                const nextVal = e.target.value;
                                setCreateError(null);
                                setOptionRows((prev) =>
                                  prev.map((item, i) => (i === idx ? nextVal : item))
                                );
                              }}
                              className={`w-full h-[46px] rounded-[14px] border-[1.5px] border-[#E8E4DC] bg-[#FAF8F5] text-[15px] text-[#141413] placeholder:text-[#6B6860]/60 focus:border-[#141413] focus:bg-white focus:outline-none transition-colors ${
                                isLink ? "pl-3.5 pr-9" : "px-3.5"
                              }`}
                            />
                            {isLink && (
                              <span
                                title="Link detected"
                                aria-label="Link detected"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
                              >
                                🔗
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={!canRemove}
                            onClick={() => {
                              if (!canRemove) return;
                              setCreateError(null);
                              setOptionRows((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            title="Remove"
                            aria-label={`Remove option ${idx + 1}`}
                            className={`w-11 h-11 rounded-[10px] border border-[#E8E4DC] bg-white grid place-items-center text-base shrink-0 transition-colors ${
                              canRemove
                                ? "text-[#6B6860] hover:bg-[#F3EFE8] hover:text-[#141413] cursor-pointer"
                                : "text-[#6B6860]/35 opacity-50 cursor-not-allowed"
                            }`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {optionRows.length < LIMITS.maxOptions && (
                    <button
                      type="button"
                      onClick={() => {
                        setOptionRows((prev) => [...prev, ""]);
                      }}
                      className="w-full min-h-[44px] mt-2 rounded-2xl bg-transparent hover:bg-[#F3EFE8] text-[#6B6860] hover:text-[#141413] text-[13px] font-semibold inline-flex items-center justify-center transition-colors cursor-pointer"
                    >
                      + Add option (up to 6)
                    </button>
                  )}
                </div>

                {createError && (
                  <div
                    role="alert"
                    className="rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-3.5 py-2.5 text-xs font-semibold"
                  >
                    {createError}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <button
                  type="submit"
                  disabled={nonBlankOptionsCount < LIMITS.minOptions || isCreating}
                  className="w-full min-h-[50px] px-5 rounded-2xl bg-[#FF5A36] hover:bg-[#E84825] disabled:bg-[#E8E4DC] disabled:text-[#6B6860] disabled:shadow-none text-white text-[15px] font-bold shadow-[0_6px_16px_-4px_rgba(255,90,54,0.4)] inline-flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed"
                >
                  {isCreating ? (
                    <span>Creating room…</span>
                  ) : (
                    <span>Create Room &amp; Get Link →</span>
                  )}
                </button>
                {nonBlankOptionsCount < LIMITS.minOptions && (
                  <p className="text-center text-xs text-[#6B6860] font-medium">
                    Add at least 3 options ({nonBlankOptionsCount}/3 entered)
                  </p>
                )}
              </div>
            </form>
          </section>
        )}

        {screenPhase === "lobby" && (
          /* ================= SCREEN 2: JOIN / LOBBY (/r/:code) ================= */
          <section
            data-testid="screen-lobby"
            className="w-full max-w-[460px] flex flex-col gap-[18px]"
          >
            {isLoadingRoom && !room ? (
              <div className="bg-white border border-[#E8E4DC] rounded-3xl p-8 text-center shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08)]">
                <p className="text-sm font-semibold text-[#6B6860]">Loading decision room…</p>
              </div>
            ) : (
              room && (
                <>
                  {/* Share Banner */}
                  <div className="bg-white border-[1.5px] border-dashed border-[#D6D0C4] rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5">
                    <span className="font-mono text-[13px] text-[#141413] truncate">
                      {shareUrlDisplay}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyShareLink}
                      className={`min-h-[44px] px-3.5 py-2 rounded-[10px] text-xs font-semibold text-white shrink-0 transition-colors cursor-pointer ${
                        copiedLink ? "bg-[#16A34A]" : "bg-[#141413] hover:bg-[#141413]/85"
                      }`}
                    >
                      {copiedLink ? "Copied ✓" : "Copy Link"}
                    </button>
                  </div>

                  {/* Lobby Card */}
                  <form
                    onSubmit={handleStartSwiping}
                    className="bg-white border border-[#E8E4DC] rounded-3xl px-[22px] py-7 text-center shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08),0_2px_6px_rgba(20,20,19,0.04)]"
                  >
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-white border border-[#E8E4DC] text-[#6B6860] mb-3">
                      {room.options.length} options · Expires in{" "}
                      {formatTtlMinutes(room.expiresAt, nowMs)}
                    </span>

                    <h1 className="font-display text-[26px] font-extrabold leading-[1.15] text-[#141413]">
                      {room.title}
                    </h1>
                    <p className="text-sm text-[#6B6860] leading-[1.45] mt-1.5">
                      Zero login. Swipe right on places you&apos;d be happy with.
                    </p>

                    <div className="text-left mt-[22px]">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.04em] text-[#6B6860] mb-2">
                        <label htmlFor="participant-name-input">Your Name (Optional)</label>
                      </div>
                      <input
                        id="participant-name-input"
                        type="text"
                        value={nameInput}
                        maxLength={LIMITS.nameMaxLength}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder={guestPlaceholder}
                        className="w-full h-[46px] px-3.5 rounded-[14px] border-[1.5px] border-[#E8E4DC] bg-[#FAF8F5] text-[15px] text-[#141413] placeholder:text-[#6B6860]/60 focus:border-[#141413] focus:bg-white focus:outline-none transition-colors"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isJoining}
                      className="w-full min-h-[50px] mt-4 px-5 rounded-2xl bg-[#FF5A36] hover:bg-[#E84825] text-white text-[15px] font-bold shadow-[0_6px_16px_-4px_rgba(255,90,54,0.4)] inline-flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
                    >
                      <span>{isJoining ? "Joining…" : "Start Swiping →"}</span>
                    </button>
                  </form>

                  <div className="text-center text-[13px] text-[#6B6860]">
                    {room.participants.length === 1
                      ? "1 person already joined"
                      : `${room.participants.length} people already joined`}
                  </div>
                </>
              )
            )}
          </section>
        )}

        {screenPhase === "swipe" && room && (
          /* ================= SCREEN 3: SWIPE / VOTE (Option B + Option C Tray) ================= */
          <section
            data-testid="screen-swipe"
            className="w-full max-w-[460px] flex flex-col gap-[18px]"
          >
            {/* Progress HUD */}
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[15px] font-bold text-[#141413] truncate">
                  {room.title}
                </strong>
                <span
                  data-testid="swipe-progress-pill"
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-mono bg-white border border-[#E8E4DC] text-[#6B6860] shrink-0"
                >
                  {Math.min(currentIdx + 1, room.options.length)} of {room.options.length}
                </span>
              </div>
              <div className="h-1.5 bg-[#F3EFE8] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF5A36] rounded-full transition-all duration-250"
                  style={{
                    width: `${
                      ((Math.min(currentIdx + 1, room.options.length)) / room.options.length) * 100
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Split-Face Decision Card Stack */}
            {(() => {
              const currentOption = room.options[currentIdx] ?? room.options[0];
              const nextOption = room.options[currentIdx + 1] ?? null;
              const formattedNum = String(currentIdx + 1).padStart(2, "0");

              return (
                <div className="relative w-full h-[324px] my-1 select-none">
                  {/* Back Peeking Card */}
                  {nextOption && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-white border-[1.5px] border-[#E8E4DC] rounded-[26px] shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08)] scale-95 translate-y-3 opacity-60 pointer-events-none z-10 flex flex-col overflow-hidden"
                    >
                      <div className="flex-1 p-6 flex flex-col justify-between">
                        <div className="font-mono text-[38px] font-bold text-[#E8E4DC] leading-none">
                          {String(currentIdx + 2).padStart(2, "0")}
                        </div>
                        <div className="font-display text-[26px] font-extrabold text-[#141413]/40 leading-[1.18] truncate">
                          {nextOption.label}
                        </div>
                        <span className="text-xs text-[#6B6860]/50">
                          Drag card or tap below
                        </span>
                      </div>
                      <div className="h-[66px] border-t-[1.5px] border-[#E8E4DC] grid grid-cols-2" />
                    </div>
                  )}

                  {/* Front Interactive Split-Face Card */}
                  <div
                    data-testid="swipe-front-card"
                    onPointerDown={(e) => {
                      const targetEl = e.target as HTMLElement | null;
                      // Critical pointer guard: ignore events originating inside footer buttons or link chips
                      if (targetEl && targetEl.closest("button, a")) {
                        return;
                      }
                      setIsDragging(true);
                      dragStartXRef.current = e.clientX;
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // ignore synthetic pointer events
                      }
                    }}
                    onPointerMove={(e) => {
                      if (!isDragging) return;
                      setDragDx(e.clientX - dragStartXRef.current);
                    }}
                    onPointerUp={() => {
                      if (!isDragging) return;
                      setIsDragging(false);
                      if (dragDx > 90) {
                        commitCardVote("pick");
                      } else if (dragDx < -90) {
                        commitCardVote("pass");
                      } else {
                        setDragDx(0);
                      }
                    }}
                    onPointerCancel={() => {
                      setIsDragging(false);
                      setDragDx(0);
                    }}
                    style={{
                      transform: cardTransformStyle,
                      opacity: flyDirection ? 0 : 1,
                      transition: isDragging
                        ? "none"
                        : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease",
                      touchAction: "none",
                    }}
                    className="absolute inset-0 z-20 bg-white border-[1.5px] border-[#E8E4DC] rounded-[26px] shadow-[0_20px_44px_-12px_rgba(20,20,19,0.14)] flex flex-col overflow-hidden cursor-grab active:cursor-grabbing"
                  >
                    {/* PICK / PASS Stamps */}
                    <div
                      style={{ opacity: pickStampOpacity }}
                      className="absolute top-[18px] left-[18px] z-30 pointer-events-none px-3 py-1 rounded-[10px] font-display text-base font-extrabold tracking-[0.04em] border-[2.5px] border-[#16A34A] text-[#16A34A] bg-[#DCFCE7] -rotate-8"
                    >
                      PICK ✓
                    </div>
                    <div
                      style={{ opacity: passStampOpacity }}
                      className="absolute top-[18px] right-[18px] z-30 pointer-events-none px-3 py-1 rounded-[10px] font-display text-base font-extrabold tracking-[0.04em] border-[2.5px] border-[#DC2626] text-[#DC2626] bg-[#FEE2E2] rotate-8"
                    >
                      PASS ✕
                    </div>

                    {/* Upper Showcase */}
                    <div className="flex-1 p-6 flex flex-col justify-between">
                      <div
                        data-testid="card-index-number"
                        className="font-mono text-[38px] font-bold text-[#E8E4DC] leading-none"
                      >
                        {formattedNum}
                      </div>

                      <div>
                        <div
                          data-testid="card-option-title"
                          className="font-display text-[26px] sm:text-[28px] font-extrabold text-[#141413] leading-[1.18] tracking-[-0.025em] break-words"
                        >
                          {currentOption.label}
                        </div>
                        {currentOption.url && (
                          <a
                            href={currentOption.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 px-3 py-2 min-h-[44px] rounded-xl bg-[#F3EFE8] hover:bg-[#E8E4DC] text-[#141413] text-[13px] font-semibold no-underline transition-colors"
                          >
                            <span>🔗 Open link ↗</span>
                          </a>
                        )}
                      </div>

                      <span className="text-xs text-[#6B6860]">
                        Drag card or tap below
                      </span>
                    </div>

                    {/* Docked 66px Two-Tone Action Footer */}
                    <div className="grid grid-cols-2 border-t-[1.5px] border-[#E8E4DC] h-[66px] shrink-0">
                      <button
                        type="button"
                        data-testid="btn-pass"
                        onClick={() => commitCardVote("pass")}
                        className="bg-white hover:bg-[#FEE2E2] text-[#DC2626] border-r-[1.5px] border-[#E8E4DC] text-[15px] font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <span>✕ Pass</span>
                      </button>
                      <button
                        type="button"
                        data-testid="btn-pick"
                        onClick={() => commitCardVote("pick")}
                        className="bg-white hover:bg-[#DCFCE7] text-[#16A34A] text-[15px] font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <span>✓ Pick</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Live Votes History Tray (Option C merge) */}
            <div className="bg-white border border-[#E8E4DC] rounded-[18px] px-3.5 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#6B6860]">
                  Your votes so far (tap to toggle)
                </span>
                <button
                  type="button"
                  disabled={currentIdx === 0}
                  onClick={handleUndoCard}
                  className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold text-[#6B6860] hover:text-[#141413] hover:bg-[#F3EFE8] disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  ↶ Undo
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {room.options.map((opt) => {
                  const v = localVotes[opt.id];
                  const isPick = v === "pick";
                  const isPass = v === "pass";
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleToggleTrayVote(opt.id)}
                      className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        isPick
                          ? "bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0] cursor-pointer"
                          : isPass
                            ? "bg-[#FEE2E2] text-[#DC2626] border-[#FECACA] line-through cursor-pointer"
                            : "bg-[#F3EFE8] text-[#6B6860] border-[#E8E4DC] cursor-default"
                      }`}
                    >
                      {isPick ? `✓ ${opt.label}` : isPass ? `✕ ${opt.label}` : opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Desktop Keyboard Hints */}
            <div className="hidden sm:flex items-center justify-center gap-4 text-xs text-[#6B6860] mt-1">
              <span>
                <kbd className="bg-white border border-[#E8E4DC] rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                  ←
                </kbd>{" "}
                Pass
              </span>
              <span>
                <kbd className="bg-white border border-[#E8E4DC] rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                  →
                </kbd>{" "}
                Pick
              </span>
              <span>
                <kbd className="bg-white border border-[#E8E4DC] rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                  Z
                </kbd>{" "}
                Undo
              </span>
            </div>
          </section>
        )}

        {screenPhase === "waiting" && room && (
          /* ================= SCREEN 4: WAITING STATE ================= */
          <section
            data-testid="screen-waiting"
            className="w-full max-w-[460px] flex flex-col gap-[18px]"
          >
            <div className="bg-white border border-[#E8E4DC] rounded-3xl p-5 text-center shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08)]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0] mb-2.5">
                ✓ Your votes are locked in
              </span>
              <h1 className="font-display text-[26px] font-extrabold leading-[1.15] text-[#141413]">
                Waiting on the group…
              </h1>
              <p className="text-sm text-[#6B6860] leading-[1.45] mt-1.5">
                Winner reveals automatically as soon as everyone finishes.
              </p>
            </div>

            {/* Live Participants Card */}
            <div className="bg-white border border-[#E8E4DC] rounded-3xl px-5 py-3.5 shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08)]">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.04em] text-[#6B6860] mt-1.5 mb-2">
                <span>
                  Participants ({room.doneCount} of {room.participants.length} done)
                </span>
              </div>

              <div className="divide-y divide-[#E8E4DC]">
                {room.participants.map((p) => {
                  const initial = (p.name.trim()[0] || "G").toUpperCase();
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between py-2.5 gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#F3EFE8] grid place-items-center text-[13px] font-bold text-[#141413] shrink-0">
                          {initial}
                        </div>
                        <span
                          className={`text-sm truncate ${
                            p.done ? "font-bold text-[#141413]" : "font-medium text-[#141413]"
                          }`}
                        >
                          {p.name}
                          {p.isHost ? " (Host)" : ""}
                        </span>
                      </div>

                      {p.done ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0] shrink-0">
                          ✓ Done
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A] shrink-0">
                          ⋯ Swiping
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Share Banner Repeated */}
            <div className="bg-white border-[1.5px] border-dashed border-[#D6D0C4] rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5">
              <span className="font-mono text-[13px] text-[#141413] truncate">
                {shareUrlDisplay}
              </span>
              <button
                type="button"
                onClick={handleCopyShareLink}
                className={`min-h-[44px] px-3.5 py-2 rounded-[10px] text-xs font-semibold text-white shrink-0 transition-colors cursor-pointer ${
                  copiedLink ? "bg-[#16A34A]" : "bg-[#141413] hover:bg-[#141413]/85"
                }`}
              >
                {copiedLink ? "Copied ✓" : "Copy Link"}
              </button>
            </div>

            {/* Host-Only Early Reveal Control */}
            {hostToken && (
              <button
                type="button"
                data-testid="btn-host-reveal"
                disabled={isRevealing}
                onClick={handleHostRevealNow}
                className="w-full min-h-[50px] px-5 rounded-2xl bg-white hover:bg-[#F3EFE8] text-[#141413] border-[1.5px] border-[#E8E4DC] text-[15px] font-bold inline-flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
              >
                <span>
                  {isRevealing ? "Revealing winner…" : "Host: Reveal Winner Now →"}
                </span>
              </button>
            )}
          </section>
        )}

        {screenPhase === "winner" && room && room.winner && (
          /* ================= SCREEN 5: WINNER REVEAL ================= */
          <section
            data-testid="screen-winner"
            className="w-full max-w-[460px] sm:max-w-[500px] flex flex-col gap-[18px]"
          >
            {/* Winner Highlight Card */}
            <div className="bg-gradient-to-br from-white to-[#FFF7F4] border-2 border-[#FF5A36] rounded-[28px] p-6 text-center shadow-[0_20px_44px_-14px_rgba(255,90,54,0.25)]">
              <div className="text-4xl mb-2">🏆</div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-white border border-[#E8E4DC] text-[#6B6860] mb-2.5">
                {room.title} · Winner
              </span>
              <h1
                data-testid="winner-option-title"
                className="font-display text-[30px] font-extrabold leading-[1.15] text-[#141413] mb-2 break-words"
              >
                {room.winner.label}
              </h1>

              {room.winner.url && (
                <div className="mb-2.5">
                  <a
                    href={room.winner.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl bg-[#F3EFE8] hover:bg-[#E8E4DC] text-[#141413] text-[13px] font-semibold no-underline transition-colors"
                  >
                    <span>🔗 Open link ↗</span>
                  </a>
                </div>
              )}

              <p
                className={`text-[15px] font-semibold ${
                  room.winner.allPassed ? "text-[#D97706]" : "text-[#16A34A]"
                }`}
              >
                {room.winner.allPassed
                  ? "Nobody agreed! Randomizer picked this"
                  : `${room.winner.picks} of ${room.winner.totalVoters} picked this`}
              </p>
            </div>

            {/* Conditional Tie-Breaker / All-Pass Banner */}
            {room.winner.tieBreakApplied && (
              <div
                data-testid="tie-breaker-banner"
                className="bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-[14px] px-3.5 py-2.5 text-[13px] font-medium flex items-start gap-2 text-left"
              >
                <span>⚡</span>
                <div>
                  {room.winner.allPassed ? (
                    <>
                      <strong>All-Pass Randomizer:</strong> Every option received 0 picks —{" "}
                      <strong>{room.winner.label}</strong> was randomly selected.
                    </>
                  ) : (
                    <>
                      <strong>Tie-breaker activated:</strong>{" "}
                      {room.winner.tiedOptionLabels.join(" and ")} tied at{" "}
                      {room.winner.picks}{" "}
                      {room.winner.picks === 1 ? "vote" : "votes"} each —{" "}
                      <strong>{room.winner.label}</strong> was randomly selected.
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Vote Breakdown Card */}
            <div className="bg-white border border-[#E8E4DC] rounded-3xl p-5 shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08)]">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.04em] text-[#6B6860] mb-2">
                <span>Vote Breakdown</span>
              </div>

              <div className="flex flex-col">
                {room.winner.breakdown.map((item, idx) => {
                  const isWin = item.optionId === room.winner?.optionId;
                  return (
                    <div key={item.optionId} className="flex flex-col gap-1.5 py-2">
                      <div
                        className={`flex items-center justify-between text-sm ${
                          isWin
                            ? "font-semibold text-[#141413]"
                            : idx === room.winner!.breakdown.length - 1
                              ? "text-[#6B6860]"
                              : "text-[#141413]"
                        }`}
                      >
                        <span className="truncate pr-2">
                          {idx + 1}. {item.label} {isWin ? "🏆" : ""}
                        </span>
                        <span className="font-mono shrink-0">
                          {item.picks} / {item.totalVoters}
                        </span>
                      </div>
                      <div className="h-2 bg-[#F3EFE8] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isWin ? "bg-[#FF5A36]" : "bg-[#141413]"
                          }`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer CTAs */}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => navigateToRoom(null)}
                className="w-full min-h-[50px] px-5 rounded-2xl bg-[#FF5A36] hover:bg-[#E84825] text-white text-[15px] font-bold shadow-[0_6px_16px_-4px_rgba(255,90,54,0.4)] inline-flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
              >
                <span>Start a New Room</span>
              </button>
              <button
                type="button"
                onClick={handleCopyResultForGroupChat}
                className="w-full min-h-[50px] px-5 rounded-2xl bg-white hover:bg-[#F3EFE8] text-[#141413] border-[1.5px] border-[#E8E4DC] text-[15px] font-bold inline-flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
              >
                <span>
                  {copiedResult ? "Copied Result ✓" : "Copy Result for Group Chat"}
                </span>
              </button>
            </div>
          </section>
        )}

        {screenPhase === "expired" && (
          /* ================= SCREEN 6: EXPIRED / 404 ROOM ================= */
          <section
            data-testid="screen-expired"
            className="w-full max-w-[460px] my-auto flex flex-col gap-[18px]"
          >
            <div className="bg-white border border-[#E8E4DC] rounded-3xl px-6 py-9 text-center shadow-[0_12px_32px_-8px_rgba(20,20,19,0.08)]">
              <div className="text-[40px] mb-3">⏳</div>
              <h1 className="font-display text-[26px] font-extrabold leading-[1.15] text-[#141413]">
                This room has expired
              </h1>
              <p className="text-sm text-[#6B6860] leading-[1.45] mt-1.5 mb-[22px]">
                Decision rooms auto-delete after 60 minutes to keep things disposable and clutter-free.
              </p>
              <button
                type="button"
                onClick={() => navigateToRoom(null)}
                className="w-full min-h-[50px] px-5 rounded-2xl bg-[#FF5A36] hover:bg-[#E84825] text-white text-[15px] font-bold shadow-[0_6px_16px_-4px_rgba(255,90,54,0.4)] inline-flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
              >
                <span>Create a New Room →</span>
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
