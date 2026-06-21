import { HttpError } from "../../core/http-error.js";
import { tutorPolicy } from "../tutoring/tutor-policy.js";
import { serializeOpenAIVoicePipelineSessionDescriptor } from "./voice-session-schema.js";
import {
  createVoicePipelineOptions,
  type VoicePipelineServiceEnv
} from "./voice-pipeline-service.js";
import type {
  CreateVoiceSessionRequest,
  OpenAIVoicePipelineSessionDescriptor,
  VoiceSessionDescriptor
} from "./voice-types.js";
import { maxVoiceTurnBodyBytes, voiceBackend } from "./voice-types.js";

export type VoiceSessionContext = {
  callerKey?: string;
  sessionId?: string;
};

export type VoiceSessionService = {
  createSession(request: CreateVoiceSessionRequest, context?: VoiceSessionContext): Promise<VoiceSessionDescriptor>;
};

// The voice session service env is now just the pipeline env: the realtime-only
// (OPENAI_REALTIME_*, OPENAI_SAFETY_IDENTIFIER) and backend-switch (VOICE_BACKEND)
// vars were removed with the realtime/LiveKit arms. Keeping this alias in place so
// call sites stay typed against "the env a voice session needs."
export type VoiceSessionServiceEnv = VoicePipelineServiceEnv;

export const defaultVoiceBackend = voiceBackend;

/**
 * The single voice session service. The turn-based OpenAI pipeline is the only
 * backend, so there is no switch to read or validate — `createVoiceSessionService`
 * always returns the pipeline service. (The old `VOICE_BACKEND` var and its
 * `readVoiceBackend` validation were retired with the realtime/LiveKit arms.)
 */
export function createVoiceSessionService(env: VoiceSessionServiceEnv): VoiceSessionService {
  return new OpenAIVoicePipelineSessionService(createVoicePipelineOptions(env));
}

class OpenAIVoicePipelineSessionService implements VoiceSessionService {
  constructor(private readonly options: ReturnType<typeof createVoicePipelineOptions>) {}

  createSession(
    request: CreateVoiceSessionRequest,
    context: VoiceSessionContext = {}
  ): Promise<OpenAIVoicePipelineSessionDescriptor> {
    assertTutorIntent(request);

    return Promise.resolve(
      serializeOpenAIVoicePipelineSessionDescriptor({
        capabilities: {
          audioInput: true,
          audioOutput: true,
          imageInput: true,
          manualReply: true,
          payloadLimitBytes: maxVoiceTurnBodyBytes
        },
        model: this.options.tutorModel,
        provider: "openai-voice-pipeline",
        sessionId: context.sessionId ?? crypto.randomUUID(),
        transcribeModel: this.options.transcribeModel,
        ttsModel: this.options.ttsModel,
        tutorPolicy,
        voice: this.options.voice
      })
    );
  }
}

function assertTutorIntent(request: CreateVoiceSessionRequest): void {
  if (request.intent !== "tutor") {
    throw new HttpError(400, `Unsupported voice session intent: ${String(request.intent)}`);
  }
}
