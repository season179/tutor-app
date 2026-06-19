export const sessionsPath = "/api/sessions";

export const maxSessionEvents = 200;

export type TutorSessionStatus = "draft" | "active" | "ended";

import type { ExtractionOutcome } from "./problem-context/problem-context-types.js";

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
  extractionNotes: string | null;
  extractionOutcome: ExtractionOutcome | null;
  imageMeta: SessionImageMeta | null;
  imageName: string | null;
  imageObjectKey: string | null;
  imagePrompt: string | null;
  ownerKey: string;
  promptConfirmed: boolean;
};

export type SessionEventRecord = {
  createdAt: string;
  id: number;
  message: string;
  sessionId: string;
  value: unknown;
};

export type TutorSessionDetail = {
  events: SessionEventRecord[];
  session: TutorSessionRecord;
};

export type CreateTutorSessionRequest = {
  title?: string;
};

export type UpdateTutorSessionRequest = {
  extractionNotes?: string | null;
  extractionOutcome?: ExtractionOutcome | null;
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

export function toTutorSessionSummary(session: TutorSessionRecord): TutorSessionSummary {
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
