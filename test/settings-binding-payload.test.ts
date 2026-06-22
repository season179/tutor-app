/**
 * Proves the per-stage model from the DB-backed settings snapshot is actually shipped across
 * the REASONING binding — the core wiring of the settings → model feature.
 *
 * The 4 reasoning stages all use the same `modelExtraForStage(settings, stage)` helper to
 * build `{ model }` in the binding `extra` payload; the gate-check stage stands in for all
 * four (the helper's per-stage mapping is pinned in settings-store.test.ts). This test
 * captures the raw binding payload and asserts the settings model survived the hop, so a
 * regression that drops the `extra.model` plumbing (in voice-pipeline-service OR in
 * Worker B's payload forwarding) fails here rather than silently falling back to the env
 * default.
 */

import assert from "node:assert/strict";

import { checkGateStage } from "../src/modules/tutoring/gate-checker.ts";
import type { ProviderSettings } from "../src/modules/settings/settings-types.ts";

const frame = {
  diagramDescription: null,
  extractedText: "24 stickers are shared equally among 4 friends.",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem" as const,
  quantities: [
    { label: "stickers", raw: "24" },
    { label: "friends", raw: "4" }
  ],
  relationships: ["shared equally among 4 friends"],
  taskLanguage: "en",
  unknownTarget: "how many stickers each friend gets",
  visibleQuestion: "How many stickers does each friend get?"
};

const customGateModel = { provider: "anthropic", model: "claude-test-model" } as const;
const customGateModelSpecifier = "anthropic/claude-test-model";

const settings: ProviderSettings = {
  stt_model: { provider: "openrouter", model: "qwen/stt" },
  tts_model: { provider: "openrouter", model: "google/tts" },
  tts_voice: "Aoede",
  gate_check_model: customGateModel,
  verifier_model: { provider: "openai", model: "verifier" },
  tutor_model: { provider: "openai", model: "tutor" },
  extract_model: { provider: "openai", model: "extract" }
};

test("checkGateStage ships the settings gate_check_model in the binding payload", async () => {
  const capturedBodies: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/gate-check")) {
      if (typeof init?.body === "string") {
        capturedBodies.push(init.body);
      }
      return Response.json({
        result: { accepted: true, notes: null },
        runId: "test",
        streamUrl: "runs/test",
        offset: "-1"
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as Fetcher["fetch"];

  await checkGateStage(
    "context",
    frame,
    "the stickers are shared",
    { REASONING: { fetch: fetchImpl } as Fetcher },
    settings
  );

  assert.equal(capturedBodies.length, 1, "one binding call expected");
  const payload = JSON.parse(capturedBodies[0]!) as { model?: string; input?: string };
  assert.equal(
    payload.model,
    customGateModelSpecifier,
    "the split gate_check_model from settings must travel in the binding payload as provider/model"
  );
  assert.ok(typeof payload.input === "string" && payload.input.length > 0, "input still travels");
});

test("checkGateStage omits `model` from the payload when no settings are passed", async () => {
  // Back-compat: callers that don't thread settings (e.g. legacy direct calls) must NOT
  // ship a blank `model`, or Worker B would override its env default with empty. The
  // helper returns {} when there's no model, so the key is absent entirely.
  const capturedBodies: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/workflows/gate-check")) {
      if (typeof init?.body === "string") {
        capturedBodies.push(init.body);
      }
      return Response.json({
        result: { accepted: true, notes: null },
        runId: "test",
        streamUrl: "runs/test",
        offset: "-1"
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as Fetcher["fetch"];

  await checkGateStage(
    "context",
    frame,
    "the stickers are shared",
    { REASONING: { fetch: fetchImpl } as Fetcher }
    // no settings → Worker B uses its env default
  );

  const payload = JSON.parse(capturedBodies[0]!) as { model?: string };
  assert.ok(!("model" in payload), "`model` key must be absent when no settings are passed");
});
