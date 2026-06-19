import {
  applyTutorSessionUpdate,
  maxSessionEvents,
  toTutorSessionSummary,
  type AppendSessionEventRequest,
  type CreateTutorSessionRequest,
  type SessionEventRecord,
  type TutorSessionDetail,
  type TutorSessionRecord,
  type TutorSessionSummary,
  type UpdateTutorSessionRequest
} from "./session-types.js";
import type { ProblemContextRecord } from "./problem-context/problem-frame.js";
import { sessionStoreNotFoundError, type SaveProblemContextRequest, type SessionPhaseAdvance, type SessionStore } from "./session-store.js";
import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "./tutor-action.js";
import {
  createProblemContextRecord,
  createSessionEventRecord,
  createTutorSessionRecord,
  mapD1EventRow,
  mapD1ProblemContextRow,
  mapD1SessionRow,
  nowIso,
  rowStringOrNull,
  serializeActiveStep,
  serializeImageMeta,
  serializeProblemContext
} from "./memory-session-store.js";

const tutorSessionColumns =
  "id, owner_key, title, status, image_prompt, image_name, image_meta_json, image_object_key, extraction_outcome, extraction_notes, prompt_confirmed, created_at, updated_at, current_phase, gate_status, current_support_level, active_step_json";

function d1Rows(result: D1Result): Record<string, unknown>[] {
  return (result.results ?? []) as Record<string, unknown>[];
}

export class D1SessionStore implements SessionStore {
  constructor(private readonly db: D1Database) {}

  async advanceSessionPhase(
    ownerKey: string,
    sessionId: string,
    expectedPhase: SessionPhase,
    advance: SessionPhaseAdvance
  ): Promise<TutorSessionRecord | null> {
    const updatedAt = nowIso();
    const result = await this.db
      .prepare(
        `UPDATE tutor_sessions
         SET current_phase = ?, gate_status = ?, current_support_level = ?, active_step_json = ?, updated_at = ?
         WHERE id = ? AND owner_key = ? AND current_phase = ?`
      )
      .bind(
        advance.currentPhase,
        advance.gateStatus,
        advance.supportLevel,
        serializeActiveStep(advance.activeStep),
        updatedAt,
        sessionId,
        ownerKey,
        expectedPhase
      )
      .run();

    if ((result.meta.changes ?? 0) !== 1) {
      return null;
    }

    const row = await this.getOwnedSessionRow(ownerKey, sessionId);
    return row ? mapD1SessionRow(row) : null;
  }

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        session.id,
        session.ownerKey,
        session.title,
        session.status,
        session.imagePrompt,
        session.imageName,
        serializeImageMeta(session.imageMeta),
        session.imageObjectKey,
        session.extractionOutcome,
        session.extractionNotes,
        session.promptConfirmed ? 1 : 0,
        session.createdAt,
        session.updatedAt,
        session.currentPhase,
        session.gateStatus,
        session.supportLevel,
        serializeActiveStep(session.activeStep)
      )
      .run();

    return session;
  }

  async getProblemContext(ownerKey: string, sessionId: string): Promise<ProblemContextRecord | null> {
    const session = await this.getOwnedSessionRow(ownerKey, sessionId);
    if (!session) {
      return null;
    }

    const row = await this.db
      .prepare(
        `SELECT id, session_id, r2_object_key, extracted_text, confirmed_question, extraction_outcome,
                extraction_confidence, problem_type, skill_keys_json, quantities_json, relationships_json,
                unknown_target, diagram_description, task_language, language_is_subject, created_at, updated_at
         FROM problem_contexts
         WHERE session_id = ?`
      )
      .bind(sessionId)
      .first();

    return row ? mapD1ProblemContextRow(row as Record<string, unknown>) : null;
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
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .bind(sessionId, maxSessionEvents)
      .all();

    const events = d1Rows(eventsResult).map(mapD1EventRow);
    const problemContext = await this.getProblemContext(ownerKey, sessionId);

    return {
      events,
      problemContext,
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

  async saveProblemContext(
    ownerKey: string,
    request: SaveProblemContextRequest
  ): Promise<ProblemContextRecord> {
    const session = await this.getOwnedSessionRow(ownerKey, request.sessionId);
    if (!session) {
      throw sessionStoreNotFoundError();
    }

    const existing = await this.getProblemContext(ownerKey, request.sessionId);
    const timestamp = nowIso();
    const record = createProblemContextRecord(
      request,
      existing?.createdAt ?? timestamp,
      existing?.id ?? crypto.randomUUID()
    );
    record.updatedAt = timestamp;

    const serialized = serializeProblemContext(record);
    await this.db
      .prepare(
        `INSERT INTO problem_contexts (
           id, session_id, r2_object_key, extracted_text, confirmed_question, extraction_outcome,
           extraction_confidence, problem_type, skill_keys_json, quantities_json, relationships_json,
           unknown_target, diagram_description, task_language, language_is_subject, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           r2_object_key = excluded.r2_object_key,
           extracted_text = excluded.extracted_text,
           confirmed_question = excluded.confirmed_question,
           extraction_outcome = excluded.extraction_outcome,
           extraction_confidence = excluded.extraction_confidence,
           problem_type = excluded.problem_type,
           skill_keys_json = excluded.skill_keys_json,
           quantities_json = excluded.quantities_json,
           relationships_json = excluded.relationships_json,
           unknown_target = excluded.unknown_target,
           diagram_description = excluded.diagram_description,
           task_language = excluded.task_language,
           language_is_subject = excluded.language_is_subject,
           updated_at = excluded.updated_at`
      )
      .bind(
        serialized.id,
        serialized.session_id,
        serialized.r2_object_key,
        serialized.extracted_text,
        serialized.confirmed_question,
        serialized.extraction_outcome,
        serialized.extraction_confidence,
        serialized.problem_type,
        serialized.skill_keys_json,
        serialized.quantities_json,
        serialized.relationships_json,
        serialized.unknown_target,
        serialized.diagram_description,
        serialized.task_language,
        serialized.language_is_subject,
        serialized.created_at,
        serialized.updated_at
      )
      .run();

    return record;
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
         SET title = ?, status = ?, image_prompt = ?, image_name = ?, image_meta_json = ?, image_object_key = ?, extraction_outcome = ?, extraction_notes = ?, prompt_confirmed = ?, gate_status = ?, updated_at = ?
         WHERE id = ? AND owner_key = ?`
      )
      .bind(
        updated.title,
        updated.status,
        updated.imagePrompt,
        updated.imageName,
        imageMetaJson,
        updated.imageObjectKey,
        updated.extractionOutcome,
        updated.extractionNotes,
        updated.promptConfirmed ? 1 : 0,
        updated.gateStatus,
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
