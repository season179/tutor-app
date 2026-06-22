import { HttpError, type JsonValue } from "../../core/http-error.js";
import { readLimitedTextBody } from "../../core/read-limited-text.js";
import { isJsonObject } from "../../core/schema-parser.js";
import type { VoicePipelineAudioInput, VoicePipelineAudioOutput } from "../../modules/voice/voice-types.js";

// Mirrors src/providers/openai/openai-responses.ts: a ceiling on a single audio
// (JSON) response body, and a separate timeout for the upstream model call. Audio
// bytes for TTS are read in full via arrayBuffer(); these caps apply only to the
// JSON bodies (STT success + error bodies on either endpoint).
const maxOpenRouterJsonResponseBytes = 256_000;
const maxOpenRouterErrorBytes = 8_192;
export const openRouterRequestTimeoutMs = 30_000;

const transcriptionsUrl = "https://openrouter.ai/api/v1/audio/transcriptions";
const speechUrl = "https://openrouter.ai/api/v1/audio/speech";
const speechMimeType = "audio/mpeg";

export type OpenRouterAudioOptions = {
  // `apiKey` reaches `requireOpenRouterApiKey` inside the helpers, which throws HttpError(500)
  // on undefined — so the option is typed `string | undefined` here (mirroring how the OpenAI
  // provider's options carry the key) rather than forcing every call site to pre-check.
  apiKey: string | undefined;
  model: string;
};

export type OpenRouterSpeechOptions = OpenRouterAudioOptions & {
  voice: string;
};

export function requireOpenRouterApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new HttpError(500, "Missing OPENROUTER_API_KEY");
  }

  return apiKey;
}

/**
 * Transcribes a student's audio turn via OpenRouter's `/audio/transcriptions`.
 *
 * OpenRouter's STT wire differs from OpenAI's in two load-bearing ways: the body is
 * JSON (not multipart/form-data), and the audio travels as `{ input_audio: { data,
 * format } }` where `data` is BARE base64 (no `data:` prefix) and `format` is a
 * required enum token (`webm`, `mp3`, `m4a`, …). The success body is the OpenAI-shaped
 * `{ text, usage }`, so the caller's text-extraction path is unchanged.
 *
 * Throws HttpError(502) on a non-2xx (mirrors the OpenAI STT throw the turn loop made).
 */
