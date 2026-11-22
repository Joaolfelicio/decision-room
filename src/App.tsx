import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import {
  LIMITS,
  type PublicRoom,
  type RoomOption,
  type Votes,
} from "../shared/types.ts";

interface PresetTemplate {
  id: string;
  label: string;
  title: string;
  options: string[];
}

const PRESETS: PresetTemplate[] = [
  {
    id: "dinner",
    label: "Tonight's Dinner",
    title: "Where are we eating tonight?",
    options: [
      "Birria Tacos & Margaritas",
      "Wood-Fired Neapolitan Pizza",
      "Spicy Tonkotsu Ramen",
      "Smashburgers & Loaded Fries",
    ],
  },
  {
    id: "movie",
    label: "Movie Night",
    title: "What are we watching tonight?",
    options: [
      "Dune: Part Two - https://www.imdb.com/title/tt15239678/",
      "Knives Out (Mystery Rewatch)",
      "Spider-Man: Across the Spider-Verse",
      "Everything Everywhere All at Once",
    ],
  },
  {
    id: "weekend",
    label: "Weekend Plan",
    title: "Saturday afternoon plan?",
    options: [
      "Coffee Walk + Farmers Market",
      "Board Game Cafe Showdown",
      "Sunset Kayaking / Trail Walk",
      "Co-Op Couch Gaming Marathon",
    ],
  },
];

interface StoredSession {
  participantId: string;
  participantToken: string;
  name: string;
}

function getRoomIdFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("room");
  if (fromQuery && /^[A-Za-z0-9]{4,10}$/.test(fromQuery.trim())) {
    return fromQuery.trim().toUpperCase();
  }
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("room=")) {
    const id = hash.slice(5).trim();
    if (/^[A-Za-z0-9]{4,10}$/.test(id)) return id.toUpperCase();
  }
  return null;
}

function setRoomIdInLocation(roomId: string | null) {
  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set("room", roomId.toUpperCase());
  } else {
    url.searchParams.delete("room");
  }
  url.hash = "";
  window.history.pushState({}, "", url.toString());
}

