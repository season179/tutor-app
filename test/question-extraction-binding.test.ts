/**
 * extractQuestion (vision) over the REASONING service binding — the Phase 4 "last
 * straggler" migration proof.
 *
 * With the flag on, the vision extraction routes through Worker B's extract-question
 * workflow. Worker A ships the extraction instructions as the workflow `input` and the
 * presigned image URL as `imageUrl`; the workflow fetches the bytes and attaches them as a
 * vision image. Worker A still applies normalizeExtractionResponse (scrub + outcome
 * normalization) to the result.
 *
 * The binding fake here also answers the workflow's image fetch, since Worker B fetches the
 * URL itself (Flue PromptImage needs bytes, not a URL).
 */

import assert from "node:assert/strict";

import { extractQuestionFromImageUrl } from "../src/modules/problems/question-extraction-service.ts";

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

const imageUrl = "https://r2.example.com/session-1/image.jpg";

type FetchCall = { url: string; body?: string };

/**
 * Builds a Fetcher fake that serves the extract-question workflow. (The workflow's own
 * image fetch — `fetchPromptImage` — runs inside Worker B's runtime, not here; this fake
 * stands in for Worker B at the binding boundary, where Worker A only invokes the
 * workflow and passes the image URL in the payload.)
 */
function makeBindingFake(result: unknown, calls: FetchCall[]): Fetcher {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url.includes("/workflows/extract-question")) {
      return Response.json(result);
    }

    throw new Error(`unexpected REASONING fetch: ${url}`);
  }) as Fetcher["fetch"];

  return { fetch: fetchImpl } as Fetcher;
}

test("extractQuestionFromImageUrl routes through the binding with the flag on and scrubs the result", async () => {
  const calls: FetchCall[] = [];
  const binding = makeBindingFake(fullExtractionPayload, calls);
  const env = {
    OPENAI_VISION_MODEL: "gpt-5.5",
    REASONING: binding
  };

  const response = await extractQuestionFromImageUrl(imageUrl, env);

  // The workflow was invoked (and the image URL was passed in the payload).
  const workflowCall = calls.find((c) => c.url.includes("/workflows/extract-question"));
  assert.ok(workflowCall, "expected a workflow invocation");
  const payload = JSON.parse(workflowCall!.body ?? "{}") as { imageUrl?: string; input?: string };
  assert.equal(payload.imageUrl, imageUrl);
  assert.match(payload.input ?? "", /Extract the homework problem/);

  // Worker A's normalization still ran on the binding result.
  assert.equal(response.outcome, "extracted");
  assert.equal(response.question, "What is the value of x?");
  assert.equal(response.frame.unknownTarget, "the value of x");
  assert.equal(response.requiresConfirmation, true);
});

test("extractQuestionFromImageUrl maps a binding failure to HttpError(502)", async () => {
  // Extraction is NOT fail-soft (it runs at session creation, outside the turn loop): a
  // binding failure must surface, not degrade.
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/extract-question")) {
      return new Response("upstream error", { status: 500 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as Fetcher["fetch"];

  const env = {
    OPENAI_VISION_MODEL: "gpt-5.5",
    REASONING: { fetch: fetchImpl } as Fetcher
  };

  await assert.rejects(
    extractQuestionFromImageUrl(imageUrl, env),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 502);
      return true;
    }
  );
});

test("extractQuestionFromImageUrl uses the binding by default (the flag is gone)", async () => {
  // The legacy OpenAI path was removed; the binding is the sole transport. This guards that
  // no stray OpenAI fetch happens — the only network call is the workflow invocation.
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/workflows/extract-question")) {
      return Response.json(fullExtractionPayload);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as Fetcher["fetch"];

  // Silence the fail-safe log (extraction is not fail-soft, but this test exercises the
  // happy path; kept for parity with the binding-failure test above).
  const env = {
    OPENAI_VISION_MODEL: "gpt-5.5",
    REASONING: { fetch: fetchImpl } as Fetcher
  };

  const response = await extractQuestionFromImageUrl(imageUrl, env);
  assert.equal(response.outcome, "extracted");
  // Only the workflow call ran; no OpenAI /v1/responses fetch.
  assert.ok(calls.every((url) => !url.includes("api.openai.com")));
});
