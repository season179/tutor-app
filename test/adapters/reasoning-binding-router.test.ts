/**
 * Routing for the REASONING-binding transport — the transport-aware counterpart to
 * voice-provider-router.test.ts.
 *
 * When reasoning travels over the service binding, the call is `env.REASONING.fetch(...)`
 * to `/workflows/<stage>` rather than `globalThis.fetch` to `/responses`. This router
 * (`routeReasoningWorkflowCall`) maps the workflow path back to the same slot the OpenAI
 * transport uses, so per-slot counters stay transport-agnostic.
 *
 * Like its sibling, this is Tier 2 (wire-specific): naming the `/workflows/*` paths *is*
 * describing the wire. It is the only place that should ever need to change if the Flue
 * worker's workflow naming changes.
 */

import assert from "node:assert/strict";

import { routeReasoningWorkflowCall } from "../helpers/fake-voice-providers.js";

test("routes a gate-check workflow call to the gateChecker slot", () => {
  assert.equal(routeReasoningWorkflowCall("https://reasoning.local/workflows/gate-check?wait=result"), "gateChecker");
});

test("routes a verifier workflow call to the verifier slot", () => {
  assert.equal(routeReasoningWorkflowCall("https://reasoning.local/workflows/verifier?wait=result"), "verifier");
});

test("routes a tutor-turn workflow call to the tutor slot", () => {
  assert.equal(routeReasoningWorkflowCall("https://reasoning.local/workflows/tutor-turn?wait=result"), "tutor");
});

test("ignores the query string when matching the stage", () => {
  assert.equal(routeReasoningWorkflowCall("https://reasoning.local/workflows/gate-check"), "gateChecker");
});

test("returns null for a non-workflow binding path", () => {
  assert.equal(routeReasoningWorkflowCall("https://reasoning.local/health"), null);
  assert.equal(routeReasoningWorkflowCall("https://reasoning.local/workflows/_warmup"), null);
});

test("the two transports never overlap — a /responses URL is not a workflow call", () => {
  // Belt-and-suspenders: the binding router must not match an OpenAI /responses URL, and
  // vice versa, so a call can never be double-counted across transports.
  assert.equal(routeReasoningWorkflowCall("https://api.openai.com/v1/responses"), null);
});
