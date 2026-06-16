import type {
  AppendSessionEventRequest,
  CreateTutorSessionRequest,
  SessionEventRecord,
  SessionImageMeta,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionStatus,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";
import { maxSessionEvents } from "./session-types.js";
import type { SessionStore } from "./session-store.js";

type StoredSession = TutorSessionRecord & {
  events: SessionEventRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultTitle(createdAt: string): string {
  const date = new Date(createdAt);
  return `Session ${date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  })}`;
}

function rowStringOrNull(value: unknown): string | null {
  return value ? String(value) : null;
}

function parseImageMeta(value: string | null): SessionImageMeta | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as SessionImageMeta;
    if (
      typeof parsed.bytes === "number" &&
      typeof parsed.height === "number" &&
      typeof parsed.width === "number"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function serializeImageMeta(value: SessionImageMeta | null | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function toSessionSummary(session: TutorSessionRecord): TutorSessionSummary {
  return {
    createdAt: session.createdAt,
    id: session.id,
    status: session.status,
    title: session.title,
    updatedAt: session.updatedAt
  };
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private nextEventId = 1;

  async appendEvent(
    ownerKey: string,
    sessionId: string,
    request: AppendSessionEventRequest
  ): Promise<SessionEventRecord> {
    const session = await this.requireOwnedSession(ownerKey, sessionId);
    const createdAt = nowIso();
    const event: SessionEventRecord = {
      createdAt,
      id: this.nextEventId++,
      message: request.message,
      sessionId,
      value: request.value ?? null
    };

    session.events.unshift(event);
    session.events = session.events.slice(0, maxSessionEvents);
    session.updatedAt = createdAt;

    return event;
  }

  async createSession(ownerKey: string, request: CreateTutorSessionRequest = {}): Promise<TutorSessionRecord> {
    const createdAt = nowIso();
    const session: StoredSession = {
      createdAt,
      events: [],
      id: crypto.randomUUID(),
      imageMeta: null,
      imageName: null,
      imagePrompt: null,
      ownerKey,
      status: "draft",
      title: request.title?.trim() || defaultTitle(createdAt),
      updatedAt: createdAt
    };

    this.sessions.set(session.id, session);
    return this.toRecord(session);
  }

  async getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerKey !== ownerKey) {
      return null;
    }

    return {
      events: [...session.events],
      session: this.toRecord(session)
    };
  }

  async listSessions(ownerKey: string): Promise<TutorSessionSummary[]> {
    return [...this.sessions.values()]
      .filter((session) => session.ownerKey === ownerKey)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => toSessionSummary(this.toRecord(session)));
  }

  async sessionExists(ownerKey: string, sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.ownerKey === ownerKey);
  }

  async updateSession(
    ownerKey: string,
    sessionId: string,
    request: UpdateTutorSessionRequest
  ): Promise<TutorSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerKey !== ownerKey) {
      return null;
    }

    if (request.title !== undefined) {
      session.title = request.title.trim();
    }

    if (request.status !== undefined) {
      session.status = request.status;
    }

    if (request.imagePrompt !== undefined) {
      session.imagePrompt = request.imagePrompt;
    }

    if (request.imageName !== undefined) {
      session.imageName = request.imageName;
    }

    if (request.imageMeta !== undefined) {
      session.imageMeta = request.imageMeta;
    }

    session.updatedAt = nowIso();
    return this.toRecord(session);
  }

  private async requireOwnedSession(ownerKey: string, sessionId: string): Promise<StoredSession> {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerKey !== ownerKey) {
      throw new Error("Session not found");
    }

    return session;
  }

  private toRecord(session: StoredSession): TutorSessionRecord {
    return {
      createdAt: session.createdAt,
      id: session.id,
      imageMeta: session.imageMeta,
      imageName: session.imageName,
      imagePrompt: session.imagePrompt,
      ownerKey: session.ownerKey,
      status: session.status,
      title: session.title,
      updatedAt: session.updatedAt
    };
  }
}

export function mapD1SessionRow(row: Record<string, unknown>): TutorSessionRecord {
  return {
    createdAt: String(row.created_at),
    id: String(row.id),
    imageMeta: parseImageMeta(rowStringOrNull(row.image_meta_json)),
    imageName: rowStringOrNull(row.image_name),
    imagePrompt: rowStringOrNull(row.image_prompt),
    ownerKey: String(row.owner_key),
    status: row.status as TutorSessionStatus,
    title: String(row.title),
    updatedAt: String(row.updated_at)
  };
}

export function mapD1EventRow(row: Record<string, unknown>): SessionEventRecord {
  let value: unknown = null;
  if (row.value_json) {
    try {
      value = JSON.parse(String(row.value_json));
    } catch {
      value = null;
    }
  }

  return {
    createdAt: String(row.created_at),
    id: Number(row.id),
    message: String(row.message),
    sessionId: String(row.session_id),
    value
  };
}

export { defaultTitle, nowIso, parseImageMeta, rowStringOrNull, serializeImageMeta, toSessionSummary };
