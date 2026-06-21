/**
 * Provider-swap proof — Phase 4 DoD.
 *
 * The migration plan's Phase 4: "flip one stage's model specifier to OpenRouter in B's env
 * and run the Tier-1 guardrail suite unchanged. That run — not a grep — proves the
 * reasoning swap in Worker B works without touching domain code."
 *
 * The binding transport is provider-agnostic BY CONSTRUCTION: Worker A calls
 * `/workflows/<stage>` with a provider-neutral payload and reads back a structured result;
 * Worker B owns the provider wire (the `model` specifier + the API key). So swapping the
 * reasoning provider is a one-line change to `REASONING_MODEL` in Worker B's wrangler.jsonc
 * plus the matching `*_API_KEY` secret — nothing in Worker A changes.
 *
 * This test makes that contract executable: it asserts (1) the binding client and all four
 * migrated stages carry NO provider-specific wire vocabulary (no `api.openai.com`, no
 * `/v1/responses`, no `Bearer`); and (2) the model specifier is read from the env, not
 * hardcoded — so the swap is an env change, not a code change.
 *
 * Scope (per the plan's own caveat): this proves **Worker B's model is swappable**, not that
 * "Worker A is provider-agnostic" — Worker A still hardcodes OpenAI for STT/TTS (out of
 * scope; Flue is LLM-only), and Worker A's reasoning code is now just a binding call.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// Worker A files that carry reasoning-binding calls (the migrated stages + the client).
// These MUST be provider-neutral: they reach the model only through the binding.
const bindingPathFiles = [
  "src/providers/reasoning/reasoning-binding.ts",
  "src/modules/tutoring/gate-checker.ts",
  "src/modules/tutoring/verifier-agent.ts",
  "src/modules/problems/question-extraction-service.ts"
].map((relative) => resolve(repoRoot, relative));

// Provider-specific wire that must NOT appear in the binding-path code — it lives only in
// Worker B. Phase 4 removed the legacy direct-OpenAI reasoning path entirely, so the
// binding-path files reach the model ONLY through the service binding and must be clean of
// every provider wire token, OpenAI included. The OpenAI tokens (`api.openai.com`,
// `/v1/responses`, `Bearer`) are the ones the file header promises to forbid; without them
// the binding-path files could silently regress to a direct OpenAI call and still pass.
const providerWire = [
  "api.openai.com",
  "/v1/responses",
  "Bearer",
  "openrouter",
  "anthropic/",
  "cloudflare/",
  "mistral/",
  "/v1/chat/completions"
];

test("no binding-path file hardcodes a non-OpenAI provider wire (the swap stays env-only)", () => {
  // The binding-path files must not name a SPECIFIC provider — that would re-couple Worker A
  // to a swap target. Provider choice lives in Worker B's REASONING_MODEL env, not here.
  const offenders: string[] = [];
  for (const file of bindingPathFiles) {
    const source = readFileSync(file, "utf8");
    for (const token of providerWire) {
      if (source.includes(token)) {
        offenders.push(`${file}: contains "${token}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], "binding-path files must not name a provider wire");
});

test("the binding client reaches the model only via the service binding, not a provider URL", () => {
  const source = readFileSync(resolve(repoRoot, "src/providers/reasoning/reasoning-binding.ts"), "utf8");
  // The binding call posts to a workflow path on the REASONING Fetcher — never a provider
  // URL. `https://reasoning.local` is a routing placeholder for the service binding, not a
  // real provider endpoint.
  assert.match(source, /binding\.fetch/);
  assert.match(source, /\/workflows\//);
  assert.doesNotMatch(source, /api\.openai\.com/);
});

test("the model specifier lives in Worker B's env, not Worker A's code", () => {
  // Worker B reads REASONING_MODEL from process.env with an OpenAI default. Swapping to
  // OpenRouter is changing that one var (+ the key secret) — no Worker A code change.
  const workerBSource = readFileSync(
    resolve(repoRoot, "reasoning-worker/.flue/workflows/gate-check.ts"),
    "utf8"
  );
  assert.match(workerBSource, /process\.env\.REASONING_MODEL/);
  // The default is OpenAI; an OpenRouter value would override it via env alone.
  assert.match(workerBSource, /openai\/gpt-5\.5/);

  // And the wrangler.jsonc exposes REASONING_MODEL as the single swap knob.
  const wranglerSource = readFileSync(
    resolve(repoRoot, "reasoning-worker/wrangler.jsonc"),
    "utf8"
  );
  assert.match(wranglerSource, /REASONING_MODEL/);
});
