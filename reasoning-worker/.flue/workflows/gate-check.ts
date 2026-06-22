// Flue workflow: gate-check.
//
// Worker A's checkGateStage builds the full scrubbed gate-check prompt (stage rubric +
// scrubbed problem frame + student text) and ships it in `payload.input`. This workflow
// is a pure model executor: it creates an agent with NO stage instructions of its own
// (see docs/adr/0001-flue-reasoning-worker.md — Flue has no per-call `instructions`
// override, so the dynamic prompt must travel as the input) and returns the model's
// structured verdict. Worker A applies its extra domain validation
// (parseGateCheckerVerdict) to this output.
//
// The valibot `result` schema is the single structured-output contract across the
// binding; it replaces the strict JSON-schema request shape on this side. It mirrors the
// current gateCheckerJsonSchema: { accepted: boolean, notes: string | null }.
import { createAgent, type FlueContext, type WorkflowRouteHandler } from "@flue/runtime";
import * as v from "valibot";

// Default route handler: no auth between workers (platform identity via the service
// binding). If Worker B is ever exposed publicly, add HMAC verification here before
// next() — see the plan §3 "Auth between workers".
export const route: WorkflowRouteHandler = async (_context, next) => next();

// The agent carries only the model specifier — the full prompt arrives per-call in the
// payload. The model comes from the REASONING_MODEL var (provider/model string), so
// swapping providers is a config change in wrangler.jsonc, not a code change here.
const gateChecker = createAgent(() => ({
  model: process.env.REASONING_MODEL ?? "openai/gpt-5.5"
}));

// The shared structured-output contract. Mirrors the OpenAI gateCheckerJsonSchema so
// Worker A's parseGateCheckerVerdict sees the same shape it always has.
export const gateCheckResult = v.object({
  accepted: v.boolean(),
  notes: v.union([v.string(), v.null()])
});

export type GateCheckPayload = {
  // The complete scrubbed gate-check prompt Worker A assembled (rubric + frame + text).
  input: string;
  // Optional per-call model override (`provider/model` string). Worker A ships the stage's
  // current model from the DB-backed settings; when absent, the agent's env-based model
  // (REASONING_MODEL) is used. Keeping the env fallback means Worker B still runs standalone.
  model?: string;
};

export async function run({ init, payload }: FlueContext<GateCheckPayload>) {
  const harness = await init(gateChecker);
  const session = await harness.session();

  const { data } = await session.prompt(payload.input, {
    result: gateCheckResult,
    ...(payload.model ? { model: payload.model } : {})
  });

  return data;
}
