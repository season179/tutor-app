/**
 * The canonical tutoring contract — the server-owned vocabulary the phase machine
 * enforces. Mirrors the `TutorAction` contract in `docs/tutoring-workflow.md`.
 *
 * Introduced in M1 (see `docs/build-plan.md`). `TutorAction` is the target shape;
 * M1 emits and validates the `ProposedTutorAction` subset and grows it per milestone.
 * The separate verifier (M4) sets `assessment.studentStatus`; the gate-checker (M3)
 * drives `gateStatus`. Authority over phase lives on the server, not in the model.
 */

/**
 * The session phases, in order. This array is the single source of truth — the
 * `SessionPhase` union is derived from it, so the two can never drift apart.
 */
export const sessionPhases = [
  "session_open",
  "capture_parse",
  "frame_task", // the comprehension gate
  "activate_prior",
  "plan_first_step",
  "step_loop",
  "answer_check",
  "memory_write",
  "transfer_check",
  "wrap_up"
] as const;

export type SessionPhase = (typeof sessionPhases)[number];

/**
 * The legal moves a tutor may emit (the formal contract enum). This array is the
 * single source of truth; the `TutorMove` union is derived from it.
 */
export const tutorMoves = [
  "rapport_check",
  "recall_prior",
  "clarify_context",
  "three_reads_1",
  "three_reads_2",
  "three_reads_3",
  "restate_prompt",
  "elicit",
  "scaffold_hint",
  "precision_check",
  "feedback_with_why",
  "model_micro_step",
  "fade",
  "transfer_check",
  "wrap",
  "reset",
  "safety_boundary",
  "escalate"
] as const;

export type TutorMove = (typeof tutorMoves)[number];

/**
 * Leak/solving markers that are never legal tutor moves. They appear only in a
 * phase's `forbiddenMoves` list so the model is told not to emit them and the
 * validator can name the violation precisely. Single source of truth — the
 * `GateForbiddenMove` union is derived from this array.
 */
export const gateForbiddenMoves = ["solve", "final_answer", "calculation_hint", "check_answer"] as const;

export type GateForbiddenMove = (typeof gateForbiddenMoves)[number];

/** What the model may put in `move`: a legal move, or (caught by the validator) a leak marker. */
export type ProposedMove = TutorMove | GateForbiddenMove;

export type SupportLevel = 0 | 1 | 2 | 3 | 4;

export const comprehensionGateStatuses = [
  "needs_image",
  "needs_question_confirmation",
  "needs_context_read", // Three Reads #1
  "needs_quantity_read", // Three Reads #2
  "needs_target_read", // Three Reads #3
  "needs_restatement",
  "complete"
] as const;

export type ComprehensionGateStatus = (typeof comprehensionGateStatuses)[number];

export type StudentAssessmentStatus =
  | "unknown"
  | "correct"
  | "partial"
  | "incorrect"
  | "stuck"
  | "off_task";

/**
 * The subset of `TutorAction` the model emits today (M1). Other fields of the full
 * contract are added with the milestone that needs them.
 *
 * Note there is deliberately no `studentStatus` here: the warm tutor must never
 * self-certify comprehension or grade its own work (build-plan D4/D5). Assessment is
 * owned by the separate verifier (M4) via `TutorAction.assessment.studentStatus`.
 */
export type ProposedTutorAction = {
  phase: SessionPhase;
  move: ProposedMove;
  spokenUtterance: string;
  statePatch?: {
    nextPhase?: SessionPhase;
  };
};

/**
 * The full target contract (see `docs/tutoring-workflow.md`), trimmed to the fields
 * actually wired today: identity + the move, the verifier-owned `assessment` (M4), and
 * the server-owned `statePatch` the phase machine and gate-checker (M3) drive.
 *
 * Deliberately not modeled yet — these belong to capabilities the build plan still
 * defers, and were removed so the type reflects reality rather than aspiration:
 * `language`/code-switching (trilingual), `waitPolicy` (timing), `targetCognitiveWork`
 * /`expectedStudentResponse` (the pedagogy-spec compiler), `masteryEvidence` (the
 * externalized learner model), and `safety` (the moderation/guardian surface).
 */
export type TutorAction = {
  schemaVersion: typeof tutorActionSchemaVersion;
  sessionId: string;
  turnId: string;
  phase: SessionPhase;
  move: ProposedMove;
  supportLevel: SupportLevel;
  spokenUtterance: string;
  assessment: {
    studentStatus: StudentAssessmentStatus;
    misconceptionKey?: string;
    confidence: "low" | "medium" | "high";
  };
  statePatch: {
    nextPhase?: SessionPhase;
    gateStatus?: ComprehensionGateStatus;
    supportLevelDelta?: -1 | 0 | 1;
  };
};

export const tutorActionSchemaVersion = 1 as const;
