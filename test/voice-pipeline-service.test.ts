/**
 * Voice pipeline service — Tier 1 portable guardrails.
 *
 * These tests express DOMAIN intent and assert DOMAIN behavior. They never name a
 * provider, a URL, or a wire shape — all of that lives behind `installVoiceProviders`
 * (see `test/helpers/fake-voice-providers.ts`). The same bodies will run unchanged
 * against a future OpenRouter wire impl; that run is the real decoupling proof.
 *
 * What's covered (mirrors §7a): the legacy projection + phase advance, the kickoff
 * contract (×3), audio transcription, the gate's solving-move rejection and re-ask,
 * the Three Reads walk, the gate hold/advance/short-circuit, the plan-phase no-grade
 * guard, the step-loop grading (wrong/correct) with support-level moves, the LLM
 * verifier track, the verifier-error fail-safe, the final answer, and reflection.
 */

import assert from "node:assert/strict";

import { MemorySessionStore } from "../src/modules/sessions/memory-session-store.ts";
import { handleVoicePipelineTurnWithStore } from "../src/modules/voice/voice-pipeline-service.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";
import {
  context,
  multiplicationFrame,
  ownerKey,
  problemImage,
  seedAnswerCheckSession,
  seedGateSession,
  seedKickoffSession,
  seedNonSharingStepLoop,
  seedStepLoopSession,
  seedThreeReadsSession,
  sessionState,
  sharingFrame,
  voiceServiceEnv
} from "./helpers/voice-fixtures.ts";

// The fake is restored after every test so a missed cleanup can never leak a stubbed
// fetch into the next test (the biggest flakiness risk per the plan's §11).
let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

test("projects a validated turn to the legacy public lesson shape and advances the phase", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Hi there! Ready to read this problem together?"
  };

  fake = installVoiceProviders({ tutor: action, tts: speechBytes });

  const response = await handleVoicePipelineTurnWithStore(
    { image: problemImage, sessionId: session.id, text: "Help me understand this problem step by step." },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.tutorText, action.spokenUtterance);
  assert.deepEqual(response.lesson, {
    phase: "orient",
    spokenUtterance: action.spokenUtterance,
    studentStatus: "unknown",
    tutorAction: "orient"
  });
  assert.deepEqual(response.session, sessionState({ currentPhase: "frame_task" }));
  assert.equal("hiddenState" in response.lesson, false);
  assert.equal("safetyNotes" in response.lesson, false);
  assert.equal(response.audio.mimeType, "audio/mpeg");
  assert.equal(response.audio.size, speechBytes.byteLength);

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
  assert.equal(detail?.session.status, "active");
  const tutorTurn = detail?.events.find((event) => event.message === "Tutor turn");
  assert.ok(tutorTurn);
  assert.equal(JSON.stringify(tutorTurn.value).includes("hiddenState"), false);
  // The persisted turn carries the contract version and the server-owned gate state.
  assert.equal((tutorTurn.value as { schemaVersion?: number }).schemaVersion, 1);
  assert.equal("gateStatus" in (tutorTurn.value as object), true);
});

test("kickoff turn opens with a tutor move and no student turn", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Kickoff" });
  await seedKickoffSession(store, session.id);

  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Hi! I'm Coach Echo. Let's read this sharing problem together — ready?"
  };

  fake = installVoiceProviders({ tutor: action, tts: new Uint8Array([1, 2, 3, 4]) });

  const response = await handleVoicePipelineTurnWithStore(
    { kickoff: true, sessionId: session.id },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.tutorText, action.spokenUtterance);
  assert.equal(response.transcript, "");
  assert.equal(response.session.currentPhase, "frame_task");
  // The opening turn never grades or gate-checks — only the move generator runs.
  assert.equal(fake.calls.counts.gateChecker, 0);
  assert.equal(fake.calls.counts.verifier, 0);
  assert.match(fake.calls.tutorBodies()[0] ?? "", /opening turn/i);

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
  assert.equal(detail?.session.status, "active");
  assert.ok(detail?.events.some((event) => event.message === "Tutor turn"));
  // The tutor spoke first: no student-side events were written this turn.
  assert.equal(detail?.events.some((event) => event.message === "Student turn"), false);
  assert.equal(detail?.events.some((event) => event.message === "Problem image submitted"), false);
});

test("kickoff turn advances even if the model proposes staying at session_open", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Kickoff stays" });
  await seedKickoffSession(store, session.id);

  // The model returns a legal-but-self-defeating nextPhase. A naive clamp to fromPhase
  // would leave the session at session_open, so a second kickoff would greet again.
  const action = {
    move: "rapport_check",
    nextPhase: "session_open",
    spokenUtterance: "Hi! I'm Coach Echo. Let's read this together."
  };

  fake = installVoiceProviders({ tutor: action, tts: new Uint8Array([1, 2, 3, 4]) });

  const response = await handleVoicePipelineTurnWithStore(
    { kickoff: true, sessionId: session.id },
    voiceServiceEnv,
    store,
    context
  );

  // Forced forward so the session_open guard would reject a second kickoff.
  assert.equal(response.session.currentPhase, "frame_task");
  assert.notEqual(response.session.currentPhase, "session_open");

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
});

