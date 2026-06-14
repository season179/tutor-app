export const voiceSessionPath = "/api/voice/session";

export type VoiceBackend = "openai-realtime" | "livekit-agents";

export type VoiceSessionIntent = "tutor";

export type CreateVoiceSessionRequest = {
  intent: VoiceSessionIntent;
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

export type LiveKitAgentsSessionDescriptor = BaseVoiceSessionDescriptor & {
  agentName: string;
  livekitUrl: string;
  participantIdentity: string;
  participantToken: string;
  provider: "livekit-agents";
  roomName: string;
};

export type VoiceSessionDescriptor = OpenAIRealtimeSessionDescriptor | LiveKitAgentsSessionDescriptor;

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
