export const sessionsPath = "/api/sessions";

export const maxSessionEvents = 200;

export type TutorSessionStatus = "draft" | "active" | "ended";

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
  imageMeta: SessionImageMeta | null;
  imageName: string | null;
  imagePrompt: string | null;
  ownerKey: string;
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
  imageMeta?: SessionImageMeta | null;
  imageName?: string | null;
  imagePrompt?: string | null;
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
    imageMeta: updateValue(request.imageMeta, session.imageMeta),
    imageName: updateValue(request.imageName, session.imageName),
    imagePrompt: updateValue(request.imagePrompt, session.imagePrompt),
    status: updateValue(request.status, session.status),
    title: updateValue(request.title?.trim(), session.title),
    updatedAt
  };
}