test("kickoff turn is rejected once the session has started", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Kickoff guard" });
  await seedThreeReadsSession(store, session.id);

  // No provider slots configured: any fetch throws, proving the kickoff never reached
  // a provider call before the already-started guard rejected it.
  fake = installVoiceProviders({});

  await assert.rejects(
    handleVoicePipelineTurnWithStore({ kickoff: true, sessionId: session.id }, voiceServiceEnv, store, context),
    /already started/
  );
});

test("transcribes recorder audio and runs the turn from the transcript", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline audio test" });
  const speechBytes = new Uint8Array([5, 6, 7, 8]);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Great — shall we read what the problem is asking?"
  };

  fake = installVoiceProviders({
    transcribe: { text: "Subtract the library amount from the total." },
    tutor: action,
    tts: speechBytes
  });

  const response = await handleVoicePipelineTurnWithStore(
    {
      audio: {
        dataUrl: "data:audio/webm;codecs=opus;base64,AQIDBA==",
        mimeType: "audio/webm;codecs=opus",
        name: "student-turn.webm",
        size: 4
      },
      image: problemImage,
      sessionId: session.id
    },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.transcript, "Subtract the library amount from the total.");
  assert.equal(response.tutorText, action.spokenUtterance);
});

test("rejects a solving move during the comprehension gate before reaching TTS", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate test" });
  await seedGateSession(store, session.id);

  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 sweets each." };

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Not a restatement." },
    tutor: { kind: "illegal", action: solve },
    tts: new Uint8Array([0])
  });

  await assert.rejects(
    handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "Just tell me the answer." },
      voiceServiceEnv,
      store,
      context
    ),
    /valid turn/
  );

  // The solving move never reaches TTS — the turn dies before speech.
  assert.equal(fake.calls.counts.tts, 0);
  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
  assert.notEqual(detail?.session.gateStatus, "complete");
});

test("re-asks the generator when the first move is illegal, then accepts a legal one", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Retry test" });
  await seedGateSession(store, session.id);

  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 sweets each." };
  const restate = {
    move: "restate_prompt",
    nextPhase: "frame_task",
    spokenUtterance: "In your own words, what are we trying to find?"
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Keep going." },
    tutor: [{ kind: "illegal", action: solve }, restate],
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { image: problemImage, sessionId: session.id, text: "I think we share them out." },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(fake.calls.counts.tutor, 2);
  assert.equal(response.tutorText, restate.spokenUtterance);
  assert.deepEqual(response.lesson, {
    phase: "orient",
    spokenUtterance: restate.spokenUtterance,
    studentStatus: "unknown",
    tutorAction: "ask"
  });
  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "frame_task",
      gateStatus: "needs_restatement",
      unknownTarget: sharingFrame.unknownTarget
    })
  );

  // The rejection reason from the first attempt is fed back into the second prompt.
  assert.match(fake.calls.tutorBodies()[1] ?? "", /previous attempt was rejected/i);

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
});

test("does not advance past the gate until the gate-checker accepts a restatement", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate advance test" });
  await seedGateSession(store, session.id);

  const plan = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Nice — ready for the first tiny step?"
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Not yet." },
    tutor: plan,
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "Just divide it." },
    voiceServiceEnv,
    store,
    context
  );

  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "frame_task",
      gateStatus: "needs_restatement",
      unknownTarget: sharingFrame.unknownTarget
    })
  );
});

test("advances past the gate only after the gate-checker accepts a valid restatement", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate pass test" });
  await seedGateSession(store, session.id);

  const plan = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Great restatement — what's our first tiny step?"
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: true, notes: null },
    tutor: plan,
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "We need to find how many stickers each friend gets." },
    voiceServiceEnv,
    store,
    context
  );

  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "plan_first_step",
      gateStatus: "complete",
      goalStatus: "framed",
      unknownTarget: sharingFrame.unknownTarget
    })
  );

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "plan_first_step");
  assert.equal(detail?.session.gateStatus, "complete");
});

test("skips the gate-checker once the gate is already complete", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate complete test" });
  await seedGateSession(store, session.id);
  await store.advanceSessionPhase(ownerKey, session.id, "frame_task", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "complete",
    supportLevel: 0
  });

  const plan = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Ready to plan the first step?"
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Should not run." },
    tutor: plan,
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "We need to find how many stickers each friend gets." },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(fake.calls.counts.gateChecker, 0);
  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "plan_first_step",
      gateStatus: "complete",
      goalStatus: "framed",
      unknownTarget: sharingFrame.unknownTarget
    })
  );
});

