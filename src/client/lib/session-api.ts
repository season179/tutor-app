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

export async function listSessions(): Promise<TutorSessionSummary[]> {
  const response = await fetch(sessionsPath, {
    headers: {
      Accept: "application/json"
    },
    method: "GET"
  });

  return readJson<TutorSessionSummary[]>(response);
}

export async function createSession(title?: string): Promise<TutorSessionRecord> {
  const response = await fetch(sessionsPath, {
    body: JSON.stringify(title ? { title } : {}),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return readJson<TutorSessionRecord>(response);
}

export async function getSession(sessionId: string): Promise<TutorSessionDetail> {
  const response = await fetch(`${sessionsPath}/${sessionId}`, {
    headers: {
      Accept: "application/json"
    },
    method: "GET"
  });

  return readJson<TutorSessionDetail>(response);
}

export async function updateSession(
  sessionId: string,
  request: UpdateTutorSessionRequest
): Promise<TutorSessionRecord> {
  const response = await fetch(`${sessionsPath}/${sessionId}`, {
    body: JSON.stringify(request),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });

  return readJson<TutorSessionRecord>(response);
}

export async function appendSessionEvent(
  sessionId: string,
  request: AppendSessionEventRequest
): Promise<void> {
  const response = await fetch(`${sessionsPath}/${sessionId}/events`, {
    body: JSON.stringify(request),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  await readJson(response);
}
