import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../dist/core/http-error.js";
import { parseCreateVoiceSessionRequest } from "../dist/modules/voice/voice-session-handler.js";

test("parseCreateVoiceSessionRequest accepts tutor intent with sessionId", () => {
  assert.deepEqual(parseCreateVoiceSessionRequest({ intent: "tutor", sessionId: "session-123" }), {
    intent: "tutor",
    sessionId: "session-123"
  });
});

test("parseCreateVoiceSessionRequest trims sessionId", () => {
  assert.deepEqual(parseCreateVoiceSessionRequest({ intent: "tutor", sessionId: "  session-123  " }), {
    intent: "tutor",
    sessionId: "session-123"
  });
});

test("parseCreateVoiceSessionRequest rejects missing sessionId", () => {
  assert.throws(() => parseCreateVoiceSessionRequest({ intent: "tutor" }), HttpError);
});

test("parseCreateVoiceSessionRequest rejects unsupported intent", () => {
  assert.throws(
    () => parseCreateVoiceSessionRequest({ intent: "other", sessionId: "session-123" }),
    HttpError
  );
});
