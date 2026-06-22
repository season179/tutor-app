// Flue workflow: tutor-turn.
//
// Worker A's proposeTutorAction builds the full scrubbed tutor prompt per attempt — the
// move-generator instructions (phase, gate status, verifier verdict, accumulated rejection
// reasons from the re-ask loop) + the JSON prompt (problem frame, active step, recent
// history) — and ships it in `payload.input`. This workflow is a pure model executor (no
// stage instructions of its own; see docs/adr/0001-flue-reasoning-worker.md) and returns
// the proposed tutor action. Worker A applies `proposedTutorActionFromJson` +
// `validateTutorAction` to the result and re-asks (one binding call per attempt) if the
// action is illegal — the re-ask loop stays entirely in Worker A.
//
// A transient failure here propagates as HttpError(502) and kills the turn BEFORE
// commitTurn — the tutor is NOT fail-soft (fail closed: never retry past a successful
// commit, since TTS may have played).
//
// The valibot `result` schema mirrors proposedTutorActionJsonSchema
// ({ move, nextPhase, spokenUtterance }); enum membership is re-validated in Worker A.
import {
  createAgent,
  type FlueContext,
  type PromptImage,
  type WorkflowRouteHandler
} from "@flue/runtime";
import * as v from "valibot";

export const route: WorkflowRouteHandler = async (_context, next) => next();

// The tutor is the only stage that may run on a different model from the other three
// reasoning stages — the conversational LLM that consumes the transcript and emits the
// spoken reply is hot-swappable independently of the gate/verifier/extraction models. It
// falls back to REASONING_MODEL (the shared default) when TUTOR_MODEL is unset, so a
// deployment that wants all four stages on one model sets only REASONING_MODEL.
const tutor = createAgent(() => ({
  model: process.env.TUTOR_MODEL ?? process.env.REASONING_MODEL ?? "openai/gpt-5.5"
}));

// The shared structured-output contract. Mirrors the OpenAI proposedTutorActionJsonSchema
// so Worker A's proposedTutorActionFromJson sees the same shape. `move`/`nextPhase` are
// free strings here (the legal-enum set is phase-dependent and owned by Worker A); Worker A
// re-validates enum membership against the current phase.
export const tutorTurnResult = v.object({
  move: v.string(),
  nextPhase: v.string(),
  spokenUtterance: v.string()
});

export type TutorTurnPayload = {
  // The complete scrubbed tutor prompt Worker A assembled for this attempt (instructions +
  // JSON prompt). The rejection reasons from prior attempts are already woven into this.
  input: string;
  // An optional per-turn problem image, split into the Flue PromptImage fields. The
  // student can upload an image mid-turn; it rides alongside the prompt as a vision
  // attachment. Worker A splits the data URL into base64 `data` + `mimeType`.
  image?: PromptImage;
  // Optional per-call model override (`provider/model`). Worker A ships the tutor stage's
  // current model from the DB-backed settings; when absent, the agent's env-based model
  // (TUTOR_MODEL ?? REASONING_MODEL) is used. Keeping the env fallback means Worker B still
  // runs standalone.
  model?: string;
};

export async function run({ init, payload }: FlueContext<TutorTurnPayload>) {
  const harness = await init(tutor);
  const session = await harness.session();

  const response = await session.prompt(payload.input, {
    result: tutorTurnResult,
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.image ? { images: [payload.image] } : {})
  });

  return response.data;
}
