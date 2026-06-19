import assert from "node:assert/strict";
import test from "node:test";

import { deriveFirstCheckableStep } from "../dist/active-step.js";
import { verifyActiveStep } from "../dist/step-verifier.js";
import type { ProblemFrame } from "../src/problem-context/problem-frame.ts";

const sharingFrame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "24 stickers are shared equally among 4 friends.",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [{ label: "stickers", raw: "24" }],
  relationships: ["shared equally among 4 friends"],
  taskLanguage: "en",
  unknownTarget: "how many stickers each friend gets",
  visibleQuestion: "How many stickers does each friend get?"
};

test("verifyActiveStep marks the friend count correct", () => {
  const step = deriveFirstCheckableStep(sharingFrame)!;
  const verdict = verifyActiveStep(step, "I think it's 4 stickers");

  assert.ok(verdict);
  assert.equal(verdict.studentStatus, "correct");
  assert.equal(verdict.chip, "ok");
  assert.equal(verdict.studentAnswer, 4);
  assert.equal(verdict.correctionHint, null);
});

test("verifyActiveStep gives a specific nudge when the child says the total", () => {
  const step = deriveFirstCheckableStep(sharingFrame)!;
  const verdict = verifyActiveStep(step, "24?");

  assert.ok(verdict);
  assert.equal(verdict.studentStatus, "incorrect");
  assert.equal(verdict.chip, "retry");
  assert.equal(verdict.studentAnswer, 24);
  assert.match(verdict.correctionHint ?? "", /all the stickers/i);
  assert.doesNotMatch(verdict.correctionHint ?? "", /each friend gets 6/i);
});

test("verifyActiveStep prefers the expected value when multiple numbers appear", () => {
  const step = deriveFirstCheckableStep(sharingFrame)!;
  const verdict = verifyActiveStep(step, "there are 4 friends and 24 stickers");

  assert.ok(verdict);
  assert.equal(verdict.studentStatus, "correct");
  assert.equal(verdict.studentAnswer, 4);
});

test("verifyActiveStep skips non-numeric student turns", () => {
  const step = deriveFirstCheckableStep(sharingFrame)!;
  assert.equal(verifyActiveStep(step, "split them into groups"), null);
});
