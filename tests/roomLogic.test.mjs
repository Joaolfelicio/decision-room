import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicRoom,
  isRoomExpired,
  parseOptionEntry,
  pickParticipantName,
  tallyVotes,
  validateCreateRoomInput,
} from "../shared/roomLogic.ts";
import roomHandler from "../netlify/functions/room.mts";

test("parseOptionEntry extracts URL and clean label", () => {
  const opt = parseOptionEntry(
    "Dune: Part Two - https://www.imdb.com/title/tt15239678/",
    0
  );
  assert.ok(opt);
  assert.equal(opt.id, "opt-1");
  assert.equal(opt.label, "Dune: Part Two");
  assert.equal(opt.url, "https://www.imdb.com/title/tt15239678/");
});

test("validateCreateRoomInput enforces 3 to 6 distinct options", () => {
  const tooFew = validateCreateRoomInput({
    title: "Dinner",
    options: ["Tacos", "Pizza"],
  });
  assert.ok("error" in tooFew);

  const valid = validateCreateRoomInput({
    title: "Dinner",
    options: ["Tacos", "Pizza", "Ramen", "Burgers"],
    groupSize: 2,
  });
  assert.ok("meta" in valid);
  assert.equal(valid.meta.options.length, 4);
  assert.equal(valid.meta.groupSize, 2);
});

test("tallyVotes ranks highest Yes first and breaks ties deterministically", () => {
  const created = validateCreateRoomInput({
    title: "Dinner",
    options: ["Tacos", "Pizza", "Ramen"],
    groupSize: 2,
  });
  assert.ok("meta" in created);
  const { meta } = created;
  meta.id = "TEST99";

  const participants = [
    {
      id: "p1",
      token: "t1",
      name: "Joao",
      joinedAt: "2026-11-22T00:00:00Z",
      updatedAt: "2026-11-22T00:01:00Z",
      votes: { "opt-1": true, "opt-2": true, "opt-3": false },
    },
    {
      id: "p2",
      token: "t2",
      name: "Lili",
      joinedAt: "2026-11-22T00:00:05Z",
      updatedAt: "2026-11-22T00:01:05Z",
      votes: { "opt-1": true, "opt-2": true, "opt-3": false },
    },
  ];

  const tally1 = tallyVotes(meta, participants);
  const tally2 = tallyVotes(meta, participants);
  assert.equal(tally1.winner.optionId, tally2.winner.optionId);
  assert.equal(tally1.winner.tieBroken, true);
  assert.equal(tally1.winner.tiedWith.length, 1);

  const publicRoom = buildPublicRoom(meta, participants);
  assert.equal(publicRoom.status, "closed");
  assert.equal(publicRoom.closedReason, "everyone");
  assert.ok(publicRoom.winner);
});

test("isRoomExpired respects 60-minute TTL and pickParticipantName assigns fun fallback", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const created = validateCreateRoomInput(
    { title: "Test", options: ["A", "B", "C"] },
    now
  );
  assert.ok("meta" in created);
  assert.equal(isRoomExpired(created.meta, new Date("2026-11-22T12:59:00Z")), false);
  assert.equal(isRoomExpired(created.meta, new Date("2026-11-22T13:01:00Z")), true);

  const autoName = pickParticipantName("", []);
  assert.ok(autoName.length > 0);
});

test("Netlify Function end-to-end: create room, 2 voters join & vote, auto-reveals winner", async () => {
  const createRes = await roomHandler(
    new Request("http://localhost/api/room?action=create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Friday Dinner?",
        options: ["Birria Tacos", "Neapolitan Pizza", "Tonkotsu Ramen"],
        groupSize: 2,
      }),
    })
  );
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.ok(created.room.id);
  const roomId = created.room.id;

  const join1Res = await roomHandler(
    new Request("http://localhost/api/room?action=join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, name: "Joao" }),
    })
  );
  assert.equal(join1Res.status, 201);
  const p1 = await join1Res.json();
  assert.equal(p1.name, "Joao");

  const join2Res = await roomHandler(
    new Request("http://localhost/api/room?action=join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId }),
    })
  );
  assert.equal(join2Res.status, 201);
  const p2 = await join2Res.json();
  assert.ok(p2.name.length > 0);

  const vote1Res = await roomHandler(
    new Request("http://localhost/api/room?action=vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId,
        participantId: p1.participantId,
        participantToken: p1.participantToken,
        votes: { "opt-1": true, "opt-2": false, "opt-3": true },
      }),
    })
  );
  const v1 = await vote1Res.json();
  assert.equal(v1.room.status, "open");
  assert.equal(v1.room.doneCount, 1);

  const vote2Res = await roomHandler(
    new Request("http://localhost/api/room?action=vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId,
        participantId: p2.participantId,
        participantToken: p2.participantToken,
        votes: { "opt-1": false, "opt-2": false, "opt-3": true },
      }),
    })
  );
  const v2 = await vote2Res.json();
  assert.equal(v2.room.status, "closed");
  assert.equal(v2.room.closedReason, "everyone");
  assert.equal(v2.room.winner.optionId, "opt-3");
  assert.equal(v2.room.winner.tieBroken, false);
});
