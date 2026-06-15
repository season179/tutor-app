import { HttpError } from "./http-error.js";
import {
  parseAppendSessionEventRequest,
  parseCreateTutorSessionRequest,
  parseUpdateTutorSessionRequest
} from "./session-schema.js";
import type { SessionStore } from "./session-store.js";
import { sessionsPath } from "./session-types.js";
import type { RequestContext } from "./request-context.js";

const maxRequestBytes = 16_384;

export async function listSessions(context: RequestContext, store: SessionStore) {
  return store.listSessions(context.ownerKey);
}

export async function createSession(
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseCreateTutorSessionRequest(body);
  return store.createSession(context.ownerKey, request);
}

export async function getSession(
  sessionId: string,
  context: RequestContext,
  store: SessionStore
) {
  const detail = await store.getSession(context.ownerKey, sessionId);
  if (!detail) {
    throw new HttpError(404, "Session not found");
  }

  return detail;
}

export async function updateSession(
  sessionId: string,
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseUpdateTutorSessionRequest(body);
  const updated = await store.updateSession(context.ownerKey, sessionId, request);
  if (!updated) {
    throw new HttpError(404, "Session not found");
  }

  return updated;
}

export async function appendSessionEvent(
  sessionId: string,
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseAppendSessionEventRequest(body);
  const exists = await store.sessionExists(context.ownerKey, sessionId);
  if (!exists) {
    throw new HttpError(404, "Session not found");
  }

  try {
    return await store.appendEvent(context.ownerKey, sessionId, request);
  } catch {
    throw new HttpError(404, "Session not found");
  }
}

export function parseSessionRoute(pathname: string):
  | { kind: "collection" }
  | { kind: "detail"; sessionId: string }
  | { kind: "events"; sessionId: string }
  | null {
  if (pathname === sessionsPath) {
    return { kind: "collection" };
  }

  const prefix = `${sessionsPath}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const remainder = pathname.slice(prefix.length);
  const segments = remainder.split("/").filter(Boolean);

  if (segments.length === 1) {
    return { kind: "detail", sessionId: segments[0]! };
  }

  if (segments.length === 2 && segments[1] === "events") {
    return { kind: "events", sessionId: segments[0]! };
  }

  return null;
}

export async function readJsonBody(request: Request, maxBytes = maxRequestBytes): Promise<unknown> {
  const reader = request.body?.getReader();

  if (!reader) {
    return null;
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        text += decoder.decode();
        break;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request body was too large");
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  if (!text) {
    throw new HttpError(400, "Request body was empty");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Request body was not valid JSON");
  }
}

export async function handleSessionsRequest(
  request: Request,
  context: RequestContext,
  store: SessionStore
): Promise<unknown> {
  const route = parseSessionRoute(new URL(request.url).pathname);
  if (!route) {
    throw new HttpError(404, "Not found");
  }

  if (route.kind === "collection") {
    if (request.method === "GET") {
      return listSessions(context, store);
    }

    if (request.method === "POST") {
      return createSession(await readJsonBody(request), context, store);
    }

    throw new HttpError(405, "Method not allowed");
  }

  if (route.kind === "detail") {
    if (request.method === "GET") {
      return getSession(route.sessionId, context, store);
    }

    if (request.method === "PATCH") {
      return updateSession(route.sessionId, await readJsonBody(request), context, store);
    }

    throw new HttpError(405, "Method not allowed");
  }

  if (request.method === "POST") {
    return appendSessionEvent(route.sessionId, await readJsonBody(request), context, store);
  }

  throw new HttpError(405, "Method not allowed");
}
