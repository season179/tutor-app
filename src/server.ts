import "dotenv/config";

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(rootDir, "public");

const port = readPort(process.env.PORT);
const host = process.env.HOST;
const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";
const safetyIdentifier = hashSafetyIdentifier(process.env.OPENAI_SAFETY_IDENTIFIER ?? "local-ai-tutor-user");

const mimeTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"]
]);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload?: JsonValue
  ) {
    super(message);
  }
}

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

function hashSafetyIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

async function createRealtimeClientSecret(): Promise<JsonValue> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new HttpError(500, "Missing OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions:
          "You are AI Tutor, a patient realtime voice tutor. Help students reason through homework step by step, ask a clarifying question when the goal is unclear, and guide learning instead of only giving final answers. Keep spoken replies concise unless the student asks for detail.",
        audio: {
          output: {
            voice
          }
        }
      }
    })
  });

  const rawBody = await response.text();
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

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/token") {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new HttpError(405, "Method not allowed");
    }

    const token = await createRealtimeClientSecret();
    sendJson(res, 200, token);
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
  console.log(`Model: ${model}`);
  console.log(`Voice: ${voice}`);
});
