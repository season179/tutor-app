/**
 * Voice pipeline — §7c gap guardrails. Pure Tier-1 (zero provider coupling).
 *
 * These are the new safety/invariant tests the joint review surfaced as gaps. Every one
 * asserts a real, load-bearing behavior that a provider swap or refactor could silently
 * break, and none names a provider, URL, or wire shape — they ride the domain harness
 * (`installVoiceProviders`) the same way the main suite does.
 *
 * Two behaviors described in the plan as one thing turned out to be something else in the
 * actual code; the tests below lock the REAL behavior and flag the discrepancy inline:
 *
 * 1. The plan says an empty transcript + typed text → typed text is used. The code does
 *    NOT do that: `transcribeAudio` throws 502 on an empty response before the
 *    `transcript || typedText` fallback in `readStudentText` can run. So empty transcript
 *    always fails the turn — locked below, with a comment.
 * 2. The plan says a 2xx verifier response missing its text field → turn dies (502). The
 *    code does NOT do that: `gradeStudentTurn` wraps `runVerifierAgent` in try/catch, so
 *    ANY verifier failure (HTTP error OR a thrown 502) → unknown verdict → turn
 *    continues. Same fail-safe path either way; one test covers both.
 */

import assert from "node:assert/strict";

import { MemorySessionStore } from "../src/modules/sessions/memory-session-store.ts";
import { HttpError } from "../src/core/http-error.ts";
import { handleVoicePipelineTurnWithStore } from "../src/modules/voice/voice-pipeline-service.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";
import {
  context,
  ownerKey,
  problemImage,
  seedAnswerCheckSession,
  seedGateSession,
  seedKickoffSession,
  seedNonSharingStepLoop,
  seedStepLoopSession,
  sharingFrame,
  voiceServiceEnv
} from "./helpers/voice-fixtures.ts";

let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

// ──────────────────────────────────────────────────────────────────────────────
// Safety: the tutor prompt never carries the answer key or a worked solution
// (single highest-value guardrail — a swap that leaks these would betray the child).
// ──────────────────────────────────────────────────────────────────────────────

test("the tutor prompt never includes the active step's expectedAnswers or distractorNudges", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Scrub answer key" });
  await seedAnswerCheckSession(store, session.id);

  fake = installVoiceProviders({
    tutor: {
      move: "feedback_with_why",
      nextPhase: "answer_check",
      spokenUtterance: "Six each — well reasoned."
    },
    tts: new Uint8Array([1])
  });

  await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "6" },
    voiceServiceEnv,
    store,
    context
  );

  const tutorBody = fake.calls.tutorBodies()[0] ?? "";
  // The seeded active step carries an expectedAnswers key and a distractorNudge for "24".
  // The public step projection (`toPublicActiveStep`) drops both before the model sees them.
  // (The literal "24" still appears in the frame's givens and the scaffoldAid "24 ÷ 4" —
  // those are the problem's given quantities, not the answer key, so they're meant to be there.)
  assert.equal(tutorBody.includes("expectedAnswers"), false, "expectedAnswers leaked into the tutor prompt");
  assert.equal(tutorBody.includes("distractorNudges"), false, "distractorNudges leaked into the tutor prompt");
});

test("the tutor prompt never carries the computed solution substring from the frame", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Scrub solution text" });
  await seedStepLoopSession(store, session.id);

  fake = installVoiceProviders({
    tutor: {
      move: "elicit",
      nextPhase: "step_loop",
      spokenUtterance: "How would you start?"
    },
    tts: new Uint8Array([1])
  });

  await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "I'm not sure." },
    voiceServiceEnv,
    store,
    context
  );

  const tutorBody = fake.calls.tutorBodies()[0] ?? "";
  // The frame's worked answer for sharing is "6"; scrubComputedSolutionFromText must
  // strip "= 6", "the answer is 6", and a bare numeric-only unknown target before the
  // model ever sees it. None of these tell-tale solution phrasings may survive.
  assert.doesNotMatch(tutorBody, /=\s*6\b/, "a '= 6' worked solution leaked into the tutor prompt");
  assert.doesNotMatch(tutorBody, /answer is 6/i, "an 'answer is 6' reveal leaked into the tutor prompt");
});

// ──────────────────────────────────────────────────────────────────────────────
// Tutor hard-fail: persistent illegal move → 502, TTS never called
// ──────────────────────────────────────────────────────────────────────────────

