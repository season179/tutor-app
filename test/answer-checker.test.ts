import assert from "node:assert/strict";
import test from "node:test";

import { deriveFinalAnswerCheck } from "../dist/modules/tutoring/active-step.js";
import {
  hasSubjectLanguageOutput,
  outputLanguageLabel,
  requiresSubjectLanguage,
  verifyAnswerCheck
} from "../dist/modules/tutoring/answer-checker.js";
import type { ProblemFrame } from "../src/modules/problems/problem-frame.ts";

const sharingFrame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "24 pelekat dikongsi sama rata kepada 4 kawan.",
  languageIsSubject: true,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [
    { label: "pelekat", raw: "24" },
    { label: "kawan", raw: "4" }
  ],
  relationships: ["dikongsi sama rata kepada 4 kawan"],
  taskLanguage: "ms",
  unknownTarget: "berapa pelekat setiap kawan dapat",
  visibleQuestion: "Berapa pelekat setiap kawan dapat?"
};

test("requiresSubjectLanguage when languageIsSubject or Malay task language", () => {
  assert.equal(requiresSubjectLanguage(sharingFrame), true);
  assert.equal(
    requiresSubjectLanguage({ ...sharingFrame, languageIsSubject: false, taskLanguage: "en" }),
    false
  );
});

test("outputLanguageLabel surfaces BM prompt for Malay worksheets", () => {
  assert.equal(outputLanguageLabel(sharingFrame), "answer in BM");
});

test("verifyAnswerCheck marks numeric-only Malay answers partial", () => {
  const step = deriveFinalAnswerCheck(sharingFrame);
  assert.ok(step);

  const verdict = verifyAnswerCheck(step!, sharingFrame, "6");
  assert.equal(verdict?.studentStatus, "partial");
  assert.equal(verdict?.chip, "partial");
});

test("verifyAnswerCheck accepts Malay words with the right number", () => {
  const step = deriveFinalAnswerCheck(sharingFrame);
  assert.ok(step);

  const verdict = verifyAnswerCheck(step!, sharingFrame, "setiap kawan dapat 6 pelekat");
  assert.equal(verdict?.studentStatus, "correct");
});

test("hasSubjectLanguageOutput detects Malay markers", () => {
  assert.equal(hasSubjectLanguageOutput("setiap kawan dapat 6 pelekat"), true);
  assert.equal(hasSubjectLanguageOutput("each friend gets 6"), false);
});
