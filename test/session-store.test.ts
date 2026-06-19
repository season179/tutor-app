import assert from "node:assert/strict";
import test from "node:test";

import { mapD1SessionRow, MemorySessionStore } from "../dist/memory-session-store.js";
import { updateSession } from "../dist/session-handler.js";
import type { RequestContext } from "../src/request-context.ts";

const ownerKey = "access:user-a";
const context: RequestContext = {
  identity: { userId: "user-a" },
  ownerKey
};

test("MemorySessionStore scopes sessions by owner key", async () => {
  const store = new MemorySessionStore();
  const ownerA = "access:user-a";
  const ownerB = "access:user-b";

  const sessionA = await store.createSession(ownerA, { title: "Owner A" });
  const sessionB = await store.createSession(ownerB, { title: "Owner B" });

  const listA = await store.listSessions(ownerA);
  const listB = await store.listSessions(ownerB);

  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.equal(listA[0]?.id, sessionA.id);
  assert.equal(listB[0]?.id, sessionB.id);

  assert.equal(await store.sessionExists(ownerA, sessionB.id), false);
  assert.equal(await store.getSession(ownerB, sessionA.id), null);
});

test("MemorySessionStore appends events and updates session timestamps", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  await store.appendEvent(ownerKey, session.id, {
    message: "Voice session connected",
    value: { provider: "openai-realtime" }
  });

  const detail = await store.getSession(ownerKey, session.id);
  assert.ok(detail);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0]?.message, "Voice session connected");
  assert.notEqual(detail.session.updatedAt, session.updatedAt);
});

test("MemorySessionStore updates image metadata without storing data URLs", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const updated = await store.updateSession(ownerKey, session.id, {
    imageMeta: { bytes: 120_000, height: 900, width: 1200 },
    imageName: "worksheet.jpg",
    imagePrompt: "Walk me through this problem."
  });

  assert.ok(updated);
  assert.deepEqual(updated?.imageMeta, { bytes: 120_000, height: 900, width: 1200 });
  assert.equal(updated?.imageName, "worksheet.jpg");
  assert.equal(updated?.imagePrompt, "Walk me through this problem.");
});

test("MemorySessionStore transferOwnerSessions moves sessions and preserves events", async () => {
  const store = new MemorySessionStore();
  const ownerA = "user-a";
  const ownerB = "user-b";
  const otherOwner = "user-c";

  const sessionA1 = await store.createSession(ownerA, { title: "Session A1" });
  const sessionA2 = await store.createSession(ownerA, { title: "Session A2" });
  const sessionC = await store.createSession(otherOwner, { title: "Session C" });

  await store.appendEvent(ownerA, sessionA1.id, { message: "Event A1" });
  await store.appendEvent(ownerA, sessionA2.id, { message: "Event A2" });

  const transferred = await store.transferOwnerSessions(ownerA, ownerB);

  assert.equal(transferred, 2);
  assert.equal((await store.listSessions(ownerA)).length, 0);
  assert.deepEqual(
    (await store.listSessions(ownerB)).map((session) => session.id).sort(),
    [sessionA1.id, sessionA2.id].sort()
  );
  assert.equal((await store.listSessions(otherOwner))[0]?.id, sessionC.id);

  const detail = await store.getSession(ownerB, sessionA1.id);
  assert.ok(detail);
  assert.equal(detail.events[0]?.message, "Event A1");
});

test("MemorySessionStore starts sessions at the opening phase with support off", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  assert.equal(session.currentPhase, "session_open");
  assert.equal(session.gateStatus, null);
  assert.equal(session.supportLevel, 0);
});

test("advanceSessionPhase moves the phase when the expected phase matches", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const advanced = await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_restatement",
    supportLevel: 0
  });

  assert.ok(advanced);
  assert.equal(advanced?.currentPhase, "frame_task");
  assert.equal(advanced?.gateStatus, "needs_restatement");

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
});

test("advanceSessionPhase refuses to advance when the expected phase is stale", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const result = await store.advanceSessionPhase(ownerKey, session.id, "step_loop", {
    activeStep: null,
    currentPhase: "answer_check",
    gateStatus: null,
    supportLevel: 0
  });

  assert.equal(result, null);
  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "session_open");
});

test("mapD1SessionRow normalizes optional image columns", () => {
  const session = mapD1SessionRow({
    created_at: "2026-06-17T01:02:03.000Z",
    extraction_notes: "Bottom cut off.",
    extraction_outcome: "partial",
    id: "session-1",
    image_meta_json: JSON.stringify({ bytes: 120_000, height: 900, width: 1200 }),
    image_name: "",
    image_object_key: "session-1/image.jpg",
    image_prompt: "Find x.",
    owner_key: "access:user-a",
    prompt_confirmed: 1,
    status: "draft",
    title: "Algebra help",
    updated_at: "2026-06-17T01:02:03.000Z"
  });

  assert.deepEqual(session.imageMeta, { bytes: 120_000, height: 900, width: 1200 });
  assert.equal(session.imageName, null);
  assert.equal(session.imagePrompt, "Find x.");
  assert.equal(session.extractionOutcome, "partial");
  assert.equal(session.extractionNotes, "Bottom cut off.");
  assert.equal(session.promptConfirmed, true);
});

test("mapD1SessionRow parses active_step_json", () => {
  const session = mapD1SessionRow({
    active_step_json: JSON.stringify({
      ask: "How many stickers is that?",
      defaultWrongNudge: "Try again.",
      distractorNudges: { "24": "That is the total." },
      expectedAnswers: [4],
      scaffoldAid: "4 friends · 1 sticker each"
    }),
    created_at: "2026-06-17T01:02:03.000Z",
    current_phase: "step_loop",
    current_support_level: 1,
    extraction_notes: null,
    extraction_outcome: null,
    gate_status: "complete",
    id: "session-1",
    image_meta_json: null,
    image_name: null,
    image_object_key: null,
    image_prompt: null,
    owner_key: "access:user-a",
    prompt_confirmed: 0,
    status: "active",
    title: "Sharing",
    updated_at: "2026-06-17T02:03:04.000Z"
  });

  assert.equal(session.activeStep?.expectedAnswers[0], 4);
  assert.equal(session.currentPhase, "step_loop");
  assert.equal(session.supportLevel, 1);
});

test("confirming a typed prompt seeds problem context and gate status", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Manual prompt" });

  const updated = await updateSession(
    session.id,
    {
      imagePrompt: "How many stickers does each friend get?",
      promptConfirmed: true
    },
    context,
    store
  );

  assert.equal(updated.promptConfirmed, true);
  assert.equal(updated.gateStatus, "needs_restatement");

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.problemContext?.unknownTarget, "How many stickers does each friend get?");
  assert.equal(detail?.problemContext?.visibleQuestion, "How many stickers does each friend get?");
});
