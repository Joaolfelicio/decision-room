import assert from "node:assert/strict";
import {
  computeWinnerSummary,
  parseOptionRaw,
  pickGuestName,
  validateOptionsInput,
} from "../src/roomLogic.ts";

console.log("▶ Running Decision Room v1 unit & tie-breaker checks...");

// 1. Smart URL detection & option validation
const urlOpt = parseOptionRaw("https://marugameudon.com", 2);
assert.ok(urlOpt);
assert.equal(urlOpt.id, "opt-3");
assert.equal(urlOpt.label, "marugameudon.com");
assert.equal(urlOpt.url, "https://marugameudon.com/");

const tooFew = validateOptionsInput(["Ramen Nagi", "Tacos El Gordo", "   "]);
assert.ok("error" in tooFew, "Fewer than 3 non-empty options must fail");

const duplicate = validateOptionsInput(["Ramen Nagi", "ramen nagi", "Thai Basil"]);
assert.ok("error" in duplicate, "Duplicate options must fail");

const validList = validateOptionsInput([
  "Ramen Nagi",
  "Tacos El Gordo",
  "https://marugameudon.com",
  "Thai Basil",
]);
assert.ok("options" in validList);
assert.equal(validList.options.length, 4);

// 2. Guest Animal fallback assignment
const guest1 = pickGuestName("", []);
assert.equal(guest1, "Guest Panda");

// 3. Clear Winner tally
const baseRoom = {
  id: "k9x2",
  hostToken: "htok",
  hostParticipantId: "p1",
  title: "Friday dinner?",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  status: "open",
  options: validList.options,
  participants: {
    p1: {
      id: "p1",
      name: "Joao",
      isHost: true,
      joinedAt: "2026-11-22T00:00:00Z",
      done: true,
      votes: {
        "opt-1": "pick",
        "opt-2": "pick",
        "opt-3": "pass",
        "opt-4": "pass",
      },
    },
    p2: {
      id: "p2",
      name: "Maya",
      isHost: false,
      joinedAt: "2026-11-22T00:00:02Z",
      done: true,
      votes: {
        "opt-1": "pick",
        "opt-2": "pass",
        "opt-3": "pick",
        "opt-4": "pass",
      },
    },
  },
  winner: null,
  tieBreakSeed: 123456,
};

const clearWinner = computeWinnerSummary(baseRoom);
assert.equal(clearWinner.optionId, "opt-1", "Ramen Nagi with 2/2 picks should win");
assert.equal(clearWinner.picks, 2);
assert.equal(clearWinner.totalVoters, 2);
assert.equal(clearWinner.tieBreakApplied, false);
assert.equal(clearWinner.allPassed, false);

// 4. Tie-breaker activation when top options tie
const tiedRoom = {
  ...baseRoom,
  participants: {
    p1: {
      ...baseRoom.participants.p1,
      votes: {
        "opt-1": "pick",
        "opt-2": "pick",
        "opt-3": "pass",
        "opt-4": "pass",
      },
    },
    p2: {
      ...baseRoom.participants.p2,
      votes: {
        "opt-1": "pick",
        "opt-2": "pick",
        "opt-3": "pass",
        "opt-4": "pass",
      },
    },
  },
};

const tieWinA = computeWinnerSummary(tiedRoom);
const tieWinB = computeWinnerSummary(tiedRoom);
assert.equal(tieWinA.tieBreakApplied, true, "Tied top score must set tieBreakApplied=true");
assert.equal(tieWinA.allPassed, false);
assert.equal(tieWinA.optionId, tieWinB.optionId, "Tie-break must be deterministic for room seed");
assert.equal(tieWinA.tiedOptionLabels.length, 2);

// 5. All-Pass edge case (0 picks across all options)
const allPassRoom = {
  ...baseRoom,
  participants: {
    p1: {
      ...baseRoom.participants.p1,
      votes: {
        "opt-1": "pass",
        "opt-2": "pass",
        "opt-3": "pass",
        "opt-4": "pass",
      },
    },
    p2: {
      ...baseRoom.participants.p2,
      votes: {
        "opt-1": "pass",
        "opt-2": "pass",
        "opt-3": "pass",
        "opt-4": "pass",
      },
    },
  },
};

const allPassWinner = computeWinnerSummary(allPassRoom);
assert.equal(allPassWinner.allPassed, true, "0 picks must flag allPassed=true");
assert.equal(allPassWinner.tieBreakApplied, true, "0 picks must flag tieBreakApplied=true");
assert.equal(allPassWinner.picks, 0);

console.log("✓ All Decision Room v1 unit, tie-breaker, and all-pass assertions passed.");
