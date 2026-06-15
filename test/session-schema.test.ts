import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSessionEventRequestSchema,
  createTutorSessionRequestSchema,
  updateTutorSessionRequestSchema
} from "../src/session-schema.ts";

test("createTutorSessionRequestSchema accepts an empty object", () => {
  assert.deepEqual(createTutorSessionRequestSchema.parse({}), {});
});

test("createTutorSessionRequestSchema accepts a title", () => {
  assert.deepEqual(createTutorSessionRequestSchema.parse({ title: "Algebra help" }), {
    title: "Algebra help"
  });
});

test("updateTutorSessionRequestSchema requires at least one field", () => {
  assert.equal(updateTutorSessionRequestSchema.safeParse({}).success, false);
});

test("updateTutorSessionRequestSchema accepts status updates", () => {
  assert.deepEqual(updateTutorSessionRequestSchema.parse({ status: "active" }), {
    status: "active"
  });
});

test("appendSessionEventRequestSchema requires a message", () => {
  assert.equal(appendSessionEventRequestSchema.safeParse({}).success, false);
  assert.deepEqual(appendSessionEventRequestSchema.parse({ message: "Voice session connected" }), {
    message: "Voice session connected"
  });
});
