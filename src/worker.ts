import startServer from "@tanstack/react-start/server-entry";

import { createAuth, authPathPrefix, type AuthEnv } from "./modules/auth/auth.js";
import { createApiHandlerEnv, handleApiRequest } from "./api-handler.js";
import { D1SessionStore } from "./modules/sessions/d1-session-store.js";
import { SessionRuntimeDO } from "./modules/sessions/session-runtime-do.js";
import { voiceSessionPath, voiceTurnPath } from "./modules/voice/voice-types.js";

// Durable Objects must be exported from the worker's main module.
export { SessionRuntimeDO };

// Custom Cloudflare entry: auth + voice rate-limit + the ownership-gated API
// handler all run HERE, before delegating anything else to TanStack Start, which
// SSRs the document shell and serves the client bundle (replacing env.ASSETS).
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // Everything the worker owns lives under /api/. Any other path (the SSR
    // document, or a client asset that missed the asset router) goes straight
    // to TanStack Start — without building a better-auth instance and D1 store
    // it would never use on the SSR hot path.
    if (!url.pathname.startsWith("/api/")) {
      // Start reads CF bindings via `cloudflare:workers`, so only the Request is passed.
      return startServer.fetch(request);
    }

    const store = new D1SessionStore(env.DB);
    const auth = createWorkerAuth(env, store);

    // better-auth handles its own routes (sign-in, callback, sign-out, session).
    // These must run before the ownership-gated API handler.
    if (url.pathname.startsWith(authPathPrefix)) {
      return auth.handler(request);
    }

    if ((url.pathname === voiceSessionPath || url.pathname === voiceTurnPath) && request.method === "POST") {
      const rateLimitResponse = await limitVoiceSessionRequest(env, readCallerKey(request));
      if (rateLimitResponse) {
        return rateLimitResponse;
      }
    }

    const apiResponse = await handleApiRequest(request, createApiHandlerEnv(env), {
      auth,
      sessionRuntime: env.SESSION_RUNTIME,
      store
    });

    if (apiResponse) {
      return apiResponse;
    }

    // Unknown /api/* endpoint: keep it out of the SPA renderer and return a
    // JSON 404 instead of SSR'ing an HTML document in response to an API call.
    return Response.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
} satisfies ExportedHandler<Env>;

function createWorkerAuth(env: AuthEnv, store: D1SessionStore) {
  return createAuth(env, {
    transferSessions: async (fromUserId, toUserId) => {
      await store.transferOwnerSessions(fromUserId, toUserId);
    }
  });
}

async function limitVoiceSessionRequest(env: Env, key: string): Promise<Response | undefined> {
  const limiter = env.REALTIME_TOKEN_RATE_LIMITER;

  if (!limiter) {
    return undefined;
  }

  const { success } = await limiter.limit({ key });

  if (success) {
    return undefined;
  }

  return Response.json(
    { error: "Too many session requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "60"
      }
    }
  );
}

function readCallerKey(request: Request): string {
  return (
    toIpCallerKey(request.headers.get("CF-Connecting-IP")) ??
    toIpCallerKey(request.headers.get("X-Forwarded-For")?.split(",").at(0)) ??
    "anonymous"
  );
}

function toIpCallerKey(value: string | null | undefined): string | undefined {
  const ip = value?.trim();
  return ip ? `ip:${ip}` : undefined;
}
