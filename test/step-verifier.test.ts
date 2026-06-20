import assert from "node:assert/strict";
import test from "node:test";

import { deriveFirstCheckableStep } from "../dist/modules/tutoring/active-step.js";
import { llmStepVerdict, unknownStepVerdict, verifyActiveStep } from "../dist/modules/tutoring/step-verifier.js";
import type { ProblemFrame } from "../src/modules/problems/problem-frame.ts";

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

test("verifyActiveStep verdicts are high-confidence deterministic", () => {
  const step = deriveFirstCheckableStep(sharingFrame)!;
  const verdict = verifyActiveStep(step, "4")!;
  assert.equal(verdict.method, "deterministic");
  assert.equal(verdict.confidence, "high");
  assert.equal(verdict.misconceptionKey, null);
});

test("llmStepVerdict maps a verifier verdict and scrubs a worked answer from the hint", () => {
  const verdict = llmStepVerdict({
    confidence: "medium",
    correctionHint: "The answer is 6 — re-read what each friend gets.",
    misconceptionKey: "used_total_not_share",
    studentStatus: "incorrect"
  });

  assert.equal(verdict.method, "llm");
  assert.equal(verdict.chip, "retry");
  assert.equal(verdict.studentAnswer, null);
  assert.equal(verdict.misconceptionKey, "used_total_not_share");
  assert.doesNotMatch(verdict.correctionHint ?? "", /answer is\s*6/i);
});

test("llmStepVerdict drops the hint on a correct verdict", () => {
  const verdict = llmStepVerdict({
    confidence: "high",
    correctionHint: "Nice — six each.",
    misconceptionKey: null,
    studentStatus: "correct"
  });

  assert.equal(verdict.chip, "ok");
  assert.equal(verdict.correctionHint, null);
});

test("unknownStepVerdict is a gentle, non-failing fallback", () => {
  const verdict = unknownStepVerdict();
  assert.equal(verdict.studentStatus, "unknown");
  assert.equal(verdict.method, "llm");
  assert.notEqual(verdict.chip, "retry");
});
