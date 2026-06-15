import { HttpError } from "./http-error.js";
import type { RequestContext } from "./request-context.js";
import type { SessionStore } from "./session-store.js";
import {
  createVoiceSessionService,
  type VoiceSessionContext,
  type VoiceSessionServiceEnv
} from "./voice-session-service.js";
import { serializeVoiceSessionDescriptor } from "./voice-session-schema.js";
import type { CreateVoiceSessionRequest, VoiceSessionDescriptor } from "./voice-types.js";

export function parseCreateVoiceSessionRequest(value: unknown): CreateVoiceSessionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Voice session request must be a JSON object");
  }

  const record = value as { intent?: unknown; sessionId?: unknown };
  const intent = record.intent;
  if (intent !== "tutor") {
    throw new HttpError(400, `Unsupported voice session intent: ${String(intent)}`);
  }

  const sessionId = record.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new HttpError(400, "Voice session request must include sessionId");
  }

  return {
    intent,
    sessionId: sessionId.trim()
  };
}

export async function createVoiceSession(
  body: unknown,
  env: VoiceSessionServiceEnv,
  context: VoiceSessionContext = {}
): Promise<VoiceSessionDescriptor> {
  const request = parseCreateVoiceSessionRequest(body);
  const voiceSessionService = createVoiceSessionService(env);
  const descriptor = await voiceSessionService.createSession(request, context);

  return serializeVoiceSessionDescriptor(descriptor);
}

export async function createVoiceSessionWithStore(
  body: unknown,
  env: VoiceSessionServiceEnv,
  store: SessionStore,
  requestContext: RequestContext
): Promise<VoiceSessionDescriptor> {
  const request = parseCreateVoiceSessionRequest(body);
  const owned = await store.sessionExists(requestContext.ownerKey, request.sessionId);
  if (!owned) {
    throw new HttpError(404, "Session not found");
  }

  const voiceContext: VoiceSessionContext = {
    callerKey: requestContext.ownerKey,
    sessionId: request.sessionId
  };

  const descriptor = await createVoiceSession(body, env, voiceContext);
  await store.updateSession(requestContext.ownerKey, request.sessionId, { status: "active" });

  return descriptor;
}
