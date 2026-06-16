import type {
  AppendSessionEventRequest,
  CreateTutorSessionRequest,
  SessionEventRecord,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";
import { maxSessionEvents } from "./session-types.js";
import type { SessionStore } from "./session-store.js";
import {
  defaultTitle,
  mapD1EventRow,
  mapD1SessionRow,
  nowIso,
  rowStringOrNull,
  serializeImageMeta,
  toSessionSummary
} from "./memory-session-store.js";

export class D1SessionStore implements SessionStore {
  constructor(private readonly db: D1Database) {}

  async appendEvent(
    ownerKey: string,
    sessionId: string,
    request: AppendSessionEventRequest
  ): Promise<SessionEventRecord> {
    const session = await this.getOwnedSessionRow(ownerKey, sessionId);
    if (!session) {
      throw new Error("Session not found");
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

    return {
      createdAt,
      id: eventId,
      message: request.message,
      sessionId,
      value: request.value ?? null
    };
  }

  async createSession(ownerKey: string, request: CreateTutorSessionRequest = {}): Promise<TutorSessionRecord> {
    const createdAt = nowIso();
    const id = crypto.randomUUID();
    const title = request.title?.trim() || defaultTitle(createdAt);

    await this.db
      .prepare(
        `INSERT INTO tutor_sessions (
          id, owner_key, title, status, image_prompt, image_name, image_meta_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', NULL, NULL, NULL, ?, ?)`
      )
      .bind(id, ownerKey, title, createdAt, createdAt)
      .run();

    return {
      createdAt,
      id,
      imageMeta: null,
      imageName: null,
      imagePrompt: null,
      ownerKey,
      status: "draft",
      title,
      updatedAt: createdAt
    };
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

    const events = (eventsResult.results ?? []).map((row) => mapD1EventRow(row as Record<string, unknown>));

    return {
      events,
      session: mapD1SessionRow(sessionRow)
    };
  }

  async listSessions(ownerKey: string): Promise<TutorSessionSummary[]> {
    const result = await this.db
      .prepare(
        `SELECT id, owner_key, title, status, image_prompt, image_name, image_meta_json, created_at, updated_at
         FROM tutor_sessions
         WHERE owner_key = ?
         ORDER BY updated_at DESC`
      )
      .bind(ownerKey)
      .all();

    return (result.results ?? []).map((row) =>
      toSessionSummary(mapD1SessionRow(row as Record<string, unknown>))
    );
  }

  async sessionExists(ownerKey: string, sessionId: string): Promise<boolean> {
    const row = await this.getOwnedSessionRow(ownerKey, sessionId);
    return Boolean(row);
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

    const updatedAt = nowIso();
    const title = request.title !== undefined ? request.title.trim() : String(existing.title);
    const status = request.status ?? (existing.status as TutorSessionRecord["status"]);
    const imagePrompt = request.imagePrompt !== undefined ? request.imagePrompt : rowStringOrNull(existing.image_prompt);
    const imageName = request.imageName !== undefined ? request.imageName : rowStringOrNull(existing.image_name);
    const imageMetaJson =
      request.imageMeta !== undefined
        ? serializeImageMeta(request.imageMeta)
        : rowStringOrNull(existing.image_meta_json);

    await this.db
      .prepare(
        `UPDATE tutor_sessions
         SET title = ?, status = ?, image_prompt = ?, image_name = ?, image_meta_json = ?, updated_at = ?
         WHERE id = ? AND owner_key = ?`
      )
      .bind(title, status, imagePrompt, imageName, imageMetaJson, updatedAt, sessionId, ownerKey)
      .run();

    return mapD1SessionRow({
      ...existing,
      image_meta_json: imageMetaJson,
      image_name: imageName,
      image_prompt: imagePrompt,
      status,
      title,
      updated_at: updatedAt
    });
  }

  private async getOwnedSessionRow(
    ownerKey: string,
    sessionId: string
  ): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT id, owner_key, title, status, image_prompt, image_name, image_meta_json, created_at, updated_at
         FROM tutor_sessions
         WHERE id = ? AND owner_key = ?`
      )
      .bind(sessionId, ownerKey)
      .first();

    return row ? (row as Record<string, unknown>) : null;
  }
}
