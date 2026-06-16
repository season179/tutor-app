import {
  sessionsPath,
  type AppendSessionEventRequest,
  type TutorSessionDetail,
  type TutorSessionRecord,
  type TutorSessionSummary,
  type UpdateTutorSessionRequest
} from "../../session-types.js";
import { jsonRequestInit } from "./json-request.js";
import { readJsonResponse } from "./read-json-response.js";

export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return readJsonResponse<T>(
    response,
    (status, message) => new SessionApiError(status, message),
    (status) => `Request failed (${status}).`,
    "Response was not valid JSON."
  );
}

async function fetchJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  return readJson<T>(response);
}

function getJson<T>(input: string): Promise<T> {
  return fetchJson<T>(input, {
    headers: {
      Accept: "application/json"
    },
    method: "GET"
  });
}

export async function listSessions(): Promise<TutorSessionSummary[]> {
  return getJson<TutorSessionSummary[]>(sessionsPath);
}

export async function createSession(title?: string): Promise<TutorSessionRecord> {
  return fetchJson<TutorSessionRecord>(sessionsPath, jsonRequestInit("POST", title ? { title } : {}));
}

export async function getSession(sessionId: string): Promise<TutorSessionDetail> {
  return getJson<TutorSessionDetail>(`${sessionsPath}/${sessionId}`);
}

export async function updateSession(
  sessionId: string,
  request: UpdateTutorSessionRequest
): Promise<TutorSessionRecord> {
  return fetchJson<TutorSessionRecord>(`${sessionsPath}/${sessionId}`, jsonRequestInit("PATCH", request));
}

export async function appendSessionEvent(
  sessionId: string,
  request: AppendSessionEventRequest
): Promise<void> {
  await fetchJson<unknown>(`${sessionsPath}/${sessionId}/events`, jsonRequestInit("POST", request));
}
