/**
 * OpenAI wire conformance — Tier 2.
 *
 * Deliberately provider-specific (§7b). These are the only tests that name the OpenAI
 * wire shape: they assert (a) that our adapter reads the OpenAI `output[].content[].text`
 * fallback when `output_text` is absent, mirroring `extractOutputText`, and (b) that the
 * adapter encodes a multipart transcription body and a JSON tutor prompt the way the
 * OpenAI Responses/Audio API expects. On a provider swap you rewrite only this file.
 *
 * These tests install a raw `fetch` double of their own — they assert on wire shapes the
 * domain harness deliberately hides, so they stand apart from `fake-voice-providers`.
 */

import assert from "node:assert/strict";

import { extractOutputText } from "../../src/providers/openai/openai-responses.ts";
import { MemorySessionStore } from "../../src/modules/sessions/memory-session-store.ts";
import { handleVoicePipelineTurnWithStore } from "../../src/modules/voice/voice-pipeline-service.ts";
import {
  context,
  ownerKey,
  problemImage,
  seedKickoffSession,
  sharingFrame,
  voiceServiceEnv
} from "../helpers/voice-fixtures.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Response parsing: the output-content fallback
//
// These three unit tests exercise the SHARED `extractOutputText` in
// `src/providers/openai/openai-responses.ts`, which `gate-checker.ts` and
// `verifier-agent.ts` import. NOTE: `voice-pipeline-service.ts` currently carries its
// OWN private copy of the same function (called from its tutor-generator path), so these
// unit tests do not directly cover the pipeline's copy — only the integration test below
// ("the pipeline reads a tutor action out of the output-content fallback shape") does,
// end-to-end. The two copies are identical today; collapsing them is a production cleanup
// that belongs to the later provider ADR (out of scope per plan §13). If you edit one
// copy, the other must follow, and this test will not catch a pipeline-only divergence.
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

test("the pipeline reads a tutor action out of the output-content fallback shape", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  await seedKickoffSession(store, session.id);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Hi! Let's read this together — ready?"
  };

  const originalFetch = globalThis.fetch;
  // Only kickoff: the move generator fires exactly once and its response carries the
  // output-content (not output_text) shape, exercising the adapter's fallback parse.
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/v1/responses")) {
      return Response.json({
        output: [
          {
            content: [{ text: JSON.stringify(action), type: "output_text" }],
            role: "assistant",
            type: "message"
          }
        ]
      });
    }
    if (url.endsWith("/v1/audio/speech")) {
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { kickoff: true, sessionId: session.id },
      voiceServiceEnv,
      store,
      context
    );

    assert.equal(response.tutorText, action.spokenUtterance);
    assert.deepEqual(response.lesson, {
      phase: "orient",
      spokenUtterance: action.spokenUtterance,
      studentStatus: "unknown",
      tutorAction: "orient"
    });
    assert.equal(response.session.currentPhase, "frame_task");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Request encoding: how the adapter shapes the OpenAI requests
// ──────────────────────────────────────────────────────────────────────────────

test("transcription is encoded as multipart form data with the audio blob", async () => {
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

  const originalFetch = globalThis.fetch;
  let transcribeBody: FormData | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/v1/audio/transcriptions")) {
      assert.ok(init?.body instanceof FormData, "transcription body must be multipart form data");
      transcribeBody = init.body as FormData;
      return Response.json({ text: "What the student said." });
    }
    if (url.endsWith("/v1/responses")) {
      if (isGateCheckerBody(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: true, notes: null }) });
      }
      return Response.json({
        output_text: JSON.stringify({
          move: "three_reads_1",
          nextPhase: "frame_task",
          spokenUtterance: "Read it once — what's happening?"
        })
      });
    }
    if (url.endsWith("/v1/audio/speech")) {
      return new Response(new Uint8Array([1]));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

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
      voiceServiceEnv,
      store,
      context
    );

    assert.ok(transcribeBody);
    const audioFile = transcribeBody!.get("file");
    assert.ok(audioFile instanceof Blob);
    // The adapter parses the data URL's media type and strips any parameter suffix
    // (codecs=opus) — the blob carries the bare media type.
    assert.equal((audioFile as Blob).type, "audio/webm");
    // The adapter asks for the JSON response format, not verbose text.
    assert.equal(transcribeBody!.get("response_format"), "json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Tier-2 tests need to tell a gate-checker /responses call from a tutor /responses call
// (same URL). The OpenAI wire distinguishes them by the `instructions` preamble marker;
// that marker is what the harness's own router sniffs, and it's fair game here.
function isGateCheckerBody(init?: RequestInit): boolean {
  if (typeof init?.body !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(init.body) as { instructions?: string };
    return Boolean(parsed.instructions?.includes("comprehension-gate checker"));
  } catch {
    return false;
  }
}

test("the tutor prompt carries the student utterance in the JSON input field", async () => {
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
  const originalFetch = globalThis.fetch;
  let capturedTutorInput: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/v1/responses")) {
      if (isGateCheckerBody(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: true, notes: null }) });
      }
      const body = JSON.parse(String(init?.body)) as { input?: Array<{ content?: Array<{ text?: unknown }> }> };
      const text = body.input?.[0]?.content?.[0]?.text;
      if (typeof text === "string") {
        capturedTutorInput = text;
      }
      return Response.json({
        output_text: JSON.stringify({
          move: "three_reads_1",
          nextPhase: "frame_task",
          spokenUtterance: "What's this problem about?"
        })
      });
    }
    if (url.endsWith("/v1/audio/speech")) {
      return new Response(new Uint8Array([1]));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: utterance },
      voiceServiceEnv,
      store,
      context
    );

    assert.ok(capturedTutorInput);
    assert.ok(capturedTutorInput!.includes(utterance));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an image turn embeds the image data URL in the tutor input content", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Image encoding" });

  const originalFetch = globalThis.fetch;
  let capturedImage: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/v1/responses")) {
      const body = JSON.parse(String(init?.body)) as {
        input?: Array<{ content?: Array<{ image_url?: unknown; type?: string }> }>;
      };
      const imagePart = body.input?.[0]?.content?.find((part) => part.type === "input_image");
      if (imagePart && typeof imagePart.image_url === "string") {
        capturedImage = imagePart.image_url;
      }
      return Response.json({
        output_text: JSON.stringify({
          move: "rapport_check",
          nextPhase: "frame_task",
          spokenUtterance: "Let's look at this together."
        })
      });
    }
    if (url.endsWith("/v1/audio/speech")) {
      return new Response(new Uint8Array([1]));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "Help me understand this problem." },
      voiceServiceEnv,
      store,
      context
    );

    assert.equal(capturedImage, problemImage.dataUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
