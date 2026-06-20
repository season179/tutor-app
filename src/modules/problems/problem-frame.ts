import type { ExtractionOutcome } from "./problem-context-types.js";

export const problemTypes = ["word_problem", "equation", "geometry", "science", "other"] as const;

export type ProblemType = (typeof problemTypes)[number];

export type ProblemQuantity = {
  label: string;
  raw: string;
  unit?: string | undefined;
};

/**
 * The problem *frame* — givens, unknown, and task language. Never the computed answer.
 * Stored in `problem_contexts` after vision extraction (M3).
 */
export type ProblemFrame = {
  diagramDescription: string | null;
  extractedText: string;
  languageIsSubject: boolean;
  likelySkillKeys: string[];
  problemType: ProblemType;
  quantities: ProblemQuantity[];
  relationships: string[];
  taskLanguage: string;
  unknownTarget: string | null;
  visibleQuestion: string;
};

export type ProblemContextRecord = ProblemFrame & {
  confirmedQuestion: string | null;
  createdAt: string;
  extractionConfidence: "high" | "low" | "medium" | null;
  extractionOutcome: ExtractionOutcome;
  id: string;
  r2ObjectKey: string | null;
  sessionId: string;
  updatedAt: string;
};

// A worked-answer "= N" is a computed result, e.g. "24 ÷ 4 = 6" or a "… = 6" scrawled after
// the prompt. The `(?<![A-Za-z]\s*)` guard keeps a genuine equation problem ("Solve 2x = 14",
// where a variable precedes "="), so it is detected/stripped only when the left side isn't a
// variable. No `$` anchor — a worked answer mid-text or on an earlier line must still match.
const computedAnswerEquationPattern = /(?<![A-Za-z]\s*)=\s*[-+]?\$?\d+(?:\.\d+)?/;

const computedSolutionPatterns: readonly RegExp[] = [
  /\bthe (?:final )?answer is\s+[-+]?\$?\d/i,
  /\bthe answer['’]s\s+[-+]?\$?\d/i,
  computedAnswerEquationPattern
];

const numericOnlyPattern = /^[-+]?\$?\d+(?:\.\d+)?$/;

function frameTextFields(frame: ProblemFrame): string[] {
  return [
    frame.extractedText,
    frame.visibleQuestion,
    frame.unknownTarget,
    frame.diagramDescription,
    ...frame.relationships,
    ...frame.quantities.map((quantity) => `${quantity.label} ${quantity.raw} ${quantity.unit ?? ""}`.trim())
  ].filter((value): value is string => Boolean(value?.trim()));
}

/** True when the frame appears to include a computed final answer (§9.4 guard). */
export function frameContainsComputedSolution(frame: ProblemFrame): boolean {
  if (frame.unknownTarget && numericOnlyPattern.test(frame.unknownTarget.trim())) {
    return true;
  }

  return frameTextFields(frame).some((text) =>
    computedSolutionPatterns.some((pattern) => pattern.test(text))
  );
}

// Global variants of the detection patterns, for stripping every occurrence of a
// worked answer out of free text. Givens are deliberately NOT touched (a "24" in
// "24 stickers" is an input the child needs, not the answer) — only explicit
// "the answer is N" and computed "= N" fragments are removed. The "= N" pattern shares
// the variable guard above so it scrubs worked answers anywhere in the text without
// corrupting a "Solve 2x = 14" equation.
const computedSolutionStripPatterns: readonly RegExp[] = [
  /\bthe (?:final )?answer(?:['’]s| is)\s+[-+]?\$?\d+(?:\.\d+)?/gi,
  new RegExp(computedAnswerEquationPattern.source, "g")
];

/**
 * Remove explicit worked-answer fragments from a single text field, leaving the
 * question and its givens intact. Returns the cleaned string (possibly empty).
 */
export function scrubComputedSolutionFromText(text: string): string {
  let cleaned = text;
  for (const pattern of computedSolutionStripPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/**
 * Return a copy of the frame with any computed answer scrubbed from its free-text
 * fields. A numeric-only `unknownTarget` (e.g. "6") is the answer masquerading as the
 * goal, so it is dropped entirely. Quantities (the givens) are never altered.
 */
export function scrubComputedSolutionFromFrame(frame: ProblemFrame): ProblemFrame {
  const unknownTarget =
    frame.unknownTarget && numericOnlyPattern.test(frame.unknownTarget.trim())
      ? null
      : frame.unknownTarget
        ? scrubComputedSolutionFromText(frame.unknownTarget) || null
        : null;

  return {
    ...frame,
    extractedText: scrubComputedSolutionFromText(frame.extractedText),
    visibleQuestion: scrubComputedSolutionFromText(frame.visibleQuestion),
    unknownTarget,
    relationships: frame.relationships
      .map((relationship) => scrubComputedSolutionFromText(relationship))
      .filter(Boolean),
    diagramDescription: frame.diagramDescription
      ? scrubComputedSolutionFromText(frame.diagramDescription) || null
      : null
  };
}

export function defaultProblemFrame(visibleQuestion = ""): ProblemFrame {
  return {
    diagramDescription: null,
    extractedText: visibleQuestion,
    languageIsSubject: false,
    likelySkillKeys: [],
    problemType: "other",
    quantities: [],
    relationships: [],
    taskLanguage: "en",
    unknownTarget: null,
    visibleQuestion
  };
}

/** Minimal frame when the child/parent confirms a typed question without vision extraction. */
export function problemFrameFromConfirmedPrompt(question: string): ProblemFrame {
  const trimmed = question.trim();

  return {
    ...defaultProblemFrame(trimmed),
    unknownTarget: trimmed || null,
    visibleQuestion: trimmed
  };
}
