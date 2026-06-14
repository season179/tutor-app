import type { VoiceClientAdapter } from "../voice-client-adapter.js";
import type { VoiceSessionDescriptor } from "../voice-types.js";

export type StatusTone = "ready" | "working" | "connected" | "error";

export type AppStatus = {
  message: string;
  tone: StatusTone;
};

export type TutorSessionState = {
  adapter: VoiceClientAdapter;
  descriptor: VoiceSessionDescriptor;
  mediaStream: MediaStream;
  unsubscribe: () => void;
};
