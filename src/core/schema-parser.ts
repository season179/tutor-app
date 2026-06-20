import type { z } from "zod";

type ParseObjectMessages = {
  invalid: string;
  notObject: string;
};

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseObjectWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  messages: ParseObjectMessages
): T {
  if (!isJsonObject(value)) {
    throw new Error(messages.notObject);
  }

  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(messages.invalid);
  }

  return result.data;
}
