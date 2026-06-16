import type { VoiceClientAdapter } from "../voice-client-adapter.js";
import type { VoiceSessionDescriptor } from "../voice-types.js";
import type { SessionImageMeta, TutorSessionStatus, TutorSessionSummary } from "../session-types.js";

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

export type LoadedSessionContext = {
  imageMeta: SessionImageMeta | null;
  imageName: string | null;
  imagePrompt: string | null;
};

export type SessionListErrorKind = "auth" | "network" | "unknown";

export type SessionListError = {
  kind: SessionListErrorKind;
  message: string;
};

export function statusLabel(status: TutorSessionStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "ended":
      return "Ended";
    default:
      return "Draft";
  }
}

export function hasPriorActivity(session: TutorSessionSummary | undefined, eventCount: number): boolean {
  return Boolean(session && (eventCount > 0 || session.status !== "draft"));
}

export const activeSessionStorageKey = "ai-tutor.active-session-id";

export { defaultImagePrompt } from "../voice-types.js";
