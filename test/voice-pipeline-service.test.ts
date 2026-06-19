import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/memory-session-store.js";
import { handleVoicePipelineTurnWithStore } from "../dist/voice-pipeline-service.js";
import type { RequestContext } from "../src/request-context.ts";

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
  overrides: Partial<import("../src/voice-types.ts").VoicePipelineSessionState>
): import("../src/voice-types.ts").VoicePipelineSessionState {
  return {
    currentPhase: "session_open",
    focusAsk: null,
    gateStatus: null,
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
        unknownTarget: sharingFrame.unknownTarget
      })
    );
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
        currentPhase: "step_loop",
        focusAsk: "Give each friend 1 sticker first. How many stickers is that?",
        gateStatus: "complete",
        scaffoldAid: "4 friends · 1 sticker each",
        studentStatus: "correct",
        supportLevel: 0,
        unknownTarget: sharingFrame.unknownTarget
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
