/**
 * Gate stage over the REASONING service binding — the error-asymmetry pin.
 *
 * The binding is the sole reasoning transport now (Phase 4 removed the legacy path), so the
 * main gate tests already exercise the binding. This file keeps the ONE assertion that is
 * load-bearing and easy to regress: a transient Worker B failure KILLS the gate turn at
 * HttpError(502) — the safety-critical half of the gate-vs-verifier asymmetry (the gate
 * runs first; the verifier, by contrast, is fail-soft to `unknown` — see
 * verifier-agent-binding.test.ts). Pinning it here in isolation keeps the contract honest.
 */

import assert from "node:assert/strict";

import { MemorySessionStore } from "../src/modules/sessions/memory-session-store.ts";
import { handleVoicePipelineTurnWithStore } from "../src/modules/voice/voice-pipeline-service.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";
import { context, ownerKey, seedGateSession, voiceServiceEnv } from "./helpers/voice-fixtures.ts";

let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

test("a REASONING binding failure KILLS the gate turn at 502 — never fail-soft (the asymmetry)", async () => {
  // The gate is safety-critical and runs first: a transient Worker B failure MUST propagate
  // as HttpError(502) and abort the turn before commit. This is the deliberate counterpart
  // to the verifier, where the same failure degrades to `unknown`. Both halves together are
  // the Phase 3 DoD contract.
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Binding gate down" });
  await seedGateSession(store, session.id);

  fake = installVoiceProviders({
    gateChecker: { status: 500 },
    tutor: { move: "restate_prompt", nextPhase: "frame_task", spokenUtterance: "should never be reached" },
    tts: new Uint8Array([0])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "We need to find the share." },
      voiceServiceEnv,
      store,
      context
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error, "expected an Error");
      assert.equal((error as { status?: number }).status, 502, "gate binding failure must surface as 502");
      return true;
    }
  );

  // The turn died before TTS (no speech over a dead turn) and before commit (phase held).
  assert.equal(fake.calls.counts.tts, 0);
  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
  assert.notEqual(detail?.session.gateStatus, "complete");
});
