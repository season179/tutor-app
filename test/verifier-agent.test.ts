import assert from "node:assert/strict";
import test from "node:test";

import { runVerifierAgent } from "../dist/modules/tutoring/verifier-agent.js";
import type { ProblemFrame } from "../src/modules/problems/problem-frame.ts";

const env = {
  OPENAI_API_KEY: "test-key",
  OPENAI_TUTOR_MODEL: undefined,
  OPENAI_VERIFIER_MODEL: undefined
};

const frame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "There were 150 books. 80 were borrowed. How many books are left?",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [
    { label: "books", raw: "150" },
    { label: "borrowed", raw: "80" }
  ],
  relationships: ["80 were borrowed"],
  taskLanguage: "en",
  unknownTarget: "how many books are left",
  visibleQuestion: "How many books are left?"
};

test("runVerifierAgent sends a strict-JSON grading request and parses the verdict", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = "";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    sentBody = String(init?.body ?? "");
    return Response.json({
      output_text: JSON.stringify({
        confidence: "high",
        correctionHint: null,
        misconceptionKey: null,
        studentStatus: "correct"
      })
    });
  }) as typeof fetch;

  try {
    const verdict = await runVerifierAgent(
      { frame, kind: "final_answer", question: frame.visibleQuestion, studentText: "70 books are left" },
      env
    );

    assert.equal(verdict.studentStatus, "correct");
    assert.equal(verdict.confidence, "high");
    assert.equal(verdict.correctionHint, null);

    const body = JSON.parse(sentBody) as {
      instructions: string;
      text: { format: { name: string; strict: boolean } };
    };
    assert.match(body.instructions, /narrow answer verifier/i);
    assert.equal(body.text.format.name, "verifier_verdict");
    assert.equal(body.text.format.strict, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runVerifierAgent never sends a worked answer to the model", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = "";
  const leaky: ProblemFrame = {
    ...frame,
    extractedText: "How many books are left? The answer is 70.",
    relationships: ["150 − 80 = 70"],
    unknownTarget: "70"
  };

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentBody = String(init?.body ?? "");
    return Response.json({
      output_text: JSON.stringify({
        confidence: "low",
        correctionHint: null,
        misconceptionKey: null,
        studentStatus: "unknown"
      })
    });
  }) as typeof fetch;

  try {
    await runVerifierAgent({ frame: leaky, kind: "final_answer", question: "How many are left?", studentText: "um" }, env);

    assert.doesNotMatch(sentBody, /answer is\s*70/i, "worked answer phrasing must be scrubbed");
    assert.doesNotMatch(sentBody, /=\s*70/, "trailing computed answer must be scrubbed");

    const body = JSON.parse(sentBody) as { input: Array<{ content: Array<{ text: string }> }> };
    const userText = body.input[0]!.content[0]!.text;
    assert.doesNotMatch(userText, /"unknownTarget":\s*"70"/, "a numeric-only target is the answer in disguise");
    assert.match(userText, /"raw":\s*"150"/, "givens are preserved");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runVerifierAgent rejects an out-of-enum verdict", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> =>
    Response.json({
      output_text: JSON.stringify({
        confidence: "high",
        correctionHint: null,
        misconceptionKey: null,
        studentStatus: "maybe"
      })
    })) as typeof fetch;

  try {
    await assert.rejects(
      runVerifierAgent({ frame, kind: "step", question: "x", studentText: "y" }, env),
      /verifier/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
