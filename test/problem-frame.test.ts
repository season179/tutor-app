import assert from "node:assert/strict";
import test from "node:test";

import {
  frameContainsComputedSolution,
  scrubComputedSolutionFromFrame,
  scrubComputedSolutionFromText
} from "../dist/modules/problems/problem-frame.js";
import { buildProblemFrame } from "../dist/modules/problems/question-extraction-service.js";

test("frameContainsComputedSolution flags numeric-only unknown targets", () => {
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: "24 stickers shared among 4 friends.",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [{ label: "stickers", raw: "24" }],
    question: "How many stickers does each friend get?",
    relationships: ["shared equally"],
    taskLanguage: "en",
    unknownTarget: "6"
  });

  assert.equal(frameContainsComputedSolution(frame), true);
});

test("frameContainsComputedSolution allows goal language without a computed answer", () => {
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: "24 stickers shared among 4 friends.",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [{ label: "stickers", raw: "24" }],
    question: "How many stickers does each friend get?",
    relationships: ["shared equally"],
    taskLanguage: "en",
    unknownTarget: "how many stickers each friend gets"
  });

  assert.equal(frameContainsComputedSolution(frame), false);
});

test("scrubComputedSolutionFromText removes a worked answer but keeps the question and givens", () => {
  assert.equal(scrubComputedSolutionFromText("24 ÷ 4 = 6"), "24 ÷ 4");
  const cleaned = scrubComputedSolutionFromText(
    "Share 24 stickers among 4 friends. The answer is 6."
  );
  assert.ok(!/answer is\s*\d/i.test(cleaned), "worked answer should be stripped");
  assert.ok(cleaned.includes("24"), "givens should be preserved");
  assert.ok(cleaned.includes("4 friends"), "givens should be preserved");
});

test("scrubComputedSolutionFromText preserves a genuine equation problem", () => {
  // "= 14" is the problem here (a variable precedes "="), not a worked answer to strip.
  assert.equal(scrubComputedSolutionFromText("Solve 2x = 14"), "Solve 2x = 14");
  assert.equal(scrubComputedSolutionFromText("Find x: 3x = 12."), "Find x: 3x = 12.");
});

test("scrubComputedSolutionFromText strips a worked answer that isn't on the last line", () => {
  const cleaned = scrubComputedSolutionFromText("Each friend gets 24 / 4 = 6\nWrite your answer below.");

  assert.ok(!/=\s*6\b/.test(cleaned), "a worked answer mid-text is stripped, not just at end of string");
  assert.ok(cleaned.includes("Write your answer below."), "the rest of the field is kept");
});

test("frameContainsComputedSolution does not flag a variable equation as a worked answer", () => {
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: "Solve 2x = 14.",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "equation",
    quantities: [],
    question: "Solve 2x = 14.",
    relationships: [],
    taskLanguage: "en",
    unknownTarget: "x"
  });

  assert.equal(frameContainsComputedSolution(frame), false);
});

test("scrubComputedSolutionFromFrame drops a numeric-only target and keeps givens", () => {
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: "24 stickers shared among 4 friends. = 6",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [{ label: "stickers", raw: "24" }],
    question: "How many stickers does each friend get?",
    relationships: ["shared equally among 4 friends"],
    taskLanguage: "en",
    unknownTarget: "6"
  });

  const scrubbed = scrubComputedSolutionFromFrame(frame);

  assert.equal(scrubbed.unknownTarget, null, "numeric-only target is the answer in disguise");
  assert.ok(!/=\s*6\b/.test(scrubbed.extractedText), "trailing = 6 should be stripped");
  assert.deepEqual(scrubbed.quantities, frame.quantities, "givens are never altered");
  assert.equal(frameContainsComputedSolution(scrubbed), false, "scrubbed frame is clean");
});
