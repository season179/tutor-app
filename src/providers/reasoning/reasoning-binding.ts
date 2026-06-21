import { HttpError, type JsonValue } from "../../core/http-error.js";
import { readLimitedTextBody } from "../../core/read-limited-text.js";
import { isJsonObject } from "../../core/schema-parser.js";

// Ceiling on a single reasoning call over the binding. The binding's `?wait=result`
// long-poll blocks until Worker B's workflow (a model call) finishes; without a deadline a
// hung Worker B would hold the turn open indefinitely. This restores the safety net the
// direct OpenAI calls had (AbortSignal.timeout), generous enough to cover the binding hop
// plus the model latency.
const reasoningWorkflowTimeoutMs = 60_000;

/**
 * Worker A's client for the REASONING service binding (Worker B, Flue).
 *
 * Every reasoning stage reuses this: Worker A builds the full scrubbed prompt and ships
 * it in `payload.input` (Flue has no per-call `instructions` override — see
 * docs/adr/0001-flue-reasoning-worker.md), then reads back the workflow's structured
 * `result`. The valibot schema on Worker B's side is the single source of truth for the
 * output shape; A's per-stage domain parser is applied to this helper's return value.
 *
 * Error mapping follows the plan §3 contract: this helper does NOT add a fail-soft layer.
 * A non-2xx from the binding (5xx, timeout, bad payload) throws `HttpError(502)`, which
 * is the same throw gate/tutor/extraction already make — so a transient Worker B failure
 * kills the turn (or the extraction) before commit, exactly as a direct OpenAI 5xx would.
 * The verifier is the only fail-soft stage, and its soft-fail lives in `gradeStudentTurn`'s
 * try/catch around `runVerifierAgent` (the HttpError propagates into that existing catch).
 */

export type ReasoningEnv = {
  /** The service binding to ai-tutor-reasoning. Absent in tests/local without the binding. */
  REASONING?: Fetcher | undefined;
};

/**
 * Combines a stage's dynamic `instructions` and its `input` text into the single string
 * Flue's `session.prompt(input)` receives. Flue composes the system prompt only from
 * AGENTS.md + agent-level `instructions` (set at createAgent time) — there is no per-call
 * `instructions` option on `session.prompt`. To keep turn behavior byte-for-byte under
 * that constraint, Worker A ships the full scrubbed prompt as the workflow `input`: the
 * instructions preamble, then the user input, in their existing order. The model reads
 * the same words it always has; only the system/user role split is flattened to one turn.
 */
export function composeReasoningInput(instructions: string, input: string): string {
  return `${instructions}\n\n${input}`;
}

/**
 * Calls a Flue workflow over the REASONING binding and returns its structured result.
 *
 * @param stage  Workflow filename (e.g. "gate-check") → POST /workflows/<stage>?wait=result.
 * @param input  The full scrubbed prompt (use `composeReasoningInput`).
 * @param env    Must carry `REASONING: Fetcher`.
 * @param extra  Optional extra payload fields (e.g. the tutor's per-turn image).
 * @returns      The workflow's parsed `result` object (shape validated by Worker B's valibot).
 */
export async function runReasoningWorkflow(
  stage: string,
  input: string,
  env: ReasoningEnv,
  extra?: Record<string, JsonValue>
): Promise<JsonValue> {
  const binding = env.REASONING;
  if (!binding) {
    throw new HttpError(502, "Reasoning service binding is not available.", {
      stage,
      reason: "REASONING binding absent"
    });
  }

  let response: Response;
  try {
    response = await binding.fetch(
      `https://reasoning.local/workflows/${encodeURIComponent(stage)}?wait=result`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `input` last so a stray `input` key in `extra` can never clobber the composed
        // prompt: the positional prompt always wins.
        body: JSON.stringify({ ...extra, input }),
        signal: AbortSignal.timeout(reasoningWorkflowTimeoutMs)
      }
    );
  } catch (error) {
    // A binding fetch that throws (network/timeout in the binding transport) maps to the
    // same HttpError(502) gate/tutor throw on a direct OpenAI failure.
    throw new HttpError(502, `Reasoning workflow "${stage}" call failed.`, {
      stage,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      `Reasoning workflow "${stage}" returned an error.`,
      await readWorkflowError(response)
    );
  }

  const text = await readWorkflowResultText(response);
  if (!text) {
    throw new HttpError(502, `Reasoning workflow "${stage}" returned no body.`, { stage });
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new HttpError(502, `Reasoning workflow "${stage}" returned invalid JSON.`, {
      stage,
      body: text.slice(0, 500),
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Flue's `?wait=result` wraps the workflow's return value in an envelope — Worker B
  // responds with `{ result, runId, streamUrl, offset }` (see @flue/runtime's
  // runSyncMode/runDirectSyncMode), NOT the bare workflow output. The per-stage domain
  // parsers (parseGateCheckerVerdict, parseVerifierVerdict, parseExtractQuestionResponse,
  // proposedTutorActionFromJson) read fields off the workflow output itself, so unwrap the
  // `result` field here. (Guarded so a body that is already the bare result still passes
  // through — e.g. a transport that doesn't envelope.)
  return isJsonObject(parsed) && "result" in parsed
    ? (parsed as { result: JsonValue }).result
    : parsed;
}

const maxWorkflowResultBytes = 256_000;
const maxWorkflowErrorBytes = 8_192;

// Both readers reuse the canonical bounded body reader (src/core/read-limited-text.ts),
// which streams the decode and cancels + releases the reader on overflow. Returns null
// when the response has no body (the `!text` callers treat that as "no body").
function readWorkflowResultText(response: Response): Promise<string | null> {
  return readLimitedTextBody(
    response.body,
    maxWorkflowResultBytes,
    () => new HttpError(502, "Reasoning workflow response was too large.")
  );
}

async function readWorkflowError(response: Response): Promise<JsonValue> {
  const text = await readLimitedTextBody(
    response.body,
    maxWorkflowErrorBytes,
    () => new HttpError(502, "Reasoning workflow error body was too large.")
  );
  if (!text) {
    return { status: response.status, statusText: response.statusText };
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { status: response.status, body: text };
  }
}
