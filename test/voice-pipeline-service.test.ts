import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/modules/sessions/memory-session-store.js";
import { handleVoicePipelineTurnWithStore } from "../dist/modules/voice/voice-pipeline-service.js";
import type { RequestContext } from "../src/core/request-context.ts";

const ownerKey = "access:test-user";

const context: RequestContext = {
  identity: { userId: "test-user" },
  ownerKey
};

const env = {
  OPENAI_API_KEY: "test-key",
  OPENAI_GATE_CHECKER_MODEL: undefined,
  OPENAI_TRANSCRIBE_MODEL: undefined,
  OPENAI_TTS_MODEL: undefined,
  OPENAI_TTS_VOICE: undefined,
  OPENAI_TUTOR_MODEL: undefined
};

const problemImage = {
  dataUrl: "data:image/jpeg;base64,abc",
  height: 960,
  mimeType: "image/jpeg",
  name: "problem.jpg",
  size: 112298,
  width: 1280
};

const sharingFrame = {
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

function sessionState(
  overrides: Partial<import("../src/modules/voice/voice-types.ts").VoicePipelineSessionState>
): import("../src/modules/voice/voice-types.ts").VoicePipelineSessionState {
  return {
    currentPhase: "session_open",
    focusAsk: null,
    gateStatus: null,
    goalStatus: "empty",
    outputLanguageLabel: null,
    scaffoldAid: null,
    studentStatus: "unknown",
    supportLevel: 0,
    unknownTarget: null,
    ...overrides
  };
}

function isGateCheckerRequest(init?: RequestInit): boolean {
  if (!init?.body) {
    return false;
  }

  const body = JSON.parse(String(init.body)) as { instructions?: string };
  return body.instructions?.includes("comprehension-gate checker") ?? false;
}

async function seedGateSession(store: MemorySessionStore, sessionId: string): Promise<void> {
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId
  });
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_restatement",
    supportLevel: 0
  });
}

