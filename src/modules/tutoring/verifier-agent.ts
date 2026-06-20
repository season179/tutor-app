import { HttpError, type JsonValue } from "../../core/http-error.js";
import { extractOutputText, fetchOpenAiJson, requireOpenAiApiKey } from "../../providers/openai/openai-responses.js";
import { isJsonObject } from "../../core/schema-parser.js";
import {
  scrubComputedSolutionFromFrame,
  scrubComputedSolutionFromText,
  type ProblemFrame
} from "../problems/problem-frame.js";
import type { StudentAssessmentStatus } from "./tutor-action.js";

export const defaultVerifierModel = "gpt-5.5";

/** Whether we are grading a single step in the loop or the final framed answer. */
export type VerifierKind = "step" | "final_answer";

export type VerifierConfidence = "low" | "medium" | "high";

/**
 * The verifier's verdict. It assesses; it never speaks. `correctionHint` is a short
 * redirect or probing question for the tutor to weave in — never the worked answer.
 */
export type VerifierVerdict = {
  studentStatus: StudentAssessmentStatus;
  misconceptionKey: string | null;
  confidence: VerifierConfidence;
  correctionHint: string | null;
};

export type VerifierAgentEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_VERIFIER_MODEL?: string | undefined;
  OPENAI_TUTOR_MODEL: string | undefined;
};

export type VerifierAgentInput = {
  frame: ProblemFrame;
  /** The exact question the child is answering this turn. */
  question: string;
  studentText: string;
  kind: VerifierKind;
};

type VerifierOptions = {
  apiKey: string | undefined;
  model: string;
};

const verifierStatuses = ["correct", "partial", "incorrect", "stuck", "off_task", "unknown"] as const;

const verifierInstructions = `You are a narrow answer verifier for a children's homework tutor. You GRADE; you never speak to the child.

You are given the problem frame (givens, relationships, the unknown to find, the visible question), the exact question the child is answering this turn, and the child's words. Decide how their response measures up.

studentStatus:
- "correct": the response is right for what was asked (a right number, or sound reasoning that reaches it). Accept child phrasing and paraphrases.
- "partial": on the right track but incomplete, or right idea with a slip.
- "incorrect": a clear, confident wrong answer or wrong method.
- "stuck": they signal they don't know, ask for the answer, or give no usable attempt.
- "off_task": unrelated to the problem.
- "unknown": you genuinely cannot tell from what they said.

Be conservative: only "correct" when you are sure. When unsure, prefer "partial", "stuck", or "unknown" — never guess "correct".

correctionHint: at most one short sentence the tutor can use to redirect — a nudge or probing question. NEVER state, compute, or imply the final numeric answer. Use null when studentStatus is "correct".
misconceptionKey: a short snake_case tag for the error (e.g. "used_total_not_share", "added_instead_of_subtracted") or null.

Return JSON only.`;

const verifierJsonSchema = {
  additionalProperties: false,
  properties: {
    confidence: { enum: ["low", "medium", "high"], type: "string" },
    correctionHint: { type: ["string", "null"] },
    misconceptionKey: { type: ["string", "null"] },
    studentStatus: { enum: [...verifierStatuses], type: "string" }
  },
  required: ["confidence", "correctionHint", "misconceptionKey", "studentStatus"],
  type: "object"
} as const;

export function createVerifierOptions(env: VerifierAgentEnv): VerifierOptions {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_VERIFIER_MODEL ?? env.OPENAI_TUTOR_MODEL ?? defaultVerifierModel
  };
}

/**
 * Grades a step or final answer with a narrow LLM rubric. The frame is scrubbed of any
 * worked solution before it reaches the model (defense-in-depth on top of extraction).
 */
export async function runVerifierAgent(
  input: VerifierAgentInput,
  env: VerifierAgentEnv
): Promise<VerifierVerdict> {
  const options = createVerifierOptions(env);
  const apiKey = requireOpenAiApiKey(options.apiKey);
  // Strip any worked solution (numeric-only target, "= 6", "the answer is 6") before the
  // frame reaches the model — defense-in-depth on top of the scrub done at extraction.
  const safeFrame = scrubComputedSolutionFromFrame(input.frame);

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
    apiKey,
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: JSON.stringify(
                {
                  kind: input.kind,
                  problemFrame: {
                    givens: safeFrame.quantities,
                    relationships: safeFrame.relationships,
                    unknownTarget: safeFrame.unknownTarget,
                    visibleQuestion: safeFrame.visibleQuestion
                  },
                  questionAsked: scrubComputedSolutionFromText(input.question),
                  studentText: input.studentText.trim()
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
      instructions: verifierInstructions,
      model: options.model,
      text: {
        format: {
          name: "verifier_verdict",
          schema: verifierJsonSchema,
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
    throw new HttpError(502, "OpenAI verifier response did not include output text.", payload);
  }

  try {
    return parseVerifierVerdict(JSON.parse(outputText) as JsonValue);
  } catch (error) {
    throw new HttpError(
      502,
      "OpenAI verifier response was not valid JSON.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function parseVerifierVerdict(value: JsonValue): VerifierVerdict {
  if (!isJsonObject(value)) {
    throw new Error("Verifier payload must be an object.");
  }

  const studentStatus = value.studentStatus;
  if (typeof studentStatus !== "string" || !verifierStatuses.some((status) => status === studentStatus)) {
    throw new Error("Verifier payload studentStatus was invalid.");
  }

  const confidence = value.confidence;
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
    throw new Error("Verifier payload confidence was invalid.");
  }

  return {
    confidence,
    correctionHint: optionalText(value.correctionHint, "correctionHint"),
    misconceptionKey: optionalText(value.misconceptionKey, "misconceptionKey"),
    studentStatus: studentStatus as StudentAssessmentStatus
  };
}

function optionalText(value: JsonValue | undefined, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Verifier payload ${field} was invalid.`);
  }

  return value.trim() || null;
}
