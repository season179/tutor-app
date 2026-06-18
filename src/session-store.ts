import type {
  AppendSessionEventRequest,
  CreateTutorSessionRequest,
  SessionEventRecord,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";

export type SessionStore = {
  appendEvent(ownerKey: string, sessionId: string, request: AppendSessionEventRequest): Promise<SessionEventRecord>;
  createSession(ownerKey: string, request?: CreateTutorSessionRequest): Promise<TutorSessionRecord>;
  getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null>;
  listSessions(ownerKey: string): Promise<TutorSessionSummary[]>;
  sessionExists(ownerKey: string, sessionId: string): Promise<boolean>;
  transferOwnerSessions(fromOwnerKey: string, toOwnerKey: string): Promise<number>;
  updateSession(
    ownerKey: string,
    sessionId: string,
    request: UpdateTutorSessionRequest
  ): Promise<TutorSessionRecord | null>;
};

export function sessionStoreNotFoundError(): Error {
  return new Error("Session not found");
}
