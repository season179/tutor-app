import { z } from "zod";

import { parseObjectWithSchema } from "../schema-parser.js";
import {
  extractionOutcomes,
  maxProblemImageBytes,
  type ExtractQuestionRequest,
  type ExtractQuestionResponse,
  type PreviewUrlRequest,
  type PreviewUrlResponse,
  type UploadUrlRequest,
  type UploadUrlResponse
} from "./problem-context-types.js";

const allowedImageContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export const uploadUrlRequestSchema = z.object({
  bytes: z.number().int().positive().max(maxProblemImageBytes),
  contentType: z.enum(allowedImageContentTypes),
  sessionId: z.string().trim().min(1)
}) satisfies z.ZodType<UploadUrlRequest>;

export const extractQuestionRequestSchema = z.object({
  objectKey: z.string().trim().min(1).max(512),
  sessionId: z.string().trim().min(1)
}) satisfies z.ZodType<ExtractQuestionRequest>;

export const previewUrlRequestSchema = z.object({
  objectKey: z.string().trim().min(1).max(512),
  sessionId: z.string().trim().min(1)
}) satisfies z.ZodType<PreviewUrlRequest>;

export const extractQuestionResponseSchema = z.object({
  confidence: z.enum(["high", "low", "medium"]),
  notes: z.string().nullable(),
  outcome: z.enum(extractionOutcomes),
  question: z.string(),
  requiresConfirmation: z.boolean()
}) satisfies z.ZodType<ExtractQuestionResponse>;

export const uploadUrlResponseSchema = z.object({
  expiresAt: z.string().min(1),
  objectKey: z.string().min(1),
  uploadUrl: z.string().url()
}) satisfies z.ZodType<UploadUrlResponse>;

export const previewUrlResponseSchema = z.object({
  expiresAt: z.string().min(1),
  url: z.string().url()
}) satisfies z.ZodType<PreviewUrlResponse>;

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  return parseObjectWithSchema(schema, value, {
    invalid: `${label} was invalid.`,
    notObject: `${label} must be a JSON object.`
  });
}

export function parseUploadUrlRequest(value: unknown): UploadUrlRequest {
  return parseWithSchema(uploadUrlRequestSchema, value, "Upload URL request");
}

export function parseExtractQuestionRequest(value: unknown): ExtractQuestionRequest {
  return parseWithSchema(extractQuestionRequestSchema, value, "Extract question request");
}

export function parsePreviewUrlRequest(value: unknown): PreviewUrlRequest {
  return parseWithSchema(previewUrlRequestSchema, value, "Preview URL request");
}
