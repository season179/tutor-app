import { HttpError, type JsonValue } from "../../core/http-error.js";
import { extractOutputText, fetchOpenAiJson, requireOpenAiApiKey } from "../../providers/openai/openai-responses.js";
import { isJsonObject } from "../../core/schema-parser.js";
import {
  defaultProblemFrame,
  frameContainsComputedSolution,
  problemTypes,
  scrubComputedSolutionFromFrame,
  type ProblemFrame,
  type ProblemQuantity,
  type ProblemType
} from "./problem-frame.js";
import type { ExtractionOutcome, ExtractQuestionResponse } from "./problem-context-types.js";

export const defaultVisionModel = "gpt-5.5";

const minExtractedQuestionLength = 12;

export type QuestionExtractionServiceEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_VISION_MODEL: string | undefined;
};

const extractionInstructions = `Extract the homework problem *frame* from this image — what is given and what the student must find.

"question" is the load-bearing field. It MUST be the COMPLETE, self-contained problem statement, transcribed verbatim from the image — everything a student must read to solve the problem. For word problems the givens are usually embedded in the prose, so include every setup sentence leading up to AND the final question being asked. A student reading only "question" must have everything needed to solve it — never put just the final interrogative sentence there.
"quantities" and "relationships" are supplementary structured metadata that summarize the givens; they do not replace the full prose in "question".

Never include a computed final answer, solved value, or arithmetic result in any field — only what the problem asks the student to find.
If multiple complete problems exist, return the first complete one and set outcome to multiple_questions.
If the image is not a homework or school problem, set outcome to not_a_problem.
If no readable question is visible, set outcome to none and explain in notes.
If text is visible but incomplete, garbled, or missing key parts, set outcome to partial.
If a complete question is visible, set outcome to extracted.
Set confidence to high, medium, or low based on how certain you are.
Use notes for brief explanations when outcome is not extracted.`;

const quantitySchema = {
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    raw: { type: "string" },
    unit: { type: ["string", "null"] }
  },
  required: ["label", "raw", "unit"],
  type: "object"
} as const;

const extractedQuestionJsonSchema = {
  additionalProperties: false,
  properties: {
    confidence: {
      enum: ["high", "low", "medium"],
      type: "string"
    },
    diagramDescription: { type: ["string", "null"] },
    extractedText: { type: "string" },
    languageIsSubject: { type: "boolean" },
    likelySkillKeys: {
      items: { type: "string" },
      type: "array"
    },
    notes: {
      type: ["string", "null"]
    },
    outcome: {
      enum: ["extracted", "multiple_questions", "none", "not_a_problem", "partial"],
      type: "string"
    },
    problemType: {
      enum: [...problemTypes],
      type: "string"
    },
    quantities: {
      items: quantitySchema,
      type: "array"
    },
    question: {
      type: "string"
    },
    relationships: {
      items: { type: "string" },
      type: "array"
    },
    taskLanguage: { type: "string" },
    unknownTarget: { type: ["string", "null"] }
  },
  required: [
    "question",
    "confidence",
    "notes",
    "outcome",
    "extractedText",
    "problemType",
    "likelySkillKeys",
    "quantities",
    "relationships",
    "unknownTarget",
    "diagramDescription",
    "taskLanguage",
    "languageIsSubject"
  ],
  type: "object"
} as const;

export function createQuestionExtractionOptions(env: QuestionExtractionServiceEnv): {
  apiKey: string | undefined;
  visionModel: string;
} {
  return {
    apiKey: env.OPENAI_API_KEY,
    visionModel: env.OPENAI_VISION_MODEL ?? defaultVisionModel
  };
}

type RawExtractionPayload = {
  confidence: ExtractQuestionResponse["confidence"];
  diagramDescription: string | null;
  extractedText: string;
  languageIsSubject: boolean;
  likelySkillKeys: string[];
  notes: string | null;
  outcome: ExtractionOutcome;
  problemType: ProblemType;
  quantities: ProblemQuantity[];
  question: string;
  relationships: string[];
  taskLanguage: string;
  unknownTarget: string | null;
};

export function buildProblemFrame(payload: RawExtractionPayload): ProblemFrame {
  const visibleQuestion = payload.question.trim() || payload.extractedText.trim();

  return {
    diagramDescription: payload.diagramDescription?.trim() || null,
    extractedText: payload.extractedText.trim() || visibleQuestion,
    languageIsSubject: payload.languageIsSubject,
    likelySkillKeys: payload.likelySkillKeys,
    problemType: payload.problemType,
    quantities: payload.quantities,
    relationships: payload.relationships,
    taskLanguage: payload.taskLanguage.trim() || "en",
    unknownTarget: payload.unknownTarget?.trim() || null,
    visibleQuestion
  };
}

