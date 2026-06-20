import type {
  ExtractQuestionResponse,
  PreviewUrlResponse,
  UploadUrlResponse
} from "../../modules/problems/problem-context-types.js";
import {
  problemContextExtractQuestionPath,
  problemContextPreviewUrlPath,
  problemContextUploadUrlPath
} from "../../modules/problems/problem-context-types.js";
import { jsonRequestInit } from "./json-request.js";
import { readJsonResponse } from "./read-json-response.js";

export async function requestProblemImageUploadUrl(
  sessionId: string,
  contentType: string,
  bytes: number
): Promise<UploadUrlResponse> {
  let response: Response;

  try {
    response = await fetch(
      problemContextUploadUrlPath,
      jsonRequestInit("POST", { bytes, contentType, sessionId })
    );
  } catch (error) {
    throw new Error("Could not reach the app server. Try restarting `pnpm dev`.", { cause: error });
  }

  return readJsonResponse<UploadUrlResponse>(
    response,
    (_status, message) => new Error(message),
    (status) => `Failed to create upload URL (${status}).`,
    "Upload URL response was not valid JSON."
  );
}

export async function uploadProblemImageToR2(
  uploadUrl: string,
  blob: Blob,
  contentType: string
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(uploadUrl, {
      body: blob,
      headers: {
        "Content-Length": String(blob.size),
        "Content-Type": contentType
      },
      method: "PUT"
    });
  } catch (error) {
    throw new Error(
      "Could not upload the image to storage. This is often a bucket CORS issue for direct browser uploads.",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to upload problem image (${response.status}).`);
  }
}

export async function extractProblemQuestion(
  sessionId: string,
  objectKey: string
): Promise<ExtractQuestionResponse> {
  let response: Response;

  try {
    response = await fetch(
      problemContextExtractQuestionPath,
      jsonRequestInit("POST", { objectKey, sessionId })
    );
  } catch (error) {
    throw new Error("Could not reach the app server. Try restarting `pnpm dev`.", { cause: error });
  }

  return readJsonResponse<ExtractQuestionResponse>(
    response,
    (_status, message) => new Error(message),
    (status) => `Failed to extract question (${status}).`,
    "Extract question response was not valid JSON."
  );
}

export async function requestProblemImagePreviewUrl(
  sessionId: string,
  objectKey: string
): Promise<PreviewUrlResponse> {
  const response = await fetch(
    problemContextPreviewUrlPath,
    jsonRequestInit("POST", { objectKey, sessionId })
  );

  return readJsonResponse<PreviewUrlResponse>(
    response,
    (_status, message) => new Error(message),
    (status) => `Failed to create preview URL (${status}).`,
    "Preview URL response was not valid JSON."
  );
}
