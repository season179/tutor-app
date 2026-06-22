// Flue workflow: extract-question (vision).
//
// Worker A's extractQuestion builds the extraction instructions and ships the image URL in
// `payload.imageUrl`. Unlike the per-turn stages (gate/verifier/tutor), this stage runs at
// session-creation time (latency-tolerant) and takes an image input. Worker A passes a
// presigned R2 read URL; this workflow fetches the bytes and attaches them as a vision
// image, since Flue's PromptImage needs the image bytes ({ type, data, mimeType }), not a URL.
//
// Worker A applies normalizeExtractionResponse / parseExtractQuestionResponse to the result
// (extra domain validation + scrubbing the frame of any computed solution). The valibot
// `result` here mirrors the OpenAI extractedQuestionJsonSchema.
import { createAgent, type FlueContext, type PromptImage, type WorkflowRouteHandler } from "@flue/runtime";
import * as v from "valibot";

export const route: WorkflowRouteHandler = async (_context, next) => next();

const extractor = createAgent(() => ({
  model: process.env.REASONING_MODEL ?? "openai/gpt-5.5"
}));

// The shared structured-output contract. Mirrors the OpenAI extractedQuestionJsonSchema so
// Worker A's parseExtractQuestionResponse sees the same shape. The enum fields
// (outcome/confidence/problemType) are picklists so structured output emits the exact tokens
// Worker A's parser expects — problemType in particular MUST stay in lockstep with Worker A's
// `problemTypes`; a bare v.string() let the model return "word problem" (space) where the
// parser requires "word_problem" (underscore), failing the whole extraction. Worker A still
// re-validates these enums as defense in depth.
export const extractQuestionResult = v.object({
  question: v.string(),
  confidence: v.picklist(["high", "medium", "low"]),
  notes: v.union([v.string(), v.null()]),
  outcome: v.picklist(["extracted", "multiple_questions", "none", "not_a_problem", "partial"]),
  extractedText: v.string(),
  problemType: v.picklist(["word_problem", "equation", "geometry", "science", "other"]),
  likelySkillKeys: v.array(v.string()),
  quantities: v.array(
    v.object({
      label: v.string(),
      raw: v.string(),
      unit: v.union([v.string(), v.null()])
    })
  ),
  relationships: v.array(v.string()),
  unknownTarget: v.union([v.string(), v.null()]),
  diagramDescription: v.union([v.string(), v.null()]),
  taskLanguage: v.string(),
  languageIsSubject: v.boolean()
});

export type ExtractQuestionPayload = {
  // The full extraction instructions (Worker A's extractionInstructions).
  input: string;
  // A presigned R2 read URL for the problem image. This workflow fetches the bytes and
  // attaches them as a vision PromptImage.
  imageUrl: string;
  // Optional per-call model override (`provider/model`). See gate-check.ts for the rationale;
  // falls back to the agent's env-based model (REASONING_MODEL) when absent.
  model?: string;
};

export async function run({ init, payload }: FlueContext<ExtractQuestionPayload>) {
  const image = await fetchPromptImage(payload.imageUrl);
  const harness = await init(extractor);
  const session = await harness.session();

  const response = await session.prompt(payload.input, {
    result: extractQuestionResult,
    images: [image],
    ...(payload.model ? { model: payload.model } : {})
  });

  return response.data;
}

/** Fetches the image URL and converts it to the Flue PromptImage shape ({ type, data, mimeType }). */
async function fetchPromptImage(url: string): Promise<PromptImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`extract-question: failed to fetch image (${response.status})`);
  }
  const mimeType = response.headers.get("content-type") ?? "image/jpeg";
  const buffer = await response.arrayBuffer();
  const data = bytesToBase64(new Uint8Array(buffer));
  return { type: "image", data, mimeType };
}

/**
 * Base64-encodes bytes in fixed-size chunks. `btoa(String.fromCharCode(...bytes))` spreads
 * every byte as a call argument and overflows the call stack for realistic photo sizes
 * (~100KB+), so feed String.fromCharCode bounded slices instead. (Mirrors Worker A's
 * bytesToBase64 in voice-pipeline-service.ts, which uses the same 0x8000 chunking.)
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
