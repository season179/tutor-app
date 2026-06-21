/**
 * Matcher precedence for the voice-pipeline fetch router.
 *
 * The tutor slot is defined as "a `/responses` call that is neither the gate-checker nor
 * the verifier." The router applies an explicit ordered matcher list (gate → verifier →
 * tutor-else); that precedence is the single behavior most likely to silently break on a
 * provider swap (a future router key could collide). Locking it here — independent of the
 * rest of the suite — keeps the precedence honest rather than emergent string-sniffing.
 *
 * This test is Tier 2 (wire-specific): it must name the OpenAI wire markers because
 * describing the routing *is* describing the wire. It is the only place that should ever
 * need to change shape on a swap.
 */

import assert from "node:assert/strict";

import { routeVoiceProviderCall } from "../helpers/fake-voice-providers.js";

function withInstructions(text: string): RequestInit {
  return { body: JSON.stringify({ instructions: text }), method: "POST" };
}

test("routes an audio-transcriptions call to the transcribe slot", () => {
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/audio/transcriptions", { body: new FormData() }),
    "transcribe"
  );
});

test("routes an audio-speech call to the tts slot", () => {
  assert.equal(routeVoiceProviderCall("https://provider.example/v1/audio/speech", { body: "{}" }), "tts");
});

test("routes a gate-checker /responses call by its comprehension-gate marker", () => {
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/responses", withInstructions("You are a narrow comprehension-gate checker for a tutor.")),
    "gateChecker"
  );
});

test("routes a verifier /responses call by its narrow-verifier marker", () => {
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/responses", withInstructions("You are a narrow answer verifier for a tutor.")),
    "verifier"
  );
});

test("routes a /responses call with neither marker to the tutor slot (the else branch)", () => {
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/responses", withInstructions("You are the move generator for a tutoring state machine.")),
    "tutor"
  );
});

test("does not call a body without instructions a tutor call when it isn't JSON", () => {
  // A non-JSON body on /responses still falls through to tutor (the else branch) — the
  // tutor generator always sends JSON, so this is belt-and-suspenders, but it must not
  // throw or mis-route.
  assert.equal(routeVoiceProviderCall("https://provider.example/v1/responses", { body: "not json" }), "tutor");
});

test("returns null for a fetch that isn't a voice-pipeline call", () => {
  assert.equal(routeVoiceProviderCall("https://other.example/api/widgets"), null);
});

test("precedence is gateChecker before verifier before tutor — the load-bearing order", () => {
  // A request whose instructions mention BOTH markers must land in the gateChecker slot,
  // because the gate-checker preamble's own marker ("comprehension-gate checker") would
  // otherwise be shadowed by any verifier wording in the same prompt. The order is the
  // contract — flipping it would silently re-route the gate check.
  const both = withInstructions("comprehension-gate checker and narrow answer verifier together");
  assert.equal(routeVoiceProviderCall("https://provider.example/v1/responses", both), "gateChecker");

  // A request with only the verifier marker still lands in verifier, not tutor.
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/responses", withInstructions("narrow answer verifier")),
    "verifier"
  );
});

test("a marker embedded in the student input (not instructions) routes to tutor, not the matching slot", () => {
  // The router discriminates on the `instructions` preamble ONLY, never the `input`
  // field. A future tutor prompt that quotes the marker inside the student-facing input
  // must still route to the tutor slot — otherwise a child's own words could re-route
  // their turn's provider call. Pinned explicitly so the invariant can't drift.
  const bodyWithMarkerInInput = {
    input: [{ content: [{ text: "the comprehension-gate checker said no" }], role: "user" }],
    instructions: "You are the move generator for a tutoring state machine."
  };
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/responses", { body: JSON.stringify(bodyWithMarkerInInput) }),
    "tutor"
  );

  const bodyWithVerifierInInput = {
    input: [{ content: [{ text: "the narrow answer verifier graded me correct" }], role: "user" }],
    instructions: "You are the move generator for a tutoring state machine."
  };
  assert.equal(
    routeVoiceProviderCall("https://provider.example/v1/responses", { body: JSON.stringify(bodyWithVerifierInInput) }),
    "tutor"
  );
});
