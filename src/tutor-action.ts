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
 * validator can name the violation precisely.
 */
export type GateForbiddenMove = "solve" | "final_answer" | "calculation_hint" | "check_answer";

/** What the model may put in `move`: a legal move, or (caught by the validator) a leak marker. */
export type ProposedMove = TutorMove | GateForbiddenMove;

export type SupportLevel = 0 | 1 | 2 | 3 | 4;

export type ComprehensionGateStatus =
  | "needs_image"
  | "needs_question_confirmation"
  | "needs_context_read" // Three Reads #1
  | "needs_quantity_read" // Three Reads #2
  | "needs_target_read" // Three Reads #3
  | "needs_restatement"
  | "complete";

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
    gateStatus?: ComprehensionGateStatus;
  };
};

/**
 * The full target contract (see `docs/tutoring-workflow.md`). Documented here as the
 * shape M1 grows toward; populated progressively across milestones.
 */
export type TutorAction = {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  phase: SessionPhase;
  move: ProposedMove;
  supportLevel: SupportLevel;
  targetCognitiveWork:
    | "notice"
    | "restate"
    | "choose_first_step"
    | "explain_why"
    | "calculate_one_step"
    | "check_work"
    | "summarize";
  expectedStudentResponse:
    | "spoken_phrase"
    | "spoken_reasoning"
    | "one_number"
    | "choice"
    | "independent_attempt"
    | "none";
  spokenUtterance: string;
  language: {
    spokenLanguage: string;
    termSet: string;
    targetOutputLanguage: string;
    codeSwitchPolicy: "mirror" | "stable";
  };
  waitPolicy: { minimumQuietMs: number; nudgeAfterMs: number; hintAfterMs: number };
  assessment: {
    studentStatus: StudentAssessmentStatus;
    misconceptionKey?: string;
    confidence: "low" | "medium" | "high";
  };
  statePatch: {
    nextPhase?: SessionPhase;
    gateStatus?: ComprehensionGateStatus;
    supportLevelDelta?: -1 | 0 | 1;
    masteryEvidence?: Array<{ skillKey: string; kind: "success" | "struggle" | "misconception" }>;
  };
  safety: { kind: "none" | "boundary" | "escalate"; reason?: string };
};

export const tutorActionSchemaVersion = 1 as const;
