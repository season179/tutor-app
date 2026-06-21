import assert from "node:assert/strict";

import { deriveFirstCheckableStep } from "../src/modules/tutoring/active-step.ts";
import { gradeStudentTurn, shouldGradeTurn } from "../src/modules/tutoring/verifier.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";
import type { ProblemFrame } from "../src/modules/problems/problem-frame.ts";

let fake: VoiceProviderFake | null = null;
function env() {
  return {
    OPENAI_TUTOR_MODEL: undefined,
    OPENAI_VERIFIER_MODEL: undefined,
    REASONING: fake?.reasoning
  };
}
afterEach(() => {
  fake?.restore();
  fake = null;
});

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
    env()
  );
  assert.equal(verdict, null);
});

test("gradeStudentTurn uses the deterministic track when there is a numeric answer key", async () => {
  // No verifier slot configured: a binding call would assert-fail, proving the deterministic
  // track graded the turn without reaching the model.
  fake = installVoiceProviders({});
  const step = deriveFirstCheckableStep(sharingFrame)!;
  const verdict = await gradeStudentTurn(
    { activeStep: step, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "4" },
    env()
  );

  assert.ok(verdict);
  assert.equal(verdict.method, "deterministic");
  assert.equal(verdict.studentStatus, "correct");
  assert.equal(verdict.studentAnswer, 4);
  assert.equal(fake.calls.counts.verifier, 0);
});

test("gradeStudentTurn falls back to the LLM track when nothing is computable", async () => {
  fake = installVoiceProviders({ verifier: { studentStatus: "correct", confidence: "medium" } });

  const verdict = await gradeStudentTurn(
    {
      activeStep: null,
      frame: sharingFrame,
      gateStatus: "complete",
      lastTutorAsk: "What did you get?",
      phase: "answer_check",
      studentText: "I shared them out and each friend got the same amount"
    },
    env()
  );

  assert.ok(verdict);
  assert.equal(verdict.method, "llm");
  assert.equal(verdict.studentStatus, "correct");
  assert.equal(verdict.studentAnswer, null);
  assert.equal(verdict.correctionHint, null);
});

test("gradeStudentTurn scrubs a worked answer out of the LLM correction hint", async () => {
  fake = installVoiceProviders({
    verifier: {
      studentStatus: "incorrect",
      confidence: "high",
      correctionHint: "The answer is 6 — try sharing them one at a time.",
      misconceptionKey: "used_total_not_share"
    }
  });

  const verdict = await gradeStudentTurn(
    { activeStep: null, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "24" },
    env()
  );

  assert.ok(verdict);
  assert.equal(verdict.studentStatus, "incorrect");
  assert.equal(verdict.misconceptionKey, "used_total_not_share");
  assert.doesNotMatch(verdict.correctionHint ?? "", /answer is\s*6/i);
  assert.match(verdict.correctionHint ?? "", /sharing them/i);
});

test("gradeStudentTurn fails safe to unknown when the verifier errors", async () => {
  // Silence the fail-safe log to keep test output clean.
  const consoleError = console.error;
  console.error = () => undefined;
  try {
    fake = installVoiceProviders({ verifier: { status: 500 } });

    const verdict = await gradeStudentTurn(
      { activeStep: null, frame: sharingFrame, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "maybe twelve?" },
      env()
    );

    assert.ok(verdict);
    assert.equal(verdict.studentStatus, "unknown");
    assert.equal(verdict.method, "llm");
  } finally {
    console.error = consoleError;
  }
});

test("gradeStudentTurn fails safe to unknown without a problem frame", async () => {
  fake = installVoiceProviders({});
  const verdict = await gradeStudentTurn(
    { activeStep: null, frame: null, gateStatus: "complete", lastTutorAsk: null, phase: "step_loop", studentText: "I think it's six" },
    env()
  );

  assert.ok(verdict);
  assert.equal(verdict.studentStatus, "unknown");
});
