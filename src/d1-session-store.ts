import type {
  AppendSessionEventRequest,
  CreateTutorSessionRequest,
  SessionEventRecord,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";
import { applyTutorSessionUpdate, maxSessionEvents, toTutorSessionSummary } from "./session-types.js";
import { sessionStoreNotFoundError, type SessionStore } from "./session-store.js";
import {
  createSessionEventRecord,
  createTutorSessionRecord,
  mapD1EventRow,
  mapD1SessionRow,
  nowIso,
  rowStringOrNull,
  serializeImageMeta
} from "./memory-session-store.js";

const tutorSessionColumns =
  "id, owner_key, title, status, image_prompt, image_name, image_meta_json, created_at, updated_at";

function d1Rows(result: D1Result): Record<string, unknown>[] {
  return (result.results ?? []) as Record<string, unknown>[];
}

export class D1SessionStore implements SessionStore {
  constructor(private readonly db: D1Database) {}

  async appendEvent(
    ownerKey: string,
    sessionId: string,
    request: AppendSessionEventRequest
  ): Promise<SessionEventRecord> {
    const session = await this.getOwnedSessionRow(ownerKey, sessionId);
    if (!session) {
      throw sessionStoreNotFoundError();
    }

    const createdAt = nowIso();
    const valueJson = request.value === undefined ? null : JSON.stringify(request.value);

    const insert = await this.db
      .prepare(
        `INSERT INTO session_events (session_id, message, value_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(sessionId, request.message, valueJson, createdAt)
      .run();

    await this.db
      .prepare("UPDATE tutor_sessions SET updated_at = ? WHERE id = ? AND owner_key = ?")
      .bind(createdAt, sessionId, ownerKey)
      .run();

    const eventId = Number(insert.meta.last_row_id);

    await this.db
      .prepare(
        `DELETE FROM session_events
         WHERE session_id = ?1
           AND id NOT IN (
             SELECT id
             FROM session_events
             WHERE session_id = ?1
             ORDER BY created_at DESC, id DESC
             LIMIT ?2
           )`
      )
      .bind(sessionId, maxSessionEvents)
      .run();

    return createSessionEventRecord(sessionId, eventId, createdAt, request);
  }

  async createSession(ownerKey: string, request: CreateTutorSessionRequest = {}): Promise<TutorSessionRecord> {
    const session = createTutorSessionRecord(ownerKey, request, nowIso(), crypto.randomUUID());

    await this.db
      .prepare(
        `INSERT INTO tutor_sessions (${tutorSessionColumns})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        session.id,
        session.ownerKey,
        session.title,
        session.status,
        session.imagePrompt,
        session.imageName,
        serializeImageMeta(session.imageMeta),
        session.createdAt,
        session.updatedAt
      )
      .run();

    return session;
  }

  async getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null> {
    const sessionRow = await this.getOwnedSessionRow(ownerKey, sessionId);
    if (!sessionRow) {
      return null;
    }

    const eventsResult = await this.db
      .prepare(
        `SELECT id, session_id, message, value_json, created_at
         FROM session_events
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(sessionId, maxSessionEvents)
      .all();

    const events = d1Rows(eventsResult).map(mapD1EventRow);

    return {
      events,
      session: mapD1SessionRow(sessionRow)
    };
  }

  async listSessions(ownerKey: string): Promise<TutorSessionSummary[]> {
    const result = await this.db
      .prepare(
        `SELECT ${tutorSessionColumns}
         FROM tutor_sessions
         WHERE owner_key = ?
         ORDER BY updated_at DESC`
      )
      .bind(ownerKey)
      .all();

    return d1Rows(result).map((row) => toTutorSessionSummary(mapD1SessionRow(row)));
  }

  async sessionExists(ownerKey: string, sessionId: string): Promise<boolean> {
    const row = await this.getOwnedSessionRow(ownerKey, sessionId);
    return Boolean(row);
  }

  async transferOwnerSessions(fromOwnerKey: string, toOwnerKey: string): Promise<number> {
    const result = await this.db
      .prepare("UPDATE tutor_sessions SET owner_key = ? WHERE owner_key = ?")
      .bind(toOwnerKey, fromOwnerKey)
      .run();

    return result.meta.changes ?? 0;
  }

  async updateSession(
    ownerKey: string,
    sessionId: string,
    request: UpdateTutorSessionRequest
  ): Promise<TutorSessionRecord | null> {
    const existing = await this.getOwnedSessionRow(ownerKey, sessionId);
    if (!existing) {
      return null;
    }

    const existingSession = mapD1SessionRow(existing);
    const updated = applyTutorSessionUpdate(existingSession, request, nowIso());
    const imageMetaJson =
      request.imageMeta !== undefined
        ? serializeImageMeta(updated.imageMeta)
        : rowStringOrNull(existing.image_meta_json);

    await this.db
      .prepare(
        `UPDATE tutor_sessions
         SET title = ?, status = ?, image_prompt = ?, image_name = ?, image_meta_json = ?, updated_at = ?
         WHERE id = ? AND owner_key = ?`
      )
      .bind(
        updated.title,
        updated.status,
        updated.imagePrompt,
        updated.imageName,
        imageMetaJson,
        updated.updatedAt,
        sessionId,
        ownerKey
      )
      .run();

    return updated;
  }

  private async getOwnedSessionRow(
    ownerKey: string,
    sessionId: string
  ): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT ${tutorSessionColumns}
         FROM tutor_sessions
         WHERE id = ? AND owner_key = ?`
      )
      .bind(sessionId, ownerKey)
      .first();

    return row ? (row as Record<string, unknown>) : null;
  }
}
