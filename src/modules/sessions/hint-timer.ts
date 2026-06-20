/**
 * Idle wait before a gentle hint nudge in the step loop (M5). Set to ~2 minutes per the
 * pedagogy rule (docs/tutoring-workflow.md): a child shouldn't struggle alone longer than
 * that, but the struggle before the nudge should be productive, not cut short.
 */
export const hintWaitMs = 120_000;

export const hintTimerEventMessage = "Hint timer";

/**
 * The live, answer-free step context an idle hint is built from. Both fields come from the
 * public projection of the active step — never the verifier's answer key.
 */
export type HintContext = {
  ask: string | null;
  scaffoldAid: string | null;
};

const emptyHintContext: HintContext = { ask: null, scaffoldAid: null };

/**
 * Builds an idle nudge from the live step, escalating with support level. It only ever uses
 * the answer-free `ask` and `scaffoldAid` (e.g. "24 ÷ 4") — never the answer — and falls back
 * to generic encouragement when there is no active step yet, so it works for any problem
 * rather than the hardcoded sticker script it replaced.
 */
export function hintNudgeForSupportLevel(
  supportLevel: number,
  context: HintContext = emptyHintContext
): string {
  const ask = context.ask?.trim() || null;
  const scaffoldAid = context.scaffoldAid?.trim() || null;

  if (supportLevel <= 0) {
    return ask
      ? `Take your time — what's the first thing you could try for "${ask}"?`
      : "Take your time — what's the first thing you could try?";
  }

  if (supportLevel === 1) {
    return ask
      ? `Hint: think about "${ask}". What could you do first?`
      : "Hint: what's the first small step you could take?";
  }

  if (supportLevel === 2) {
    if (scaffoldAid) {
      return `Hint: try working it out as ${scaffoldAid}.`;
    }
    return ask
      ? `Hint: focus on "${ask}" — one small step at a time.`
      : "Hint: try the first small step, even if you're not sure.";
  }

  return scaffoldAid
    ? `Hint: set it up as ${scaffoldAid} and take it one step at a time.`
    : "Hint: let's do the very first step together — what could come first?";
}

export function shouldArmHintTimer(phase: string): boolean {
  return phase === "step_loop";
}