export async function transcribeViaOpenRouter(
  audio: VoicePipelineAudioInput,
  options: OpenRouterAudioOptions
): Promise<string> {
  const apiKey = requireOpenRouterApiKey(options.apiKey);
  const { base64, format } = parseAudioDataUrl(audio.dataUrl, audio.mimeType);

  const response = await fetch(transcriptionsUrl, {
    body: JSON.stringify({
      model: options.model,
      input_audio: { data: base64, format }
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal: AbortSignal.timeout(openRouterRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      "OpenRouter transcription request failed",
      await readOpenRouterError(response)
    );
  }

  const payload = await readJsonBody(response, maxOpenRouterJsonResponseBytes, "transcription");
  const text = asString(asRecord(payload).text)?.trim();
  if (!text) {
    throw new HttpError(502, "OpenRouter transcription response did not include text.", payload);
  }

  return text;
}

/**
 * Synthesizes the tutor's spoken utterance via OpenRouter's `/audio/speech`.
 *
 * OpenRouter's TTS wire is JSON `{ model, input, voice, response_format }` and the
 * success body is RAW BINARY audio (never JSON) — `arrayBuffer()` on 2xx, `.json()`
 * only on error. Unlike OpenAI's `gpt-4o-mini-tts`, Gemini 3.1 Flash TTS has no
 * `instructions` field, so the tone direction ("calm, patient tutor") is folded into
 * `input` as a leading directive — Gemini steers on natural-language input.
 *
 * Returns the existing `data:audio/mpeg;base64,...` output the client already renders.
 */
export async function synthesizeSpeechViaOpenRouter(
  text: string,
  options: OpenRouterSpeechOptions
): Promise<VoicePipelineAudioOutput> {
  const apiKey = requireOpenRouterApiKey(options.apiKey);
  // Gemini TTS has no style/instructions field; bake the tutor delivery into the text.
  const input = `In a warm, patient tutor voice: ${text}`;

  const response = await fetch(speechUrl, {
    body: JSON.stringify({
      input,
      model: options.model,
      response_format: "mp3",
      voice: options.voice
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal: AbortSignal.timeout(openRouterRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      "OpenRouter text-to-speech request failed",
      await readOpenRouterError(response)
    );
  }

  // Success body is binary audio — read it in full (no JSON parse). Mirrors the
  // OpenAI TTS path: bytes → base64 data URL the client renders as <audio>.
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    dataUrl: `data:${speechMimeType};base64,${bytesToBase64(bytes)}`,
    mimeType: speechMimeType,
    size: bytes.byteLength
  };
}

/**
 * Splits a `data:<mime>;base64,<data>` URL into OpenRouter's STT fields: bare base64
 * `data` (the prefix MUST be stripped — OpenRouter rejects a data URL here) and the
 * required `format` token. The format is derived from the declared MIME, falling back
 * to parsing it out of the data URL's own metadata, then to the container suffix.
 */
function parseAudioDataUrl(
  dataUrl: string,
  fallbackMimeType: string
): { base64: string; format: string } {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new HttpError(400, "Audio payload must be a base64 data URL.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const metadataParts = metadata.split(";").filter(Boolean);
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  if (!isBase64) {
    throw new HttpError(400, "Audio payload must be a base64 data URL.");
  }

  const mimeFromDataUrl = metadataParts[0]?.includes("/") ? metadataParts[0] : "";
  const mimeType = mimeFromDataUrl || fallbackMimeType;
  return {
    base64: dataUrl.slice(commaIndex + 1),
    format: audioFormatFor(mimeType)
  };
}

/**
 * Maps an audio MIME type to the OpenRouter STT `format` enum token. The enum is
 * `wav | mp3 | flac | m4a | ogg | webm | aac`; `audio/mp4` and `audio/x-m4a` both map
 * to `m4a`. Falls back to `webm` (the browser default recording container) when the
 * MIME is absent or unrecognized — the same default the client uploads.
 */
function audioFormatFor(mimeType: string): string {
  const lowered = mimeType.toLowerCase();
  if (lowered === "audio/wav" || lowered === "audio/wave" || lowered === "audio/x-wav") {
    return "wav";
  }
  if (lowered === "audio/mpeg" || lowered === "audio/mp3") {
    return "mp3";
  }
  if (lowered === "audio/flac") {
    return "flac";
  }
  if (lowered === "audio/mp4" || lowered === "audio/x-m4a" || lowered === "audio/m4a") {
    return "m4a";
  }
  if (lowered === "audio/ogg" || lowered === "audio/ogg; codecs=opus") {
    return "ogg";
  }
  if (lowered === "audio/aac") {
    return "aac";
  }
  // webm is the MediaRecorder default; treat it (and anything unknown) as webm.
  return "webm";
}

async function readJsonBody(
  response: Response,
  maxBytes: number,
  stage: string
): Promise<JsonValue> {
  const text = await readLimitedTextBody(
    response.body,
    maxBytes,
    () => new HttpError(502, `OpenRouter ${stage} response was too large.`)
  );
  if (!text) {
    throw new HttpError(502, `OpenRouter ${stage} response was empty.`);
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new HttpError(502, `OpenRouter ${stage} response was not valid JSON.`, text.slice(0, 500));
  }
}

async function readOpenRouterError(response: Response): Promise<JsonValue> {
  const text = await readLimitedTextBody(
    response.body,
    maxOpenRouterErrorBytes,
    () => new HttpError(502, "OpenRouter error body was too large.")
  );
  if (!text) {
    return response.statusText || "Unknown OpenRouter error";
  }
  try {
    const payload = JSON.parse(text) as JsonValue;
    const error = asRecord(asRecord(payload).error);
    return asString(error.message) ?? text;
  } catch {
    return text;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function asRecord(value: unknown): Record<string, JsonValue> {
  return isJsonObject(value) ? (value as Record<string, JsonValue>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
