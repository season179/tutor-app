import { z } from "zod";

import type {
  LiveKitAgentsSessionDescriptor,
  OpenAIRealtimeSessionDescriptor,
  TutorPolicy,
  VoiceCapabilities,
  VoiceSessionDescriptor
} from "./voice-types.js";
import { parseObjectWithSchema } from "./schema-parser.js";

const tutorPolicySchema = z.object({
  agentName: z.string().min(1),
  defaultImagePrompt: z.string(),
  greetingInstructions: z.string(),
  imageResponseInstructions: z.string(),
  instructions: z.string()
}) satisfies z.ZodType<TutorPolicy>;

const voiceCapabilitiesSchema = z.object({
  audioInput: z.boolean(),
  audioOutput: z.boolean(),
  imageInput: z.boolean(),
  manualReply: z.boolean(),
  payloadLimitBytes: z.number().nullable()
}) satisfies z.ZodType<VoiceCapabilities>;

const baseVoiceSessionDescriptorSchema = z.object({
  capabilities: voiceCapabilitiesSchema,
  sessionId: z.string().min(1),
  tutorPolicy: tutorPolicySchema
});

const openAIRealtimeSessionDescriptorSchema = baseVoiceSessionDescriptorSchema.extend({
  clientSecret: z.string().min(1),
  model: z.string().min(1),
  provider: z.literal("openai-realtime"),
  voice: z.string().min(1)
}) satisfies z.ZodType<OpenAIRealtimeSessionDescriptor>;

const liveKitAgentsSessionDescriptorSchema = baseVoiceSessionDescriptorSchema.extend({
  agentName: z.string().min(1),
  livekitUrl: z.string().min(1),
  participantIdentity: z.string().min(1),
  participantToken: z.string().min(1),
  provider: z.literal("livekit-agents"),
  roomName: z.string().min(1)
}) satisfies z.ZodType<LiveKitAgentsSessionDescriptor>;

export const voiceSessionDescriptorSchema = z.discriminatedUnion("provider", [
  openAIRealtimeSessionDescriptorSchema,
  liveKitAgentsSessionDescriptorSchema
]);

export function parseVoiceSessionDescriptor(value: unknown): VoiceSessionDescriptor {
  return parseObjectWithSchema(voiceSessionDescriptorSchema, value, {
    invalid: "Voice session response did not match a supported provider shape.",
    notObject: "Voice session response was not a JSON object."
  });
}

export function serializeVoiceSessionDescriptor(descriptor: VoiceSessionDescriptor): VoiceSessionDescriptor {
  return voiceSessionDescriptorSchema.parse(descriptor);
}

export function serializeOpenAIRealtimeSessionDescriptor(
  descriptor: OpenAIRealtimeSessionDescriptor
): OpenAIRealtimeSessionDescriptor {
  return openAIRealtimeSessionDescriptorSchema.parse(descriptor);
}
