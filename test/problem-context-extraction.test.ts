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
import {
  buildProblemFrame,
  normalizeExtractionResponse
} from "../dist/problem-context/question-extraction-service.js";

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

test("extractionStatusHint makes the in-progress extraction obvious", () => {
  // While the vision model reads the photo, this hint is the in-panel cue that
  // mirrors the center focus card. It must read as actively working, not ready.
  const hint = extractionStatusHint("extracting", null);

  assert.match(hint ?? "", /extract/i);
  assert.doesNotMatch(hint ?? "", /ready|review|confirm/i);
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
    diagramDescription: null,
    extractedText: "",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "other",
    quantities: [],
    question: "",
    relationships: [],
    taskLanguage: "en",
    unknownTarget: null
  });

  assert.equal(normalized.outcome, "none");
  assert.equal(normalized.question, "");
  assert.equal(normalized.requiresConfirmation, true);
  assert.match(normalized.notes ?? "", /No readable question/i);
});

test("normalizeExtractionResponse downgrades very short extracted questions to partial", () => {
  const normalized = normalizeExtractionResponse({
    confidence: "high",
    diagramDescription: null,
    extractedText: "Solve x",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "equation",
    quantities: [],
    question: "Solve x",
    relationships: [],
    taskLanguage: "en",
    unknownTarget: "x"
  });

  assert.equal(normalized.outcome, "partial");
  assert.equal(normalized.question, "Solve x");
});

test("normalizeExtractionResponse preserves the full word-problem statement with its givens", () => {
  // Mirrors the regression where a photo returned only the final question sentence
  // ("校长能够购买多少个科学仪器？") and dropped the givens. `question` must carry the
  // complete statement — every setup sentence plus the question — so a student reading
  // only `question` has everything needed to solve it.
  const fullStatement =
    "智民小学获得 RM70 000 捐款。校长拨出 RM54 000 给图书馆，剩下的钱要购买单价是 RM1 980 的科学仪器。校长能够购买多少个科学仪器？";

  const normalized = normalizeExtractionResponse({
    confidence: "high",
    diagramDescription: null,
    extractedText: fullStatement,
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [
      { label: "捐款总额", raw: "RM70 000" },
      { label: "图书馆拨款", raw: "RM54 000" },
      { label: "科学仪器单价", raw: "RM1 980" }
    ],
    question: fullStatement,
    relationships: ["剩下的钱 = 捐款总额 − 图书馆拨款"],
    taskLanguage: "zh",
    unknownTarget: "能购买多少个科学仪器"
  });

  assert.equal(normalized.outcome, "extracted");
  assert.equal(normalized.question, fullStatement);
  assert.equal(normalized.frame.visibleQuestion, fullStatement);
  // The structured quantity metadata supplements but does not replace the full prose.
  assert.equal(normalized.frame.quantities.length, 3);
  // The "剩下的钱 = 捐款总额 − 图书馆拨款" relationship contains "=", but its left side is
  // Chinese (not an [A-Za-z] variable) and its right side is not a bare number, so the
  // computed-answer scrub guard (frameContainsComputedSolution) correctly leaves this
  // `extracted` outcome untouched. A real worked answer ("= 3") WOULD be caught.
  assert.equal(normalized.frame.relationships.length, 1);
});

test("buildProblemFrame lets the full question win over a fragmentary extractedText", () => {
  // The model sometimes returns a fragmentary extractedText (e.g. only the givens)
  // but a complete question. `question` is load-bearing: it must win so the full
  // statement reaches the student, not a fragment.
  const fullStatement = "A shop has 12 apples. It sells 5. How many are left?";
  const fragmentaryText = "A shop has 12 apples.";
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: fragmentaryText,
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [],
    question: fullStatement,
    relationships: [],
    taskLanguage: "en",
    unknownTarget: "how many apples are left"
  });

  assert.equal(frame.visibleQuestion, fullStatement);
});
