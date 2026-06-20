import { HttpError, type JsonValue } from "../../core/http-error.js";
import { readLimitedTextBody } from "../../core/read-limited-text.js";

export type RealtimeClientSecretOptions = {
  apiKey: string | undefined;
  instructions: string;
  model: string | undefined;
  safetyIdentifierSeed: string | undefined;
  timeoutMs?: number;
  voice: string | undefined;
};

export const defaultRealtimeModel = "gpt-realtime-2";
export const defaultRealtimeVoice = "marin";
export const defaultSafetyIdentifier = "local-ai-tutor-user";
const maxOpenAiResponseBytes = 64_000;

export async function createRealtimeClientSecret(options: RealtimeClientSecretOptions): Promise<JsonValue> {
  const apiKey = options.apiKey;

  if (!apiKey) {
    throw new HttpError(500, "Missing OPENAI_API_KEY");
  }

  const safetyIdentifier = await hashSafetyIdentifier(options.safetyIdentifierSeed ?? defaultSafetyIdentifier);
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: options.model ?? defaultRealtimeModel,
        instructions: options.instructions,
        audio: {
          output: {
            voice: options.voice ?? defaultRealtimeVoice
          }
        }
      }
    })
  });

  const rawBody =
    (await readLimitedTextBody(
      response.body,
      maxOpenAiResponseBytes,
      () => new HttpError(502, "OpenAI response was too large")
    )) ?? "";
  let payload: JsonValue;

  try {
    payload = JSON.parse(rawBody) as JsonValue;
  } catch {
    payload = { error: rawBody };
  }

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI client secret request failed", payload);
  }

  return payload;
}

async function hashSafetyIdentifier(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