export function normalizeExtractionResponse(
  value: RawExtractionPayload
): ExtractQuestionResponse {
  let frame = buildProblemFrame(value);
  let question = frame.visibleQuestion;
  let outcome = value.outcome;
  let notes = value.notes?.trim() || null;

  if (!question) {
    outcome = "none";
  } else if (outcome === "extracted" && question.length < minExtractedQuestionLength) {
    outcome = "partial";
    notes = notes ?? "The extracted question looks incomplete.";
  } else if (outcome === "extracted" && value.confidence === "low") {
    outcome = "partial";
    notes = notes ?? "The extracted question may be incomplete.";
  }

  if (outcome === "none" && !notes) {
    notes = "No readable question was visible.";
  }

  if (outcome === "not_a_problem" && !notes) {
    notes = "This image does not look like a homework problem.";
  }

  if (frameContainsComputedSolution(frame)) {
    outcome = outcome === "extracted" ? "partial" : outcome;
    notes = notes ?? "Extraction may have included a computed answer; please confirm the question.";
    // Scrub the worked answer out of every free-text field (not just unknownTarget) and
    // recompute the question, so a solved value can never reach storage or the model.
    frame = scrubComputedSolutionFromFrame(frame);
    question = frame.visibleQuestion;
  }

  return {
    confidence: value.confidence,
    frame,
    notes,
    outcome,
    question,
    requiresConfirmation: true
  };
}

export async function extractQuestionFromImageUrl(
  imageUrl: string,
  env: QuestionExtractionServiceEnv
): Promise<ExtractQuestionResponse> {
  const options = createQuestionExtractionOptions(env);
  const apiKey = requireOpenAiApiKey(options.apiKey);

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
    apiKey,
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: extractionInstructions,
              type: "input_text"
            },
            {
              image_url: imageUrl,
              type: "input_image"
            }
          ],
          role: "user"
        }
      ],
      model: options.visionModel,
      text: {
        format: {
          name: "extracted_question",
          schema: extractedQuestionJsonSchema,
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
    throw new HttpError(502, "OpenAI vision response did not include output text.", payload);
  }

  try {
    return normalizeExtractionResponse(parseExtractQuestionResponse(JSON.parse(outputText) as JsonValue));
  } catch (error) {
    throw new HttpError(
      502,
      "OpenAI vision response was not valid extraction JSON.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function parseExtractQuestionResponse(value: JsonValue): RawExtractionPayload {
  if (!isJsonObject(value)) {
    throw new Error("Extraction payload must be an object.");
  }

  const confidence = value.confidence;
  const question = value.question;
  const notes = value.notes;
  const outcome = value.outcome;
  const extractedText = value.extractedText;
  const problemType = value.problemType;
  const likelySkillKeys = value.likelySkillKeys;
  const quantities = value.quantities;
  const relationships = value.relationships;
  const unknownTarget = value.unknownTarget;
  const diagramDescription = value.diagramDescription;
  const taskLanguage = value.taskLanguage;
  const languageIsSubject = value.languageIsSubject;

  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new Error("Extraction payload confidence was invalid.");
  }

  if (typeof question !== "string") {
    throw new Error("Extraction payload question was invalid.");
  }

  if (notes !== null && typeof notes !== "string") {
    throw new Error("Extraction payload notes was invalid.");
  }

  if (
    outcome !== "extracted" &&
    outcome !== "multiple_questions" &&
    outcome !== "none" &&
    outcome !== "not_a_problem" &&
    outcome !== "partial"
  ) {
    throw new Error("Extraction payload outcome was invalid.");
  }

  if (typeof extractedText !== "string") {
    throw new Error("Extraction payload extractedText was invalid.");
  }

  if (!problemTypes.includes(problemType as ProblemType)) {
    throw new Error("Extraction payload problemType was invalid.");
  }

  if (!Array.isArray(likelySkillKeys) || !likelySkillKeys.every((item) => typeof item === "string")) {
    throw new Error("Extraction payload likelySkillKeys was invalid.");
  }

  if (!Array.isArray(relationships) || !relationships.every((item) => typeof item === "string")) {
    throw new Error("Extraction payload relationships was invalid.");
  }

  if (unknownTarget !== null && typeof unknownTarget !== "string") {
    throw new Error("Extraction payload unknownTarget was invalid.");
  }

  if (diagramDescription !== null && typeof diagramDescription !== "string") {
    throw new Error("Extraction payload diagramDescription was invalid.");
  }

  if (typeof taskLanguage !== "string") {
    throw new Error("Extraction payload taskLanguage was invalid.");
  }

  if (typeof languageIsSubject !== "boolean") {
    throw new Error("Extraction payload languageIsSubject was invalid.");
  }

  const parsedQuantities: ProblemQuantity[] = [];
  if (!Array.isArray(quantities)) {
    throw new Error("Extraction payload quantities was invalid.");
  }

  for (const item of quantities) {
    if (!isJsonObject(item)) {
      continue;
    }

    const raw = item.raw;
    const label = item.label;
    const unit = item.unit;
    if (typeof raw !== "string" || typeof label !== "string") {
      continue;
    }

    parsedQuantities.push({
      label,
      raw,
      ...(typeof unit === "string" && unit ? { unit } : {})
    });
  }

  return {
    confidence,
    diagramDescription,
    extractedText: extractedText.trim(),
    languageIsSubject,
    likelySkillKeys,
    notes,
    outcome,
    problemType: problemType as ProblemType,
    quantities: parsedQuantities,
    question: question.trim(),
    relationships,
    taskLanguage,
    unknownTarget: unknownTarget?.trim() || null
  };
}

export function emptyExtractionResponse(question = ""): ExtractQuestionResponse {
  return normalizeExtractionResponse({
    confidence: "low",
    diagramDescription: null,
    extractedText: question,
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: question ? null : "No readable question was visible.",
    outcome: question ? "partial" : "none",
    problemType: "other",
    quantities: [],
    question,
    relationships: [],
    taskLanguage: "en",
    unknownTarget: null
  });
}

// Re-export for tests that import from the service module.
export { defaultProblemFrame, frameContainsComputedSolution };