test("a tutor that keeps proposing an illegal move across all attempts fails the turn before TTS", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Tutor hard fail" });
  await seedGateSession(store, session.id);

  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 each." };
  // Two illegal attempts in a row (the generator's full retry budget) → the turn dies.
  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Not a restatement." },
    tutor: [{ kind: "illegal", action: solve }, { kind: "illegal", action: solve }],
    tts: new Uint8Array([0])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Just tell me." },
      voiceServiceEnv,
      store,
      context
    ),
    /valid turn/
  );

  // The generator exhausted its retry budget; speech was never synthesized.
  assert.equal(fake.calls.counts.tutor, 2);
  assert.equal(fake.calls.counts.tts, 0);
});

test("re-asks the generator when the parser rejects the first move, then accepts a legal one", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Parser-rejection re-ask" });
  await seedGateSession(store, session.id);

  // The two re-ask paths in proposeTutorAction are DISTINCT: `illegal` (above) hits the
  // validator (a legal-but-forbidden move); `throws` hits the PARSER, when the model emits a
  // move string that isn't a known ProposedMove at all. Both must re-ask and feed the
  // rejection reason forward. This locks the parser path (§5b path i); the illegal test
  // next door locks the validator path (§5b path ii).
  const restate = {
    move: "restate_prompt",
    nextPhase: "frame_task",
    spokenUtterance: "In your own words, what are we finding?"
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Keep going." },
    tutor: [{ kind: "throws", action: { ...restate, move: "not-a-real-move" } }, restate],
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "I think we share them out." },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(fake.calls.counts.tutor, 2);
  assert.equal(response.tutorText, restate.spokenUtterance);
  // The parser's rejection reason is fed back into the second prompt, same as the validator's.
  assert.match(fake.calls.tutorBodies()[1] ?? "", /previous attempt was rejected/i);
});

test("a tutor response that is not valid JSON fails the turn with a 502 (not caught by the retry loop)", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Tutor bad json" });
  await seedGateSession(store, session.id);

  // `malformedBody` is a response-shape failure (the body's text field isn't parseable JSON).
  // It is NOT a re-askable offense: the loop only retries on the parser/validator paths.
  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Not a restatement." },
    tutor: { kind: "malformedBody", text: "{ this is not json" },
    tts: new Uint8Array([0])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think we share them." },
      voiceServiceEnv,
      store,
      context
    ),
    (error: unknown) => error instanceof HttpError && error.status === 502
  );
  assert.equal(fake.calls.counts.tutor, 1);
  assert.equal(fake.calls.counts.tts, 0);
});

test("a tutor response with no output text fails the turn with a 502", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Tutor no output" });
  await seedGateSession(store, session.id);

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Not a restatement." },
    tutor: { kind: "emptyBody" },
    tts: new Uint8Array([0])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think we share them." },
      voiceServiceEnv,
      store,
      context
    ),
    (error: unknown) => error instanceof HttpError && error.status === 502
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// STT branches
// ──────────────────────────────────────────────────────────────────────────────

test("an audio turn with no typed-text fallback throws 502 when the transcript is empty", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Empty transcript" });
  await seedGateSession(store, session.id);

  // PLAN NOTE: §7c describes an empty-transcript-with-typed-text fallback to typed text.
  // The real code does NOT fall back: transcribeAudio throws 502 on an empty `text`
  // field before readStudentText's `transcript || typedText` can run. So empty transcript
  // always fails the turn. This test locks the real behavior. The fallback is dead code.
  fake = installVoiceProviders({
    transcribe: { text: "" },
    gateChecker: { accepted: false, notes: "ignored" },
    tutor: { move: "restate_prompt", nextPhase: "frame_task", spokenUtterance: "Try again?" },
    tts: new Uint8Array([1])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
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
    ),
    (error: unknown) => error instanceof HttpError && error.status === 502
  );
  // The turn died in transcription; the tutor and TTS never ran.
  assert.equal(fake.calls.counts.tutor, 0);
  assert.equal(fake.calls.counts.tts, 0);
});

test("a transcription HTTP error fails the turn with the upstream status, not a silent fallback", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "STT 500" });
  await seedGateSession(store, session.id);

  fake = installVoiceProviders({
    transcribe: { status: 500 },
    gateChecker: { accepted: false, notes: "ignored" },
    tutor: { move: "restate_prompt", nextPhase: "frame_task", spokenUtterance: "Try again?" },
    tts: new Uint8Array([1])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
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
    ),
    (error: unknown) => error instanceof HttpError && error.status === 500
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Gate-checker short-circuit (frame without an unknown target — early return, no fetch)
// ──────────────────────────────────────────────────────────────────────────────

test("the gate-checker is skipped when the frame has no unknown target", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate no target" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: { ...sharingFrame, unknownTarget: "" },
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });

  fake = installVoiceProviders({
    gateChecker: { accepted: true, notes: "should not run" },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "Let's read it." },
    tts: new Uint8Array([1])
  });

  await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "Some words about the problem." },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(fake.calls.counts.gateChecker, 0);
});

