import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/modules/sessions/memory-session-store.js";
import { runIdleHintAlarm } from "../dist/modules/sessions/hint-alarm.js";
import { hintTimerEventMessage, hintWaitMs } from "../dist/modules/sessions/hint-timer.js";

const ownerKey = "access:user-a";

const leftoverStep = {
  ask: "How many books are left?",
  defaultWrongNudge: "Not quite — how many are left after some are removed?",
  distractorNudges: {},
  expectedAnswers: [70],
  scaffoldAid: "150 − 80"
};

async function seedStepLoop(
  store: MemorySessionStore,
  sessionId: string,
  activeStep: typeof leftoverStep | null,
  supportLevel: number
): Promise<void> {
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep,
    currentPhase: "step_loop",
    gateStatus: "complete",
    supportLevel
  });
}

test("runIdleHintAlarm nudges in the step loop and schedules the next alarm", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey);
  await seedStepLoop(store, session.id, leftoverStep, 2);

  const result = await runIdleHintAlarm(store, ownerKey, session.id, 1_000);

  assert.equal(result.nudged, true);
  assert.equal(result.rearmAtMs, 1_000 + hintWaitMs);

  const detail = await store.getSession(ownerKey, session.id);
  const hint = detail?.events.find((event) => event.message === hintTimerEventMessage);
  assert.ok(hint);
  // The nudge is built from the live step's answer-free scaffold...
  assert.match((hint.value as { text: string }).text, /150 − 80/);
  // ...and never leaks the computed answer.
  assert.doesNotMatch(JSON.stringify(hint.value), /\b70\b/);
});

test("runIdleHintAlarm escalates the nudge with support level", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey);
  await seedStepLoop(store, session.id, null, 0);

  await runIdleHintAlarm(store, ownerKey, session.id, 0);

  const detail = await store.getSession(ownerKey, session.id);
  const hint = detail?.events.find((event) => event.message === hintTimerEventMessage);
  // Support level 0 leads with gentle encouragement rather than a hint.
  assert.match((hint?.value as { text: string }).text, /take your time/i);
});

test("runIdleHintAlarm does nothing once the child has left the step loop", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey); // stays at session_open

  const result = await runIdleHintAlarm(store, ownerKey, session.id, 0);

  assert.equal(result.nudged, false);
  assert.equal(result.rearmAtMs, null);
  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.events.length, 0);
});

test("runIdleHintAlarm is a no-op for an unknown session", async () => {
  const store = new MemorySessionStore();

  const result = await runIdleHintAlarm(store, ownerKey, "does-not-exist", 0);

  assert.equal(result.nudged, false);
  assert.equal(result.rearmAtMs, null);
});