test("projects a validated turn to the legacy public lesson shape and advances the phase", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Hi there! Ready to read this problem together?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(action) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, action.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "Help me understand this problem step by step." },
      env,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads the tutor action from response output content", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const action = {
    move: "recall_prior",
    nextPhase: "session_open",
    spokenUtterance: "Have you solved a sharing problem like this before?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({
        output: [
          {
            content: [{ text: JSON.stringify(action), type: "output_text" }],
            role: "assistant",
            type: "message"
          }
        ]
      });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, action.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "Help me understand this problem step by step." },
      env,
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
    assert.deepEqual(response.session, sessionState({ currentPhase: "session_open" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribes recorder audio and runs the turn from the transcript", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline audio test" });
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([5, 6, 7, 8]);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Great — shall we read what the problem is asking?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      assert.ok(init?.body instanceof FormData);
      const audioFile = init.body.get("file");
      assert.ok(audioFile instanceof Blob);
      assert.equal(audioFile.type, "audio/webm");
      return Response.json({ text: "Subtract the library amount from the total." });
    }

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(action) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, action.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
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
      env,
      store,
      context
    );

    assert.equal(response.transcript, "Subtract the library amount from the total.");
    assert.equal(response.tutorText, action.spokenUtterance);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a solving move during the comprehension gate before reaching TTS", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate test" });
  await seedGateSession(store, session.id);

  const originalFetch = globalThis.fetch;
  let speechCalls = 0;
  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 sweets each." };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: false, notes: "Not a restatement." }) });
      }

      return Response.json({ output_text: JSON.stringify(solve) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      speechCalls += 1;
      return new Response(new Uint8Array([0]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      handleVoicePipelineTurnWithStore(
        { image: problemImage, sessionId: session.id, text: "Just tell me the answer." },
        env,
        store,
        context
      ),
      /valid turn/
    );

    assert.equal(speechCalls, 0);
    const detail = await store.getSession(ownerKey, session.id);
    assert.equal(detail?.session.currentPhase, "frame_task");
    assert.notEqual(detail?.session.gateStatus, "complete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("re-asks the generator when the first move is illegal, then accepts a legal one", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Retry test" });
  await seedGateSession(store, session.id);

  const originalFetch = globalThis.fetch;
  let tutorCalls = 0;
  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 sweets each." };
  const restate = {
    move: "restate_prompt",
    nextPhase: "frame_task",
    spokenUtterance: "In your own words, what are we trying to find?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: false, notes: "Keep going." }) });
      }

      tutorCalls += 1;
      return Response.json({ output_text: JSON.stringify(tutorCalls === 1 ? solve : restate) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "I think we share them out." },
      env,
      store,
      context
    );

    assert.equal(tutorCalls, 2);
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

    const detail = await store.getSession(ownerKey, session.id);
    assert.equal(detail?.session.currentPhase, "frame_task");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not advance past the gate until the gate-checker accepts a restatement", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate advance test" });
  await seedGateSession(store, session.id);

  const originalFetch = globalThis.fetch;
  const plan = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Nice — ready for the first tiny step?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: false, notes: "Not yet." }) });
      }

      return Response.json({ output_text: JSON.stringify(plan) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Just divide it." },
      env,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("advances past the gate only after the gate-checker accepts a valid restatement", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate pass test" });
  await seedGateSession(store, session.id);

  const originalFetch = globalThis.fetch;
  const plan = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Great restatement — what's our first tiny step?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: true, notes: null }) });
      }

      return Response.json({ output_text: JSON.stringify(plan) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "We need to find how many stickers each friend gets." },
      env,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  const originalFetch = globalThis.fetch;
  let gateCheckerCalls = 0;
  const plan = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Ready to plan the first step?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        gateCheckerCalls += 1;
        return Response.json({ output_text: JSON.stringify({ accepted: false, notes: "Should not run." }) });
      }

      return Response.json({ output_text: JSON.stringify(plan) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "We need to find how many stickers each friend gets." },
      env,
      store,
      context
    );

    assert.equal(gateCheckerCalls, 0);
    assert.deepEqual(
      response.session,
      sessionState({
        currentPhase: "plan_first_step",
        gateStatus: "complete",
        goalStatus: "framed",
        unknownTarget: sharingFrame.unknownTarget
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function seedThreeReadsSession(store: MemorySessionStore, sessionId: string): Promise<void> {
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId
  });
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });
}

test("requires all three reads plus a restatement before solving unlocks", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Three Reads walk" });
  await seedThreeReadsSession(store, session.id);

  const originalFetch = globalThis.fetch;
  // The tutor tries to move on to planning every single turn; only the gate FSM,
  // not the model, decides when that's actually allowed.
  const push = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "Tell me more about this problem."
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: true, notes: null }) });
      }

      return Response.json({ output_text: JSON.stringify(push) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  async function takeTurn(text: string) {
    return handleVoicePipelineTurnWithStore({ sessionId: session.id, text }, env, store, context);
  }

  try {
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a rejected read holds the gate on the same stage", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Read held" });
  await seedThreeReadsSession(store, session.id);

  const originalFetch = globalThis.fetch;
  const probe = {
    move: "three_reads_1",
    nextPhase: "frame_task",
    spokenUtterance: "Read it once more — what's happening in this story?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isGateCheckerRequest(init)) {
        return Response.json({ output_text: JSON.stringify({ accepted: false, notes: "Just asked for the answer." }) });
      }

      return Response.json({ output_text: JSON.stringify(probe) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Just tell me the answer." },
      env,
      store,
      context
    );

    assert.equal(response.session.currentPhase, "frame_task");
    assert.equal(response.session.gateStatus, "needs_context_read");

    const checks = await store.listComprehensionChecks(ownerKey, session.id);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.checkKind, "context");
    assert.equal(checks[0]?.accepted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function seedStepLoopSession(store: MemorySessionStore, sessionId: string): Promise<void> {
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId
  });
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep: null,
    currentPhase: "step_loop",
    gateStatus: "complete",
    supportLevel: 1
  });
}

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

  const originalFetch = globalThis.fetch;
  let tutorPrompt = "";
  const elicit = {
    move: "elicit",
    nextPhase: "plan_first_step",
    spokenUtterance: "What's the very first move — not the answer?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      tutorPrompt = String(init?.body ?? "");
      return Response.json({ output_text: JSON.stringify(elicit) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "24?" },
      env,
      store,
      context
    );

    assert.equal(response.lesson.studentStatus, "unknown");
    assert.doesNotMatch(tutorPrompt, /separate verifier already graded/i);

    const detail = await store.getSession(ownerKey, session.id);
    assert.equal(detail?.events.some((event) => event.message === "Step verify"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("grades a wrong numeric step before the generator and projects stuck status", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier wrong" });
  await seedStepLoopSession(store, session.id);

  const originalFetch = globalThis.fetch;
  let tutorPrompt = "";
  const redirect = {
    move: "feedback_with_why",
    nextPhase: "step_loop",
    spokenUtterance: "24 is all the stickers — how many friends get one?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      tutorPrompt = String(init?.body ?? "");
      return Response.json({ output_text: JSON.stringify(redirect) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "24?" },
      env,
      store,
      context
    );

    assert.equal(response.lesson.studentStatus, "stuck");
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("grades a correct numeric step and decrements support when the child explains", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier correct" });
  await seedStepLoopSession(store, session.id);

  const originalFetch = globalThis.fetch;
  const affirm = {
    move: "feedback_with_why",
    nextPhase: "step_loop",
    spokenUtterance: "Yes — one each for four friends is four stickers."
  };

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(affirm) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think it's 4 because one for each friend" },
      env,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function seedAnswerCheckSession(store: MemorySessionStore, sessionId: string): Promise<void> {
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId
  });
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep: {
      ask: "How many stickers does each friend get?",
      defaultWrongNudge: "Not quite — how many does each friend get after sharing equally?",
      distractorNudges: { "24": "That's the total — we need how many each friend gets." },
      expectedAnswers: [6],
      scaffoldAid: "24 ÷ 4"
    },
    currentPhase: "answer_check",
    gateStatus: "complete",
    supportLevel: 0
  });
}

test("grades the final answer and advances to memory_write", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Answer check" });
  await seedAnswerCheckSession(store, session.id);

  const originalFetch = globalThis.fetch;
  const affirm = {
    move: "feedback_with_why",
    nextPhase: "answer_check",
    spokenUtterance: "Yes — six stickers each!"
  };

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(affirm) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "6 stickers each" },
      env,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const multiplicationFrame = {
  diagramDescription: null,
  extractedText: "There are 5 boxes of 4 pencils. How many pencils are there in total?",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem" as const,
  quantities: [
    { label: "boxes", raw: "5" },
    { label: "pencils per box", raw: "4" }
  ],
  relationships: ["5 boxes of 4 pencils each"],
  taskLanguage: "en",
  unknownTarget: "how many pencils in total",
  visibleQuestion: "How many pencils are there in total?"
};

function isVerifierRequest(init?: RequestInit): boolean {
  if (!init?.body) {
    return false;
  }

  const body = JSON.parse(String(init.body)) as { instructions?: string };
  return body.instructions?.includes("narrow answer verifier") ?? false;
}

async function seedNonSharingStepLoop(store: MemorySessionStore, sessionId: string): Promise<void> {
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: multiplicationFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId
  });
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep: null,
    currentPhase: "step_loop",
    gateStatus: "complete",
    supportLevel: 1
  });
}

