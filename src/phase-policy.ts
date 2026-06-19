/**
 * PhasePolicy — the pure rulebook for the server-owned phase machine.
 *
 * No I/O, no model calls: which moves are legal in a phase, which are forbidden,
 * and which phase transitions are allowed. This is the module the runtime consults
 * to decide what the tutor may do; the model only phrases within these bounds.
 * See `docs/tutoring-workflow.md` ("The phase model") and `docs/build-plan.md`.
 */

import type { GateForbiddenMove, SessionPhase, TutorMove } from "./tutor-action.js";

// Moves allowed in every phase — safety overrides and de-escalation are never gated.
const universalMoves: readonly TutorMove[] = ["reset", "safety_boundary", "escalate"];

const allowedByPhase: Record<SessionPhase, readonly TutorMove[]> = {
  session_open: ["rapport_check", "recall_prior"],
  capture_parse: ["clarify_context"],
  frame_task: ["three_reads_1", "three_reads_2", "three_reads_3", "restate_prompt"],
  activate_prior: ["recall_prior"],
  plan_first_step: ["elicit", "model_micro_step"],
  step_loop: ["elicit", "scaffold_hint", "precision_check", "feedback_with_why", "model_micro_step", "fade"],
  answer_check: ["precision_check", "feedback_with_why"],
  memory_write: ["elicit"],
  transfer_check: ["transfer_check", "fade"],
  wrap_up: ["wrap"]
};

// `solve`/`final_answer` are forbidden in every phase (invariant #1: never solve it
// for them). The gate (frame_task) additionally forbids anything that starts solving
// before the child has shown they understand the question.
const alwaysForbidden: readonly GateForbiddenMove[] = ["solve", "final_answer"];
// The gate (frame_task) forbids everything always-forbidden, plus the moves that start
// solving before the child has shown they understand the question. Composed from
// `alwaysForbidden` so a new universal leak marker is automatically forbidden here too.
const gateForbidden: readonly GateForbiddenMove[] = [...alwaysForbidden, "calculation_hint", "check_answer"];

export function allowedMoves(phase: SessionPhase): readonly TutorMove[] {
  return [...allowedByPhase[phase], ...universalMoves];
}

export function forbiddenMoves(phase: SessionPhase): readonly GateForbiddenMove[] {
  return phase === "frame_task" ? gateForbidden : alwaysForbidden;
}

export function isMoveLegal(phase: SessionPhase, move: string): boolean {
  return allowedMoves(phase).some((allowed) => allowed === move);
}

// The forward phase graph — the normal progression only. Self-transitions (a turn that
// stays put) and closing the session (→ wrap_up, e.g. on a safety exit) are allowed from
// anywhere via canTransition's early-returns, so wrap_up is deliberately not duplicated as
// a per-phase edge here.
const phaseGraph: Record<SessionPhase, readonly SessionPhase[]> = {
  session_open: ["capture_parse", "frame_task"],
  capture_parse: ["frame_task"],
  frame_task: ["activate_prior", "plan_first_step"],
  activate_prior: ["plan_first_step"],
  plan_first_step: ["step_loop"],
  step_loop: ["answer_check"],
  answer_check: ["memory_write", "step_loop"],
  memory_write: ["transfer_check"],
  transfer_check: [],
  wrap_up: []
};

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  if (from === to) {
    return true;
  }

  if (to === "wrap_up") {
    return true;
  }

  return phaseGraph[from].some((next) => next === to);
}

export const initialPhase: SessionPhase = "session_open";
