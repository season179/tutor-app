import assert from "node:assert/strict";
import test from "node:test";

import {
  parseVoiceSessionDescriptor,
  serializeVoiceSessionDescriptor
} from "../dist/voice-session-schema.js";
import type { OpenAIRealtimeSessionDescriptor } from "../src/voice-types.ts";

const tutorPolicy = {
  agentName: "Tutor",
  defaultImagePrompt: "What do you see in this image?",
  greetingInstructions: "Greet the student warmly.",
  imageResponseInstructions: "Help the student with the problem in the image.",
  instructions: "You are a helpful tutor."
};

const openAISession: OpenAIRealtimeSessionDescriptor = {
  capabilities: {
    audioInput: true,
    audioOutput: true,
    imageInput: true,
    manualReply: true,
    payloadLimitBytes: null
  },
  clientSecret: "ek_test_secret",
  model: "gpt-realtime-2",
  provider: "openai-realtime",
  sessionId: "session-123",
  tutorPolicy,
  voice: "marin"
};

test("parseVoiceSessionDescriptor accepts a valid OpenAI session", () => {
  assert.deepEqual(parseVoiceSessionDescriptor(openAISession), openAISession);
});

test("serializeVoiceSessionDescriptor round-trips a valid OpenAI session", () => {
  assert.deepEqual(serializeVoiceSessionDescriptor(openAISession), openAISession);
});

test("parseVoiceSessionDescriptor rejects non-objects", () => {
  assert.throws(() => parseVoiceSessionDescriptor(null), /JSON object/);
  assert.throws(() => parseVoiceSessionDescriptor([]), /JSON object/);
});

test("parseVoiceSessionDescriptor rejects unsupported provider shapes", () => {
  assert.throws(
    () =>
      parseVoiceSessionDescriptor({
        ...openAISession,
        clientSecret: ""
      }),
    /supported provider shape/
  );
});

test("parseVoiceSessionDescriptor accepts a valid LiveKit session", () => {
  const liveKitSession = {
    agentName: "tutor-agent",
    capabilities: openAISession.capabilities,
    livekitUrl: "wss://example.livekit.cloud",
    participantIdentity: "student-1",
    participantToken: "token-abc",
    provider: "livekit-agents" as const,
    roomName: "tutor-room",
    sessionId: "session-livekit",
    tutorPolicy
  };

  assert.deepEqual(parseVoiceSessionDescriptor(liveKitSession), liveKitSession);
});
