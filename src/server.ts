import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiHandlerEnv, handleApiRequest } from "./api-handler.js";
import { HttpError, type JsonValue } from "./http-error.js";
import { MemorySessionStore } from "./memory-session-store.js";
import { defaultRealtimeModel, defaultRealtimeVoice } from "./realtime-token.js";
import { maxJsonRequestBodyBytes } from "./session-handler.js";
import { defaultVoiceBackend } from "./voice-session-service.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(rootDir, "public");
const sessionStore = new MemorySessionStore();
const jsonContentType = "application/json; charset=utf-8";
const maxPort = 65_535;
const requestBodyTooLargeMessage = "Request body too large.";

const port = readPort(process.env.PORT);
const host = process.env.HOST;

const mimeTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", jsonContentType],
  [".map", jsonContentType]
]);

function readPort(value: string | undefined): number {
  if (value === undefined || value === "") {
    return 0;
  }

  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (parsed <= maxPort) {
      return parsed;
    }
  }

  throw new Error(`Invalid PORT value: ${value}`);
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: JsonValue,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "Content-Type": jsonContentType,
    "Cache-Control": "no-store",
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

async function readRequestBody(req: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxJsonRequestBodyBytes) {
      throw new Error(requestBodyTooLargeMessage);
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    }
  }

  const requestInit: RequestInit = {
    headers,
    method: req.method ?? "GET"
  };

  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      requestInit.body = await readRequestBody(req);
    }
  } catch (error) {
    if (error instanceof Error && error.message === requestBodyTooLargeMessage) {
      res.writeHead(413, { "Content-Type": jsonContentType });
      res.end(JSON.stringify({ error: requestBodyTooLargeMessage }));
      return;
    }

    throw error;
  }

  const request = new Request(url, requestInit);

  const apiResponse = await handleApiRequest(request, createApiHandlerEnv(process.env), {
    allowDevBypass: true,
    store: sessionStore
  });

  if (apiResponse) {
    res.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));
    res.end(Buffer.from(await apiResponse.arrayBuffer()));
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
  console.log(`Voice backend: ${process.env.VOICE_BACKEND ?? defaultVoiceBackend}`);
  console.log(`OpenAI model: ${process.env.OPENAI_REALTIME_MODEL ?? defaultRealtimeModel}`);
  console.log(`OpenAI voice: ${process.env.OPENAI_REALTIME_VOICE ?? defaultRealtimeVoice}`);
});

export { sessionStore };
