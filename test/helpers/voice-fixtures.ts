/**
 * Shared fixtures for the voice-pipeline tests: the problem frames, the session seed
 * helpers, the request context, the env, and the canonical image payload.
 *
 * Provider-neutral: nothing here names OpenAI, a URL, or a wire shape.
 */

import type { VoicePipelineSessionState } from "../../src/modules/voice/voice-types.js";
import type { VoicePipelineServiceEnv } from "../../src/modules/voice/voice-pipeline-service.js";
import type { RequestContext } from "../../src/core/request-context.js";
import { MemorySessionStore } from "../../src/modules/sessions/memory-session-store.js";
import type { ProblemFrame } from "../../src/modules/problems/problem-frame.js";

export const ownerKey = "access:test-user";

export const context: RequestContext = {
  identity: { userId: "test-user" },
  ownerKey
};

export const voiceServiceEnv: VoicePipelineServiceEnv = {
  OPENAI_API_KEY: "test-key",
  OPENAI_GATE_CHECKER_MODEL: undefined,
  OPENAI_TRANSCRIBE_MODEL: undefined,
  OPENAI_TTS_MODEL: undefined,
  OPENAI_TTS_VOICE: undefined,
  OPENAI_TUTOR_MODEL: undefined
};

export const problemImage = {
  dataUrl: "data:image/jpeg;base64,abc",
  height: 960,
  mimeType: "image/jpeg",
  name: "problem.jpg",
  size: 112298,
  width: 1280
} as const;

export const sharingFrame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "24 stickers are shared equally among 4 friends.",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [
    { label: "stickers", raw: "24" },
    { label: "friends", raw: "4" }
  ],
  relationships: ["shared equally among 4 friends"],
  taskLanguage: "en",
  unknownTarget: "how many stickers each friend gets",
  visibleQuestion: "How many stickers does each friend get?"
};

export const multiplicationFrame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "There are 5 boxes of 4 pencils. How many pencils are there in total?",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [
    { label: "boxes", raw: "5" },
    { label: "pencils per box", raw: "4" }
  ],
  relationships: ["5 boxes of 4 pencils each"],
  taskLanguage: "en",
  unknownTarget: "how many pencils in total",
  visibleQuestion: "How many pencils are there in total?"
};

/** Builds a session state object with documented defaults; tests override the phase bits. */
export function sessionState(
  overrides: Partial<VoicePipelineSessionState>
): VoicePipelineSessionState {
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

/** Saves the sharing frame and advances into the gate at a given read status. */
export async function seedGateSession(
  store: MemorySessionStore,
  sessionId: string,
  gateStatus: "needs_restatement" | "needs_context_read" | "needs_quantity_read" | "needs_target_read" = "needs_restatement"
): Promise<void> {
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
    gateStatus,
    supportLevel: 0
  });
}

/** The standard pre-gate session: problem framed, session waiting on its first read. */
export async function seedThreeReadsSession(
  store: MemorySessionStore,
  sessionId: string
): Promise<void> {
  await seedGateSession(store, sessionId, "needs_context_read");
}

/**
 * The kickoff pre-state: problem framed and the gate seeded, but the session is still at
 * `session_open` waiting for the tutor to open. Distinct from seedThreeReadsSession (which
 * advances into frame_task) — the kickoff guard rejects anything that isn't session_open.
 */
export async function seedKickoffSession(
  store: MemorySessionStore,
  sessionId: string
): Promise<void> {
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId
  });
  await store.advanceSessionPhase(ownerKey, sessionId, "session_open", {
    activeStep: null,
    currentPhase: "session_open",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });
}

/** A step-loop session seeded at support level 1 with the sharing frame. */
export async function seedStepLoopSession(
  store: MemorySessionStore,
  sessionId: string
): Promise<void> {
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

/** A step-loop session against a non-sharing frame, forcing the LLM verifier track. */
export async function seedNonSharingStepLoop(
  store: MemorySessionStore,
  sessionId: string
): Promise<void> {
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

/** Seeds the final-answer step so the turn grades it and advances to memory_write. */
export async function seedAnswerCheckSession(
  store: MemorySessionStore,
  sessionId: string
): Promise<void> {
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
