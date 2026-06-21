/**
 * Voice provider decoupling guardrail — §8 of the test-guardrails plan.
 *
 * This is the structural barrier that keeps Tier-1 (portable) test files from quietly
 * re-coupling to the OpenAI wire. The plan called for an ESLint `no-restricted-imports`
 * rule as the primary barrier, but this project ships no ESLint at all; implementing the
 * same guarantee as a test keeps CI as the single enforcement point and adds no new
 * toolchain. It fails the suite — loudly — the moment a Tier-1 file reaches into the
 * OpenAI provider code or mentions wire vocabulary.
 *
 * The checks mirror §8.1 (structural import barrier) and §8.3 (wire-vocab grep):
 *
 * - Tier-1 files exist (guards against a rename slipping the barrier).
 * - Tier-1 files contain no wire vocabulary (`api.openai.com`, the `/v1/...` paths,
 *   `output_text`, `output[`, `content[`, `FormData`, `Bearer `).
 * - Tier-1 files may import ONLY the `installVoiceProviders` domain surface from the
 *   helpers, never the wire-specific exports (`routeVoiceProviderCall`,
 *   `makeOpenAiProviderFake`).
 * - Tier-1 files import nothing under `src/providers/openai/*`.
 *
 * The second-impl proof (§8.2 — run the Tier-1 suite against an OpenRouter wire) is a
 * future CI job; it can't be expressed until that impl exists.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// The Tier-1 (portable) files — everything that must survive a provider swap unchanged.
// `test/helpers/voice-fixtures.ts` is included because Tier-1 files import it, so its
// coupling is transitively theirs.
const tierOneFiles = [
  "test/voice-pipeline-service.test.ts",
  "test/voice-pipeline-guardrails.test.ts",
  "test/helpers/voice-fixtures.ts"
].map((relative) => resolve(repoRoot, relative));

// Wire vocabulary that must never appear in a Tier-1 file. Belt-and-suspenders alongside
// the import barrier — the grep alone is too weak (the plan's own §8 says so), but it
// catches a leaked token the import rule wouldn't.
const wireVocabulary = [
  "api.openai.com",
  "/v1/responses",
  "/v1/audio/",
  "output_text",
  "output[",
  "content[",
  "FormData",
  "Bearer "
];

// Exports a Tier-1 file is FORBIDDEN to import from the harness — they encode OpenAI wire
// knowledge. `installVoiceProviders` is the sanctioned domain surface; everything else is
// an internal wire export.
const forbiddenHarnessImports = ["routeVoiceProviderCall", "makeOpenAiProviderFake"];

test("every Tier-1 file is present (guards against a rename slipping the barrier)", () => {
  for (const file of tierOneFiles) {
    readFileSync(file, "utf8");
  }
});

test("no Tier-1 file contains OpenAI wire vocabulary", () => {
  const offenders: string[] = [];
  for (const file of tierOneFiles) {
    const source = readFileSync(file, "utf8");
    for (const token of wireVocabulary) {
      if (source.includes(token)) {
        offenders.push(`${file}: contains "${token}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], "Tier-1 files must not name the OpenAI wire");
});

test("no Tier-1 file imports the harness's wire-specific exports", () => {
  const offenders: string[] = [];
  for (const file of tierOneFiles) {
    const source = readFileSync(file, "utf8");
    for (const symbol of forbiddenHarnessImports) {
      // Match an import binding: `import { routeVoiceProviderCall` or a bare identifier
      // import. The sanctioned `installVoiceProviders` is exempt.
      const importPattern = new RegExp(`\\b${symbol}\\b`);
      if (importPattern.test(source)) {
        offenders.push(`${file}: imports "${symbol}" (wire-specific)`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Tier-1 files must reach the harness only via installVoiceProviders"
  );
});

test("no Tier-1 file imports anything under src/providers/openai", () => {
  const offenders: string[] = [];
  for (const file of tierOneFiles) {
    const source = readFileSync(file, "utf8");
    const providerImport = source.match(/from\s+["'][^"']*providers\/openai[^"']*["']/);
    if (providerImport) {
      offenders.push(`${file}: ${providerImport[0]}`);
    }
  }
  assert.deepEqual(offenders, [], "Tier-1 files must not import the OpenAI provider");
});

// Scope note: we deliberately do NOT scan the whole test tree for wire vocabulary.
// `gate-checker.test.ts`, `verifier-agent.test.ts`, and friends test the adapter modules
// DIRECTLY and are legitimately wire-coupled; they're out of scope for this voice-pipeline
// decoupling. The guardrail is that the Tier-1 list above is exhaustive for voice-pipeline
// tests, which the tests above already enforce.
