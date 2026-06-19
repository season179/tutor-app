import assert from "node:assert/strict";
import test from "node:test";

import { allowedMoves, canTransition, forbiddenMoves, initialPhase, isMoveLegal } from "../dist/phase-policy.js";

test("the comprehension gate allows only the Three Reads and restate moves", () => {
  const moves = allowedMoves("frame_task");

  assert.ok(moves.includes("three_reads_1"));
  assert.ok(moves.includes("three_reads_2"));
  assert.ok(moves.includes("three_reads_3"));
  assert.ok(moves.includes("restate_prompt"));
  assert.ok(!moves.includes("model_micro_step"));
  assert.ok(!moves.includes("scaffold_hint"));
});

test("solving moves are illegal during the gate", () => {
  assert.equal(isMoveLegal("frame_task", "model_micro_step"), false);
  assert.equal(isMoveLegal("frame_task", "scaffold_hint"), false);
  assert.equal(isMoveLegal("frame_task", "three_reads_1"), true);
});

test("solve and final_answer are forbidden everywhere; the gate forbids more", () => {
  assert.ok(forbiddenMoves("step_loop").includes("solve"));
  assert.ok(forbiddenMoves("step_loop").includes("final_answer"));
  assert.ok(forbiddenMoves("frame_task").includes("calculation_hint"));
  assert.ok(forbiddenMoves("frame_task").includes("check_answer"));
});

test("safety moves are legal in any phase", () => {
  assert.equal(isMoveLegal("frame_task", "safety_boundary"), true);
  assert.equal(isMoveLegal("step_loop", "reset"), true);
});

test("phase transitions follow the workflow graph", () => {
  assert.equal(canTransition("frame_task", "plan_first_step"), true);
  assert.equal(canTransition("frame_task", "step_loop"), false); // can't skip planning
  assert.equal(canTransition("step_loop", "session_open"), false); // no going back to the start
  assert.equal(canTransition("frame_task", "frame_task"), true); // staying put
  assert.equal(canTransition("step_loop", "wrap_up"), true); // can always close
  assert.equal(initialPhase, "session_open");
});
