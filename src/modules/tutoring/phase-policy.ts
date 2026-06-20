/**
 * PhasePolicy — the pure rulebook for the server-owned phase machine.
 *
 * No I/O, no model calls: which moves are legal in a phase, which are forbidden,
 * and which phase transitions are allowed. This is the module the runtime consults
 * to decide what the tutor may do; the model only phrases within these bounds.
 * See `docs/tutoring-workflow.md` ("The phase model") and `docs/build-plan.md`.
 */

import { sessionPhases, type ComprehensionGateStatus, type GateForbiddenMove, type SessionPhase, type TutorMove } from "./tutor-action.js";

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
  memory_write: ["wrap_up", "transfer_check"],
  transfer_check: [],
  wrap_up: []
};

export function isGateComplete(gateStatus: ComprehensionGateStatus | null | undefined): boolean {
  return gateStatus === "complete";
}

/**
 * The Three Reads progression — the comprehension-gate read statuses in order. Each is a
 * distinct reading check the child must pass; a child can't skip ahead. `restatement` is
 * the final read, after which the gate completes.
 */
export const comprehensionGateReadStatuses = [
  "needs_context_read", // Read 1 — what is the problem about?
  "needs_quantity_read", // Read 2 — what are the numbers and what do they mean?
  "needs_target_read", // Read 3 — what is it asking us to find?
  "needs_restatement" // Final — restate the goal in your own words
] as const satisfies readonly ComprehensionGateStatus[];

type GateReadStatus = (typeof comprehensionGateReadStatuses)[number];

/** The reading task a gate read status corresponds to. */
export type GateStage = "context" | "quantity" | "target" | "restatement";

const gateStageByStatus: Record<GateReadStatus, GateStage> = {
  needs_context_read: "context",
  needs_quantity_read: "quantity",
  needs_target_read: "target",
  needs_restatement: "restatement"
};

/** The first gate status once a question with an unknown target has been framed. */
export const initialGateStatus: ComprehensionGateStatus = comprehensionGateReadStatuses[0];

export function isGateReadStatus(status: ComprehensionGateStatus | null | undefined): status is GateReadStatus {
  return comprehensionGateReadStatuses.some((candidate) => candidate === status);
}

/** The read being evaluated for a gate status, or null when the gate isn't on a read. */
export function gateStageForStatus(status: ComprehensionGateStatus | null | undefined): GateStage | null {
  return isGateReadStatus(status) ? gateStageByStatus[status] : null;
}

/**
 * The next gate status when the current read is accepted. Reads advance in their fixed
 * order and the final restatement completes the gate; any non-read status is returned
 * unchanged. This is the one place the gate moves forward, so a read can never be skipped.
 */
export function nextGateStatus(
  status: ComprehensionGateStatus | null | undefined
): ComprehensionGateStatus | null {
  const index = comprehensionGateReadStatuses.findIndex((candidate) => candidate === status);
  if (index < 0) {
    return status ?? null;
  }

  return comprehensionGateReadStatuses[index + 1] ?? "complete";
}

export function canTransition(
  from: SessionPhase,
  to: SessionPhase,
  gateStatus?: ComprehensionGateStatus | null
): boolean {
  if (from === to) {
    return true;
  }

  if (to === "wrap_up") {
    return true;
  }

  if (from === "frame_task" && to !== from && !isGateComplete(gateStatus)) {
    return false;
  }

  return phaseGraph[from].some((next) => next === to);
}

export function allowedNextPhases(
  from: SessionPhase,
  gateStatus?: ComprehensionGateStatus | null
): readonly SessionPhase[] {
  return sessionPhases.filter((candidate) => canTransition(from, candidate, gateStatus));
}

export const initialPhase: SessionPhase = "session_open";