test("requires all three reads plus a restatement before solving unlocks", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Three Reads walk" });
  await seedThreeReadsSession(store, session.id);

  // The tutor tries to move on to planning every single turn; only the gate FSM,
  // not the model, decides when that's actually allowed.
  const push = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Tell me more about this problem."
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: true, notes: null },
    tutor: push,
    tts: new Uint8Array([1])
  });

  async function takeTurn(text: string) {
    return handleVoicePipelineTurnWithStore({ sessionId: session.id, text }, voiceServiceEnv, store, context);
  }

  // Read 1 (context) accepted → advances exactly one read; solving stays locked.
  const r1 = await takeTurn("It's about four friends sharing some stickers.");
  assert.equal(r1.session.currentPhase, "frame_task");
  assert.equal(r1.session.gateStatus, "needs_quantity_read");

  // Read 2 (quantities) accepted → next read; still locked in frame_task.
  const r2 = await takeTurn("There are 24 stickers and 4 friends.");
  assert.equal(r2.session.currentPhase, "frame_task");
  assert.equal(r2.session.gateStatus, "needs_target_read");

  // Read 3 (the question) accepted → final restatement read; still locked.
  const r3 = await takeTurn("It wants how many stickers each friend gets.");
  assert.equal(r3.session.currentPhase, "frame_task");
  assert.equal(r3.session.gateStatus, "needs_restatement");

  // Restatement accepted → gate completes and only now does planning unlock.
  const r4 = await takeTurn("We need to find how many stickers each friend gets.");
  assert.equal(r4.session.currentPhase, "plan_first_step");
  assert.equal(r4.session.gateStatus, "complete");

  // One audited row per read, in order, with the stage recorded as the check kind.
  const checks = await store.listComprehensionChecks(ownerKey, session.id);
  assert.deepEqual(
    checks.map((check) => check.checkKind),
    ["context", "quantity", "target", "restatement"]
  );
  assert.ok(checks.every((check) => check.accepted));
});

test("a rejected read holds the gate on the same stage", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Read held" });
  await seedThreeReadsSession(store, session.id);

  const probe = {
    move: "three_reads_1",
    nextPhase: "frame_task",
    spokenUtterance: "Read it once more — what's happening in this story?"
  };

  fake = installVoiceProviders({
    gateChecker: { accepted: false, notes: "Just asked for the answer." },
    tutor: probe,
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "Just tell me the answer." },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.session.currentPhase, "frame_task");
  assert.equal(response.session.gateStatus, "needs_context_read");

  const checks = await store.listComprehensionChecks(ownerKey, session.id);
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.checkKind, "context");
  assert.equal(checks[0]?.accepted, false);
});

test("does not grade numeric answers during plan_first_step", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Plan phase guard" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "plan_first_step",
    gateStatus: "complete",
    supportLevel: 0
  });

  const elicit = {
    move: "elicit",
    nextPhase: "plan_first_step",
    spokenUtterance: "What's the very first move — not the answer?"
  };

  fake = installVoiceProviders({ tutor: elicit, tts: new Uint8Array([1]) });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "24?" },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.lesson.studentStatus, "unknown");
  assert.doesNotMatch(fake.calls.tutorBodies()[0] ?? "", /separate verifier already graded/i);

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.events.some((event) => event.message === "Step verify"), false);
});

test("grades a wrong numeric step before the generator and projects stuck status", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier wrong" });
  await seedStepLoopSession(store, session.id);

  const redirect = {
    move: "feedback_with_why",
    nextPhase: "step_loop",
    spokenUtterance: "24 is all the stickers — how many friends get one?"
  };

  fake = installVoiceProviders({ tutor: redirect, tts: new Uint8Array([1]) });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "24?" },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.lesson.studentStatus, "stuck");
  const tutorPrompt = fake.calls.tutorBodies()[0] ?? "";
  assert.match(tutorPrompt, /separate verifier already graded/i);
  assert.match(tutorPrompt, /studentStatus.*incorrect/);

  const detail = await store.getSession(ownerKey, session.id);
  const verifyEvent = detail?.events.find((event) => event.message === "Step verify");
  assert.ok(verifyEvent);
  assert.equal((verifyEvent.value as { studentStatus?: string }).studentStatus, "incorrect");

  const tutorTurn = detail?.events.find((event) => event.message === "Tutor turn");
  assert.equal((tutorTurn?.value as { verdict?: { chip?: string } }).verdict?.chip, "retry");
  assert.ok(detail?.session.activeStep);
  assert.equal(detail?.session.supportLevel, 2);
});

