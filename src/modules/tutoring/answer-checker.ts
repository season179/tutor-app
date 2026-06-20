import type { ActiveStep } from "./active-step.js";
import type { ProblemFrame } from "../problems/problem-frame.js";
import { verifyActiveStep, type StepVerifierVerdict } from "./step-verifier.js";

const malayOutputMarkers = /\b(pelekat|kawan|setiap|berapa|sama rata|daripada)\b/i;

export function requiresSubjectLanguage(frame: ProblemFrame): boolean {
  const language = frame.taskLanguage?.toLowerCase() ?? "en";
  return frame.languageIsSubject || language.startsWith("ms");
}

export function hasSubjectLanguageOutput(text: string): boolean {
  return malayOutputMarkers.test(text);
}

export function outputLanguageLabel(frame: ProblemFrame): string | null {
  if (!requiresSubjectLanguage(frame)) {
    return null;
  }

  const language = frame.taskLanguage?.toLowerCase() ?? "ms";
  return language.startsWith("ms") ? "answer in BM" : `answer in ${frame.taskLanguage}`;
}

/**
 * Grades the final answer in `answer_check`: numeric match first, then required
 * output language when the worksheet language is the subject.
 */
export function verifyAnswerCheck(
  step: ActiveStep,
  frame: ProblemFrame,
  studentText: string
): StepVerifierVerdict | null {
  const numericVerdict = verifyActiveStep(step, studentText);
  if (!numericVerdict) {
    return null;
  }

  if (numericVerdict.studentStatus === "incorrect") {
    return numericVerdict;
  }

  if (requiresSubjectLanguage(frame) && !hasSubjectLanguageOutput(studentText)) {
    return {
      ...numericVerdict,
      chip: "partial",
      chipLabel: "Almost",
      correctionHint:
        "The worksheet is in Malay — try saying it with words like pelekat and kawan.",
      studentStatus: "partial"
    };
  }

  return numericVerdict;
}
