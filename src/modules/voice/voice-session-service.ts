import { HttpError, type JsonValue } from "../../core/http-error.js";
import {
  createRealtimeClientSecret,
  defaultRealtimeModel,
  defaultRealtimeVoice,
  defaultSafetyIdentifier
} from "../auth/realtime-token.js";
import { isJsonObject } from "../../core/schema-parser.js";
import { tutorPolicy } from "../tutoring/tutor-policy.js";
import {
  serializeOpenAIRealtimeSessionDescriptor,
  serializeOpenAIVoicePipelineSessionDescriptor
} from "./voice-session-schema.js";
import {
  createVoicePipelineOptions,
  type VoicePipelineServiceEnv
} from "./voice-pipeline-service.js";
import type {
  CreateVoiceSessionRequest,
  OpenAIVoicePipelineSessionDescriptor,
  OpenAIRealtimeSessionDescriptor,
  VoiceBackend,
  VoiceSessionDescriptor
} from "./voice-types.js";
import { maxVoiceTurnBodyBytes } from "./voice-types.js";

export type VoiceSessionContext = {
  callerKey?: string;
  sessionId?: string;
};

export type VoiceSessionService = {
  createSession(request: CreateVoiceSessionRequest, context?: VoiceSessionContext): Promise<VoiceSessionDescriptor>;
};

export type VoiceSessionServiceEnv = VoicePipelineServiceEnv & {
  OPENAI_REALTIME_MODEL: string | undefined;
  OPENAI_REALTIME_VOICE: string | undefined;
  OPENAI_SAFETY_IDENTIFIER: string | undefined;
  VOICE_BACKEND: string | undefined;
};

type OpenAIRealtimeSessionServiceOptions = {
  apiKey: string | undefined;
  model: string;
  safetyIdentifierSeed: string;
  voice: string;
};

export const defaultVoiceBackend: VoiceBackend = "openai-voice-pipeline";

export function createVoiceSessionService(env: VoiceSessionServiceEnv): VoiceSessionService {
  const backend = readVoiceBackend(env.VOICE_BACKEND);

  if (backend === "openai-voice-pipeline") {
    return new OpenAIVoicePipelineSessionService(createVoicePipelineOptions(env));
  }

  if (backend === "openai-realtime") {
    return new OpenAIRealtimeSessionService({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_REALTIME_MODEL ?? defaultRealtimeModel,
      safetyIdentifierSeed: env.OPENAI_SAFETY_IDENTIFIER ?? defaultSafetyIdentifier,
      voice: env.OPENAI_REALTIME_VOICE ?? defaultRealtimeVoice
    });
  }

  return new LiveKitAgentsSessionService();
}

function readVoiceBackend(value: string | undefined): VoiceBackend {
  if (!value) {
    return defaultVoiceBackend;
  }

  if (value === "openai-voice-pipeline" || value === "openai-realtime" || value === "livekit-agents") {
    return value;
  }

  throw new HttpError(500, `Unsupported VOICE_BACKEND: ${value}`);
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

class OpenAIRealtimeSessionService implements VoiceSessionService {
  constructor(private readonly options: OpenAIRealtimeSessionServiceOptions) {}

  async createSession(
    request: CreateVoiceSessionRequest,
    context: VoiceSessionContext = {}
  ): Promise<OpenAIRealtimeSessionDescriptor> {
    assertTutorIntent(request);

    const payload = await createRealtimeClientSecret({
      apiKey: this.options.apiKey,
      instructions: tutorPolicy.instructions,
      model: this.options.model,
      safetyIdentifierSeed: this.createSafetyIdentifierSeed(context.callerKey),
      voice: this.options.voice
    });
    const session = readOpenAISession(payload);

    return serializeOpenAIRealtimeSessionDescriptor({
      capabilities: {
        audioInput: true,
        audioOutput: true,
        imageInput: true,
        manualReply: true,
        payloadLimitBytes: null
      },
      clientSecret: readOpenAIClientSecret(payload),
      model: asString(session.model) ?? this.options.model,
      provider: "openai-realtime",
      sessionId: context.sessionId ?? crypto.randomUUID(),
      tutorPolicy,
      voice: readOpenAISessionVoice(session) ?? this.options.voice
    });
  }

  private createSafetyIdentifierSeed(callerKey: string | undefined): string {
    if (!callerKey) {
      return this.options.safetyIdentifierSeed;
    }

    return `${this.options.safetyIdentifierSeed}:${callerKey}`;
  }
}

class LiveKitAgentsSessionService implements VoiceSessionService {
  createSession(): Promise<VoiceSessionDescriptor> {
    throw new HttpError(
      501,
      "VOICE_BACKEND=livekit-agents is defined, but the LiveKit Agents runtime is not implemented in this foundation pass."
    );
  }
}

function assertTutorIntent(request: CreateVoiceSessionRequest): void {
  if (request.intent !== "tutor") {
    throw new HttpError(400, `Unsupported voice session intent: ${String(request.intent)}`);
  }
}

function readOpenAIClientSecret(payload: JsonValue): string {
  const root = asRecord(payload);
  const clientSecret = asRecord(root.client_secret);
  const secret = asString(root.value) ?? asString(clientSecret.value);

  if (!secret) {
    throw new HttpError(502, "OpenAI client secret response did not include a secret value.", payload);
  }

  return secret;
}

function readOpenAISessionVoice(session: Record<string, JsonValue>): string | undefined {
  const audio = asRecord(session.audio);
  const output = asRecord(audio.output);

  return asString(output.voice) ?? asString(session.voice);
}

function readOpenAISession(payload: JsonValue): Record<string, JsonValue> {
  return asRecord(asRecord(payload).session);
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return isJsonObject(value) ? (value as Record<string, JsonValue>) : {};
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
