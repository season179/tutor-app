import assert from "node:assert/strict";

import { checkGateRestatement, checkGateStage } from "../src/modules/tutoring/gate-checker.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";

const frame = {
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

// checkGateStage reaches the model through the REASONING binding; each test installs a fake
// carrying the gateChecker slot. The env reads the binding off the installed fake.
let fake: VoiceProviderFake | null = null;
function env() {
  return { REASONING: fake?.reasoning };
}
afterEach(() => {
  fake?.restore();
  fake = null;
});

test("checkGateStage sends a stage-specific rubric and the stage name as the read", async () => {
  const stages = ["context", "quantity", "target", "restatement"] as const;
  const markers: Record<(typeof stages)[number], RegExp> = {
    context: /READ 1 \(context\)/,
    quantity: /READ 2 \(quantities\)/,
    target: /READ 3 \(the question\)/,
    restatement: /FULL restatement/
  };

  for (const stage of stages) {
    fake = installVoiceProviders({ gateChecker: { accepted: true, notes: null } });

    const verdict = await checkGateStage(stage, frame, "my words about it", env());

    assert.equal(verdict.accepted, true);
    assert.equal(fake.calls.counts.gateChecker, 1);

    // The rubric + the comprehension-gate marker travel in the workflow input, and the
    // stage name is encoded as the `read` field in the JSON payload.
    const input = fake.calls.workflowInputs("gateChecker")[0] ?? "";
    assert.match(input, /comprehension-gate checker/);
    assert.match(input, markers[stage]);
    assert.match(input, new RegExp(`"read"\\s*:\\s*"${stage}"`));
  }
});

test("checkGateStage short-circuits empty student text without calling the model", async () => {
  fake = installVoiceProviders({ gateChecker: { accepted: true, notes: null } });

  const verdict = await checkGateStage("context", frame, "   ", env());

  assert.equal(verdict.accepted, false);
  assert.equal(fake.calls.counts.gateChecker, 0);
});

test("checkGateRestatement is the restatement-stage check", async () => {
  fake = installVoiceProviders({ gateChecker: { accepted: true, notes: null } });

  await checkGateRestatement(frame, "We need to find how many each friend gets.", env());

  assert.equal(fake.calls.counts.gateChecker, 1);
  assert.match(fake.calls.workflowInputs("gateChecker")[0] ?? "", /FULL restatement/);
});
