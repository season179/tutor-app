import type { ActiveStep } from "./active-step.js";
import type { StudentAssessmentStatus } from "./tutor-action.js";

export type VerdictChip = "ok" | "partial" | "retry";

export type StepVerifierVerdict = {
  chip: VerdictChip;
  chipLabel: string;
  correctionHint: string | null;
  method: "deterministic" | "skipped";
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
    correctionHint: correctionHintFor(step, studentAnswer, studentStatus),
    method: "deterministic",
    studentAnswer,
    studentStatus
  };
}

export function shouldVerifyActiveStep(studentText: string): boolean {
  return extractNumbers(studentText).length > 0;
}
