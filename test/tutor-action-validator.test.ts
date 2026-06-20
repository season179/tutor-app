import assert from "node:assert/strict";
import test from "node:test";

import type { ProposedTutorAction } from "../src/modules/tutoring/tutor-action.ts";
import { validateTutorAction } from "../dist/modules/tutoring/tutor-action-validator.js";

function action(partial: Partial<ProposedTutorAction>): ProposedTutorAction {
  return {
    phase: "step_loop",
    move: "elicit",
    spokenUtterance: "What could you try as a first step?",
    ...partial
  };
}

test("rejects a solve attempt during the comprehension gate", () => {
  const result = validateTutorAction(
    action({ phase: "frame_task", move: "solve", spokenUtterance: "It's 6 each." }),
    { phase: "frame_task" }
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => reason.includes("forbidden")));
});

test("rejects a scaffolding hint during the gate (move not allowed in phase)", () => {
  const result = validateTutorAction(
    action({ phase: "frame_task", move: "scaffold_hint", spokenUtterance: "Try dividing twenty-four by four." }),
    { phase: "frame_task" }
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => reason.includes("not allowed")));
});

test("accepts a restate prompt during the gate", () => {
  const result = validateTutorAction(
    action({
      phase: "frame_task",
      move: "restate_prompt",
      spokenUtterance: "In your own words, what are we trying to find?"
    }),
    { phase: "frame_task" }
  );

  assert.deepEqual(result, { ok: true });
});

test("rejects an utterance over the 32-word cap", () => {
  const longUtterance = `${Array.from({ length: 40 }, () => "word").join(" ")}?`;
  const result = validateTutorAction(action({ spokenUtterance: longUtterance }), { phase: "step_loop" });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => reason.includes("cap")));
});

test("rejects more than one cognitive demand in a turn", () => {
  const result = validateTutorAction(
    action({ spokenUtterance: "What is the total? And how many groups?" }),
    { phase: "step_loop" }
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => reason.includes("one cognitive demand")));
});

test("rejects an utterance that reveals the final answer", () => {
  const result = validateTutorAction(
    action({ move: "feedback_with_why", spokenUtterance: "Nice work — the answer is 6." }),
    { phase: "step_loop" }
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => reason.includes("final answer")));
});

test("accepts a clean step-loop turn", () => {
  const result = validateTutorAction(
    action({ move: "scaffold_hint", spokenUtterance: "What number tells you how many there are altogether?" }),
    { phase: "step_loop" }
  );

  assert.deepEqual(result, { ok: true });
});

test("accepts a warm rapport opener before a single demand", () => {
  const result = validateTutorAction(
    action({ move: "elicit", spokenUtterance: "Ready? What could you try as a first step?" }),
    { phase: "step_loop" }
  );

  assert.deepEqual(result, { ok: true });
});

test("accepts a question that asks about the answer without revealing it", () => {
  const result = validateTutorAction(
    action({ move: "elicit", spokenUtterance: "What do you think the answer is?" }),
    { phase: "step_loop" }
  );

  assert.deepEqual(result, { ok: true });
});

test("accepts mentioning answers in the plural", () => {
  const result = validateTutorAction(
    action({
      phase: "answer_check",
      move: "precision_check",
      spokenUtterance: "Which of the answers feels closer to you?"
    }),
    { phase: "answer_check" }
  );

  assert.deepEqual(result, { ok: true });
});

test("rejects an empty utterance", () => {
  const result = validateTutorAction(action({ spokenUtterance: "   " }), { phase: "step_loop" });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => reason.includes("empty")));
});
