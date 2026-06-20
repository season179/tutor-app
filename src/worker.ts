import startServer from "@tanstack/react-start/server-entry";

import { createWorkerAuth, authPathPrefix } from "./modules/auth/auth.js";
import { D1SessionStore } from "./modules/sessions/d1-session-store.js";
import { SessionRuntimeDO } from "./modules/sessions/session-runtime-do.js";

// Durable Objects must be exported from the worker's main module.
export { SessionRuntimeDO };

// Custom Cloudflare entry: better-auth owns `/api/auth/*`. Everything else — the SSR
// document, client assets, and the TanStack Start server functions (`/_serverFn/*`,
// where sessions, problem-context, and voice now live) — is delegated to Start.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // better-auth handles its own routes (sign-in, callback, sign-out, session).
      // It is the only thing still served from under `/api/`.
      if (url.pathname.startsWith(authPathPrefix)) {
        const store = new D1SessionStore(env.DB);
        const auth = createWorkerAuth(env, store);
        return auth.handler(request);
      }

      // No other `/api/*` endpoint exists post-migration. Return a JSON 404 rather
      // than letting the SSR renderer answer an API call with an HTML document.
      return Response.json(
        { error: "Not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Start reads CF bindings via `cloudflare:workers`, so only the Request is passed.
    return startServer.fetch(request);
  }
} satisfies ExportedHandler<Env>;
