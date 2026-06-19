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
import { parseActiveStep, serializeActiveStep, type ActiveStep } from "./active-step.js";
import type { ExtractionOutcome } from "./problem-context/problem-context-types.js";
import { problemTypes, type ProblemContextRecord, type ProblemFrame, type ProblemQuantity, type ProblemType } from "./problem-context/problem-frame.js";
import { isJsonObject } from "./schema-parser.js";
import { applyTutorSessionUpdate, maxSessionEvents, toTutorSessionSummary } from "./session-types.js";
import { sessionStoreNotFoundError, type SaveProblemContextRequest, type SessionPhaseAdvance, type SessionStore } from "./session-store.js";
import { initialPhase } from "./phase-policy.js";
import { comprehensionGateStatuses, sessionPhases } from "./tutor-action.js";
import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "./tutor-action.js";

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

function parseSessionPhase(value: unknown): SessionPhase {
  return sessionPhases.includes(value as SessionPhase) ? (value as SessionPhase) : initialPhase;
}

function parseGateStatus(value: string | null): ComprehensionGateStatus | null {
  return value && comprehensionGateStatuses.includes(value as ComprehensionGateStatus)
    ? (value as ComprehensionGateStatus)
    : null;
}

function parseSupportLevel(value: unknown): SupportLevel {
  const level = Number(value ?? 0);
  return Number.isInteger(level) && level >= 0 && level <= 4 ? (level as SupportLevel) : 0;
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

function serializeStringArray(value: readonly string[]): string {
  return JSON.stringify([...value]);
}

function parseStringArray(value: string | null): string[] {
  const parsed = parseJsonOrNull(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === "string");
}

function parseProblemQuantities(value: string | null): ProblemQuantity[] {
  const parsed = parseJsonOrNull(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const quantities: ProblemQuantity[] = [];
  for (const item of parsed) {
    if (!isJsonObject(item)) {
      continue;
    }

    const raw = item.raw;
    const label = item.label;
    const unit = item.unit;
    if (typeof raw !== "string" || typeof label !== "string") {
      continue;
    }

    quantities.push({
      label,
      raw,
      ...(typeof unit === "string" && unit ? { unit } : {})
    });
  }

  return quantities;
}

function parseProblemType(value: string | null): ProblemType {
  return problemTypes.includes(value as ProblemType) ? (value as ProblemType) : "other";
}

function serializeProblemQuantities(value: readonly ProblemQuantity[]): string {
  return JSON.stringify(value.map((quantity) => ({ label: quantity.label, raw: quantity.raw, unit: quantity.unit ?? null })));
}

function createProblemContextRecord(
  request: SaveProblemContextRequest,
  createdAt: string,
  id: string
): ProblemContextRecord {
  return {
    ...request.frame,
    confirmedQuestion: request.confirmedQuestion ?? null,
    createdAt,
    extractionConfidence: request.extractionConfidence,
    extractionOutcome: request.extractionOutcome,
    id,
    r2ObjectKey: request.r2ObjectKey ?? null,
    sessionId: request.sessionId,
    updatedAt: createdAt
  };
}

export function serializeProblemContext(record: ProblemContextRecord): Record<string, unknown> {
  return {
    confirmed_question: record.confirmedQuestion,
    created_at: record.createdAt,
    diagram_description: record.diagramDescription,
    extracted_text: record.extractedText,
    extraction_confidence: record.extractionConfidence,
    extraction_outcome: record.extractionOutcome,
    id: record.id,
    language_is_subject: record.languageIsSubject ? 1 : 0,
    problem_type: record.problemType,
    quantities_json: serializeProblemQuantities(record.quantities),
    r2_object_key: record.r2ObjectKey,
    relationships_json: serializeStringArray(record.relationships),
    session_id: record.sessionId,
    skill_keys_json: serializeStringArray(record.likelySkillKeys),
    task_language: record.taskLanguage,
    unknown_target: record.unknownTarget,
    updated_at: record.updatedAt
  };
}

export function mapD1ProblemContextRow(row: Record<string, unknown>): ProblemContextRecord {
  const extractedText = String(row.extracted_text ?? "");
  const confirmedQuestion = rowStringOrNull(row.confirmed_question);

  return {
    confirmedQuestion,
    createdAt: String(row.created_at),
    diagramDescription: rowStringOrNull(row.diagram_description),
    extractedText,
    extractionConfidence:
      row.extraction_confidence === "high" || row.extraction_confidence === "medium" || row.extraction_confidence === "low"
        ? row.extraction_confidence
        : null,
    extractionOutcome: parseExtractionOutcome(String(row.extraction_outcome)) ?? "none",
    id: String(row.id),
    languageIsSubject: Number(row.language_is_subject ?? 0) === 1,
    likelySkillKeys: parseStringArray(rowStringOrNull(row.skill_keys_json)),
    problemType: parseProblemType(rowStringOrNull(row.problem_type)),
    quantities: parseProblemQuantities(rowStringOrNull(row.quantities_json)),
    r2ObjectKey: rowStringOrNull(row.r2_object_key),
    relationships: parseStringArray(rowStringOrNull(row.relationships_json)),
    sessionId: String(row.session_id),
    taskLanguage: rowStringOrNull(row.task_language) ?? "en",
    unknownTarget: rowStringOrNull(row.unknown_target),
    updatedAt: String(row.updated_at),
    visibleQuestion: confirmedQuestion ?? extractedText
  };
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
    activeStep: null,
    createdAt,
    currentPhase: initialPhase,
    extractionNotes: null,
    extractionOutcome: null,
    gateStatus: null,
    id,
    imageMeta: null,
    imageName: null,
    imageObjectKey: null,
    imagePrompt: null,
    ownerKey,
    promptConfirmed: false,
    status: "draft",
    supportLevel: 0,
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
  private readonly problemContexts = new Map<string, ProblemContextRecord>();
  private nextEventId = 1;

  async advanceSessionPhase(
    ownerKey: string,
    sessionId: string,
    expectedPhase: SessionPhase,
    advance: SessionPhaseAdvance
  ): Promise<TutorSessionRecord | null> {
    const session = this.getOwnedSession(ownerKey, sessionId);
    if (!session || session.currentPhase !== expectedPhase) {
      return null;
    }

    session.activeStep = advance.activeStep;
    session.currentPhase = advance.currentPhase;
    session.gateStatus = advance.gateStatus;
    session.supportLevel = advance.supportLevel;
    session.updatedAt = nowIso();

    return this.toRecord(session);
  }

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

  async getProblemContext(ownerKey: string, sessionId: string): Promise<ProblemContextRecord | null> {
    if (!this.getOwnedSession(ownerKey, sessionId)) {
      return null;
    }

    return this.problemContexts.get(sessionId) ?? null;
  }

  async getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null> {
    const session = this.getOwnedSession(ownerKey, sessionId);
    if (!session) {
      return null;
    }

    return {
      events: [...session.events],
      problemContext: this.problemContexts.get(sessionId) ?? null,
      session: this.toRecord(session)
    };
  }

  async listSessions(ownerKey: string): Promise<TutorSessionSummary[]> {
    return [...this.sessions.values()]
      .filter((session) => session.ownerKey === ownerKey)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => toTutorSessionSummary(this.toRecord(session)));
  }

  async saveProblemContext(
    ownerKey: string,
    request: SaveProblemContextRequest
  ): Promise<ProblemContextRecord> {
    this.requireOwnedSession(ownerKey, request.sessionId);
    const existing = this.problemContexts.get(request.sessionId);
    const timestamp = nowIso();
    const record = createProblemContextRecord(
      request,
      existing?.createdAt ?? timestamp,
      existing?.id ?? crypto.randomUUID()
    );
    record.updatedAt = timestamp;

    this.problemContexts.set(request.sessionId, record);
    return record;
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
    activeStep: parseActiveStep(parseJsonOrNull(rowStringOrNull(row.active_step_json))),
    createdAt: String(row.created_at),
    currentPhase: parseSessionPhase(row.current_phase),
    extractionNotes: rowStringOrNull(row.extraction_notes),
    extractionOutcome: parseExtractionOutcome(rowStringOrNull(row.extraction_outcome)),
    gateStatus: parseGateStatus(rowStringOrNull(row.gate_status)),
    id: String(row.id),
    imageMeta: parseImageMeta(rowStringOrNull(row.image_meta_json)),
    imageName: rowStringOrNull(row.image_name),
    imageObjectKey: rowStringOrNull(row.image_object_key),
    imagePrompt: rowStringOrNull(row.image_prompt),
    ownerKey: String(row.owner_key),
    promptConfirmed: Number(row.prompt_confirmed ?? 0) === 1,
    status: row.status as TutorSessionStatus,
    supportLevel: parseSupportLevel(row.current_support_level),
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
  createProblemContextRecord,
  createSessionEventRecord,
  createTutorSessionRecord,
  nowIso,
  parseActiveStep,
  parseImageMeta,
  rowStringOrNull,
  serializeActiveStep,
  serializeImageMeta
};
