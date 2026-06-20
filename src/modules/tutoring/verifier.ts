import type { ActiveStep } from "./active-step.js";
import { verifyAnswerCheck } from "./answer-checker.js";
import type { ProblemContextRecord } from "../problems/problem-frame.js";
import {
  llmStepVerdict,
  shouldVerifyActiveStep,
  unknownStepVerdict,
  verifyActiveStep,
  type StepVerifierVerdict
} from "./step-verifier.js";
import type { ComprehensionGateStatus, SessionPhase } from "./tutor-action.js";
import { runVerifierAgent, type VerifierAgentEnv } from "./verifier-agent.js";

export type GradeTurnInput = {
  activeStep: ActiveStep | null;
  frame: ProblemContextRecord | null;
  gateStatus: ComprehensionGateStatus | null;
  /** The most recent tutor question, used when there is no derived activeStep to grade against. */
  lastTutorAsk: string | null;
  phase: SessionPhase;
  studentText: string;
};

/** Only the solving phases grade, and only once the comprehension gate is complete. */
export function shouldGradeTurn(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  studentText: string
): boolean {
  return (
    (phase === "step_loop" || phase === "answer_check") &&
    gateStatus === "complete" &&
    Boolean(studentText.trim())
  );
}

/**
 * The two-track verifier. The deterministic track is authoritative whenever the step has a
 * computed answer key and the child gave a number; otherwise the narrow LLM grader takes over
 * so any problem — not just equal-sharing — gets graded. When neither can grade a turn that
 * should be graded, it returns an "unknown" verdict (never null), so the warm tutor model can
 * never silently self-certify the child's work.
 */
export async function gradeStudentTurn(
  input: GradeTurnInput,
  env: VerifierAgentEnv
): Promise<StepVerifierVerdict | null> {
  if (!shouldGradeTurn(input.phase, input.gateStatus, input.studentText)) {
    return null;
  }

  // Deterministic track: a computed numeric match is the surest grade we can make.
  if (input.activeStep && input.activeStep.expectedAnswers.length > 0 && shouldVerifyActiveStep(input.studentText)) {
    const verdict =
      input.phase === "answer_check" && input.frame
        ? verifyAnswerCheck(input.activeStep, input.frame, input.studentText)
        : verifyActiveStep(input.activeStep, input.studentText);

    if (verdict) {
      return verdict;
    }
  }

  // LLM track: covers every problem the deterministic derivation can't compute.
  if (!input.frame) {
    return unknownStepVerdict();
  }

  const question =
    input.activeStep?.ask?.trim() ||
    input.lastTutorAsk?.trim() ||
    input.frame.visibleQuestion.trim() ||
    "";

  try {
    const verdict = await runVerifierAgent(
      {
        frame: input.frame,
        kind: input.phase === "answer_check" ? "final_answer" : "step",
        question,
        studentText: input.studentText
      },
      env
    );
    return llmStepVerdict(verdict);
  } catch (error) {
    // Fail safe: a grading-phase turn must never fall through ungraded. Log and return
    // "unknown" so the tutor asks the child to explain rather than affirming a guess.
    console.error(
      JSON.stringify({
        message: "verifier-agent failed; defaulting to unknown",
        phase: input.phase,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return unknownStepVerdict();
  }
}
