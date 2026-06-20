import { createAuth, authPathPrefix, type AuthEnv } from "./modules/auth/auth.js";
import { createApiHandlerEnv, handleApiRequest } from "./api-handler.js";
import { D1SessionStore } from "./modules/sessions/d1-session-store.js";
import { SessionRuntimeDO } from "./modules/sessions/session-runtime-do.js";
import { voiceSessionPath, voiceTurnPath } from "./modules/voice/voice-types.js";

export { SessionRuntimeDO };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
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

    return env.ASSETS.fetch(request);
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
