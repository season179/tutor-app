import { HttpError, type JsonValue } from "../../core/http-error.js";
import { isJsonObject } from "../../core/schema-parser.js";

const maxOpenAiJsonResponseBytes = 256_000;
export const openAiRequestTimeoutMs = 30_000;

export type OpenAiFetchOptions = {
  apiKey: string;
  body?: Blob | FormData | string | null;
  headers?: Record<string, string>;
  method?: string;
};

export function requireOpenAiApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new HttpError(500, "Missing OPENAI_API_KEY");
  }

  return apiKey;
}

export async function fetchOpenAiJson(url: string, options: OpenAiFetchOptions): Promise<JsonValue> {
  const init: RequestInit = {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      ...options.headers
    },
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(openAiRequestTimeoutMs)
  };

  if (options.body !== undefined) {
    init.body = options.body;
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI request failed", await readOpenAiError(response));
  }

  const text = await readLimitedResponseText(response, maxOpenAiJsonResponseBytes);

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new HttpError(502, "OpenAI response was not valid JSON.", text.slice(0, 500));
  }
}

export function extractOutputText(payload: JsonValue): string {
  const root = asRecord(payload);
  const direct = asString(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];

  for (const item of output) {
    const content = asRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const record = asRecord(part);
      const text = asString(record.text);

      if (text) {
        pieces.push(text);
      }
    }
  }

  return pieces.join("\n").trim();
}

async function readOpenAiError(response: Response): Promise<string> {
  const text = await readLimitedResponseText(response, 8_192);
  if (!text) {
    return response.statusText || "Unknown OpenAI error";
  }

  try {
    const payload = JSON.parse(text) as JsonValue;
    const error = asRecord(asRecord(payload).error);
    return asString(error.message) ?? text;
  } catch {
    return text;
  }
}

async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new HttpError(502, "OpenAI response was too large");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function asRecord(value: unknown): Record<string, JsonValue> {
  return isJsonObject(value) ? (value as Record<string, JsonValue>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
