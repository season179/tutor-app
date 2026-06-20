import assert from "node:assert/strict";
import test from "node:test";

import {
  hintNudgeForSupportLevel,
  hintTimerEventMessage,
  hintWaitMs,
  shouldArmHintTimer
} from "../src/modules/sessions/hint-timer.ts";

test("hintWaitMs matches the spec's ~2 minute struggle window", () => {
  assert.equal(hintWaitMs, 120_000);
});

test("shouldArmHintTimer only in step_loop", () => {
  assert.equal(shouldArmHintTimer("step_loop"), true);
  assert.equal(shouldArmHintTimer("answer_check"), false);
  assert.equal(shouldArmHintTimer("memory_write"), false);
});

test("hintNudgeForSupportLevel escalates with support level", () => {
  assert.match(hintNudgeForSupportLevel(0), /take your time/i);
  assert.match(hintNudgeForSupportLevel(1), /hint:/i);
  assert.match(hintNudgeForSupportLevel(4), /hint:/i);
});

test("hintTimerEventMessage is stable for client polling", () => {
  assert.equal(hintTimerEventMessage, "Hint timer");
});

test("hintNudgeForSupportLevel weaves in the live step ask and scaffold", () => {
  const context = { ask: "How many books are left?", scaffoldAid: "150 − 80" };

  assert.match(hintNudgeForSupportLevel(0, context), /books are left/i);
  assert.match(hintNudgeForSupportLevel(1, context), /books are left/i);
  // Higher support surfaces the (answer-free) operation, never the answer.
  assert.match(hintNudgeForSupportLevel(2, context), /150 − 80/);
  assert.match(hintNudgeForSupportLevel(4, context), /150 − 80/);
});

test("hintNudgeForSupportLevel never names the answer it scaffolds toward", () => {
  const nudge = hintNudgeForSupportLevel(4, { ask: "How many are left?", scaffoldAid: "150 − 80" });
  assert.doesNotMatch(nudge, /\b70\b/);
});

test("hintNudgeForSupportLevel falls back to generic encouragement without a step", () => {
  assert.match(hintNudgeForSupportLevel(0), /take your time/i);
  assert.match(hintNudgeForSupportLevel(2), /hint:/i);
  assert.doesNotMatch(hintNudgeForSupportLevel(2), /sticker/i);
});
