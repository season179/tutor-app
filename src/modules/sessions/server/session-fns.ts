import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest } from "../../../server-request-context.js";
import {
  serverFnMiddleware,
  writeServerFnMiddleware
} from "../../../core/server-fn-middleware.js";
import {
  appendSessionEvent,
  createSession,
  getSession,
  listSessions,
  updateSession
} from "../session-handler.js";
import type {
  AppendSessionEventRequest,
  UpdateTutorSessionRequest
} from "../session-types.js";

// Thin server-function adapters over the HTTP-decoupled session domain handlers.
// The handlers still re-parse their `body`/`request` payloads, so the validators
// only pass input through to give callers an end-to-end type while the handler
// keeps owning runtime validation. Reads are GET; writes are POST (server fns are
// GET/POST only — the previous PATCH was just transport). Every fn carries
// errorStatusMiddleware (maps HttpError.status onto the wire HTTP status — see
// core/error-status-middleware.ts); writes also carry the shared 16 KB body cap
// that the old /api/* handler enforced before Phase 4.

export const listSessionsFn = createServerFn({ method: "GET" })
  .middleware(serverFnMiddleware)
  .handler(async () => {
    const { context, store } = await authenticateServerRequest();
    return listSessions(context, store);
  });

export const createSessionFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: { title?: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return createSession(data, context, store);
  });

export const getSessionFn = createServerFn({ method: "GET" })
  .middleware(serverFnMiddleware)
  .validator((input: { sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return getSession(data.sessionId, context, store);
  });

export const updateSessionFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: { request: UpdateTutorSessionRequest; sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return updateSession(data.sessionId, data.request, context, store);
  });

export const appendSessionEventFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: { request: AppendSessionEventRequest; sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    await appendSessionEvent(data.sessionId, data.request, context, store);
  });
