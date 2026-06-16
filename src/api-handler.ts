import { authenticateRequest, type AccessAuthEnv } from "./access-auth.js";
import { HttpError, type JsonValue } from "./http-error.js";
import type { SessionStore } from "./session-store.js";
import { handleSessionsRequest } from "./session-handler.js";
import { sessionsPath } from "./session-types.js";
import { createVoiceSessionWithStore } from "./voice-session-handler.js";
import { type VoiceSessionServiceEnv } from "./voice-session-service.js";
import { voiceSessionPath } from "./voice-types.js";
import { readJsonBody } from "./session-handler.js";

export type ApiHandlerEnv = AccessAuthEnv & VoiceSessionServiceEnv;

export type ApiHandlerEnvSource = {
  ACCESS_DEV_IDENTITY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_REALTIME_MODEL?: string;
  OPENAI_REALTIME_VOICE?: string;
  OPENAI_SAFETY_IDENTIFIER?: string;
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
  VOICE_BACKEND?: string;
};

export type ApiHandlerOptions = {
  allowDevBypass?: boolean;
  store: SessionStore;
};

export function createApiHandlerEnv(source: ApiHandlerEnvSource): ApiHandlerEnv {
  return {
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL: source.OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_VOICE: source.OPENAI_REALTIME_VOICE,
    OPENAI_SAFETY_IDENTIFIER: source.OPENAI_SAFETY_IDENTIFIER,
    VOICE_BACKEND: source.VOICE_BACKEND,
    ...(source.ACCESS_DEV_IDENTITY ? { ACCESS_DEV_IDENTITY: source.ACCESS_DEV_IDENTITY } : {}),
    ...(source.POLICY_AUD ? { POLICY_AUD: source.POLICY_AUD } : {}),
    ...(source.TEAM_DOMAIN ? { TEAM_DOMAIN: source.TEAM_DOMAIN } : {})
  };
}

function json(payload: JsonValue, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function isApiPath(pathname: string): boolean {
  return pathname === voiceSessionPath || pathname === sessionsPath || pathname.startsWith(`${sessionsPath}/`);
}

export async function handleApiRequest(
  request: Request,
  env: ApiHandlerEnv,
  options: ApiHandlerOptions
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isApiPath(url.pathname)) {
    return null;
  }

  try {
    const authOptions =
      options.allowDevBypass === true ? ({ allowDevBypass: true } as const) : {};
    const context = await authenticateRequest(request, env, authOptions);

    if (url.pathname === voiceSessionPath) {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }

      const descriptor = await createVoiceSessionWithStore(
        await readJsonBody(request),
        env,
        options.store,
        context
      );

      return json(descriptor, 200);
    }

    const payload = await handleSessionsRequest(request, context, options.store);
    return json(payload as JsonValue, 200);
  } catch (error) {
    return handleApiError(error, url);
  }
}

function handleApiError(error: unknown, url: URL): Response {
  if (error instanceof HttpError) {
    if (error.message === "Missing OPENAI_API_KEY") {
      return json({ error: "Server is missing OPENAI_API_KEY." }, 500);
    }

    if (
      error.message.startsWith("Unsupported VOICE_BACKEND") ||
      error.message.startsWith("VOICE_BACKEND=")
    ) {
      return json({ error: error.message }, error.status);
    }

    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    return json({ error: error.message || "Request failed." }, status);
  }

  console.error(
    JSON.stringify({
      message: "unexpected api request failure",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error)
    })
  );

  return json({ error: "Internal server error" }, 500);
}
