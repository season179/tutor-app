import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "./tutor-action.js";

export const voiceSessionPath = "/api/voice/session";
export const voiceTurnPath = "/api/voice/turn";
export const maxVoiceTurnBodyBytes = 8_000_000;

export const defaultImagePrompt = "Help me understand this problem step by step.";

export type VoiceBackend = "openai-voice-pipeline" | "openai-realtime" | "livekit-agents";

export type VoiceSessionIntent = "tutor";

export type CreateVoiceSessionRequest = {
  intent: VoiceSessionIntent;
  sessionId: string;
};

export type TutorPolicy = {
  agentName: string;
  defaultImagePrompt: string;
  greetingInstructions: string;
  imageResponseInstructions: string;
  instructions: string;
};

export type VoiceCapabilities = {
  audioInput: boolean;
  audioOutput: boolean;
  imageInput: boolean;
  manualReply: boolean;
  payloadLimitBytes: number | null;
};

type BaseVoiceSessionDescriptor = {
  capabilities: VoiceCapabilities;
  provider: VoiceBackend;
  sessionId: string;
  tutorPolicy: TutorPolicy;
};

export type OpenAIRealtimeSessionDescriptor = BaseVoiceSessionDescriptor & {
  clientSecret: string;
  model: string;
  provider: "openai-realtime";
  voice: string;
};

export type OpenAIVoicePipelineSessionDescriptor = BaseVoiceSessionDescriptor & {
  model: string;
  provider: "openai-voice-pipeline";
  transcribeModel: string;
  ttsModel: string;
  voice: string;
};

export type LiveKitAgentsSessionDescriptor = BaseVoiceSessionDescriptor & {
  agentName: string;
  livekitUrl: string;
  participantIdentity: string;
  participantToken: string;
  provider: "livekit-agents";
  roomName: string;
};

export type VoiceSessionDescriptor =
  | OpenAIVoicePipelineSessionDescriptor
  | OpenAIRealtimeSessionDescriptor
  | LiveKitAgentsSessionDescriptor;

export type VoicePreparedImage = {
  dataUrl: string;
  height: number;
  mimeType: string;
  name: string;
  size: number;
  width: number;
};

export type VoiceUserTurn = {
  image: VoicePreparedImage | null;
  text: string;
};

export type VoicePipelineAudioInput = {
  dataUrl: string;
  mimeType: string;
  name?: string | undefined;
  size: number;
};

export type VoicePipelineTurnRequest = {
  audio?: VoicePipelineAudioInput | undefined;
  image?: VoicePreparedImage | null | undefined;
  sessionId: string;
  text?: string | undefined;
};

export type LessonPhase = "orient" | "ask_step" | "check_answer" | "hint" | "advance" | "wrap";

export type StudentStatus = "unknown" | "correct" | "partial" | "stuck";

export type LessonControllerTurn = {
  phase: LessonPhase;
  studentStatus: StudentStatus;
  spokenUtterance: string;
  tutorAction: "orient" | "ask" | "hint" | "confirm" | "wrap";
  hiddenState: string;
  safetyNotes: string;
};

export type PublicLessonTurn = Omit<LessonControllerTurn, "hiddenState" | "safetyNotes">;

export type VoicePipelineAudioOutput = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

export type VoicePipelineSessionState = {
  currentPhase: SessionPhase;
  focusAsk: string | null;
  gateStatus: ComprehensionGateStatus | null;
  scaffoldAid: string | null;
  studentStatus: StudentStatus;
  supportLevel: SupportLevel;
  unknownTarget: string | null;
};

export type VoicePipelineTurnResponse = {
  audio: VoicePipelineAudioOutput;
  lesson: PublicLessonTurn;
  session: VoicePipelineSessionState;
  transcript: string;
  tutorText: string;
};
