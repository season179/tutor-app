export const sessionsPath = "/api/sessions";

export const maxSessionEvents = 200;

export type TutorSessionStatus = "draft" | "active" | "ended";

import type { ActiveStep } from "../tutoring/active-step.js";
import type { ExtractionOutcome } from "../problems/problem-context-types.js";
import type { ProblemContextRecord } from "../problems/problem-frame.js";
import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "../tutoring/tutor-action.js";

export type SessionImageMeta = {
  bytes: number;
  height: number;
  width: number;
};

export type TutorSessionSummary = {
  createdAt: string;
  id: string;
  status: TutorSessionStatus;
  title: string;
  updatedAt: string;
};

export type TutorSessionRecord = TutorSessionSummary & {
  activeStep: ActiveStep | null;
  currentPhase: SessionPhase;
  extractionNotes: string | null;
  extractionOutcome: ExtractionOutcome | null;
  gateStatus: ComprehensionGateStatus | null;
  imageMeta: SessionImageMeta | null;
  imageName: string | null;
  imageObjectKey: string | null;
  imagePrompt: string | null;
  ownerKey: string;
  promptConfirmed: boolean;
  supportLevel: SupportLevel;
};

export type SessionEventRecord = {
  createdAt: string;
  id: number;
  message: string;
  sessionId: string;
  value: unknown;
};

/**
 * Canonical event-message labels for a completed turn. The turn pipeline writes
 * these (server) and the client transcript reads them — keeping them as one
 * shared symbol so the two sides can never silently drift apart on a rename.
 */
export const studentTurnEventMessage = "Student turn";
export const tutorTurnEventMessage = "Tutor turn";

export type SessionReflectionRecord = {
  createdAt: string;
  reflectionText: string;
  sessionId: string;
  updatedAt: string;
};

/** One Three Reads comprehension check — the per-read audit trail for the gate. */
export type ComprehensionCheckRecord = {
  accepted: boolean;
  checkKind: string;
  createdAt: string;
  sessionId: string;
  studentResponse: string;
};

export type TutorSessionDetail = {
  events: SessionEventRecord[];
  problemContext: ProblemContextRecord | null;
  reflection: SessionReflectionRecord | null;
  session: TutorSessionRecord;
};

/**
 * The public, answer-free shape of an active step. The verifier's answer key
 * (`expectedAnswers`, `distractorNudges`, `defaultWrongNudge`) stays server-side and
 * must never cross the HTTP boundary — only what the child legitimately sees does.
 */
export type PublicActiveStep = Pick<ActiveStep, "ask" | "scaffoldAid">;

export type PublicTutorSessionRecord = Omit<TutorSessionRecord, "activeStep"> & {
  activeStep: PublicActiveStep | null;
};

export type PublicTutorSessionDetail = Omit<TutorSessionDetail, "session"> & {
  session: PublicTutorSessionRecord;
};

export function toPublicActiveStep(step: ActiveStep | null): PublicActiveStep | null {
  return step ? { ask: step.ask, scaffoldAid: step.scaffoldAid } : null;
}

export function toPublicTutorSessionRecord(session: TutorSessionRecord): PublicTutorSessionRecord {
  const { activeStep, ...rest } = session;
  return { ...rest, activeStep: toPublicActiveStep(activeStep) };
}

export function toPublicSessionDetail(detail: TutorSessionDetail): PublicTutorSessionDetail {
  return { ...detail, session: toPublicTutorSessionRecord(detail.session) };
}

export type CreateTutorSessionRequest = {
  title?: string;
};

export type UpdateTutorSessionRequest = {
  extractionNotes?: string | null;
  extractionOutcome?: ExtractionOutcome | null;
  gateStatus?: ComprehensionGateStatus | null;
  imageMeta?: SessionImageMeta | null;
  imageName?: string | null;
  imageObjectKey?: string | null;
  imagePrompt?: string | null;
  promptConfirmed?: boolean;
  status?: TutorSessionStatus;
  title?: string;
};

export type AppendSessionEventRequest = {
  message: string;
  value?: unknown;
};

export function toTutorSessionSummary(session: TutorSessionSummary): TutorSessionSummary {
  return {
    createdAt: session.createdAt,
    id: session.id,
    status: session.status,
    title: session.title,
    updatedAt: session.updatedAt
  };
}

function updateValue<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

export function applyTutorSessionUpdate(
  session: TutorSessionRecord,
  request: UpdateTutorSessionRequest,
  updatedAt: string
): TutorSessionRecord {
  return {
    ...session,
    extractionNotes: updateValue(request.extractionNotes, session.extractionNotes),
    extractionOutcome: updateValue(request.extractionOutcome, session.extractionOutcome),
    gateStatus: updateValue(request.gateStatus, session.gateStatus),
    imageMeta: updateValue(request.imageMeta, session.imageMeta),
    imageName: updateValue(request.imageName, session.imageName),
    imageObjectKey: updateValue(request.imageObjectKey, session.imageObjectKey),
    imagePrompt: updateValue(request.imagePrompt, session.imagePrompt),
    promptConfirmed: updateValue(request.promptConfirmed, session.promptConfirmed),
    status: updateValue(request.status, session.status),
    title: updateValue(request.title?.trim(), session.title),
    updatedAt
  };
}
