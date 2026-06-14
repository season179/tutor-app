import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpError, type JsonValue } from "./http-error.js";
import {
  createVoiceSessionService,
  parseCreateVoiceSessionRequest,
  type VoiceSessionServiceEnv
} from "./voice-session-service.js";
import { voiceSessionPath } from "./voice-types.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(rootDir, "public");

const port = readPort(process.env.PORT);
const host = process.env.HOST;

const mimeTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"]
]);

function readPort(value: string | undefined): number {
  if (value === undefined || value === "") {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: JsonValue,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function getStaticPath(pathname: string): string {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    throw new HttpError(400, "Malformed URL path");
  }

  const filePath = resolve(join(publicDir, decodedPath));
  const rel = relative(publicDir, filePath);

  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new HttpError(403, "Forbidden");
  }

  return filePath;
}

async function readJsonRequest<T>(req: IncomingMessage, maxBytes = 16_384): Promise<T> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytesRead += buffer.byteLength;

    if (bytesRead > maxBytes) {
      throw new HttpError(413, "Request body was too large");
    }

    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");

  if (!text) {
    throw new HttpError(400, "Request body was empty");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Request body was not valid JSON");
  }
}

function createVoiceSessionServiceEnv(): VoiceSessionServiceEnv {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_VOICE: process.env.OPENAI_REALTIME_VOICE,
    OPENAI_SAFETY_IDENTIFIER: process.env.OPENAI_SAFETY_IDENTIFIER,
    VOICE_BACKEND: process.env.VOICE_BACKEND
  };
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new HttpError(405, "Method not allowed");
  }

  const filePath = getStaticPath(url.pathname);
  const body = await readFile(filePath);
  const contentType = mimeTypes.get(extname(filePath)) ?? "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(body);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === voiceSessionPath) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new HttpError(405, "Method not allowed");
    }

    const body = parseCreateVoiceSessionRequest(await readJsonRequest<unknown>(req));
    const voiceSessionService = createVoiceSessionService(createVoiceSessionServiceEnv());
    const descriptor = await voiceSessionService.createSession(body);

    sendJson(res, 200, descriptor);
    return;
  }

  await serveStatic(req, res, url);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: error.message,
        details: error.payload ?? null
      });
      return;
    }

    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  });
});

function getPublicUrl(): string {
  if (process.env.PORTLESS_URL) {
    return process.env.PORTLESS_URL;
  }

  const address = server.address();
  if (address && typeof address === "object") {
    return `http://localhost:${address.port}`;
  }

  return "http://localhost";
}

server.listen(port, host, () => {
  console.log(`AI Tutor app running at ${getPublicUrl()}`);
  console.log(`Voice backend: ${process.env.VOICE_BACKEND ?? "openai-realtime"}`);
  console.log(`OpenAI model: ${process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2"}`);
  console.log(`OpenAI voice: ${process.env.OPENAI_REALTIME_VOICE ?? "marin"}`);
});
