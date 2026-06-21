import { z } from "zod";

import { comprehensionGateStatuses, sessionPhases } from "../tutoring/tutor-action.js";
import type {
  LessonControllerTurn,
  OpenAIVoicePipelineSessionDescriptor,
  PublicLessonTurn,
  TutorPolicy,
  VoiceCapabilities,
  VoicePipelineSessionState,
  VoicePipelineTurnRequest,
  VoicePipelineTurnResponse,
  VoicePreparedImage,
  VoiceSessionDescriptor
} from "./voice-types.js";
import { parseObjectWithSchema } from "../../core/schema-parser.js";

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

const openAIVoicePipelineSessionDescriptorSchema = baseVoiceSessionDescriptorSchema.extend({
  model: z.string().min(1),
  provider: z.literal("openai-voice-pipeline"),
  transcribeModel: z.string().min(1),
  ttsModel: z.string().min(1),
  voice: z.string().min(1)
}) satisfies z.ZodType<OpenAIVoicePipelineSessionDescriptor>;

// The single backend now: the discriminated union collapsed to one arm when the
// realtime and LiveKit descriptors were removed. Kept as a named schema (not inlined
// into a union) so a future second backend re-introduces `z.discriminatedUnion` here.
export const voiceSessionDescriptorSchema = openAIVoicePipelineSessionDescriptorSchema;

const voicePreparedImageSchema = z.object({
  dataUrl: z.string().min(1),
  height: z.number().int().positive(),
  mimeType: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().positive(),
  width: z.number().int().positive()
}) satisfies z.ZodType<VoicePreparedImage>;

const voicePipelineAudioInputSchema = z.object({
  dataUrl: z.string().min(1),
  mimeType: z.string().min(1),
  name: z.string().min(1).optional(),
  size: z.number().int().positive()
});

export const voicePipelineTurnRequestSchema = z
  .object({
    audio: voicePipelineAudioInputSchema.optional(),
    image: voicePreparedImageSchema.nullable().optional(),
    kickoff: z.boolean().optional(),
    sessionId: z.string().trim().min(1),
    text: z.string().max(4_000).optional()
  })
  .refine(
    // A kickoff is the tutor's opening turn and legitimately carries no media; every
    // other turn must carry the student's audio, image, or text.
    (value) => value.kickoff === true || Boolean(value.audio || value.image || value.text?.trim()),
    { message: "Voice turn request must include audio, image, or text." }
  ) satisfies z.ZodType<VoicePipelineTurnRequest>;

const lessonControllerTurnSchema = z.object({
  hiddenState: z.string(),
  phase: z.enum(["orient", "ask_step", "check_answer", "hint", "advance", "wrap"]),
  safetyNotes: z.string(),
  spokenUtterance: z.string().min(1),
  studentStatus: z.enum(["unknown", "correct", "partial", "stuck"]),
  tutorAction: z.enum(["orient", "ask", "hint", "confirm", "wrap"])
}) satisfies z.ZodType<LessonControllerTurn>;

const publicLessonTurnSchema = lessonControllerTurnSchema.omit({
  hiddenState: true,
  safetyNotes: true
}) satisfies z.ZodType<PublicLessonTurn>;

export const voicePipelineTurnResponseSchema = z.object({
  audio: z.object({
    dataUrl: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().int().positive()
  }),
  lesson: publicLessonTurnSchema,
  session: z.object({
    currentPhase: z.enum(sessionPhases),
    focusAsk: z.string().nullable(),
    gateStatus: z.enum(comprehensionGateStatuses).nullable(),
    goalStatus: z.enum(["empty", "framed", "complete"]),
    outputLanguageLabel: z.string().nullable(),
    scaffoldAid: z.string().nullable(),
    studentStatus: z.enum(["unknown", "correct", "partial", "stuck"]),
    supportLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    unknownTarget: z.string().nullable()
  }) satisfies z.ZodType<VoicePipelineSessionState>,
  transcript: z.string(),
  tutorText: z.string().min(1)
}) satisfies z.ZodType<VoicePipelineTurnResponse>;

export function parseVoiceSessionDescriptor(value: unknown): VoiceSessionDescriptor {
  return parseObjectWithSchema(voiceSessionDescriptorSchema, value, {
    invalid: "Voice session response did not match a supported provider shape.",
    notObject: "Voice session response was not a JSON object."
  });
}

export function serializeVoiceSessionDescriptor(descriptor: VoiceSessionDescriptor): VoiceSessionDescriptor {
  return voiceSessionDescriptorSchema.parse(descriptor);
}

export function serializeOpenAIVoicePipelineSessionDescriptor(
  descriptor: OpenAIVoicePipelineSessionDescriptor
): OpenAIVoicePipelineSessionDescriptor {
  return openAIVoicePipelineSessionDescriptorSchema.parse(descriptor);
}

export function parseVoicePipelineTurnRequest(value: unknown): VoicePipelineTurnRequest {
  return parseObjectWithSchema(voicePipelineTurnRequestSchema, value, {
    invalid: "Voice turn request was invalid.",
    notObject: "Voice turn request must be a JSON object."
  });
}

export function parseVoicePipelineTurnResponse(value: unknown): VoicePipelineTurnResponse {
  return parseObjectWithSchema(voicePipelineTurnResponseSchema, value, {
    invalid: "Voice turn response was invalid.",
    notObject: "Voice turn response must be a JSON object."
  });
}

export function serializeVoicePipelineTurnResponse(
  response: VoicePipelineTurnResponse
): VoicePipelineTurnResponse {
  return voicePipelineTurnResponseSchema.parse(response);
}
