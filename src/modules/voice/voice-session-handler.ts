import { HttpError, sessionNotFoundHttpError } from "../../core/http-error.js";
import type { RequestContext } from "../../core/request-context.js";
import { isJsonObject } from "../../core/schema-parser.js";
import type { SessionStore } from "../sessions/session-store.js";
import {
  createVoiceSessionService,
  type VoiceSessionContext,
  type VoiceSessionServiceEnv
} from "./voice-session-service.js";
import { serializeVoiceSessionDescriptor } from "./voice-session-schema.js";
import type { CreateVoiceSessionRequest, VoiceSessionDescriptor } from "./voice-types.js";

export function parseCreateVoiceSessionRequest(value: unknown): CreateVoiceSessionRequest {
  if (!isJsonObject(value)) {
    throw new HttpError(400, "Voice session request must be a JSON object");
  }

  const intent = value.intent;
  if (intent !== "tutor") {
    throw new HttpError(400, `Unsupported voice session intent: ${String(intent)}`);
  }

  const sessionId = value.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new HttpError(400, "Voice session request must include sessionId");
  }

  return {
    intent,
    sessionId: sessionId.trim()
  };
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
    throw sessionNotFoundHttpError();
  }

  const voiceContext: VoiceSessionContext = {
    callerKey: requestContext.ownerKey,
    sessionId: request.sessionId
  };

  const voiceSessionService = createVoiceSessionService(env);
  const descriptor = await voiceSessionService.createSession(request, voiceContext);
  await store.updateSession(requestContext.ownerKey, request.sessionId, { status: "active" });

  return serializeVoiceSessionDescriptor(descriptor);
}
