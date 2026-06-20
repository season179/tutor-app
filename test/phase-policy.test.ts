import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedMoves,
  canTransition,
  comprehensionGateReadStatuses,
  forbiddenMoves,
  gateStageForStatus,
  initialGateStatus,
  initialPhase,
  isGateReadStatus,
  isMoveLegal,
  nextGateStatus
} from "../dist/modules/tutoring/phase-policy.js";

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

test("the Three Reads gate starts at the first read and lists the reads in order", () => {
  assert.equal(initialGateStatus, "needs_context_read");
  assert.deepEqual(comprehensionGateReadStatuses, [
    "needs_context_read",
    "needs_quantity_read",
    "needs_target_read",
    "needs_restatement"
  ]);
});

test("isGateReadStatus recognizes the four reads but not complete or null", () => {
  assert.equal(isGateReadStatus("needs_context_read"), true);
  assert.equal(isGateReadStatus("needs_restatement"), true);
  assert.equal(isGateReadStatus("complete"), false);
  assert.equal(isGateReadStatus(null), false);
  assert.equal(isGateReadStatus(undefined), false);
});

test("gateStageForStatus maps each read to its rubric stage", () => {
  assert.equal(gateStageForStatus("needs_context_read"), "context");
  assert.equal(gateStageForStatus("needs_quantity_read"), "quantity");
  assert.equal(gateStageForStatus("needs_target_read"), "target");
  assert.equal(gateStageForStatus("needs_restatement"), "restatement");
  assert.equal(gateStageForStatus("complete"), null);
  assert.equal(gateStageForStatus(null), null);
});

test("nextGateStatus advances one read at a time and completes after the restatement", () => {
  // The reads can never be skipped: each accept moves forward exactly one step.
  assert.equal(nextGateStatus("needs_context_read"), "needs_quantity_read");
  assert.equal(nextGateStatus("needs_quantity_read"), "needs_target_read");
  assert.equal(nextGateStatus("needs_target_read"), "needs_restatement");
  assert.equal(nextGateStatus("needs_restatement"), "complete");
  // A non-read status has nowhere further to advance.
  assert.equal(nextGateStatus("complete"), "complete");
  assert.equal(nextGateStatus(null), null);
});

test("phase transitions follow the workflow graph", () => {
  assert.equal(canTransition("frame_task", "plan_first_step", "complete"), true);
  assert.equal(canTransition("frame_task", "plan_first_step", "needs_restatement"), false);
  assert.equal(canTransition("frame_task", "step_loop"), false); // can't skip planning
  assert.equal(canTransition("step_loop", "session_open"), false); // no going back to the start
  assert.equal(canTransition("frame_task", "frame_task"), true); // staying put
  assert.equal(canTransition("step_loop", "wrap_up"), true); // can always close
  assert.equal(initialPhase, "session_open");
});
