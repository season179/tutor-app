import { HttpError, sessionNotFoundHttpError } from "../../core/http-error.js";
import { initialGateStatus } from "../tutoring/phase-policy.js";
import type { RequestContext } from "../../core/request-context.js";
import type { SessionStore } from "../sessions/session-store.js";
import {
  parseExtractQuestionRequest,
  parsePreviewUrlRequest,
  parseUploadUrlRequest
} from "./problem-context-schema.js";
import type {
  ExtractQuestionResponse,
  PreviewUrlResponse,
  UploadUrlResponse
} from "./problem-context-types.js";
import {
  assertProblemImageExists,
  createProblemImageObjectKey,
  createProblemImageReadUrl,
  createProblemImageUploadUrl,
  isOwnedProblemImageKey,
  type ProblemImageStoreEnv
} from "./problem-image-store.js";
import {
  createQuestionExtractionOptions,
  extractQuestionFromImageUrl,
  type QuestionExtractionServiceEnv
} from "./question-extraction-service.js";

export type ProblemContextHandlerEnv = ProblemImageStoreEnv & QuestionExtractionServiceEnv;

export async function handleUploadUrlRequest(
  body: unknown,
  env: ProblemContextHandlerEnv,
  store: SessionStore,
  context: RequestContext
): Promise<UploadUrlResponse> {
  const request = parseUploadUrlRequest(body);
  await requireOwnedSession(store, context.ownerKey, request.sessionId);

  const objectKey = createProblemImageObjectKey(request.sessionId);
  const upload = await createProblemImageUploadUrl(
    env,
    objectKey,
    request.contentType,
    request.bytes
  );

  return {
    expiresAt: upload.expiresAt,
    objectKey,
    uploadUrl: upload.uploadUrl
  };
}

export async function handleExtractQuestionRequest(
  body: unknown,
  env: ProblemContextHandlerEnv,
  store: SessionStore,
  context: RequestContext
): Promise<ExtractQuestionResponse> {
  const request = parseExtractQuestionRequest(body);
  await requireOwnedSession(store, context.ownerKey, request.sessionId);
  requireOwnedObjectKey(request.objectKey, request.sessionId);

  await assertProblemImageExists(env, request.objectKey);

  const readUrl = await createProblemImageReadUrl(env, request.objectKey);
  const extraction = await extractQuestionFromImageUrl(readUrl.url, env);

  await store.saveProblemContext(context.ownerKey, {
    extractionConfidence: extraction.confidence,
    extractionOutcome: extraction.outcome,
    frame: extraction.frame,
    r2ObjectKey: request.objectKey,
    sessionId: request.sessionId
  });

  await store.updateSession(context.ownerKey, request.sessionId, {
    extractionNotes: extraction.notes,
    extractionOutcome: extraction.outcome,
    gateStatus: extraction.frame.unknownTarget ? initialGateStatus : null,
    imageObjectKey: request.objectKey,
    imagePrompt: extraction.question || null,
    promptConfirmed: false
  });

  await store.appendEvent(context.ownerKey, request.sessionId, {
    message: "Question extracted",
    value: {
      confidence: extraction.confidence,
      extractedText: extraction.frame.extractedText,
      notes: extraction.notes,
      objectKey: request.objectKey,
      outcome: extraction.outcome,
      question: extraction.question,
      questionLength: extraction.question.length,
      requiresConfirmation: extraction.requiresConfirmation,
      unknownTarget: extraction.frame.unknownTarget
    }
  });

  return extraction;
}

export async function handlePreviewUrlRequest(
  body: unknown,
  env: ProblemContextHandlerEnv,
  store: SessionStore,
  context: RequestContext
): Promise<PreviewUrlResponse> {
  const request = parsePreviewUrlRequest(body);
  await requireOwnedSession(store, context.ownerKey, request.sessionId);
  requireOwnedObjectKey(request.objectKey, request.sessionId);

  await assertProblemImageExists(env, request.objectKey);

  const readUrl = await createProblemImageReadUrl(env, request.objectKey);

  return {
    expiresAt: readUrl.expiresAt,
    url: readUrl.url
  };
}

export function createProblemContextHandlerEnv(source: ProblemContextHandlerEnv): ProblemContextHandlerEnv {
  return {
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    OPENAI_VISION_MODEL: source.OPENAI_VISION_MODEL,
    R2_ACCESS_KEY_ID: source.R2_ACCESS_KEY_ID,
    R2_ACCOUNT_ID: source.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: source.R2_BUCKET_NAME,
    R2_SECRET_ACCESS_KEY: source.R2_SECRET_ACCESS_KEY,
    ...(source.PROBLEM_IMAGES ? { PROBLEM_IMAGES: source.PROBLEM_IMAGES } : {})
  };
}

export function assertProblemContextEnv(env: ProblemContextHandlerEnv): void {
  createQuestionExtractionOptions(env);
}

async function requireOwnedSession(store: SessionStore, ownerKey: string, sessionId: string): Promise<void> {
  const owned = await store.sessionExists(ownerKey, sessionId);

  if (!owned) {
    throw sessionNotFoundHttpError();
  }
}

function requireOwnedObjectKey(objectKey: string, sessionId: string): void {
  if (!isOwnedProblemImageKey(objectKey, sessionId)) {
    throw new HttpError(403, "Problem image access denied.");
  }
}