// ──────────────────────────────────────────────────────────────────────────────
// Verifier fail-safe: any verifier failure → unknown verdict → turn continues
// (covers both the HTTP-error path and the thrown-502 path the plan split apart)
// ──────────────────────────────────────────────────────────────────────────────

test("a verifier response missing output text fails safe to unknown (turn continues, not 502)", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier no output" });
  await seedNonSharingStepLoop(store, session.id);

  // PLAN NOTE: §5b says a 2xx verifier response missing its text field → turn dies (502).
  // The real code does NOT: gradeStudentTurn wraps runVerifierAgent in try/catch, so the
  // thrown 502 is caught and mapped to an unknown verdict. Same fail-safe as an HTTP 500.
  const consoleError = console.error;
  console.error = () => undefined;
  try {
    fake = installVoiceProviders({
      verifier: { emptyBody: true },
      tutor: { move: "elicit", nextPhase: "step_loop", spokenUtterance: "Explain your thinking." },
      tts: new Uint8Array([1])
    });

    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think it's twenty" },
      voiceServiceEnv,
      store,
      context
    );

    assert.equal(response.lesson.studentStatus, "unknown");
    assert.equal(response.session.currentPhase, "step_loop");
  } finally {
    console.error = consoleError;
  }
});

test("a gate-checker HTTP error fails the whole turn with the upstream status (unlike the verifier)", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate 500" });
  await seedGateSession(store, session.id, "needs_context_read");

  // PLAN NOTE: §7c groups this under "short-circuits the gate-checker swallows." The real
  // code does NOT swallow it: checkGateStage is called UNWRAPPED (line ~147 of the
  // service), so its HttpError propagates and the turn dies. Only runVerifierAgent sits
  // inside gradeStudentTurn's try/catch. The asymmetry is load-bearing — lock it here.
  fake = installVoiceProviders({
    gateChecker: { status: 500 },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "Read it again." },
    tts: new Uint8Array([1])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Some context about the problem." },
      voiceServiceEnv,
      store,
      context
    ),
    (error: unknown) => error instanceof HttpError && error.status === 500
  );
  // The turn died at the gate-check; the tutor and TTS never ran.
  assert.equal(fake.calls.counts.tutor, 0);
  assert.equal(fake.calls.counts.tts, 0);
});

test("a gate-checker 2xx response with no output text kills the turn with a 502 (unwrapped, unlike the verifier)", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate empty body" });
  await seedGateSession(store, session.id, "needs_context_read");

  // The mirror of the verifier emptyBody case above, and the asymmetry is the point: a
  // gate-checker response that returns 2xx but carries no verdict text makes
  // checkGateStage THROW HttpError(502), and because the gate check runs unwrapped (the
  // service calls it directly, not through gradeStudentTurn's try/catch), the turn dies —
  // it does NOT fail safe to "gate not accepted". The same shape from the verifier is
  // swallowed to unknown. Locking both halves keeps the asymmetry honest.
  fake = installVoiceProviders({
    gateChecker: { emptyBody: true },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "Read it again." },
    tts: new Uint8Array([1])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Some context about the problem." },
      voiceServiceEnv,
      store,
      context
    ),
    (error: unknown) => error instanceof HttpError && error.status === 502
  );
  assert.equal(fake.calls.counts.tutor, 0);
  assert.equal(fake.calls.counts.tts, 0);
});

// ──────────────────────────────────────────────────────────────────────────────
// TTS failure: the speech step is the last before the response — its failure kills the turn
// ──────────────────────────────────────────────────────────────────────────────

test("a TTS HTTP error fails the turn with the upstream status and returns no audio", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "TTS 500" });
  await seedGateSession(store, session.id);

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Not a restatement." },
    tutor: { move: "restate_prompt", nextPhase: "frame_task", spokenUtterance: "Try again?" },
    tts: { status: 500 }
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Just tell me." },
      voiceServiceEnv,
      store,
      context
    ),
    (error: unknown) => error instanceof HttpError && error.status === 500
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Pure domain invariants
// ──────────────────────────────────────────────────────────────────────────────