test("grades a non-equal-sharing step through the LLM verifier track", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "LLM verifier" });
  await seedNonSharingStepLoop(store, session.id);

  const originalFetch = globalThis.fetch;
  let tutorPrompt = "";
  const affirm = {
    move: "feedback_with_why",
    nextPhase: "step_loop",
    spokenUtterance: "Yes — twenty pencils, because five groups of four is twenty."
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isVerifierRequest(init)) {
        return Response.json({
          output_text: JSON.stringify({
            confidence: "high",
            correctionHint: null,
            misconceptionKey: null,
            studentStatus: "correct"
          })
        });
      }

      tutorPrompt = String(init?.body ?? "");
      return Response.json({ output_text: JSON.stringify(affirm) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think there are twenty pencils in total" },
      env,
      store,
      context
    );

    assert.equal(response.lesson.studentStatus, "correct");
    assert.match(tutorPrompt, /separate verifier already graded/i);

    const detail = await store.getSession(ownerKey, session.id);
    const verifyEvent = detail?.events.find((event) => event.message === "Step verify");
    assert.ok(verifyEvent);
    assert.equal((verifyEvent.value as { method?: string }).method, "llm");
    assert.equal((verifyEvent.value as { studentStatus?: string }).studentStatus, "correct");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails safe to unknown and tells the model not to self-certify when the verifier errors", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Verifier down" });
  await seedNonSharingStepLoop(store, session.id);

  const originalFetch = globalThis.fetch;
  let tutorPrompt = "";
  const probe = {
    move: "elicit",
    nextPhase: "step_loop",
    spokenUtterance: "Tell me how you worked that out."
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      if (isVerifierRequest(init)) {
        return new Response("upstream error", { status: 500 });
      }

      tutorPrompt = String(init?.body ?? "");
      return Response.json({ output_text: JSON.stringify(probe) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think it's twenty pencils" },
      env,
      store,
      context
    );

    assert.equal(response.lesson.studentStatus, "unknown");
    assert.match(tutorPrompt, /could NOT confirm/i);

    const detail = await store.getSession(ownerKey, session.id);
    const verifyEvent = detail?.events.find((event) => event.message === "Step verify");
    assert.ok(verifyEvent);
    assert.equal((verifyEvent.value as { studentStatus?: string }).studentStatus, "unknown");
    // Unknown must never advance the phase — only a confirmed correct does.
    assert.equal(detail?.session.currentPhase, "step_loop");
  } finally {
    globalThis.fetch = originalFetch;
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

  const originalFetch = globalThis.fetch;
  const reflect = {
    move: "elicit",
    nextPhase: "memory_write",
    spokenUtterance: "Nice — drawing it out really helped."
  };

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(reflect) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "Drawing one for each friend helped me see it." },
      env,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
