import { z } from "zod";

import type {
  AppendSessionEventRequest,
  CreateTutorSessionRequest,
  SessionEventRecord,
  SessionImageMeta,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionStatus,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";

const tutorSessionStatusSchema = z.enum(["draft", "active", "ended"]) satisfies z.ZodType<TutorSessionStatus>;

const sessionImageMetaSchema = z.object({
  bytes: z.number().int().nonnegative(),
  height: z.number().int().positive(),
  width: z.number().int().positive()
}) satisfies z.ZodType<SessionImageMeta>;

export const createTutorSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

export const updateTutorSessionRequestSchema = z
  .object({
    imageMeta: sessionImageMetaSchema.nullable().optional(),
    imageName: z.string().trim().min(1).max(255).nullable().optional(),
    imagePrompt: z.string().max(4_000).nullable().optional(),
    status: tutorSessionStatusSchema.optional(),
    title: z.string().trim().min(1).max(120).optional()
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.status !== undefined ||
      value.imagePrompt !== undefined ||
      value.imageName !== undefined ||
      value.imageMeta !== undefined,
    { message: "At least one field must be provided" }
  );

export const appendSessionEventRequestSchema = z.object({
  message: z.string().trim().min(1).max(500),
  value: z.unknown().optional()
}) satisfies z.ZodType<AppendSessionEventRequest>;

const tutorSessionSummarySchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
  status: tutorSessionStatusSchema,
  title: z.string().min(1),
  updatedAt: z.string().min(1)
}) satisfies z.ZodType<TutorSessionSummary>;

const tutorSessionRecordSchema = tutorSessionSummarySchema.extend({
  imageMeta: sessionImageMetaSchema.nullable(),
  imageName: z.string().nullable(),
  imagePrompt: z.string().nullable(),
  ownerKey: z.string().min(1)
}) satisfies z.ZodType<TutorSessionRecord>;

const sessionEventRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.number().int().positive(),
  message: z.string().min(1),
  sessionId: z.string().min(1),
  value: z.unknown()
}) satisfies z.ZodType<SessionEventRecord>;

export const tutorSessionDetailSchema = z.object({
  events: z.array(sessionEventRecordSchema),
  session: tutorSessionRecordSchema
}) satisfies z.ZodType<TutorSessionDetail>;

export function parseCreateTutorSessionRequest(value: unknown): CreateTutorSessionRequest {
  return omitUndefinedProperties(
    parseWithSchema(createTutorSessionRequestSchema, value, "Create session request")
  ) as CreateTutorSessionRequest;
}

export function parseUpdateTutorSessionRequest(value: unknown): UpdateTutorSessionRequest {
  return omitUndefinedProperties(
    parseWithSchema(updateTutorSessionRequestSchema, value, "Update session request")
  ) as UpdateTutorSessionRequest;
}

export function parseAppendSessionEventRequest(value: unknown): AppendSessionEventRequest {
  return parseWithSchema(appendSessionEventRequestSchema, value, "Append session event request");
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(`${label} was invalid.`);
  }

  return result.data;
}

function omitUndefinedProperties<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}