test("grades a correct numeric step and decrements support when the child explains", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier correct" });
  await seedStepLoopSession(store, session.id);

  const affirm = {
    move: "feedback_with_why",
    nextPhase: "step_loop",
    spokenUtterance: "Yes — one each for four friends is four stickers."
  };

  fake = installVoiceProviders({ tutor: affirm, tts: new Uint8Array([1]) });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "I think it's 4 because one for each friend" },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.lesson.studentStatus, "correct");
  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "answer_check",
      focusAsk: "How many stickers does each friend get?",
      gateStatus: "complete",
      goalStatus: "framed",
      scaffoldAid: "24 ÷ 4",
      studentStatus: "correct",
      supportLevel: 0,
      unknownTarget: sharingFrame.unknownTarget
    })
  );
});

test("grades the final answer and advances to memory_write", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Answer check" });
  await seedAnswerCheckSession(store, session.id);

  const affirm = {
    move: "feedback_with_why",
    nextPhase: "answer_check",
    spokenUtterance: "Yes — six stickers each!"
  };

  fake = installVoiceProviders({ tutor: affirm, tts: new Uint8Array([1]) });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "6 stickers each" },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.lesson.studentStatus, "correct");
  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "memory_write",
      focusAsk: "What helped you figure it out?",
      gateStatus: "complete",
      goalStatus: "complete",
      studentStatus: "correct",
      supportLevel: 0,
      unknownTarget: sharingFrame.unknownTarget
    })
  );

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "memory_write");
  const checkEvent = detail?.events.find((event) => event.message === "Answer check");
  assert.ok(checkEvent);
});

test("grades a non-equal-sharing step through the LLM verifier track", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "LLM verifier" });
  await seedNonSharingStepLoop(store, session.id);

  const affirm = {
    move: "feedback_with_why",
    nextPhase: "step_loop",
    spokenUtterance: "Yes — twenty pencils, because five groups of four is twenty."
  };

  fake = installVoiceProviders({
    verifier: { studentStatus: "correct" },
    tutor: affirm,
    tts: new Uint8Array([1])
  });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "I think there are twenty pencils in total" },
    voiceServiceEnv,
    store,
    context
  );

  assert.equal(response.lesson.studentStatus, "correct");
  assert.match(fake.calls.tutorBodies()[0] ?? "", /separate verifier already graded/i);

  const detail = await store.getSession(ownerKey, session.id);
  const verifyEvent = detail?.events.find((event) => event.message === "Step verify");
  assert.ok(verifyEvent);
  assert.equal((verifyEvent.value as { method?: string }).method, "llm");
  assert.equal((verifyEvent.value as { studentStatus?: string }).studentStatus, "correct");
});

test("fails safe to unknown and tells the model not to self-certify when the verifier errors", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier down" });
  await seedNonSharingStepLoop(store, session.id);

  const probe = {
    move: "elicit",
    nextPhase: "step_loop",
    spokenUtterance: "Tell me how you worked that out."
  };

  // Silence the fail-safe log to keep test output clean (determinism is unaffected).
  const consoleError = console.error;
  console.error = () => undefined;
  try {
    fake = installVoiceProviders({
      verifier: { status: 500 },
      tutor: probe,
      tts: new Uint8Array([1])
    });

    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think it's twenty pencils" },
      voiceServiceEnv,
      store,
      context
    );

    assert.equal(response.lesson.studentStatus, "unknown");
    assert.match(fake.calls.tutorBodies()[0] ?? "", /could NOT confirm/i);

    const detail = await store.getSession(ownerKey, session.id);
    const verifyEvent = detail?.events.find((event) => event.message === "Step verify");
    assert.ok(verifyEvent);
    assert.equal((verifyEvent.value as { studentStatus?: string }).studentStatus, "unknown");
    // Unknown must never advance the phase — only a confirmed correct does.
    assert.equal(detail?.session.currentPhase, "step_loop");
  } finally {
    console.error = consoleError;
  }
});

test("persists reflection and advances to wrap_up", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Reflection" });
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

  const reflect = {
    move: "elicit",
    nextPhase: "memory_write",
    spokenUtterance: "Nice — drawing it out really helped."
  };

  fake = installVoiceProviders({ tutor: reflect, tts: new Uint8Array([1]) });

  const response = await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: "Drawing one for each friend helped me see it." },
    voiceServiceEnv,
    store,
    context
  );

  assert.deepEqual(
    response.session,
    sessionState({
      currentPhase: "wrap_up",
      focusAsk: "Nice work — you finished this problem!",
      gateStatus: "complete",
      goalStatus: "complete",
      unknownTarget: sharingFrame.unknownTarget
    })
  );

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.reflection?.reflectionText, "Drawing one for each friend helped me see it.");
  assert.equal(detail?.session.currentPhase, "wrap_up");
});

// `multiplicationFrame` is exercised by the seedNonSharingStepLoop helper above; keep the
// import live so the frame's shape stays part of this module's compiled contract.
void multiplicationFrame;
