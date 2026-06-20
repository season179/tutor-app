import assert from "node:assert/strict";
import test from "node:test";

import { canTransition } from "../dist/modules/tutoring/phase-policy.js";

test("canTransition blocks leaving frame_task until the gate is complete", () => {
  assert.equal(canTransition("frame_task", "plan_first_step", "needs_restatement"), false);
  assert.equal(canTransition("frame_task", "plan_first_step", "complete"), true);
  assert.equal(canTransition("frame_task", "frame_task", "needs_restatement"), true);
});
