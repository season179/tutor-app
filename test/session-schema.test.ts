import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSessionEventRequestSchema,
  createTutorSessionRequestSchema,
  parseCreateTutorSessionRequest,
  parseUpdateTutorSessionRequest,
  updateTutorSessionRequestSchema
} from "../dist/modules/sessions/session-schema.js";

test("createTutorSessionRequestSchema accepts an empty object", () => {
  assert.deepEqual(createTutorSessionRequestSchema.parse({}), {});
});

test("createTutorSessionRequestSchema accepts a title", () => {
  assert.deepEqual(createTutorSessionRequestSchema.parse({ title: "Algebra help" }), {
    title: "Algebra help"
  });
});

test("parseCreateTutorSessionRequest omits undefined optional fields", () => {
  assert.deepEqual(parseCreateTutorSessionRequest({ title: undefined }), {});
});

test("updateTutorSessionRequestSchema requires at least one field", () => {
  assert.equal(updateTutorSessionRequestSchema.safeParse({}).success, false);
});

test("updateTutorSessionRequestSchema accepts status updates", () => {
  assert.deepEqual(updateTutorSessionRequestSchema.parse({ status: "active" }), {
    status: "active"
  });
});

test("parseUpdateTutorSessionRequest omits undefined optional fields", () => {
  assert.deepEqual(parseUpdateTutorSessionRequest({ title: undefined, status: "active" }), {
    status: "active"
  });
});

test("updateTutorSessionRequestSchema accepts extraction metadata", () => {
  assert.deepEqual(
    updateTutorSessionRequestSchema.parse({
      extractionNotes: "Bottom cut off.",
      extractionOutcome: "partial",
      promptConfirmed: true
    }),
    {
      extractionNotes: "Bottom cut off.",
      extractionOutcome: "partial",
      promptConfirmed: true
    }
  );
});

test("appendSessionEventRequestSchema requires a message", () => {
  assert.equal(appendSessionEventRequestSchema.safeParse({}).success, false);
  assert.deepEqual(appendSessionEventRequestSchema.parse({ message: "Voice session connected" }), {
    message: "Voice session connected"
  });
});