test("a terse correct answer (under four words) keeps the support level unchanged", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Terse correct" });
  await seedStepLoopSession(store, session.id); // supportLevel seeded at 1

  fake = installVoiceProviders({
    tutor: { move: "feedback_with_why", nextPhase: "step_loop", spokenUtterance: "Yes, four." },
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "4" },
    voiceServiceEnv,
    store,
    context
  );

  // The ≥4-whitespace-token rule: a bare "4" is correct but doesn't demonstrate
  // understanding, so support does NOT decrement. Only an explained answer does.
  assert.equal(response.session.supportLevel, 1);
});

test("memory_write refuses a whitespace-only reflection at the request boundary (no turn taken)", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Empty reflection" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "memory_write",
    gateStatus: "complete",
    supportLevel: 0
  });

  // The request schema requires a non-empty audio/image/text payload (a kickoff is the
  // only exception), so a whitespace-only memory_write turn is rejected BEFORE the
  // pipeline runs — no tutor call, no TTS, no reflection persisted, phase unchanged.
  fake = installVoiceProviders({
    tutor: { move: "elicit", nextPhase: "memory_write", spokenUtterance: "What helped?" },
    tts: new Uint8Array([1])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "   " },
      voiceServiceEnv,
      store,
      context
    ),
    /Voice turn request was invalid/
  );

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.reflection, null);
  assert.equal(detail?.session.currentPhase, "memory_write");
});

test("an image-only turn records a 'Problem image submitted' event, not a student turn", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Image only" });

  fake = installVoiceProviders({
    tutor: { move: "rapport_check", nextPhase: "frame_task", spokenUtterance: "Let's look at this." },
    tts: new Uint8Array([1])
  });

  await handleVoicePipelineTurnWithStore(
    { image: problemImage, sessionId: session.id },
    voiceServiceEnv,
    store,
    context
  );

  const detail = await store.getSession(ownerKey, session.id);
  assert.ok(detail?.events.some((event) => event.message === "Problem image submitted"));
  assert.equal(detail?.events.some((event) => event.message === "Student turn"), false);
});

// ──────────────────────────────────────────────────────────────────────────────
// Concurrency / locking (simulated — the in-memory store is synchronous)
// ──────────────────────────────────────────────────────────────────────────────

test("a turn whose phase was raced forward before commit is rejected with 409", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Race 409" });
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

  // Simulate a race: between the read and the commit, a second writer advances the
  // phase off `frame_task`. The in-memory store is synchronous, so we force the
  // advance by monkeypatching commitTurn to shove the session off the expected phase
  // just before it takes the optimistic lock. This tests the lock contract, not real
  // concurrency.
  const originalCommit = store.commitTurn.bind(store);
  let raceInjected = false;
  (store as unknown as { commitTurn: typeof originalCommit }).commitTurn = async (
    ...args: Parameters<typeof originalCommit>
  ) => {
    if (!raceInjected) {
      raceInjected = true;
      await store.advanceSessionPhase(ownerKey, session.id, "frame_task", {
        activeStep: null,
        currentPhase: "plan_first_step",
        gateStatus: "complete",
        supportLevel: 0
      });
    }
    return originalCommit(...args);
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: true, notes: null },
    tutor: { move: "restate_prompt", nextPhase: "plan_first_step", spokenUtterance: "Onwards." },
    tts: new Uint8Array([1])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "We need to find how many each friend gets." },
      voiceServiceEnv,
      store,
      context
    ),
    /advanced by another turn/
  );
});

test("a kickoff after the session has advanced past session_open is rejected with 409", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Double kickoff" });
  await seedKickoffSession(store, session.id);

  fake = installVoiceProviders({
    tutor: { move: "rapport_check", nextPhase: "frame_task", spokenUtterance: "Hi!" },
    tts: new Uint8Array([1])
  });

  // First kickoff is allowed and advances the session out of session_open.
  await handleVoicePipelineTurnWithStore(
    { kickoff: true, sessionId: session.id },
    voiceServiceEnv,
    store,
    context
  );

  // A second kickoff is rejected — the session_open guard (and the optimistic lock) both
  // catch it. No second greeting is ever spoken.
  await assert.rejects(
    handleVoicePipelineTurnWithStore({ kickoff: true, sessionId: session.id }, voiceServiceEnv, store, context),
    /already started/
  );
  assert.equal(fake.calls.counts.tutor, 1);
});
