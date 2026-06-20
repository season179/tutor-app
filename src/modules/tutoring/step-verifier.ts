import type { ActiveStep } from "./active-step.js";
import { scrubComputedSolutionFromText } from "../problems/problem-frame.js";
import type { StudentAssessmentStatus } from "./tutor-action.js";
import type { VerifierConfidence, VerifierVerdict } from "./verifier-agent.js";

export type VerdictChip = "ok" | "partial" | "retry";

/**
 * How the verdict was reached: a deterministic numeric check against a computed
 * answer key, or the narrow LLM grader for problems we can't compute confidently.
 */
export type VerifierMethod = "deterministic" | "llm";

export type StepVerifierVerdict = {
  chip: VerdictChip;
  chipLabel: string;
  confidence: VerifierConfidence;
  correctionHint: string | null;
  method: VerifierMethod;
  misconceptionKey: string | null;
  studentAnswer: number | null;
  studentStatus: StudentAssessmentStatus;
};

const numberPattern = /[-+]?\d+(?:\.\d+)?/g;

function extractNumbers(text: string): number[] {
  const matches = text.match(numberPattern);
  if (!matches) {
    return [];
  }

  return matches.map((match) => Number(match)).filter((value) => Number.isFinite(value));
}

function chipForStatus(status: StudentAssessmentStatus): { chip: VerdictChip; chipLabel: string } {
  switch (status) {
    case "correct":
      return { chip: "ok", chipLabel: "That works" };
    case "partial":
      return { chip: "partial", chipLabel: "Almost" };
    case "incorrect":
      return { chip: "retry", chipLabel: "Let's look again" };
    default:
      return { chip: "retry", chipLabel: "Let's look again" };
  }
}

function correctionHintFor(
  step: ActiveStep,
  studentAnswer: number,
  status: StudentAssessmentStatus
): string | null {
  if (status === "correct") {
    return null;
  }

  const distractor = step.distractorNudges[String(studentAnswer)];
  if (distractor) {
    return distractor;
  }

  return step.defaultWrongNudge;
}

function primaryStudentAnswer(numbers: number[], step: ActiveStep): number {
  if (numbers.length === 1) {
    return numbers[0]!;
  }

  const expected = new Set(step.expectedAnswers);
  const matchingExpected = numbers.filter((value) => expected.has(value));
  if (matchingExpected.length === 1) {
    return matchingExpected[0]!;
  }

  if (matchingExpected.length > 1) {
    return matchingExpected[matchingExpected.length - 1]!;
  }

  return numbers[numbers.length - 1]!;
}

/**
 * Deterministic numeric check for the active step. Returns null when the student
 * turn does not contain a number worth grading.
 */
export function verifyActiveStep(step: ActiveStep, studentText: string): StepVerifierVerdict | null {
  const trimmed = studentText.trim();
  if (!trimmed) {
    return null;
  }

  const numbers = extractNumbers(trimmed);
  if (numbers.length === 0) {
    return null;
  }

  const studentAnswer = primaryStudentAnswer(numbers, step);
  const expected = new Set(step.expectedAnswers);

  let studentStatus: StudentAssessmentStatus;
  if (expected.has(studentAnswer)) {
    studentStatus = "correct";
  } else if (numbers.some((value) => expected.has(value))) {
    studentStatus = "partial";
  } else {
    studentStatus = "incorrect";
  }

  const { chip, chipLabel } = chipForStatus(studentStatus);

  return {
    chip,
    chipLabel,
    // A computed numeric match against the answer key is as sure as grading gets.
    confidence: "high",
    correctionHint: correctionHintFor(step, studentAnswer, studentStatus),
    method: "deterministic",
    misconceptionKey: null,
    studentAnswer,
    studentStatus
  };
}

export function shouldVerifyActiveStep(studentText: string): boolean {
  return extractNumbers(studentText).length > 0;
}

/**
 * The chip the child sees for an LLM-graded turn. The gradeable statuses agree with the
 * deterministic mapping; the soft statuses (stuck/off_task/unknown) get a gentle chip so a
 * turn we merely couldn't confirm never reads as a red "wrong".
 */
function chipForLlmStatus(status: StudentAssessmentStatus): { chip: VerdictChip; chipLabel: string } {
  switch (status) {
    case "correct":
      return { chip: "ok", chipLabel: "That works" };
    case "incorrect":
      return { chip: "retry", chipLabel: "Let's look again" };
    case "partial":
      return { chip: "partial", chipLabel: "Almost" };
    case "stuck":
      return { chip: "partial", chipLabel: "Let's keep going" };
    case "off_task":
      return { chip: "partial", chipLabel: "Back to the problem" };
    default:
      return { chip: "partial", chipLabel: "Tell me more" };
  }
}

/**
 * Wraps an LLM verifier verdict in the shared verdict shape. The correction hint is
 * scrubbed again here so a worked answer can never reach the tutor (and then the child).
 */
export function llmStepVerdict(verdict: VerifierVerdict): StepVerifierVerdict {
  const { chip, chipLabel } = chipForLlmStatus(verdict.studentStatus);
  const correctionHint =
    verdict.correctionHint && verdict.studentStatus !== "correct"
      ? scrubComputedSolutionFromText(verdict.correctionHint) || null
      : null;

  return {
    chip,
    chipLabel,
    confidence: verdict.confidence,
    correctionHint,
    method: "llm",
    misconceptionKey: verdict.misconceptionKey,
    studentAnswer: null,
    studentStatus: verdict.studentStatus
  };
}

/**
 * The fail-safe verdict when no track could grade a turn that should have been graded.
 * Returning "unknown" (rather than no verdict) keeps the warm model from self-certifying.
 */
export function unknownStepVerdict(): StepVerifierVerdict {
  const { chip, chipLabel } = chipForLlmStatus("unknown");
  return {
    chip,
    chipLabel,
    confidence: "low",
    correctionHint: null,
    method: "llm",
    misconceptionKey: null,
    studentAnswer: null,
    studentStatus: "unknown"
  };
}
