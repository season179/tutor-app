import { HttpError, type JsonValue } from "../../core/http-error.js";
import { extractOutputText, fetchOpenAiJson, requireOpenAiApiKey } from "../../providers/openai/openai-responses.js";
import type { GateStage } from "./phase-policy.js";
import { scrubComputedSolutionFromText, type ProblemFrame } from "../problems/problem-frame.js";
import { isJsonObject } from "../../core/schema-parser.js";

export const defaultGateCheckerModel = "gpt-5.5";

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

const gateCheckerJsonSchema = {
  additionalProperties: false,
  properties: {
    accepted: { type: "boolean" },
    notes: { type: ["string", "null"] }
  },
  required: ["accepted", "notes"],
  type: "object"
} as const;

export type GateCheckerVerdict = {
  accepted: boolean;
  notes: string | null;
};

export type GateCheckerEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_GATE_CHECKER_MODEL?: string | undefined;
  OPENAI_TUTOR_MODEL: string | undefined;
};

type GateCheckerOptions = {
  apiKey: string | undefined;
  model: string;
};

export function createGateCheckerOptions(env: GateCheckerEnv): GateCheckerOptions {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_GATE_CHECKER_MODEL ?? env.OPENAI_TUTOR_MODEL ?? defaultGateCheckerModel
  };
}

/**
 * Grades one read of the Three Reads gate. Each stage has its own rubric, but all share the
 * frame and the strict-JSON verdict shape. The frame is scrubbed of any worked solution before
 * it reaches the model.
 */
export async function checkGateStage(
  stage: GateStage,
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv
): Promise<GateCheckerVerdict> {
  const options = createGateCheckerOptions(env);
  const apiKey = requireOpenAiApiKey(options.apiKey);
  const trimmed = studentText.trim();

  if (!trimmed) {
    return { accepted: false, notes: "No student text to evaluate." };
  }

  if (!frame.unknownTarget?.trim()) {
    return { accepted: false, notes: "Problem frame has no unknown target yet." };
  }

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
    apiKey,
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: JSON.stringify(
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
              ),
              type: "input_text"
            }
          ],
          role: "user"
        }
      ],
      instructions: gateStageInstructions(stage),
      model: options.model,
      text: {
        format: {
          name: "gate_checker_verdict",
          schema: gateCheckerJsonSchema,
          strict: true,
          type: "json_schema"
        }
      }
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new HttpError(502, "OpenAI gate-checker response did not include output text.", payload);
  }

  try {
    return parseGateCheckerVerdict(JSON.parse(outputText) as JsonValue);
  } catch (error) {
    throw new HttpError(
      502,
      "OpenAI gate-checker response was not valid JSON.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** Convenience wrapper for the final restatement read. */
export function checkGateRestatement(
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv
): Promise<GateCheckerVerdict> {
  return checkGateStage("restatement", frame, studentText, env);
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
