import { AwsClient } from "aws4fetch";

import { HttpError } from "../../core/http-error.js";
import { maxProblemImageBytes } from "./problem-context-types.js";

export type ProblemImageStoreEnv = {
  PROBLEM_IMAGES?: R2Bucket;
  R2_ACCESS_KEY_ID: string | undefined;
  R2_ACCOUNT_ID: string | undefined;
  R2_BUCKET_NAME: string | undefined;
  R2_SECRET_ACCESS_KEY: string | undefined;
};

const uploadUrlTtlSeconds = 900;
const readUrlTtlSeconds = 300;

export function createProblemImageObjectKey(sessionId: string): string {
  return `${sessionId}/${crypto.randomUUID()}.jpg`;
}

export function isOwnedProblemImageKey(objectKey: string, sessionId: string): boolean {
  if (objectKey.includes("..") || objectKey.includes("\\")) {
    return false;
  }

  const sessionPrefix = `${sessionId}/`;

  if (objectKey.startsWith(sessionPrefix)) {
    const remainder = objectKey.slice(sessionPrefix.length);
    return remainder.length > 0 && !remainder.includes("/");
  }

  // Legacy keys were scoped as `{ownerKey}/{sessionId}/{file}.jpg`.
  const legacyMarker = `/${sessionId}/`;
  const legacyIndex = objectKey.indexOf(legacyMarker);

  if (legacyIndex >= 0) {
    const remainder = objectKey.slice(legacyIndex + legacyMarker.length);
    return remainder.length > 0 && !remainder.includes("/");
  }

  return false;
}

export async function assertProblemImageExists(
  env: ProblemImageStoreEnv,
  objectKey: string,
  maxBytes = maxProblemImageBytes
): Promise<void> {
  const credentials = requireR2Credentials(env);
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey
  });

  const url = new URL(
    `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucketName}/${objectKey}`
  );

  const signed = await client.sign(new Request(url.toString(), { method: "HEAD" }), {
    aws: { region: "auto", service: "s3" }
  });

  const response = await fetch(signed);

  if (!response.ok) {
    throw new HttpError(404, "Problem image was not found.");
  }

  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, "Problem image exceeds the size limit.");
  }
}

export async function createProblemImageUploadUrl(
  env: ProblemImageStoreEnv,
  objectKey: string,
  contentType: string,
  bytes: number
): Promise<{ expiresAt: string; uploadUrl: string }> {
  const uploadUrl = await createPresignedUrl(
    env,
    objectKey,
    "PUT",
    contentType,
    uploadUrlTtlSeconds,
    bytes
  );

  return {
    expiresAt: expiresAtFromNow(uploadUrlTtlSeconds),
    uploadUrl
  };
}

export async function createProblemImageReadUrl(
  env: ProblemImageStoreEnv,
  objectKey: string,
  expiresSeconds = readUrlTtlSeconds
): Promise<{ expiresAt: string; url: string }> {
  const url = await createPresignedUrl(env, objectKey, "GET", undefined, expiresSeconds);

  return {
    expiresAt: expiresAtFromNow(expiresSeconds),
    url
  };
}

function expiresAtFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

async function createPresignedUrl(
  env: ProblemImageStoreEnv,
  key: string,
  method: "GET" | "PUT",
  contentType: string | undefined,
  expiresSeconds: number,
  contentLength?: number
): Promise<string> {
  const credentials = requireR2Credentials(env);
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey
  });

  const url = new URL(
    `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucketName}/${key}`
  );
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));

  const headers: Record<string, string> = {};
  if (contentType && method === "PUT") {
    headers["Content-Type"] = contentType;
  }

  if (method === "PUT" && contentLength !== undefined) {
    headers["Content-Length"] = String(contentLength);
  }

  const signed = await client.sign(new Request(url.toString(), { headers, method }), {
    aws: { region: "auto", service: "s3", signQuery: true }
  });

  return signed.url;
}

function requireR2Credentials(env: ProblemImageStoreEnv): {
  accessKeyId: string;
  accountId: string;
  bucketName: string;
  secretAccessKey: string;
} {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucketName = env.R2_BUCKET_NAME?.trim();

  if (!accessKeyId || !secretAccessKey || !accountId || !bucketName) {
    throw new HttpError(500, "Server is missing R2 credentials.");
  }

  return { accessKeyId, accountId, bucketName, secretAccessKey };
}
