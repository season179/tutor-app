import type { ExtractionOutcome } from "../modules/problems/problem-context-types.js";
import type { SessionImageMeta, TutorSessionStatus, TutorSessionSummary } from "../modules/sessions/session-types.js";
import type { VoiceClientAdapter } from "./lib/voice-client-adapter.js";
import type { VoiceSessionDescriptor } from "../modules/voice/voice-types.js";

export type StatusTone = "ready" | "working" | "connected" | "error";

export type AppStatus = {
  message: string;
  tone: StatusTone;
};

export type TutorSessionState = {
  adapter: VoiceClientAdapter;
  descriptor: VoiceSessionDescriptor;
  mediaStream?: MediaStream | undefined;
  unsubscribe: () => void;
};

export type LoadedSessionContext = {
  extractionNotes: string | null;
  extractionOutcome: ExtractionOutcome | null;
  imageMeta: SessionImageMeta | null;
  imageName: string | null;
  imageObjectKey: string | null;
  imagePrompt: string | null;
  promptConfirmed: boolean;
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

export const activeSessionStorageKeyPrefix = "ai-tutor.active-session-id";

/** Legacy unscoped key; removed on first read after user-scoped storage ships. */
export const legacyActiveSessionStorageKey = "ai-tutor.active-session-id";

export function activeSessionStorageKey(userId: string): string {
  return `${activeSessionStorageKeyPrefix}:${userId}`;
}

export const sidebarCollapsedStorageKey = "ai-tutor.sidebar-collapsed";

export const rightSidebarCollapsedStorageKey = "ai-tutor.right-sidebar-collapsed";

export { defaultImagePrompt } from "../modules/voice/voice-types.js";
