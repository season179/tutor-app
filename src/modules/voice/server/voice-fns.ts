import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateServerRequest, workerEnv } from "../../../server-request-context.js";
import { HttpError } from "../../../core/http-error.js";
import { createVoiceSessionWithStore } from "../voice-session-handler.js";
import { handleVoicePipelineTurnWithStore } from "../voice-pipeline-service.js";
import { parseVoicePipelineTurnRequest } from "../voice-session-schema.js";
import type { ProcessTurnPayload } from "../../sessions/session-runtime-do.js";
import {
  maxVoiceTurnBodyBytes,
  type CreateVoiceSessionRequest,
  type VoicePipelineTurnRequest,
  type VoicePipelineTurnResponse,
  type VoiceSessionDescriptor
} from "../voice-types.js";

// Server-function adapters over the voice domain. Both endpoints carry the IP-based
// rate limit that used to live in the Worker entry — moved here so the limit travels
// with the voice logic now that the requests arrive as `/_serverFn/*` calls rather
// than `/api/voice/*`. The realtime/WebRTC adapter is a direct browser↔OpenAI path
// and intentionally stays out of this file.

/** Derive the per-caller rate-limit key from the request, mirroring the old Worker entry. */
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

/**
 * IP-scoped rate limit on voice requests. Runs before auth so an unauthenticated
 * flood is still throttled. A `429` thrown here serializes back to the client as the
 * same message the old JSON response carried.
 */
async function enforceVoiceRateLimit(): Promise<void> {
  const limiter = workerEnv().REALTIME_TOKEN_RATE_LIMITER;
  if (!limiter) {
    return;
  }

  const { success } = await limiter.limit({ key: readCallerKey(getRequest()) });
  if (!success) {
    throw new HttpError(429, "Too many session requests. Please wait a moment and try again.");
  }
}

/**
 * Honor the `payloadLimitBytes` capability the session descriptor advertises. The
 * Start runtime owns body parsing, so this can only reject after the fact rather than
 * abort the stream early, but it still keeps an oversized turn out of the (expensive)
 * tutoring pipeline.
 */
function assertVoiceTurnWithinLimit(): void {
  const length = Number(getRequest().headers.get("content-length"));
  if (Number.isFinite(length) && length > maxVoiceTurnBodyBytes) {
    throw new HttpError(413, "Request body was too large");
  }
}

export const createVoiceSessionFn = createServerFn({ method: "POST" })
  .validator((input: CreateVoiceSessionRequest) => input)
  .handler(async ({ data }): Promise<VoiceSessionDescriptor> => {
    await enforceVoiceRateLimit();
    const { context, store } = await authenticateServerRequest();
    return createVoiceSessionWithStore(data, workerEnv(), store, context);
  });

export const voicePipelineTurnFn = createServerFn({ method: "POST" })
  .validator((input: VoicePipelineTurnRequest) => input)
  .handler(async ({ data }): Promise<VoicePipelineTurnResponse> => {
    await enforceVoiceRateLimit();
    assertVoiceTurnWithinLimit();
    const { context, store } = await authenticateServerRequest();

    // One Durable Object per session serializes turns and owns the hint timer; route
    // through it when the binding is present, falling back to the direct pipeline
    // (e.g. local dev without the DO) otherwise.
    const sessionRuntime = workerEnv().SESSION_RUNTIME;
    if (sessionRuntime) {
      const parsed = parseVoicePipelineTurnRequest(data);
      const stub = sessionRuntime.getByName(parsed.sessionId) as DurableObjectStub & {
        processTurn(payload: ProcessTurnPayload): Promise<VoicePipelineTurnResponse>;
      };
      return stub.processTurn({ body: data, context });
    }

    return handleVoicePipelineTurnWithStore(data, workerEnv(), store, context);
  });
