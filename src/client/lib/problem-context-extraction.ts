import type { ExtractionOutcome } from "../../modules/problems/problem-context-types.js";

export type ExtractionStatus = "extracting" | "failed" | "idle" | "no_question" | "needs_review" | "ready";

export type ExtractionAlert = {
  message: string;
  notes: string | null;
  tone: "neutral" | "warning";
};

export function mapOutcomeToExtractionStatus(outcome: ExtractionOutcome): ExtractionStatus {
  switch (outcome) {
    case "extracted":
      return "ready";
    case "partial":
    case "multiple_questions":
      return "needs_review";
    case "none":
    case "not_a_problem":
      return "no_question";
    default:
      return "ready";
  }
}

export function getExtractionAlert(
  outcome: ExtractionOutcome | null,
  notes: string | null
): ExtractionAlert | null {
  if (!outcome) {
    return null;
  }

  switch (outcome) {
    case "extracted":
      return {
        message: "Check the question below, then confirm or edit it.",
        notes: null,
        tone: "neutral"
      };
    case "partial":
      return {
        message: "We only got part of the question. Fix anything missing.",
        notes,
        tone: "warning"
      };
    case "multiple_questions":
      return {
        message: "Multiple problems found — we used the first.",
        notes,
        tone: "warning"
      };
    case "none":
      return {
        message: "Couldn't read a question from this image. Type it manually or try a clearer photo.",
        notes,
        tone: "warning"
      };
    case "not_a_problem":
      return {
        message: "This image doesn't look like a homework problem.",
        notes,
        tone: "warning"
      };
    default:
      return null;
  }
}

export function extractionStatusHint(
  status: ExtractionStatus,
  error: string | null
): string | null {
  switch (status) {
    case "extracting":
      return "Extracting question…";
    case "ready":
      return "Review and edit if needed.";
    case "needs_review":
      return "Review the extracted question before continuing.";
    case "no_question":
      return "Enter the question manually or upload a clearer image.";
    case "failed":
      return error ?? "Could not extract the question.";
    default:
      return null;
  }
}

export function shouldPrefillExtractedQuestion(outcome: ExtractionOutcome): boolean {
  return outcome === "extracted" || outcome === "partial" || outcome === "multiple_questions";
}

export function legacyReadyExtractionAlert(): ExtractionAlert {
  return {
    message: "Check the question below, then confirm or edit it.",
    notes: null,
    tone: "neutral"
  };
}

export function resolvePromptConfirmedForSession(context: {
  extractionOutcome: ExtractionOutcome | null;
  imageObjectKey: string | null;
  imagePrompt: string | null;
  promptConfirmed: boolean;
}): boolean {
  if (context.promptConfirmed) {
    return true;
  }

  return Boolean(
    !context.extractionOutcome && context.imageObjectKey && context.imagePrompt?.trim()
  );
}
