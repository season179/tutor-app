import assert from "node:assert/strict";

import {
  parseVoicePipelineTurnRequest,
  parseVoicePipelineTurnResponse,
  parseVoiceSessionDescriptor,
  serializeVoicePipelineTurnResponse,
  serializeVoiceSessionDescriptor
} from "../src/modules/voice/voice-session-schema.ts";
import type {
  OpenAIVoicePipelineSessionDescriptor,
  VoicePipelineTurnResponse
} from "../src/modules/voice/voice-types.ts";

const tutorPolicy = {
  agentName: "Tutor",
  defaultImagePrompt: "What do you see in this image?",
  greetingInstructions: "Greet the student warmly.",
  imageResponseInstructions: "Help the student with the problem in the image.",
  instructions: "You are a helpful tutor."
};

const openAIPipelineSession: OpenAIVoicePipelineSessionDescriptor = {
  capabilities: {
    audioInput: true,
    audioOutput: true,
    imageInput: true,
    manualReply: true,
    payloadLimitBytes: 8_000_000
  },
  model: "gpt-5.5",
  provider: "openai-voice-pipeline",
  sessionId: "session-123",
  transcribeModel: "gpt-4o-transcribe",
  ttsModel: "gpt-4o-mini-tts",
  tutorPolicy,
  voice: "marin"
};

test("parseVoiceSessionDescriptor accepts a valid OpenAI voice pipeline session", () => {
  assert.deepEqual(parseVoiceSessionDescriptor(openAIPipelineSession), openAIPipelineSession);
});

test("serializeVoiceSessionDescriptor round-trips a valid OpenAI voice pipeline session", () => {
  assert.deepEqual(serializeVoiceSessionDescriptor(openAIPipelineSession), openAIPipelineSession);
});

test("parseVoiceSessionDescriptor rejects non-objects", () => {
  assert.throws(() => parseVoiceSessionDescriptor(null), /JSON object/);
  assert.throws(() => parseVoiceSessionDescriptor([]), /JSON object/);
});

test("parseVoiceSessionDescriptor rejects unsupported provider shapes", () => {
  assert.throws(
    () =>
      parseVoiceSessionDescriptor({
        ...openAIPipelineSession,
        provider: "openai-realtime" as unknown as "openai-voice-pipeline"
      }),
    /supported provider shape/
  );
});

test("parseVoicePipelineTurnRequest accepts a text and image turn", () => {
  const request = {
    image: {
      dataUrl: "data:image/png;base64,abc",
      height: 200,
      mimeType: "image/png",
      name: "problem.png",
      size: 1234,
      width: 300
    },
    sessionId: "session-123",
    text: "Help me with this problem."
  };

  assert.deepEqual(parseVoicePipelineTurnRequest(request), request);
});

test("parseVoicePipelineTurnRequest accepts an audio turn", () => {
  const request = {
    audio: {
      dataUrl: "data:audio/webm;base64,abc",
      mimeType: "audio/webm",
      name: "student-turn.webm",
      size: 4321
    },
    sessionId: "session-123"
  };

  assert.deepEqual(parseVoicePipelineTurnRequest(request), request);
});

test("parseVoicePipelineTurnRequest accepts an audio turn with problem image context", () => {
  const request = {
    audio: {
      dataUrl: "data:audio/webm;base64,abc",
      mimeType: "audio/webm",
      name: "student-turn.webm",
      size: 4321
    },
    image: {
      dataUrl: "data:image/jpeg;base64,abc",
      height: 960,
      mimeType: "image/jpeg",
      name: "problem.jpg",
      size: 112298,
      width: 1280
    },
    sessionId: "session-123"
  };

  assert.deepEqual(parseVoicePipelineTurnRequest(request), request);
});

test("parseVoicePipelineTurnRequest accepts a kickoff turn with no media", () => {
  const request = { kickoff: true, sessionId: "session-123" };

  assert.deepEqual(parseVoicePipelineTurnRequest(request), request);
});

test("parseVoicePipelineTurnRequest rejects an empty turn", () => {
  assert.throws(() => parseVoicePipelineTurnRequest({ sessionId: "session-123", text: "   " }), /invalid/i);
});

test("parseVoicePipelineTurnResponse round-trips tutor turn output", () => {
  const response: VoicePipelineTurnResponse = {
    audio: {
      dataUrl: "data:audio/mpeg;base64,abc",
      mimeType: "audio/mpeg",
      size: 1234
    },
    lesson: {
      phase: "ask_step",
      spokenUtterance: "What is the first number the problem gives you?",
      studentStatus: "unknown",
      tutorAction: "ask"
    },
    session: {
      currentPhase: "plan_first_step",
      focusAsk: "Give each friend 1 sticker first. How many stickers is that?",
      gateStatus: "complete",
      goalStatus: "framed",
      outputLanguageLabel: null,
      scaffoldAid: "4 friends · 1 sticker each",
      studentStatus: "unknown",
      supportLevel: 0,
      unknownTarget: "how many stickers each friend gets"
    },
    transcript: "I see the problem.",
    tutorText: "What is the first number the problem gives you?"
  };

  assert.deepEqual(parseVoicePipelineTurnResponse(response), response);
  assert.deepEqual(serializeVoicePipelineTurnResponse(response), response);
});
