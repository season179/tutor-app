import type { z } from "zod";

type ParseObjectMessages = {
  invalid: string;
  notObject: string;
};

export function parseObjectWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  messages: ParseObjectMessages
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(messages.notObject);
  }

  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(messages.invalid);
  }

  return result.data;
}
