import assert from "node:assert/strict";

import { MemorySessionStore } from "../src/modules/sessions/memory-session-store.ts";
import {
  handleExtractQuestionRequest,
  handleUploadUrlRequest
} from "../src/modules/problems/problem-context-handler.ts";
import {
  createProblemImageObjectKey,
  isOwnedProblemImageKey
} from "../src/modules/problems/problem-image-store.ts";
import {
  extractQuestionFromImageUrl,
  normalizeExtractionResponse
} from "../src/modules/problems/question-extraction-service.ts";
import type { RequestContext } from "../src/core/request-context.ts";
import { settingsD1Stub } from "./helpers/voice-fixtures.ts";

const ownerKey = "user-a";
const context: RequestContext = {
  identity: { userId: ownerKey },
  ownerKey
};

// Extraction now crosses the REASONING binding; each test installs a binding fake and
// threads it onto r2Env via withBinding(). R2 credentials stay for presigning. DB is the
// settings stub the extraction path reads the model snapshot from.
const r2BaseEnv = {
  DB: settingsD1Stub,
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_ACCOUNT_ID: "test-account",
  R2_BUCKET_NAME: "ai-tutor-problem-images",
  R2_SECRET_ACCESS_KEY: "test-secret-key"
};

function withBinding(reasoning: Fetcher) {
  return { ...r2BaseEnv, REASONING: reasoning };
}

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
    r2BaseEnv,
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
        r2BaseEnv,
        store,
        context
      ),
    (error: Error) => {
      assert.match(error.message, /access denied/i);
      return true;
    }
  );
});

test("handleExtractQuestionRequest sends the R2 URL over the binding and parses the question", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Algebra" });
  const objectKey = createProblemImageObjectKey(session.id);

  // R2 HEAD (existence) still goes through globalThis.fetch; the extraction crosses the binding.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("r2.cloudflarestorage.com")) {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  let workflowPayload: { imageUrl?: string; input?: string } | undefined;
  const bindingFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/extract-question")) {
      workflowPayload = JSON.parse(String(init?.body)) as typeof workflowPayload;
      return Response.json(fullExtractionPayload);
    }
    throw new Error(`unexpected REASONING fetch: ${url}`);
  }) as Fetcher["fetch"];

  try {
    const response = await handleExtractQuestionRequest(
      {
        objectKey,
        sessionId: session.id
      },
      withBinding({ fetch: bindingFetch } as Fetcher),
      store,
      context
    );

    assert.equal(response.question, "What is the value of x?");
    assert.equal(response.confidence, "high");
    assert.equal(response.outcome, "extracted");
    assert.equal(response.requiresConfirmation, true);

    // The R2 read URL rides the workflow payload's imageUrl field (Worker B fetches the bytes).
    assert.ok(workflowPayload?.imageUrl?.includes("r2.cloudflarestorage.com"));
    assert.equal(workflowPayload!.imageUrl!.startsWith("data:"), false);

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
  const bindingFetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/extract-question")) {
      return Response.json({
        ...fullExtractionPayload,
        confidence: "low",
        extractedText: "",
        notes: "No readable question was visible.",
        outcome: "none",
        question: "",
        unknownTarget: null
      });
    }
    throw new Error(`unexpected REASONING fetch: ${url}`);
  }) as Fetcher["fetch"];

  const response = await extractQuestionFromImageUrl(
    "https://example.com/problem.jpg",
    withBinding({ fetch: bindingFetch } as Fetcher)
  );

  assert.equal(response.confidence, "low");
  assert.equal(response.question, "");
  assert.equal(response.outcome, "none");
  assert.equal(response.notes, "No readable question was visible.");
  assert.equal(response.requiresConfirmation, true);
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

  // R2 HEAD via fetch; extraction via the binding.
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("r2.cloudflarestorage.com")) {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const bindingFetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/extract-question")) {
      return Response.json({
        ...fullExtractionPayload,
        confidence: "medium",
        extractedText: "Find the area of the triangle.",
        notes: "Bottom of the page was cut off.",
        outcome: "partial",
        problemType: "geometry",
        question: "Find the area of the triangle.",
        unknownTarget: "the area of the triangle"
      });
    }
    throw new Error(`unexpected REASONING fetch: ${url}`);
  }) as Fetcher["fetch"];

  try {
    const response = await handleExtractQuestionRequest(
      {
        objectKey,
        sessionId: session.id
      },
      withBinding({ fetch: bindingFetch } as Fetcher),
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
