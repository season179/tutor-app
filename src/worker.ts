import { createApiHandlerEnv, handleApiRequest } from "./api-handler.js";
import { D1SessionStore } from "./d1-session-store.js";
import type { SessionStore } from "./session-store.js";
import { voiceSessionPath } from "./voice-types.js";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === voiceSessionPath && request.method === "POST") {
      const rateLimitResponse = await limitVoiceSessionRequest(env, readCallerKey(request));
      if (rateLimitResponse) {
        return rateLimitResponse;
      }
    }

    const store = createSessionStore(env);
    const apiResponse = await handleApiRequest(request, createApiHandlerEnv(env), { store });

    if (apiResponse) {
      return apiResponse;
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

function createSessionStore(env: Env): SessionStore {
  return new D1SessionStore(env.DB);
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
  const connectingIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (connectingIp) {
    return `ip:${connectingIp}`;
  }

  const forwardedFor = request.headers.get("X-Forwarded-For")?.split(",").at(0)?.trim();
  if (forwardedFor) {
    return `ip:${forwardedFor}`;
  }

  return "anonymous";
}
