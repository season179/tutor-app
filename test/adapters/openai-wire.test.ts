/**
 * OpenAI wire + reasoning-binding conformance — Tier 2.
 *
 * Deliberately provider/transport-specific. Two concerns:
 *  (a) The shared `extractOutputText` parser (`src/providers/openai/openai-responses.ts`),
 *      which the tutor path still uses to unwrap the synthetic `{ output_text }` envelope the
 *      binding helper returns.
 *  (b) Wire shapes that still live in Worker A: STT's multipart transcription body, and the
 *      tutor prompt content / image attachment as they cross the REASONING binding.
 *
 * The reasoning stages themselves no longer touch the OpenAI wire (they cross the binding);
 * the integration tests below assert the prompt content + image ride the workflow payload.
 */

import assert from "node:assert/strict";

import { extractOutputText } from "../../src/providers/openai/openai-responses.ts";
import { MemorySessionStore } from "../../src/modules/sessions/memory-session-store.ts";
import { handleVoicePipelineTurnWithStore } from "../../src/modules/voice/voice-pipeline-service.ts";
import { installVoiceProviders, makeOpenAiProviderFake, type VoiceProviderFake } from "../helpers/fake-voice-providers.ts";
import {
  context,
  ownerKey,
  problemImage,
  seedKickoffSession,
  sharingFrame,
  voiceServiceEnv
} from "../helpers/voice-fixtures.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Response parsing: extractOutputText (still used by the tutor path's synthetic envelope)
// ──────────────────────────────────────────────────────────────────────────────

test("extractOutputText prefers the top-level output_text when present", () => {
  assert.equal(extractOutputText({ output_text: "hello" }), "hello");
});

test("extractOutputText falls back to output[].content[].text joined by newlines", () => {
  assert.equal(
    extractOutputText({
      output: [
        {
          content: [
            { text: "first", type: "output_text" },
            { text: "second", type: "output_text" }
          ],
          role: "assistant",
          type: "message"
        }
      ]
    }),
    "first\nsecond"
  );
});

test("extractOutputText returns empty string when no text is present anywhere", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ type: "output_text" }] }] }), "");
  assert.equal(extractOutputText({ unrelated: true }), "");
});

// ──────────────────────────────────────────────────────────────────────────────
// Request encoding: STT multipart (fetch transport) + tutor prompt/image (binding)
//
// The reasoning stages cross the REASONING binding; STT stays on globalThis.fetch.
// These install the harness fake so both transports are exercised in one turn.
// ──────────────────────────────────────────────────────────────────────────────

let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

test("transcription is encoded as multipart form data with the audio blob", async () => {
  // STT + TTS stay on globalThis.fetch; the reasoning stages cross the binding. To assert
  // the raw STT multipart shape (which the domain harness hides), this test sets its OWN
  // globalThis.fetch for STT/TTS and builds the reasoning binding fake WITHOUT installing
  // it as globalThis.fetch (so the two don't fight over globalThis.fetch).
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Audio encoding" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });

  let transcribeBody: FormData | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/v1/audio/transcriptions")) {
      assert.ok(init?.body instanceof FormData, "transcription body must be multipart form data");
      transcribeBody = init.body as FormData;
      return Response.json({ text: "What the student said." });
    }
    if (url.endsWith("/v1/audio/speech")) {
      return new Response(new Uint8Array([1]));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  // Build (do NOT install) the provider fake so its `reasoning` Fetcher serves gate/tutor
  // over the binding while globalThis.fetch stays this test's STT/TTS double.
  const providerFake = makeOpenAiProviderFake({
    gateChecker: { accepted: true, notes: null },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "Read it once." }
  });
  const env = { ...voiceServiceEnv, REASONING: providerFake.reasoning };

  try {
    await handleVoicePipelineTurnWithStore(
      {
        audio: {
          dataUrl: "data:audio/webm;codecs=opus;base64,AQIDBA==",
          mimeType: "audio/webm;codecs=opus",
          name: "student-turn.webm",
          size: 4
        },
        sessionId: session.id
      },
      env,
      store,
      context
    );

    assert.ok(transcribeBody);
    const audioFile = transcribeBody!.get("file");
    assert.ok(audioFile instanceof Blob);
    // The adapter parses the data URL's media type and strips any parameter suffix.
    assert.equal((audioFile as Blob).type, "audio/webm");
    assert.equal(transcribeBody!.get("response_format"), "json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the tutor prompt over the binding carries the student utterance", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Tutor encoding" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });

  const utterance = "I think we share the stickers out equally.";
  fake = installVoiceProviders({
    gateChecker: { accepted: true, notes: null },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "What's this problem about?" },
    tts: new Uint8Array([1])
  });

  await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: utterance },
    voiceServiceEnv,
    store,
    context
  );

  const tutorInput = fake.calls.workflowInputs("tutor")[0] ?? "";
  assert.ok(tutorInput.includes(utterance), "the student utterance must travel in the workflow input");
});

test("an image turn embeds the image (as PromptImage fields) in the tutor binding payload", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Image encoding" });

  // Capture the raw workflow payload to inspect the image field directly (the harness hides
  // wire shape; this Tier-2 test looks at it on purpose).
  let capturedImage: { type?: string; data?: string; mimeType?: string } | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/tutor-turn")) {
      const body = JSON.parse(String(init?.body)) as { image?: typeof capturedImage };
      capturedImage = body.image ?? null;
      return Response.json({ move: "rapport_check", nextPhase: "frame_task", spokenUtterance: "Let's look." });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as Fetcher["fetch"];

  fake = installVoiceProviders({ tts: new Uint8Array([1]) });
  // Override the tutor binding to capture the image; reuse the installed fake's fetch for the
  // other stages by routing through one Fetcher.
  const imageCaptureBinding = { fetch: fetchImpl } as Fetcher;
  const env = { ...voiceServiceEnv, REASONING: imageCaptureBinding };

  await handleVoicePipelineTurnWithStore(
    { image: problemImage, sessionId: session.id, text: "Help me understand this problem." },
    env,
    store,
    context
  );

  assert.ok(capturedImage, "the tutor workflow payload must carry the image");
  assert.equal(capturedImage!.type, "image");
  assert.equal(capturedImage!.mimeType, "image/jpeg");
  // The data is the base64 portion of the data URL (the prefix is stripped).
  assert.equal(capturedImage!.data, problemImage.dataUrl.split(",")[1]);
});
