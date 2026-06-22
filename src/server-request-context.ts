import { env } from "cloudflare:workers";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

import { createWorkerAuth } from "./modules/auth/auth.js";
import { D1SessionStore } from "./modules/sessions/d1-session-store.js";
import { HttpError } from "./core/http-error.js";
import { buildOwnerKey, type AuthIdentity, type RequestContext } from "./core/request-context.js";

export type AuthenticatedServerRequest = {
  context: RequestContext;
  store: D1SessionStore;
};

/**
 * The raw Cloudflare Worker bindings, for server functions that need env beyond the
 * auth/store wiring (R2 credentials, OpenAI config, …). Keeping the `cloudflare:workers`
 * import confined to this server-only module means it never reaches the client bundle.
 */
export function workerEnv() {
  return env;
}

/**
 * Server-function counterpart of the Worker entry's `authenticate()` + store setup:
 * build the D1 store and a better-auth instance from the `cloudflare:workers`
 * bindings, read the session cookie off the incoming request, and return the
 * per-user {@link RequestContext} plus the store the domain handlers run against.
 *
 * This is only ever imported from inside `createServerFn().handler()` bodies, so
 * TanStack Start strips it — along with its Cloudflare/better-auth imports — out of
 * the client bundle.
 */
export async function authenticateServerRequest(): Promise<AuthenticatedServerRequest> {
  // Authenticated payloads must never be cached by the browser or an edge cache;
  // mirrors the `Cache-Control: no-store` the old /api/* handler set on every JSON
  // response.
  setResponseHeader("Cache-Control", "no-store");

  const store = new D1SessionStore(env.DB);
  const auth = createWorkerAuth(env, store);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) {
    throw new HttpError(401, "Unauthorized");
  }

  const userId = session.user.id;
  const identity: AuthIdentity = {
    userId,
    // The admin plugin populates `role` on the session user (default "user"); fall back to
    // "user" defensively if the field is ever absent so the admin gate fails closed.
    role: (session.user as { role?: string }).role ?? "user",
    ...(session.user.email ? { email: session.user.email } : {})
  };

  return {
    context: { identity, ownerKey: buildOwnerKey(userId) },
    store
  };
}
