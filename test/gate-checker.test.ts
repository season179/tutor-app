import assert from "node:assert/strict";
import test from "node:test";

import { checkGateRestatement, checkGateStage } from "../dist/modules/tutoring/gate-checker.js";

const env = {
  OPENAI_API_KEY: "test-key",
  OPENAI_GATE_CHECKER_MODEL: undefined,
  OPENAI_TUTOR_MODEL: undefined
};

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

type GateCall = { instructions: string; read: string };

function captureGateCall(accepted: boolean): {
  fetch: typeof fetch;
  calls: GateCall[];
} {
  const calls: GateCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url !== "https://api.openai.com/v1/responses") {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    const body = JSON.parse(String(init?.body)) as {
      instructions: string;
      input: Array<{ content: Array<{ text: string }> }>;
    };
    const payload = JSON.parse(body.input[0]!.content[0]!.text) as { read: string };
    calls.push({ instructions: body.instructions, read: payload.read });

    return Response.json({ output_text: JSON.stringify({ accepted, notes: null }) });
  }) as typeof fetch;

  return { calls, fetch: fetchImpl };
}

test("checkGateStage sends a stage-specific rubric and the stage name as the read", async () => {
  const originalFetch = globalThis.fetch;
  const stages = ["context", "quantity", "target", "restatement"] as const;
  const markers: Record<(typeof stages)[number], RegExp> = {
    context: /READ 1 \(context\)/,
    quantity: /READ 2 \(quantities\)/,
    target: /READ 3 \(the question\)/,
    restatement: /FULL restatement/
  };

  try {
    for (const stage of stages) {
      const { calls, fetch: fetchImpl } = captureGateCall(true);
      globalThis.fetch = fetchImpl;

      const verdict = await checkGateStage(stage, frame, "my words about it", env);

      assert.equal(verdict.accepted, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.read, stage);
      assert.match(calls[0]!.instructions, /comprehension-gate checker/);
      assert.match(calls[0]!.instructions, markers[stage]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkGateStage short-circuits empty student text without calling the model", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("must not call the model for empty text");
  }) as typeof fetch;

  try {
    const verdict = await checkGateStage("context", frame, "   ", env);
    assert.equal(verdict.accepted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkGateRestatement is the restatement-stage check", async () => {
  const originalFetch = globalThis.fetch;
  const { calls, fetch: fetchImpl } = captureGateCall(true);
  globalThis.fetch = fetchImpl;

  try {
    await checkGateRestatement(frame, "We need to find how many each friend gets.", env);
    assert.equal(calls[0]?.read, "restatement");
    assert.match(calls[0]!.instructions, /FULL restatement/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
