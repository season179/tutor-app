import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/modules/sessions/memory-session-store.js";
import {
  handleExtractQuestionRequest,
  handleUploadUrlRequest
} from "../dist/modules/problems/problem-context-handler.js";
import {
  createProblemImageObjectKey,
  isOwnedProblemImageKey
} from "../dist/modules/problems/problem-image-store.js";
import {
  extractQuestionFromImageUrl,
  normalizeExtractionResponse
} from "../dist/modules/problems/question-extraction-service.js";
import type { RequestContext } from "../src/core/request-context.ts";

const ownerKey = "user-a";
const context: RequestContext = {
  identity: { userId: ownerKey },
  ownerKey
};

const r2Env = {
  OPENAI_API_KEY: "test-key",
  OPENAI_VISION_MODEL: "gpt-5.5",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_ACCOUNT_ID: "test-account",
  R2_BUCKET_NAME: "ai-tutor-problem-images",
  R2_SECRET_ACCESS_KEY: "test-secret-key"
};

const fullExtractionPayload = {
  confidence: "high" as const,
  diagramDescription: null,
  extractedText: "What is the value of x?",
  languageIsSubject: false,
  likelySkillKeys: [],
  notes: null,
  outcome: "extracted" as const,
  problemType: "equation" as const,
  quantities: [],
  question: "What is the value of x?",
  relationships: [],
  taskLanguage: "en",
  unknownTarget: "the value of x"
};

test("createProblemImageObjectKey scopes keys to session", () => {
  const objectKey = createProblemImageObjectKey("session-1");

  assert.ok(objectKey.startsWith("session-1/"));
  assert.ok(objectKey.endsWith(".jpg"));
  assert.equal(isOwnedProblemImageKey(objectKey, "session-1"), true);
  assert.equal(isOwnedProblemImageKey(objectKey, "other-session"), false);
});

test("isOwnedProblemImageKey accepts legacy owner-scoped keys", () => {
  const legacyKey = "user-a/session-1/legacy-image.jpg";

  assert.equal(isOwnedProblemImageKey(legacyKey, "session-1"), true);
  assert.equal(isOwnedProblemImageKey(legacyKey, "other-session"), false);
});

test("handleUploadUrlRequest returns a scoped object key for owned sessions", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Algebra" });

  const response = await handleUploadUrlRequest(
    {
      bytes: 120_000,
      contentType: "image/jpeg",
      sessionId: session.id
    },
    r2Env,
    store,
    context
  );

  assert.ok(response.uploadUrl.includes("ai-tutor-problem-images"));
  assert.ok(isOwnedProblemImageKey(response.objectKey, session.id));
  assert.ok(response.expiresAt);
});

test("handleExtractQuestionRequest rejects object keys from another session", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Algebra" });
  const foreignKey = createProblemImageObjectKey("other-session");

  await assert.rejects(
    () =>
      handleExtractQuestionRequest(
        {
          objectKey: foreignKey,
          sessionId: session.id
        },
        r2Env,
        store,
        context
      ),
    (error: Error) => {
      assert.match(error.message, /access denied/i);
      return true;
    }
  );
});

test("handleExtractQuestionRequest sends an R2 URL to OpenAI and parses the question", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Algebra" });
  const objectKey = createProblemImageObjectKey(session.id);

  const originalFetch = globalThis.fetch;
  let openAiBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("r2.cloudflarestorage.com")) {
      return new Response(null, { status: 200 });
    }

    if (url === "https://api.openai.com/v1/responses") {
      openAiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        output_text: JSON.stringify(fullExtractionPayload)
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleExtractQuestionRequest(
      {
        objectKey,
        sessionId: session.id
      },
      r2Env,
      store,
      context
    );

    assert.equal(response.question, "What is the value of x?");
    assert.equal(response.confidence, "high");
    assert.equal(response.outcome, "extracted");
    assert.equal(response.requiresConfirmation, true);

    const input = openAiBody?.input as Array<{ content: Array<Record<string, string>> }>;
    const imagePart = input[0]?.content.find((part) => part.type === "input_image");
    assert.ok(imagePart?.image_url?.includes("r2.cloudflarestorage.com"));
    assert.equal(imagePart.image_url.startsWith("data:"), false);

    const updated = await store.getSession(ownerKey, session.id);
    assert.equal(updated?.session.imageObjectKey, objectKey);
    assert.equal(updated?.session.imagePrompt, "What is the value of x?");
    assert.equal(updated?.session.extractionOutcome, "extracted");
    assert.equal(updated?.session.promptConfirmed, false);
    assert.equal(updated?.session.gateStatus, "needs_context_read");
    assert.equal(updated?.problemContext?.unknownTarget, "the value of x");

    const extractedEvent = updated?.events.find((event) => event.message === "Question extracted");
    assert.ok(extractedEvent);
    // The event must surface the actual extracted text so bad extractions are troubleshootable
    // from the session log alone, without re-running vision or hitting the DB.
    const eventValue = extractedEvent.value as {
      question: string;
      extractedText: string;
      questionLength: number;
    };
    assert.equal(eventValue.question, "What is the value of x?");
    assert.equal(eventValue.extractedText, "What is the value of x?");
    assert.equal(eventValue.questionLength, "What is the value of x?".length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractQuestionFromImageUrl handles low-confidence empty questions", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({
        output_text: JSON.stringify({
          ...fullExtractionPayload,
          confidence: "low",
          extractedText: "",
          notes: "No readable question was visible.",
          outcome: "none",
          question: "",
          unknownTarget: null
        })
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await extractQuestionFromImageUrl("https://example.com/problem.jpg", r2Env);

    assert.equal(response.confidence, "low");
    assert.equal(response.question, "");
    assert.equal(response.outcome, "none");
    assert.equal(response.notes, "No readable question was visible.");
    assert.equal(response.requiresConfirmation, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizeExtractionResponse never returns extracted for empty questions", () => {
  const normalized = normalizeExtractionResponse({
    ...fullExtractionPayload,
    question: "   ",
    extractedText: "   ",
    unknownTarget: null
  });

  assert.equal(normalized.outcome, "none");
});

test("handleExtractQuestionRequest persists partial extraction metadata", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Algebra" });
  const objectKey = createProblemImageObjectKey(session.id);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("r2.cloudflarestorage.com")) {
      return new Response(null, { status: 200 });
    }

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({
        output_text: JSON.stringify({
          ...fullExtractionPayload,
          confidence: "medium",
          extractedText: "Find the area of the triangle.",
          notes: "Bottom of the page was cut off.",
          outcome: "partial",
          problemType: "geometry",
          question: "Find the area of the triangle.",
          unknownTarget: "the area of the triangle"
        })
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleExtractQuestionRequest(
      {
        objectKey,
        sessionId: session.id
      },
      r2Env,
      store,
      context
    );

    assert.equal(response.outcome, "partial");
    const updated = await store.getSession(ownerKey, session.id);
    assert.equal(updated?.session.extractionOutcome, "partial");
    assert.equal(updated?.session.extractionNotes, "Bottom of the page was cut off.");
    assert.equal(updated?.session.promptConfirmed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
