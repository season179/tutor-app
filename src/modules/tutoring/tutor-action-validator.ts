/**
 * TutorActionValidator — the referee. A pure function that decides whether a
 * proposed tutor turn may be spoken, given the server's authoritative phase.
 *
 * This is where "the pedagogy is the protocol" becomes enforceable: move legality
 * (per PhasePolicy), the 32-word cap, one cognitive demand per turn, and a
 * best-effort no-final-answer check. The model is *asked* to follow these rules in
 * its instructions; the validator is what *enforces* them before TTS.
 *
 * The one-cognitive-demand and no-final-answer checks are intentionally light text
 * heuristics, tuned to avoid blocking legal turns — real correctness judgement is the
 * separate verifier's job (M4). See `docs/build-plan.md`.
 */

import type { ProposedTutorAction, SessionPhase } from "./tutor-action.js";
import { allowedMoves, forbiddenMoves } from "./phase-policy.js";

export const maxSpokenWords = 32;

export type ValidationContext = { phase: SessionPhase };

export type ValidationResult = { ok: true } | { ok: false; reasons: string[] };

// Catch the tutor *stating* the result ("the answer is 6", "the answer's 42") without
// tripping on legal turns that merely ask about the answer ("what do you think the answer
// is?") or mention answers in the plural ("which of the answers is closer?"). We require a
// numeric value right after the phrase, and a real apostrophe in the contraction (so the
// plural "answers" doesn't match). Spelled-out reveals are left to the verifier (M4).
const finalAnswerPatterns: readonly RegExp[] = [
  /\bthe (?:final )?answer is\s+[-+]?\$?\d/i,
  /\bthe answer['’]s\s+[-+]?\$?\d/i
];

// A short opening check-in ("Ready?", "Make sense?", "Got it?") is rapport, not a
// cognitive demand, so we drop one such lead-in before counting question marks — a warm
// opener shouldn't read as a second demand. Backstop only: the model is also instructed to
// give exactly one demand per turn.
const rapportLeadIn =
  /^\s*(?:ok|okay|alright|right|cool|nice|ready|stuck|got it|makes? sense|sounds? good|all set|still (?:with|there)|with me|you good)\b[^?]*\?\s+/i;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countDemands(text: string): number {
  return (text.replace(rapportLeadIn, "").match(/\?/g) ?? []).length;
}

function looksLikeFinalAnswer(text: string): boolean {
  return finalAnswerPatterns.some((pattern) => pattern.test(text));
}

export function validateTutorAction(
  action: ProposedTutorAction,
  context: ValidationContext
): ValidationResult {
  const reasons: string[] = [];
  const { phase } = context;

  const allowed = allowedMoves(phase);
  if (forbiddenMoves(phase).some((forbidden) => forbidden === action.move)) {
    reasons.push(
      `move "${action.move}" is forbidden in phase "${phase}" — it would solve or reveal the answer`
    );
  } else if (!allowed.some((legal) => legal === action.move)) {
    reasons.push(
      `move "${action.move}" is not allowed in phase "${phase}"; allowed moves are: ${allowed.join(", ")}`
    );
  }

  const words = countWords(action.spokenUtterance);
  if (words === 0) {
    reasons.push("spokenUtterance is empty; the tutor must say something");
  } else if (words > maxSpokenWords) {
    reasons.push(`spokenUtterance is ${words} words; the cap is ${maxSpokenWords}`);
  }

  if (countDemands(action.spokenUtterance) > 1) {
    reasons.push("spokenUtterance makes more than one request; give exactly one cognitive demand per turn");
  }

  if (looksLikeFinalAnswer(action.spokenUtterance)) {
    reasons.push("spokenUtterance appears to reveal the final answer");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
