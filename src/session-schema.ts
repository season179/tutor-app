import { z } from "zod";

import { extractionOutcomes } from "./problem-context/problem-context-types.js";
import { problemTypes } from "./problem-context/problem-frame.js";
import { comprehensionGateStatuses, sessionPhases } from "./tutor-action.js";
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
import { parseObjectWithSchema } from "./schema-parser.js";

const tutorSessionStatusSchema = z.enum(["draft", "active", "ended"]) satisfies z.ZodType<TutorSessionStatus>;

const sessionImageMetaSchema = z.object({
  bytes: z.number().int().nonnegative(),
  height: z.number().int().positive(),
  width: z.number().int().positive()
}) satisfies z.ZodType<SessionImageMeta>;

export const createTutorSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

const extractionOutcomeSchema = z.enum(extractionOutcomes);

export const updateTutorSessionRequestSchema = z
  .object({
    extractionNotes: z.string().max(2_000).nullable().optional(),
    extractionOutcome: extractionOutcomeSchema.nullable().optional(),
    gateStatus: z.enum(comprehensionGateStatuses).nullable().optional(),
    imageMeta: sessionImageMetaSchema.nullable().optional(),
    imageName: z.string().trim().min(1).max(255).nullable().optional(),
    imageObjectKey: z.string().trim().min(1).max(512).nullable().optional(),
    imagePrompt: z.string().max(4_000).nullable().optional(),
    promptConfirmed: z.boolean().optional(),
    status: tutorSessionStatusSchema.optional(),
    title: z.string().trim().min(1).max(120).optional()
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
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
  activeStep: z
    .object({
      ask: z.string(),
      defaultWrongNudge: z.string(),
      distractorNudges: z.record(z.string(), z.string()),
      expectedAnswers: z.array(z.number()),
      scaffoldAid: z.string()
    })
    .nullable(),
  currentPhase: z.enum(sessionPhases),
  extractionNotes: z.string().nullable(),
  extractionOutcome: extractionOutcomeSchema.nullable(),
  gateStatus: z.enum(comprehensionGateStatuses).nullable(),
  imageMeta: sessionImageMetaSchema.nullable(),
  imageName: z.string().nullable(),
  imageObjectKey: z.string().nullable(),
  imagePrompt: z.string().nullable(),
  ownerKey: z.string().min(1),
  promptConfirmed: z.boolean(),
  supportLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
}) satisfies z.ZodType<TutorSessionRecord>;

const sessionEventRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.number().int().positive(),
  message: z.string().min(1),
  sessionId: z.string().min(1),
  value: z.unknown()
}) satisfies z.ZodType<SessionEventRecord>;

const problemContextRecordSchema = z.object({
  confirmedQuestion: z.string().nullable(),
  createdAt: z.string().min(1),
  diagramDescription: z.string().nullable(),
  extractedText: z.string(),
  extractionConfidence: z.enum(["high", "medium", "low"]).nullable(),
  extractionOutcome: extractionOutcomeSchema,
  id: z.string().min(1),
  languageIsSubject: z.boolean(),
  likelySkillKeys: z.array(z.string()),
  problemType: z.enum(problemTypes),
  quantities: z.array(
    z
      .object({
        label: z.string(),
        raw: z.string(),
        unit: z.string()
      })
      .partial({ unit: true })
  ),
  r2ObjectKey: z.string().nullable(),
  relationships: z.array(z.string()),
  sessionId: z.string().min(1),
  taskLanguage: z.string(),
  unknownTarget: z.string().nullable(),
  updatedAt: z.string().min(1),
  visibleQuestion: z.string()
});

export const tutorSessionDetailSchema = z.object({
  events: z.array(sessionEventRecordSchema),
  problemContext: problemContextRecordSchema.nullable(),
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
  return parseObjectWithSchema(schema, value, {
    invalid: `${label} was invalid.`,
    notObject: `${label} must be a JSON object.`
  });
}

function omitUndefinedProperties<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}
