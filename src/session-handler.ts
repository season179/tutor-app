import { HttpError } from "./http-error.js";
import {
  parseAppendSessionEventRequest,
  parseCreateTutorSessionRequest,
  parseUpdateTutorSessionRequest
} from "./session-schema.js";
import type { SessionStore } from "./session-store.js";
import { sessionsPath } from "./session-types.js";
import type { RequestContext } from "./request-context.js";
import { readLimitedTextBody } from "./read-limited-text.js";

const maxRequestBytes = 16_384;

function sessionNotFound(): HttpError {
  return new HttpError(404, "Session not found");
}

function methodNotAllowed(): HttpError {
  return new HttpError(405, "Method not allowed");
}

function requireSessionResult<T>(value: T | null): T {
  if (value === null) {
    throw sessionNotFound();
  }

  return value;
}

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
  return requireSessionResult(await store.getSession(context.ownerKey, sessionId));
}

export async function updateSession(
  sessionId: string,
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseUpdateTutorSessionRequest(body);
  return requireSessionResult(await store.updateSession(context.ownerKey, sessionId, request));
}

export async function appendSessionEvent(
  sessionId: string,
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseAppendSessionEventRequest(body);
  try {
    return await store.appendEvent(context.ownerKey, sessionId, request);
  } catch {
    throw sessionNotFound();
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
  const text = await readLimitedTextBody(
    request.body,
    maxBytes,
    () => new HttpError(413, "Request body was too large")
  );

  if (text === null) {
    return null;
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

  switch (route.kind) {
    case "collection":
      if (request.method === "GET") {
        return listSessions(context, store);
      }

      if (request.method === "POST") {
        return createSession(await readJsonBody(request), context, store);
      }

      break;
    case "detail":
      if (request.method === "GET") {
        return getSession(route.sessionId, context, store);
      }

      if (request.method === "PATCH") {
        return updateSession(route.sessionId, await readJsonBody(request), context, store);
      }

      break;
    case "events":
      if (request.method === "POST") {
        return appendSessionEvent(route.sessionId, await readJsonBody(request), context, store);
      }
  }

  throw methodNotAllowed();
}
