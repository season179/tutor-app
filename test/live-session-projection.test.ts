import assert from "node:assert/strict";
import test from "node:test";

import {
  goalStatusFromDetail,
  outputLanguageLabelFromContext,
  pendingHintFromEvents
} from "../dist/modules/sessions/live-session-projection.js";
import { hintTimerEventMessage } from "../src/modules/sessions/hint-timer.ts";
import { studentTurnEventMessage } from "../src/modules/sessions/session-types.ts";

test("pendingHintFromEvents returns the latest idle nudge text", () => {
  const hint = pendingHintFromEvents([
    { message: hintTimerEventMessage, value: { text: "Try counting friends." } }
  ]);

  assert.equal(hint, "Try counting friends.");
});

test("pendingHintFromEvents hides the hint after the child speaks again", () => {
  const hint = pendingHintFromEvents([
    { message: studentTurnEventMessage, value: { text: "I think it's 4" } },
    { message: hintTimerEventMessage, value: { text: "Try counting friends." } }
  ]);

  assert.equal(hint, null);
});

test("goalStatusFromDetail marks complete after a correct answer check event", () => {
  const status = goalStatusFromDetail({
    events: [{ message: "Answer check", value: { studentStatus: "correct" } }],
    gateStatus: "complete",
    phase: "answer_check",
    reflectionPresent: false
  });

  assert.equal(status, "complete");
});

test("outputLanguageLabelFromContext surfaces BM for Malay worksheets", () => {
  assert.equal(
    outputLanguageLabelFromContext({
      diagramDescription: null,
      extractedText: "24 pelekat",
      languageIsSubject: true,
      likelySkillKeys: [],
      problemType: "word_problem",
      quantities: [],
      relationships: [],
      taskLanguage: "ms",
      unknownTarget: "berapa setiap kawan",
      visibleQuestion: "Berapa?"
    }),
    "answer in BM"
  );
});
