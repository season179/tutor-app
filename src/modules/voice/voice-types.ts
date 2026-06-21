import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "../tutoring/tutor-action.js";

export const maxVoiceTurnBodyBytes = 8_000_000;

export const defaultImagePrompt = "Help me understand this problem step by step.";

// The voice backend is single-valued: the turn-based OpenAI pipeline is the only
// backend, kept as a literal (not a union) so a dead config switch can't rot in
// place. The realtime/WebRTC and LiveKit arms were removed in the Flue migration
// plan's Phase 1; if a second backend returns, re-introduce a union here.
export const voiceBackend = "openai-voice-pipeline" as const;
export type VoiceBackend = typeof voiceBackend;

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

export type OpenAIVoicePipelineSessionDescriptor = BaseVoiceSessionDescriptor & {
  model: string;
  provider: "openai-voice-pipeline";
  transcribeModel: string;
  ttsModel: string;
  voice: string;
};

export type VoiceSessionDescriptor = OpenAIVoicePipelineSessionDescriptor;

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
  // An opening turn the tutor speaks before the student has said anything. Carries no
  // audio/image/text — the server produces the first move from the confirmed problem.
  kickoff?: boolean | undefined;
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

export type GoalChipStatus = "empty" | "framed" | "complete";

export type VoicePipelineSessionState = {
  currentPhase: SessionPhase;
  focusAsk: string | null;
  gateStatus: ComprehensionGateStatus | null;
  goalStatus: GoalChipStatus;
  outputLanguageLabel: string | null;
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
