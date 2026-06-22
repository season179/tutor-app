// Flue workflow: verifier.
//
// Worker A's runVerifierAgent builds the full scrubbed verifier prompt (the narrow
// answer-verifier instructions + the scrubbed problem frame + the question + the student
// text) and ships it in `payload.input`. This workflow is a pure model executor — no
// stage instructions of its own (see docs/adr/0001-flue-reasoning-worker.md: Flue has no
// per-call `instructions` override) — and returns the model's structured verdict. Worker
// A wraps this in gradeStudentTurn, which is the ONLY fail-soft stage: a binding failure
// here propagates as HttpError into that try/catch and degrades to `unknown`, never
// killing the turn the way a gate/tutor failure does.
//
// The valibot `result` schema mirrors the current verifierJsonSchema
// ({ studentStatus, confidence, correctionHint, misconceptionKey }).
import { createAgent, type FlueContext, type WorkflowRouteHandler } from "@flue/runtime";
import * as v from "valibot";

// No auth between workers (platform identity via the service binding). See gate-check.ts.
export const route: WorkflowRouteHandler = async (_context, next) => next();

const verifier = createAgent(() => ({
  model: process.env.REASONING_MODEL ?? "openai/gpt-5.5"
}));

// The shared structured-output contract. Mirrors the OpenAI verifierJsonSchema so Worker
// A's parseVerifierVerdict sees the same shape it always has.
export const verifierResult = v.object({
  studentStatus: v.picklist([
    "correct",
    "partial",
    "incorrect",
    "stuck",
    "off_task",
    "unknown"
  ]),
  confidence: v.picklist(["low", "medium", "high"]),
  correctionHint: v.union([v.string(), v.null()]),
  misconceptionKey: v.union([v.string(), v.null()])
});

export type VerifierPayload = {
  // The complete scrubbed verifier prompt Worker A assembled (instructions + frame + text).
  input: string;
  // Optional per-call model override (`provider/model`). See gate-check.ts for the rationale;
  // falls back to the agent's env-based model (REASONING_MODEL) when absent.
  model?: string;
};

export async function run({ init, payload }: FlueContext<VerifierPayload>) {
  const harness = await init(verifier);
  const session = await harness.session();

  const { data } = await session.prompt(payload.input, {
    result: verifierResult,
    ...(payload.model ? { model: payload.model } : {})
  });

  return data;
}
