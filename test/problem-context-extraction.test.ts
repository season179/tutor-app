import assert from "node:assert/strict";
import test from "node:test";

import {
  extractionStatusHint,
  getExtractionAlert,
  legacyReadyExtractionAlert,
  mapOutcomeToExtractionStatus,
  resolvePromptConfirmedForSession,
  shouldPrefillExtractedQuestion
} from "../src/client/lib/problem-context-extraction.ts";
import { normalizeExtractionResponse } from "../dist/problem-context/question-extraction-service.js";

test("mapOutcomeToExtractionStatus maps review and empty outcomes", () => {
  assert.equal(mapOutcomeToExtractionStatus("extracted"), "ready");
  assert.equal(mapOutcomeToExtractionStatus("partial"), "needs_review");
  assert.equal(mapOutcomeToExtractionStatus("multiple_questions"), "needs_review");
  assert.equal(mapOutcomeToExtractionStatus("none"), "no_question");
  assert.equal(mapOutcomeToExtractionStatus("not_a_problem"), "no_question");
});

test("shouldPrefillExtractedQuestion only pre-fills usable extraction outcomes", () => {
  assert.equal(shouldPrefillExtractedQuestion("extracted"), true);
  assert.equal(shouldPrefillExtractedQuestion("partial"), true);
  assert.equal(shouldPrefillExtractedQuestion("multiple_questions"), true);
  assert.equal(shouldPrefillExtractedQuestion("none"), false);
  assert.equal(shouldPrefillExtractedQuestion("not_a_problem"), false);
});

test("getExtractionAlert returns warning guidance for empty outcomes", () => {
  const alert = getExtractionAlert("none", "No readable question was visible.");

  assert.ok(alert);
  assert.equal(alert.tone, "warning");
  assert.match(alert.message, /Couldn't read a question/i);
  assert.equal(alert.notes, "No readable question was visible.");
});

test("extractionStatusHint surfaces manual-entry guidance for no_question", () => {
  assert.match(extractionStatusHint("no_question", null) ?? "", /Enter the question manually/i);
});

test("resolvePromptConfirmedForSession treats legacy saved prompts as confirmed", () => {
  assert.equal(
    resolvePromptConfirmedForSession({
      extractionOutcome: null,
      imageObjectKey: "session-1/image.jpg",
      imagePrompt: "Find x.",
      promptConfirmed: false
    }),
    true
  );
});

test("resolvePromptConfirmedForSession keeps explicit unconfirmed state for new extractions", () => {
  assert.equal(
    resolvePromptConfirmedForSession({
      extractionOutcome: "extracted",
      imageObjectKey: "session-1/image.jpg",
      imagePrompt: "Find x.",
      promptConfirmed: false
    }),
    false
  );
});

test("legacyReadyExtractionAlert prompts review for hydrated legacy sessions", () => {
  const alert = legacyReadyExtractionAlert();

  assert.equal(alert.tone, "neutral");
  assert.match(alert.message, /confirm or edit/i);
});

test("normalizeExtractionResponse coerces empty questions to none", () => {
  const normalized = normalizeExtractionResponse({
    confidence: "high",
    notes: null,
    outcome: "extracted",
    question: ""
  });

  assert.equal(normalized.outcome, "none");
  assert.equal(normalized.question, "");
  assert.equal(normalized.requiresConfirmation, true);
  assert.match(normalized.notes ?? "", /No readable question/i);
});

test("normalizeExtractionResponse downgrades very short extracted questions to partial", () => {
  const normalized = normalizeExtractionResponse({
    confidence: "high",
    notes: null,
    outcome: "extracted",
    question: "Solve x"
  });

  assert.equal(normalized.outcome, "partial");
  assert.equal(normalized.question, "Solve x");
});
