import { HttpError, type JsonValue } from "../../core/http-error.js";
import {
  composeReasoningInput,
  runReasoningWorkflow,
  type ReasoningEnv
} from "../../providers/reasoning/reasoning-binding.js";
import type { GateStage } from "./phase-policy.js";
import { scrubComputedSolutionFromText, type ProblemFrame } from "../problems/problem-frame.js";
import { isJsonObject } from "../../core/schema-parser.js";
import { modelExtraForStage, type ProviderSettings } from "../settings/settings-types.js";

// The "comprehension-gate checker" marker stays in the preamble: the voice pipeline and its
// tests identify a gate-check request by this phrase, distinct from the tutor/verifier calls.
const gateCheckerPreamble = `You are a narrow comprehension-gate checker for a children's homework tutor. You GRADE one small reading step of the Three Reads; you never speak to the child.`;

const gateStageRubrics: Record<GateStage, string> = {
  context: `This is READ 1 (context). The child should show they have read the problem and can say what it is ABOUT — the situation or story, in their own words.
Accept any reasonable paraphrase of the scenario.
Reject if they only ask for the answer, state a number, or show no sign of having read it.`,
  quantity: `This is READ 2 (quantities). The child should pick out the KEY NUMBERS in the problem and say what each one refers to (and how they relate).
Accept if they name the relevant given quantities correctly, even loosely.
Reject if they miss the numbers, invent ones, or only ask for the answer.`,
  target: `This is READ 3 (the question). The child should identify WHAT THE QUESTION ASKS them to find — the unknown — without solving it.
Accept a paraphrase or a blank/question form of the unknown target.
Reject a final numeric answer, a solving step, or "just tell me".`,
  restatement: `This is the FULL restatement. The child should restate, in their own words, what the problem is asking them to FIND, before solving is allowed.
Accept paraphrases, child language, and blank/question forms ("how many each friend gets", "we need to find ___").
Reject if they only ask you to solve it, state a final numeric answer, or describe unrelated content.`
};

function gateStageInstructions(stage: GateStage): string {
  return `${gateCheckerPreamble}

${gateStageRubrics[stage]}

Return JSON only. Be generous with age-appropriate paraphrases; only reject clear misses.`;
}

/**
 * The scrubbed, role-neutral user content both transport paths send — the problem frame
 * (worked solution stripped), the stage being graded, and the student's words. Shared so
 * the binding and legacy paths feed the model the exact same text.
 */
function gateStageUserContent(stage: GateStage, frame: ProblemFrame, trimmed: string): string {
  return JSON.stringify(
    {
      problemFrame: {
        givens: frame.quantities,
        relationships: frame.relationships.map((relationship) =>
          scrubComputedSolutionFromText(relationship)
        ),
        unknownTarget: scrubComputedSolutionFromText(frame.unknownTarget ?? "") || null,
        visibleQuestion: scrubComputedSolutionFromText(frame.visibleQuestion)
      },
      read: stage,
      studentText: trimmed
    },
    null,
    2
  );
}

export type GateCheckerVerdict = {
  accepted: boolean;
  notes: string | null;
};

export type GateCheckerEnv = ReasoningEnv;

/**
 * Grades one read of the Three Reads gate. Each stage has its own rubric, but all share the
 * frame and the verdict shape. The frame is scrubbed of any worked solution before it
 * reaches the model. The model call crosses the REASONING binding (Worker B's gate-check
 * workflow); Worker B validates the output against the shared valibot schema and Worker A
 * re-validates with `parseGateCheckerVerdict` (enum/trim/null-coalescing domain checks the
 * schema alone doesn't cover). A binding failure propagates as HttpError(502) so a
 * transient Worker B failure kills the turn before commit (the gate is not fail-soft).
 *
 * When `settings` is provided, the gate-check stage's model is shipped in the binding
 * payload (`extra.model`), overriding Worker B's env default for this call; when absent,
 * Worker B falls back to its env model. The turn path loads the settings snapshot once and
 * threads it through, so a single settings read covers every reasoning stage in the turn.
 */
export async function checkGateStage(
  stage: GateStage,
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv,
  settings?: ProviderSettings
): Promise<GateCheckerVerdict> {
  const trimmed = studentText.trim();

  if (!trimmed) {
    return { accepted: false, notes: "No student text to evaluate." };
  }

  if (!frame.unknownTarget?.trim()) {
    return { accepted: false, notes: "Problem frame has no unknown target yet." };
  }

  const input = composeReasoningInput(
    gateStageInstructions(stage),
    gateStageUserContent(stage, frame, trimmed)
  );
  const result = await runReasoningWorkflow("gate-check", input, env, settings ? modelExtraForStage(settings, "gate-check") : undefined);

  try {
    return parseGateCheckerVerdict(result);
  } catch (error) {
    throw new HttpError(
      502,
      "Gate-checker binding result did not match the verdict shape.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** Convenience wrapper for the final restatement read. */
export function checkGateRestatement(
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv,
  settings?: ProviderSettings
): Promise<GateCheckerVerdict> {
  return checkGateStage("restatement", frame, studentText, env, settings);
}

function parseGateCheckerVerdict(value: JsonValue): GateCheckerVerdict {
  if (!isJsonObject(value)) {
    throw new Error("Gate-checker payload must be an object.");
  }

  if (typeof value.accepted !== "boolean") {
    throw new Error("Gate-checker payload accepted was invalid.");
  }

  const notes = value.notes;
  if (notes !== null && typeof notes !== "string") {
    throw new Error("Gate-checker payload notes was invalid.");
  }

  return {
    accepted: value.accepted,
    notes: notes?.trim() || null
  };
}
