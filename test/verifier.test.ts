import assert from "node:assert/strict";
import test from "node:test";

import { deriveFirstCheckableStep } from "../dist/modules/tutoring/active-step.js";
import { gradeStudentTurn, shouldGradeTurn } from "../dist/modules/tutoring/verifier.js";
import type { ProblemFrame } from "../src/modules/problems/problem-frame.ts";

const env = {
  OPENAI_API_KEY: "test-key",
  OPENAI_TUTOR_MODEL: undefined,
  OPENAI_VERIFIER_MODEL: undefined
};

const sharingFrame: ProblemFrame = {
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

function throwingFetch(): typeof fetch {
  return (async () => {
    throw new Error("verifier should not have made a network call");
  }) as typeof fetch;
}

test("shouldGradeTurn only fires in solving phases with the gate complete", () => {
  assert.equal(shouldGradeTurn("step_loop", "complete", "4"), true);
  assert.equal(shouldGradeTurn("answer_check", "complete", "6 each"), true);
  assert.equal(shouldGradeTurn("plan_first_step", "complete", "24"), false);
  assert.equal(shouldGradeTurn("step_loop", "needs_restatement", "4"), false);
  assert.equal(shouldGradeTurn("step_loop", "complete", "   "), false);
});

test("gradeStudentTurn returns null outside a grading turn", async () => {
  const verdict = await gradeStudentTurn(
    { activeStep: null, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "frame_task", studentText: "4" },
    env
  );
  assert.equal(verdict, null);
});

test("gradeStudentTurn uses the deterministic track when there is a numeric answer key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = throwingFetch();
  try {
    const step = deriveFirstCheckableStep(sharingFrame)!;
    const verdict = await gradeStudentTurn(
      { activeStep: step, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "4" },
      env
    );

    assert.ok(verdict);
    assert.equal(verdict.method, "deterministic");
    assert.equal(verdict.studentStatus, "correct");
    assert.equal(verdict.studentAnswer, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gradeStudentTurn falls back to the LLM track when nothing is computable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    Response.json({
      output_text: JSON.stringify({
        confidence: "medium",
        correctionHint: null,
        misconceptionKey: null,
        studentStatus: "correct"
      })
    })) as typeof fetch;

  try {
    const verdict = await gradeStudentTurn(
      {
        activeStep: null,
        frame: sharingFrame,
        gateStatus: "complete",
        lastTutorAsk: "What did you get?",
        phase: "answer_check",
        studentText: "I shared them out and each friend got the same amount"
      },
      env
    );

    assert.ok(verdict);
    assert.equal(verdict.method, "llm");
    assert.equal(verdict.studentStatus, "correct");
    assert.equal(verdict.studentAnswer, null);
    assert.equal(verdict.correctionHint, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gradeStudentTurn scrubs a worked answer out of the LLM correction hint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    Response.json({
      output_text: JSON.stringify({
        confidence: "high",
        correctionHint: "The answer is 6 — try sharing them one at a time.",
        misconceptionKey: "used_total_not_share",
        studentStatus: "incorrect"
      })
    })) as typeof fetch;

  try {
    const verdict = await gradeStudentTurn(
      { activeStep: null, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "24" },
      env
    );

    assert.ok(verdict);
    assert.equal(verdict.studentStatus, "incorrect");
    assert.equal(verdict.misconceptionKey, "used_total_not_share");
    assert.doesNotMatch(verdict.correctionHint ?? "", /answer is\s*6/i);
    assert.match(verdict.correctionHint ?? "", /sharing them/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gradeStudentTurn fails safe to unknown when the verifier errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const verdict = await gradeStudentTurn(
      { activeStep: null, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "maybe twelve?" },
      env
    );

    assert.ok(verdict);
    assert.equal(verdict.studentStatus, "unknown");
    assert.equal(verdict.method, "llm");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gradeStudentTurn fails safe to unknown without a problem frame", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = throwingFetch();
  try {
    const verdict = await gradeStudentTurn(
      { activeStep: null, frame: null, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "I think it's six" },
      env
    );

    assert.ok(verdict);
    assert.equal(verdict.studentStatus, "unknown");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
