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
import type { ExtractionOutcome } from "./problem-context/problem-context-types.js";
import { isJsonObject } from "./schema-parser.js";
import { applyTutorSessionUpdate, maxSessionEvents, toTutorSessionSummary } from "./session-types.js";
import { sessionStoreNotFoundError, type SessionStore } from "./session-store.js";

type StoredSession = TutorSessionRecord & {
  events: SessionEventRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultTitle(createdAt: string): string {
  const date = new Date(createdAt);
  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

function rowStringOrNull(value: unknown): string | null {
  return value ? String(value) : null;
}

function parseJsonOrNull(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseExtractionOutcome(value: string | null): ExtractionOutcome | null {
  if (
    value === "extracted" ||
    value === "multiple_questions" ||
    value === "none" ||
    value === "not_a_problem" ||
    value === "partial"
  ) {
    return value;
  }

  return null;
}

function parseImageMeta(value: string | null): SessionImageMeta | null {
  const parsed = parseJsonOrNull(value);
  if (!isJsonObject(parsed)) {
    return null;
  }

  const meta = parsed as SessionImageMeta;
  if (
    typeof meta.bytes === "number" &&
    typeof meta.height === "number" &&
    typeof meta.width === "number"
  ) {
    return meta;
  }

  return null;
}

function serializeImageMeta(value: SessionImageMeta | null | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function createTutorSessionRecord(
  ownerKey: string,
  request: CreateTutorSessionRequest,
  createdAt: string,
  id: string
): TutorSessionRecord {
  return {
    createdAt,
    extractionNotes: null,
    extractionOutcome: null,
    id,
    imageMeta: null,
    imageName: null,
    imageObjectKey: null,
    imagePrompt: null,
    ownerKey,
    promptConfirmed: false,
    status: "draft",
    title: request.title?.trim() || defaultTitle(createdAt),
    updatedAt: createdAt
  };
}

function createSessionEventRecord(
  sessionId: string,
  id: number,
  createdAt: string,
  request: AppendSessionEventRequest
): SessionEventRecord {
  return {
    createdAt,
    id,
    message: request.message,
    sessionId,
    value: request.value ?? null
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
    const session = this.requireOwnedSession(ownerKey, sessionId);
    const createdAt = nowIso();
    const event = createSessionEventRecord(sessionId, this.nextEventId++, createdAt, request);

    session.events.unshift(event);
    session.events = session.events.slice(0, maxSessionEvents);
    session.updatedAt = createdAt;

    return event;
  }

  async createSession(ownerKey: string, request: CreateTutorSessionRequest = {}): Promise<TutorSessionRecord> {
    const createdAt = nowIso();
    const session: StoredSession = {
      events: [],
      ...createTutorSessionRecord(ownerKey, request, createdAt, crypto.randomUUID())
    };

    this.sessions.set(session.id, session);
    return this.toRecord(session);
  }

  async getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null> {
    const session = this.getOwnedSession(ownerKey, sessionId);
    if (!session) {
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
      .map((session) => toTutorSessionSummary(this.toRecord(session)));
  }

  async sessionExists(ownerKey: string, sessionId: string): Promise<boolean> {
    return Boolean(this.getOwnedSession(ownerKey, sessionId));
  }

  async transferOwnerSessions(fromOwnerKey: string, toOwnerKey: string): Promise<number> {
    let transferred = 0;

    for (const session of this.sessions.values()) {
      if (session.ownerKey !== fromOwnerKey) {
        continue;
      }

      session.ownerKey = toOwnerKey;
      transferred += 1;
    }

    return transferred;
  }

  async updateSession(
    ownerKey: string,
    sessionId: string,
    request: UpdateTutorSessionRequest
  ): Promise<TutorSessionRecord | null> {
    const session = this.getOwnedSession(ownerKey, sessionId);
    if (!session) {
      return null;
    }

    Object.assign(session, applyTutorSessionUpdate(this.toRecord(session), request, nowIso()));
    return this.toRecord(session);
  }

  private requireOwnedSession(ownerKey: string, sessionId: string): StoredSession {
    const session = this.getOwnedSession(ownerKey, sessionId);
    if (!session) {
      throw sessionStoreNotFoundError();
    }

    return session;
  }

  private getOwnedSession(ownerKey: string, sessionId: string): StoredSession | null {
    const session = this.sessions.get(sessionId);
    return session && session.ownerKey === ownerKey ? session : null;
  }

  private toRecord({ events: _events, ...session }: StoredSession): TutorSessionRecord {
    return session;
  }
}

export function mapD1SessionRow(row: Record<string, unknown>): TutorSessionRecord {
  return {
    createdAt: String(row.created_at),
    extractionNotes: rowStringOrNull(row.extraction_notes),
    extractionOutcome: parseExtractionOutcome(rowStringOrNull(row.extraction_outcome)),
    id: String(row.id),
    imageMeta: parseImageMeta(rowStringOrNull(row.image_meta_json)),
    imageName: rowStringOrNull(row.image_name),
    imageObjectKey: rowStringOrNull(row.image_object_key),
    imagePrompt: rowStringOrNull(row.image_prompt),
    ownerKey: String(row.owner_key),
    promptConfirmed: Number(row.prompt_confirmed ?? 0) === 1,
    status: row.status as TutorSessionStatus,
    title: String(row.title),
    updatedAt: String(row.updated_at)
  };
}

export function mapD1EventRow(row: Record<string, unknown>): SessionEventRecord {
  return {
    createdAt: String(row.created_at),
    id: Number(row.id),
    message: String(row.message),
    sessionId: String(row.session_id),
    value: parseJsonOrNull(rowStringOrNull(row.value_json))
  };
}

export {
  createSessionEventRecord,
  createTutorSessionRecord,
  nowIso,
  parseImageMeta,
  rowStringOrNull,
  serializeImageMeta
};
