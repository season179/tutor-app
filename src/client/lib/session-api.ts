import { sessionsPath, type AppendSessionEventRequest, type TutorSessionDetail, type TutorSessionRecord, type TutorSessionSummary, type UpdateTutorSessionRequest } from "../../session-types.js";

export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new SessionApiError(response.status, payload?.error ?? `Request failed (${response.status}).`);
  }

  if (!payload) {
    throw new SessionApiError(response.status, "Response was not valid JSON.");
  }

  return payload;
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

function jsonBodyInit(method: "PATCH" | "POST", body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method
  };
}

export async function listSessions(): Promise<TutorSessionSummary[]> {
  return getJson<TutorSessionSummary[]>(sessionsPath);
}

export async function createSession(title?: string): Promise<TutorSessionRecord> {
  return fetchJson<TutorSessionRecord>(sessionsPath, jsonBodyInit("POST", title ? { title } : {}));
}

export async function getSession(sessionId: string): Promise<TutorSessionDetail> {
  return getJson<TutorSessionDetail>(`${sessionsPath}/${sessionId}`);
}

export async function updateSession(
  sessionId: string,
  request: UpdateTutorSessionRequest
): Promise<TutorSessionRecord> {
  return fetchJson<TutorSessionRecord>(`${sessionsPath}/${sessionId}`, jsonBodyInit("PATCH", request));
}

export async function appendSessionEvent(
  sessionId: string,
  request: AppendSessionEventRequest
): Promise<void> {
  await fetchJson<unknown>(`${sessionsPath}/${sessionId}/events`, jsonBodyInit("POST", request));
}
