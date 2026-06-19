import { HttpError, type JsonValue } from "../http-error.js";
import { extractOutputText, fetchOpenAiJson, requireOpenAiApiKey } from "../openai-responses.js";
import { isJsonObject } from "../schema-parser.js";
import type { ExtractionOutcome, ExtractQuestionResponse } from "./problem-context-types.js";

export const defaultVisionModel = "gpt-5.5";

const minExtractedQuestionLength = 12;

export type QuestionExtractionServiceEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_VISION_MODEL: string | undefined;
};

const extractionInstructions = `Extract the main homework, math, or science problem question from this image.
Return the question as plain text the student would read.
If multiple complete problems exist, return the first complete one and set outcome to multiple_questions.
If the image is not a homework or school problem (for example a selfie, meme, or unrelated photo), set outcome to not_a_problem.
If no readable question is visible, set outcome to none and explain in notes.
If text is visible but incomplete, garbled, or missing key parts, set outcome to partial.
If a complete question is visible, set outcome to extracted.
Set confidence to high, medium, or low based on how certain you are.
Use notes for brief explanations when outcome is not extracted.`;

const extractedQuestionJsonSchema = {
  additionalProperties: false,
  properties: {
    confidence: {
      enum: ["high", "low", "medium"],
      type: "string"
    },
    notes: {
      type: ["string", "null"]
    },
    outcome: {
      enum: ["extracted", "multiple_questions", "none", "not_a_problem", "partial"],
      type: "string"
    },
    question: {
      type: "string"
    }
  },
  required: ["question", "confidence", "notes", "outcome"],
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

export function normalizeExtractionResponse(
  value: Pick<ExtractQuestionResponse, "confidence" | "notes" | "outcome" | "question">
): ExtractQuestionResponse {
  const question = value.question.trim();
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

  return {
    confidence: value.confidence,
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

function parseExtractQuestionResponse(value: JsonValue): Pick<
  ExtractQuestionResponse,
  "confidence" | "notes" | "outcome" | "question"
> {
  if (!isJsonObject(value)) {
    throw new Error("Extraction payload must be an object.");
  }

  const confidence = value.confidence;
  const question = value.question;
  const notes = value.notes;
  const outcome = value.outcome;

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

  return {
    confidence,
    notes,
    outcome,
    question: question.trim()
  };
}
