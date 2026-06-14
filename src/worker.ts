import { HttpError, type JsonValue } from "./http-error.js";
import {
  createVoiceSessionService,
  parseCreateVoiceSessionRequest,
  type VoiceSessionServiceEnv
} from "./voice-session-service.js";
import { voiceSessionPath } from "./voice-types.js";

const maxVoiceSessionRequestBytes = 16_384;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === voiceSessionPath) {
      return handleVoiceSessionRequest(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

async function handleVoiceSessionRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const baseHeaders = {
    "Cache-Control": "no-store"
  };

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, {
      ...baseHeaders,
      Allow: "POST"
    });
  }

  if (!isAllowedOrigin(request, url)) {
    return json({ error: "Forbidden" }, 403, baseHeaders);
  }

  const callerKey = readCallerKey(request);
  const rateLimitResponse = await limitVoiceSessionRequest(env, callerKey);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = parseCreateVoiceSessionRequest(await readJsonRequest(request));
    const voiceSessionService = createVoiceSessionService(createVoiceSessionServiceEnv(env));
    const descriptor = await voiceSessionService.createSession(body, { callerKey });

    return json(descriptor, 200, baseHeaders);
  } catch (error) {
    return handleVoiceSessionError(error, url);
  }
}

function createVoiceSessionServiceEnv(env: Env): VoiceSessionServiceEnv {
  return {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL: env.OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_VOICE: env.OPENAI_REALTIME_VOICE,
    OPENAI_SAFETY_IDENTIFIER: env.OPENAI_SAFETY_IDENTIFIER,
    VOICE_BACKEND: env.VOICE_BACKEND
  };
}

async function readJsonRequest(request: Request): Promise<unknown> {
  const body = await readRequestText(request, maxVoiceSessionRequestBytes);

  if (!body) {
    throw new HttpError(400, "Request body was empty");
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "Request body was not valid JSON");
  }
}

async function readRequestText(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();

  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return text + decoder.decode();
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

  return json(
    { error: "Too many session requests. Please wait a moment and try again." },
    429,
    {
      "Cache-Control": "no-store",
      "Retry-After": "60"
    }
  );
}

function isAllowedOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");

  return !origin || origin === url.origin;
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

function handleVoiceSessionError(error: unknown, url: URL): Response {
  if (error instanceof HttpError) {
    console.error(
      JSON.stringify({
        message: "voice session request failed",
        path: url.pathname,
        status: error.status,
        details: error.payload ?? null
      })
    );

    if (error.message === "Missing OPENAI_API_KEY") {
      return json({ error: "Server is missing OPENAI_API_KEY." }, 500, {
        "Cache-Control": "no-store"
      });
    }

    if (isVoiceBackendConfigurationError(error)) {
      return json({ error: error.message }, error.status, {
        "Cache-Control": "no-store"
      });
    }

    const status = error.status >= 400 && error.status < 500 ? error.status : 502;

    return json({ error: "Failed to create voice session." }, status, {
      "Cache-Control": "no-store"
    });
  }

  console.error(
    JSON.stringify({
      message: "unexpected voice session request failure",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error)
    })
  );

  return json({ error: "Internal server error" }, 500, {
    "Cache-Control": "no-store"
  });
}

function isVoiceBackendConfigurationError(error: HttpError): boolean {
  return error.message.startsWith("Unsupported VOICE_BACKEND") || error.message.startsWith("VOICE_BACKEND=");
}

function json(payload: JsonValue, status: number, headers: HeadersInit = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