function loadSession(roomId: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(`swipepick:session:${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.participantId && parsed.participantToken) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveSession(roomId: string, session: StoredSession) {
  try {
    localStorage.setItem(`swipepick:session:${roomId}`, JSON.stringify(session));
  } catch {
    // ignore storage errors
  }
}

function loadHostToken(roomId: string): string | null {
  try {
    return localStorage.getItem(`swipepick:host:${roomId}`);
  } catch {
    return null;
  }
}

function saveHostToken(roomId: string, token: string) {
  try {
    localStorage.setItem(`swipepick:host:${roomId}`, token);
  } catch {
    // ignore storage errors
  }
}

function formatTimeRemaining(expiresAt: string): string {
  const diffMs = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(diffMs) || diffMs <= 0) return "Expired";
  const mins = Math.ceil(diffMs / 60000);
  return `${mins}m left`;
}

export default function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() =>
    getRoomIdFromLocation()
  );

  // Room creation state
  const [titleInput, setTitleInput] = useState("Where are we eating tonight?");
  const [optionInputs, setOptionInputs] = useState<string[]>([
    "Birria Tacos & Margaritas",
    "Wood-Fired Neapolitan Pizza",
    "Spicy Tonkotsu Ramen",
    "Smashburgers & Loaded Fries",
  ]);
  const [groupSizeInput, setGroupSizeInput] = useState<number | null>(2);
  const [hostNameInput, setHostNameInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");

  // Active room state
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<Votes>({});
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinNameDraft, setJoinNameDraft] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [isEditingVotes, setIsEditingVotes] = useState(false);
  const [swipeFeedback, setSwipeFeedback] = useState<"yes" | "no" | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const dragStartXRef = useRef<number | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setActiveRoomId(getRoomIdFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const fetchRoomState = useCallback(
    async (roomId: string, activeSession: StoredSession | null) => {
      const qs = new URLSearchParams({ id: roomId });
      if (activeSession) {
        qs.set("participantId", activeSession.participantId);
        qs.set("participantToken", activeSession.participantToken);
      }
      const res = await fetch(`/api/room?${qs.toString()}`, {
        headers: { accept: "application/json" },
      });
      const data = (await res.json()) as {
        room?: PublicRoom;
        myVotes?: Votes | null;
        error?: string;
      };
      if (!res.ok || !data.room) {
        throw new Error(data.error || "Could not load room.");
      }
      return data;
    },
    []
  );

  // Initial room load when activeRoomId changes
  useEffect(() => {
    if (!activeRoomId) {
      setRoom(null);
      setSession(null);
      setHostToken(null);
      setMyVotes({});
      setRoomError(null);
      setCurrentCardIndex(0);
      setIsEditingVotes(false);
      return;
    }

    const savedSess = loadSession(activeRoomId);
    const savedHost = loadHostToken(activeRoomId);
    setSession(savedSess);
    setHostToken(savedHost);
    setIsLoadingRoom(true);
    setRoomError(null);

    let cancelled = false;
    fetchRoomState(activeRoomId, savedSess)
      .then((data) => {
        if (cancelled || !data.room) return;
        setRoom(data.room);
        if (data.myVotes) {
          setMyVotes(data.myVotes);
          const firstUnvoted = data.room.options.findIndex(
            (o) => typeof data.myVotes![o.id] !== "boolean"
          );
          setCurrentCardIndex(
            firstUnvoted === -1 ? data.room.options.length : firstUnvoted
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setRoomError(err instanceof Error ? err.message : "Room not found.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRoom(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRoomId, fetchRoomState]);

  // Lightweight short-polling every 1.8s while room is open; stops automatically when closed
  useEffect(() => {
    if (!activeRoomId || !room || room.status === "closed") return;

    const timer = window.setInterval(async () => {
      try {
        const data = await fetchRoomState(activeRoomId, session);
        if (data.room) {
          setRoom(data.room);
        }
      } catch {
        // ignore transient poll failures
      }
    }, 1800);

    return () => window.clearInterval(timer);
  }, [activeRoomId, room, session, fetchRoomState]);

  const applyPreset = (preset: PresetTemplate) => {
    setTitleInput(preset.title);
    setOptionInputs([...preset.options]);
    setCreateError(null);
  };

  const handleOptionChange = (index: number, value: string) => {
    setOptionInputs((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const handleAddOption = () => {
    if (optionInputs.length >= LIMITS.maxOptions) return;
    setOptionInputs((prev) => [...prev, ""]);
  };

  const handleRemoveOption = (index: number) => {
    if (optionInputs.length <= LIMITS.minOptions) return;
    setOptionInputs((prev) => prev.filter((_, i) => i !== index));
  };

  const joinRoomWithName = async (
    roomId: string,
    nameToUse: string | undefined,
    existingSession: StoredSession | null
  ) => {
    setIsJoining(true);
    try {
      const res = await fetch("/api/room?action=join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomId,
          name: nameToUse?.trim() || undefined,
          participantId: existingSession?.participantId,
          participantToken: existingSession?.participantToken,
        }),
      });
      const data = (await res.json()) as {
        participantId?: string;
        participantToken?: string;
        name?: string;
        myVotes?: Votes;
        room?: PublicRoom;
        error?: string;
      };
      if (!res.ok || !data.participantId || !data.participantToken || !data.room) {
        throw new Error(data.error || "Could not join room.");
      }
      const nextSession: StoredSession = {
        participantId: data.participantId,
        participantToken: data.participantToken,
        name: data.name || "Voter",
      };
      saveSession(roomId, nextSession);
      setSession(nextSession);
      setRoom(data.room);
      if (data.myVotes) {
        setMyVotes(data.myVotes);
      }
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : "Failed to join room.");
    } finally {
      setIsJoining(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    try {
      const res = await fetch("/api/room?action=create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: titleInput,
          options: optionInputs,
          groupSize: groupSizeInput,
        }),
      });

      const data = (await res.json()) as {
        room?: PublicRoom;
        hostToken?: string;
        error?: string;
      };

      if (!res.ok || !data.room || !data.hostToken) {
        throw new Error(data.error || "Could not create room.");
      }

      const newRoomId = data.room.id;
      saveHostToken(newRoomId, data.hostToken);
      setHostToken(data.hostToken);
      setRoom(data.room);
      setMyVotes({});
      setCurrentCardIndex(0);
      setRoomIdInLocation(newRoomId);
      setActiveRoomId(newRoomId);

      // Automatically join the creator as a voter so they can start swiping immediately
      await joinRoomWithName(newRoomId, hostNameInput, null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create room.");
    } finally {
      setIsCreating(false);
    }
  };

  const submitVote = useCallback(
    async (option: RoomOption, decision: boolean) => {
      if (!room || !session || room.status === "closed") return;

      setSwipeFeedback(decision ? "yes" : "no");
      window.setTimeout(() => setSwipeFeedback(null), 220);

      const optimisticVotes: Votes = { ...myVotes, [option.id]: decision };
      setMyVotes(optimisticVotes);

      const nextIndex = currentCardIndex + 1;
      setCurrentCardIndex(nextIndex);
      if (nextIndex >= room.options.length) {
        setIsEditingVotes(false);
      }

      try {
        const res = await fetch("/api/room?action=vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "vote",
            roomId: room.id,
            participantId: session.participantId,
            participantToken: session.participantToken,
            votes: optimisticVotes,
          }),
        });
        const data = (await res.json()) as {
          room?: PublicRoom;
          myVotes?: Votes;
          error?: string;
        };
        if (res.ok && data.room) {
          setRoom(data.room);
          if (data.myVotes) setMyVotes(data.myVotes);
        }
      } catch {
        // next poll will reconcile
      }
    },
    [room, session, myVotes, currentCardIndex]
  );

  const currentOption: RoomOption | null = useMemo(() => {
    if (!room) return null;
    if (currentCardIndex < 0 || currentCardIndex >= room.options.length) return null;
    return room.options[currentCardIndex];
  }, [room, currentCardIndex]);

  // Keyboard support on desktop (ArrowLeft = Pass, ArrowRight = Yes)
  useEffect(() => {
    if (!room || room.status === "closed" || !session || !currentOption) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        submitVote(currentOption, false);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        submitVote(currentOption, true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [room, session, currentOption, submitVote]);

  const handleCloseAndReveal = async () => {
    if (!room) return;
    try {
      const res = await fetch("/api/room?action=close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "close",
          roomId: room.id,
          hostToken: hostToken ?? undefined,
          participantId: session?.participantId,
          participantToken: session?.participantToken,
        }),
      });
      const data = (await res.json()) as { room?: PublicRoom; error?: string };
      if (res.ok && data.room) {
        setRoom(data.room);
      }
    } catch {
      // ignore
    }
  };

  const handleCopyShareLink = async () => {
    if (!room) return;
    const shareUrl = `${window.location.origin}/?room=${room.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleLeaveToHome = (keepOptions = false) => {
    if (keepOptions && room) {
      setTitleInput(room.title);
      setOptionInputs(
        room.options.map((o) => (o.url ? `${o.label} - ${o.url}` : o.label))
      );
      setGroupSizeInput(room.groupSize);
    }
    setRoomIdInLocation(null);
    setActiveRoomId(null);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartXRef.current = e.clientX;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartXRef.current === null) return;
    setDragOffsetX(e.clientX - dragStartXRef.current);
  };

  const handlePointerUp = () => {
    if (dragStartXRef.current === null || !currentOption) {
      setDragOffsetX(0);
      dragStartXRef.current = null;
      return;
    }
    const delta = dragOffsetX;
    setDragOffsetX(0);
    dragStartXRef.current = null;
    if (delta > 75) {
      submitVote(currentOption, true);
    } else if (delta < -75) {
      submitVote(currentOption, false);
    }
  };

  const allCardsVoted =
    room !== null &&
    room.options.every((opt) => typeof myVotes[opt.id] === "boolean");

  const shareUrl = room ? `${window.location.origin}/?room=${room.id}` : "";

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#070b14]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => handleLeaveToHome(false)}
            className="flex items-center gap-2.5 text-left group min-h-[44px]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 shadow-md shadow-emerald-500/20">
              <Flame className="h-5 w-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white">
                  SwipePick
                </span>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  No Login
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Disposable group decision rooms • 60m auto-expiry
              </p>
            </div>
          </button>

          {room ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-slate-300">
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                {formatTimeRemaining(room.expiresAt)}
              </span>
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs sm:text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 active:scale-[0.99] transition"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-300" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    <span>Share #{room.id}</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const cleaned = joinCodeInput.trim().toUpperCase();
                if (/^[A-Z0-9]{4,10}$/.test(cleaned)) {
                  setRoomIdInLocation(cleaned);
                  setActiveRoomId(cleaned);
                  setJoinCodeInput("");
                }
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={8}
                aria-label="Join by room code"
                className="w-24 sm:w-28 min-h-[44px] rounded-xl border border-white/[0.1] bg-[#0d1424] px-2.5 py-1.5 font-mono text-xs uppercase text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[44px] rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/[0.12] transition"
              >
                Join
              </button>
            </form>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:py-8">
        {!activeRoomId ? (
          /* ================= CREATE ROOM VIEW ================= */
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#10192e] to-[#0b1120] p-5 sm:p-7 shadow-2xl">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  End group-chat indecision in 30 seconds
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  Drop 3–6 options. Share the link. Everyone swipes.
                </h1>
                <p className="text-sm text-slate-300/90 leading-relaxed">
                  Zero accounts or app installs. When everyone finishes swiping (or you tap
                  reveal), SwipePick tallies the overlap and breaks ties automatically.
                </p>
              </div>

              {/* Preset chips */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                  Presets:
                </span>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="min-h-[44px] rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-emerald-200 transition"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleCreateRoom} className="mt-5 space-y-5">
                {/* Prompt / Title */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="room-title"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-300"
                  >
                    Decision Prompt
                  </label>
                  <input
                    id="room-title"
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="e.g. Where are we eating tonight?"
                    maxLength={LIMITS.titleMaxLength}
                    className="w-full min-h-[46px] rounded-xl border border-white/[0.1] bg-[#080d19] px-3.5 py-2.5 text-sm sm:text-base font-medium text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                </div>

                {/* Options 3..6 */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Options ({optionInputs.length}/{LIMITS.maxOptions})
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Tip: paste a URL after a title (e.g.{" "}
                      <code className="text-cyan-300">Sushi - https://...</code>)
                    </span>
                  </div>

                  <div className="space-y-2">
                    {optionInputs.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] font-mono text-xs font-bold text-emerald-300">
                          #{idx + 1}
                        </span>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => handleOptionChange(idx, e.target.value)}
                          placeholder={`Option #${idx + 1} (text or Label - https://link)`}
                          maxLength={160}
                          aria-label={`Option ${idx + 1}`}
                          className="flex-1 min-h-[44px] rounded-xl border border-white/[0.1] bg-[#080d19] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                        />
                        {optionInputs.length > LIMITS.minOptions && (
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(idx)}
                            aria-label={`Remove option ${idx + 1}`}
                            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300 transition"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {optionInputs.length < LIMITS.maxOptions && (
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-emerald-400/40 hover:text-emerald-200 transition"
                    >
                      <Plus className="h-4 w-4" />
                      Add Option ({optionInputs.length}/{LIMITS.maxOptions})
                    </button>
                  )}
                </div>

                {/* Group Size & Optional Host Name */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <span className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      Auto-Reveal When Finished
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "2 (Couple)", val: 2 },
                        { label: "3", val: 3 },
                        { label: "4", val: 4 },
                        { label: "5", val: 5 },
                        { label: "Manual", val: null },
                      ].map((item) => {
                        const active = groupSizeInput === item.val;
                        return (
                          <button
                            key={String(item.val)}
                            type="button"
                            onClick={() => setGroupSizeInput(item.val)}
                            className={`min-h-[44px] rounded-xl border px-3 py-1.5 font-mono text-xs font-bold transition ${
                              active
                                ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                                : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="host-name"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      Your Display Name (Optional)
                    </label>
                    <input
                      id="host-name"
                      type="text"
                      value={hostNameInput}
                      onChange={(e) => setHostNameInput(e.target.value)}
                      placeholder="Leave blank for fun auto-name"
                      maxLength={LIMITS.nameMaxLength}
                      className="w-full min-h-[44px] rounded-xl border border-white/[0.1] bg-[#080d19] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                </div>

                {createError && (
                  <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-200">
                    {createError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-3.5 font-display text-base font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 hover:brightness-105 active:scale-[0.99] disabled:opacity-50 transition"
                >
                  <Zap className="h-5 w-5 fill-current" />
                  {isCreating ? "Creating Room..." : "Launch Decision Room"}
                </button>
              </form>
            </div>
          </div>
        ) : isLoadingRoom && !room ? (
          <div className="rounded-3xl border border-white/[0.08] bg-[#0d1424]/90 p-8 text-center space-y-3">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            <p className="font-mono text-sm text-slate-300">
              Loading room #{activeRoomId}...
            </p>
          </div>
        ) : roomError || !room ? (
          <div className="rounded-3xl border border-rose-400/30 bg-[#121626] p-6 sm:p-8 text-center space-y-4">
            <h2 className="font-display text-xl font-bold text-white">
              Room #{activeRoomId} unavailable
            </h2>
            <p className="text-sm text-slate-300">
              {roomError || "This room could not be found or has expired after 60 minutes."}
            </p>
            <button
              type="button"
              onClick={() => handleLeaveToHome(false)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 transition"
            >
              Create a New Room
            </button>
          </div>
        ) : (
          /* ================= ACTIVE OR CLOSED ROOM VIEW ================= */
          <div className="space-y-4">
            {/* Room Top Card: Prompt + Share Link + Live Participants */}
            <div className="rounded-3xl border border-white/[0.08] bg-[#0d1424]/95 p-4 sm:p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                    #{room.id}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                      room.status === "closed"
                        ? "border-amber-400/35 bg-amber-500/15 text-amber-200"
                        : "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                    }`}
                  >
                    {room.status === "closed" ? "Winner Picked" : "Live Voting"}
                  </span>
                </div>

                <span className="font-mono text-xs text-slate-300">
                  {room.doneCount}
                  {room.groupSize ? `/${room.groupSize}` : `/${room.participants.length}`}{" "}
                  done
                </span>
              </div>

              <h1 className="font-display text-xl sm:text-2xl font-extrabold text-white leading-snug">
                {room.title}
              </h1>

              {/* Share URL bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl border border-white/[0.07] bg-[#080d19] p-2">
                <div className="flex-1 truncate px-2.5 py-1 font-mono text-xs text-slate-300 select-all">
                  {shareUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 transition"
                >
                  {copiedLink ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Link Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>Copy Invite Link</span>
                    </>
                  )}
                </button>
              </div>

              {/* Participant Status Strip */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-400 mr-1">
                  <Users className="h-3.5 w-3.5" />
                  Voters:
                </span>
                {room.participants.length === 0 ? (
                  <span className="text-xs text-slate-400">
                    Waiting for first voter...
                  </span>
                ) : (
                  room.participants.map((p) => {
                    const isMe = session?.participantId === p.id;
                    return (
                      <span
                        key={p.id}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          p.done
                            ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-200"
                            : "border-white/[0.1] bg-white/[0.04] text-slate-300"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            p.done ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                          }`}
                        />
                        {p.name}
                        {isMe ? " (you)" : ""}
                        {p.done ? " ✓" : ""}
                      </span>
                    );
                  })
                )}
              </div>
            </div>

            {room.status === "closed" && room.winner && room.results ? (
              /* ================= WINNER REVEAL VIEW ================= */
              <div className="space-y-4">
                {(() => {
                  const winningOption =
                    room.options.find((o) => o.id === room.winner!.optionId) ??
                    room.options[0];
                  const winningScore = room.results!.find(
                    (r) => r.optionId === winningOption.id
                  ) ?? { yes: 0, no: 0 };
                  const totalVoters = Math.max(
                    1,
                    winningScore.yes + winningScore.no
                  );
                  const approvalPct = Math.round(
                    (winningScore.yes / totalVoters) * 100
                  );
                  const tiedLabels = room.winner!.tiedWith
                    .map((id) => room.options.find((o) => o.id === id)?.label)
                    .filter(Boolean);

                  return (
                    <div
                      data-testid="winner-card"
                      className="rounded-3xl border border-emerald-400/40 bg-gradient-to-b from-emerald-500/15 via-[#101c2e] to-[#0b1220] p-5 sm:p-7 shadow-2xl space-y-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 font-mono text-xs font-extrabold uppercase tracking-wider text-emerald-200">
                          <Trophy className="h-4 w-4 text-amber-300" />
                          Room Winner
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-300">
                          {winningScore.yes} Yes • {winningScore.no} Pass ({approvalPct}% match)
                        </span>
                      </div>

                      <div className="space-y-2">
                        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
                          {winningOption.label}
                        </h2>
                        {winningOption.url && (
                          <a
                            href={winningOption.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-3.5 py-2 text-xs sm:text-sm font-bold text-cyan-200 hover:bg-cyan-500/25 transition"
                          >
                            <span>Open Link</span>
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>

                      {room.winner!.tieBroken && (
                        <div
                          data-testid="tie-breaker-badge"
                          className="rounded-2xl border border-amber-400/35 bg-amber-500/12 px-3.5 py-2.5 text-xs font-semibold text-amber-200"
                        >
                          ⚡ Automatic Tie-Breaker: Tied at {winningScore.yes} Yes{" "}
                          {winningScore.yes === 1 ? "vote" : "votes"} with{" "}
                          <span className="font-bold text-white">
                            {tiedLabels.join(", ")}
                          </span>{" "}
                          — won the room coin flip!
                        </div>
                      )}

                      {/* Full Ranked Scoreboard */}
                      <div className="space-y-2.5 border-t border-white/[0.08] pt-4">
                        <div className="font-mono text-xs font-bold uppercase tracking-wider text-slate-400">
                          Full Breakdown
                        </div>
                        {room.results!.map((res, idx) => {
                          const opt = room.options.find(
                            (o) => o.id === res.optionId
                          );
                          if (!opt) return null;
                          const total = Math.max(1, res.yes + res.no);
                          const pct = Math.round((res.yes / total) * 100);
                          const isTop = idx === 0;

                          return (
                            <div
                              key={res.optionId}
                              className={`rounded-2xl border p-3 ${
                                isTop
                                  ? "border-emerald-400/35 bg-emerald-500/10"
                                  : "border-white/[0.07] bg-white/[0.02]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-xs font-bold text-slate-400">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-bold text-white truncate">
                                    {opt.label}
                                  </span>
                                  {opt.url && (
                                    <a
                                      href={opt.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label={`Open ${opt.label}`}
                                      className="text-cyan-300 hover:underline shrink-0"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  )}
                                </div>
                                <span className="font-mono text-xs font-semibold text-slate-300 shrink-0">
                                  {res.yes} Yes / {res.no} No ({pct}%)
                                </span>
                              </div>
                              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    isTop ? "bg-emerald-400" : "bg-cyan-400/70"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 pt-2">
                        <button
                          type="button"
                          onClick={() => handleLeaveToHome(true)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-white/[0.12] transition"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Rematch with Same Options
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLeaveToHome(false)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-4 py-2.5 text-xs sm:text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 transition"
                        >
                          <Plus className="h-4 w-4" />
                          New Decision Room
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : !session ? (
              /* ================= ZERO-LOGIN JOIN CARD ================= */
              <div className="rounded-3xl border border-white/[0.08] bg-[#0d1424]/95 p-5 sm:p-7 space-y-4">
                <div className="space-y-1">
                  <h2 className="font-display text-lg sm:text-xl font-bold text-white">
                    Jump in & vote ({room.options.length} options)
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300">
                    No account needed. Add your name or tap straight in with an
                    auto-assigned nickname.
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    joinRoomWithName(room.id, joinNameDraft, null);
                  }}
                  className="flex flex-col sm:flex-row gap-2.5"
                >
                  <input
                    type="text"
                    value={joinNameDraft}
                    onChange={(e) => setJoinNameDraft(e.target.value)}
                    placeholder="Your name (optional, e.g. Lili)"
                    maxLength={LIMITS.nameMaxLength}
                    aria-label="Your display name"
                    className="flex-1 min-h-[48px] rounded-xl border border-white/[0.1] bg-[#080d19] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isJoining}
                    className="min-h-[48px] rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-2.5 font-display text-sm font-extrabold text-slate-950 hover:brightness-105 disabled:opacity-50 transition"
                  >
                    {isJoining
                      ? "Joining..."
                      : joinNameDraft.trim()
                        ? `Start Voting as ${joinNameDraft.trim()}`
                        : "Start Voting (Instant)"}
                  </button>
                </form>
              </div>
            ) : !allCardsVoted || isEditingVotes ? (
              /* ================= SWIPE / VOTE DECK ================= */
              currentOption && (
                <div className="space-y-4">
                  <div
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{
                      transform: `translateX(${dragOffsetX}px) rotate(${dragOffsetX * 0.03}deg)`,
                    }}
                    className={`select-none rounded-3xl border p-6 sm:p-8 shadow-2xl transition-colors ${
                      swipeFeedback === "yes" || dragOffsetX > 50
                        ? "border-emerald-400/60 bg-emerald-500/15"
                        : swipeFeedback === "no" || dragOffsetX < -50
                          ? "border-rose-400/60 bg-rose-500/15"
                          : "border-white/[0.1] bg-gradient-to-b from-[#131d36] to-[#0c1324]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-xs font-bold text-cyan-300">
                        Option {currentCardIndex + 1} of {room.options.length}
                      </span>
                      <span className="font-mono text-xs text-slate-400">
                        Swipe or tap below
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
                        style={{
                          width: `${Math.round(
                            ((currentCardIndex + 1) / room.options.length) * 100
                          )}%`,
                        }}
                      />
                    </div>

                    <div className="my-8 sm:my-10 space-y-3 text-center">
                      <h2
                        data-testid="active-option-label"
                        className="font-display text-2xl sm:text-3xl font-extrabold text-white leading-tight"
                      >
                        {currentOption.label}
                      </h2>

                      {currentOption.url && (
                        <div>
                          <a
                            href={currentOption.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 transition"
                          >
                            <span>Preview Link</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Thumb-Zone Pass / Yes Buttons (>= 52px touch height) */}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        data-testid="vote-no-btn"
                        onClick={() => submitVote(currentOption, false)}
                        className="min-h-[54px] inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/35 bg-rose-500/15 px-4 py-3 font-display text-base font-extrabold text-rose-200 hover:bg-rose-500/25 active:scale-[0.98] transition"
                      >
                        <ThumbsDown className="h-5 w-5" />
                        <span>Pass</span>
                      </button>

                      <button
                        type="button"
                        data-testid="vote-yes-btn"
                        onClick={() => submitVote(currentOption, true)}
                        className="min-h-[54px] inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/45 bg-emerald-500/20 px-4 py-3 font-display text-base font-extrabold text-emerald-100 hover:bg-emerald-500/30 active:scale-[0.98] transition"
                      >
                        <ThumbsUp className="h-5 w-5" />
                        <span>I'm Down!</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* ================= WAITING / REVIEW VOTES STATE ================= */
              <div className="rounded-3xl border border-white/[0.08] bg-[#0d1424]/95 p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg sm:text-xl font-bold text-white">
                      You're all voted in, {session.name}!
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-300">
                      {room.groupSize
                        ? `Waiting for ${room.doneCount}/${room.groupSize} voters to finish (or reveal now).`
                        : `${room.doneCount} of ${room.participants.length} voters finished.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentCardIndex(0);
                      setIsEditingVotes(true);
                    }}
                    className="min-h-[44px] rounded-xl border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-white/[0.1] transition"
                  >
                    Re-swipe Cards
                  </button>
                </div>

                {/* Quick toggle list of my votes */}
                <div className="space-y-2">
                  {room.options.map((opt) => {
                    const votedYes = myVotes[opt.id] === true;
                    return (
                      <div
                        key={opt.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-[#080d19] px-3.5 py-2.5"
                      >
                        <span className="text-sm font-semibold text-white truncate">
                          {opt.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => submitVote(opt, !votedYes)}
                          className={`min-h-[44px] rounded-xl border px-3 py-1.5 font-mono text-xs font-bold transition ${
                            votedYes
                              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                              : "border-rose-400/35 bg-rose-500/12 text-rose-200"
                          }`}
                        >
                          {votedYes ? "I'm Down ✓" : "Pass ✕"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  data-testid="reveal-winner-btn"
                  onClick={handleCloseAndReveal}
                  className="w-full min-h-[50px] inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-emerald-400 px-5 py-3 font-display text-sm sm:text-base font-extrabold text-slate-950 shadow-lg hover:brightness-105 transition"
                >
                  <Trophy className="h-5 w-5" />
                  Close Voting & Reveal Winner Now
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
