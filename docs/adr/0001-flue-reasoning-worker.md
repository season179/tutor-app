# ADR-0001: Re-platform reasoning on a Flue worker (Flue vs. thin provider port)

Date: 2026-06-21
Status: Accepted (Phases 1–4 complete: the binding is the sole reasoning transport; the
feature flag was removed in Phase 4.)
Supersedes the open question in `realtime-removal-and-flue-migration-plan.md` §3 / §5.

## Context

Two goals were set: (1) remove realtime voice, and (2) move the OpenAI Agents SDK off
the reasoning path. Grounding work (recorded in the migration plan's decision record)
showed that removing realtime **is** removing the Agents SDK — `@openai/agents` was
imported in exactly one file (the realtime client adapter), and the turn-based pipeline
already called OpenAI via raw `fetch`. Goal (1) + the literal phrasing of goal (2) are
therefore both satisfied by Phase 1 (realtime removal), which is done.

That left a **separate** goal the SDK removal did not address: making the four reasoning
calls (`proposeTutorAction`, `checkGateStage`, `runVerifierAgent`, `extractQuestion`)
**provider/model-swappable** (OpenAI → OpenRouter, etc.) without editing domain code for
each swap. Two ways to achieve that swap were on the table:

- **(A) Flue worker.** A second, Flue-generated Cloudflare Worker exposes the reasoning
  stages as Flue workflows; Worker A calls it over a service binding instead of fetching
  OpenAI directly. Model/provider becomes a config change in Worker B.
- **(B) Thin provider port.** A small provider-port abstraction inside Worker A (the
  existing `src/providers/openai/openai-responses.ts` is already most of it) with an
  OpenRouter impl alongside; no new infrastructure.

The merged test guardrails (`test/helpers/fake-voice-providers.ts`) were designed so that
**either** approach satisfies the decoupling proof — running the Tier-1 suite unchanged
against a second provider wire is the real proof, not a grep.

## Decision

**Adopt Flue (option A).** The user explicitly chose Flue over the port, accepting its
cost in exchange for the agent-harness future it unlocks (tool-using tutor, durable
sessions, run-inspection, one-string model swap). This ADR records that the tradeoff was
considered and accepted, and commits the work to **minimizing Flue's downside**.

Architecture: **two Cloudflare Workers + a service binding.** Worker A (`ai-tutor`, the
existing TanStack Start worker) keeps all domain logic — scrubbing, the `maxTutorAttempts`
re-ask loop, `gradeStudentTurn`'s deterministic-first track, phase logic, `commitTurn`.
Worker B (`ai-tutor-reasoning`, Flue-generated) is a **pure model executor**: it holds no
stage prompt of its own and runs one Flue workflow per reasoning call.

## Consequence: the payload contract (resolves the plan's §3 spike)

The plan flagged an open spike: *"exact `instructions` threading in Flue (per-call
`session.prompt({ instructions })` vs. agent-level) — confirm against live `flue docs`."*

**Resolved against live Flue docs (withastro/flue, 2026-06-21):** `session.prompt()`
accepts `{ result, tools, model, thinkingLevel, signal, images }` — **there is no
per-call `instructions` override.** An agent's system prompt is composed only from
`AGENTS.md` and the `instructions` set at `createAgent(() => ({ instructions }))` time.

The current gate/tutor/verifier prompts are **dynamic per call** (phase, gate status,
verifier verdict, rejection reasons are all baked in per turn). To preserve turn behavior
byte-for-byte (Goal 3) under that constraint, **the full dynamic scrubbed prompt must
travel as the workflow's `input`** — the first argument to `session.prompt` — not as a
per-call system prompt. Worker B's agent is created with **no stage instructions of its
own** (`createAgent(() => ({ model: <env specifier> }))`), and A ships the complete
scrubbed prompt (today's `instructions` + `input`, concatenated in their current order) as
the workflow payload's `input` field.

This preserves what the model *sees* (the same words, same order) while routing them
through the input channel rather than a system/user split. B therefore stays a pure model
executor with zero stage-specific knowledge — exactly the boundary the plan §3 requires.

The valibot `result` schema is the single structured-output contract shared across the
binding and **replaces the current strict JSON-schema request shape on B's side**; A's
domain parsers (`parseGateCheckerVerdict` / `proposedTutorActionFromJson` /
`parseVerifierVerdict`) stay in A and apply their extra domain validation to B's
structured output. They are **not** deleted.

## Why not the port (recorded tradeoff)

For stateless, single-shot, structured-output completions on a latency-sensitive voice
loop, Flue is heavier than the swap goal strictly needs. A thin in-worker provider port
would achieve the same swap with no new infrastructure, no second deploy, no DO-subrequest
budget concern, and no two-worker dev loop — and the guardrail suite would prove the
decoupling either way. This ADR exists precisely so the heavier choice is auditable
against that lighter alternative. The cost is accepted for the harness future.

## Open / future

- STT/TTS remain direct OpenAI calls in Worker A (Flue is LLM-only); swapping audio
  providers is a separate, non-Flue effort.
- Durable Flue workflow resumption, streaming + structured-output tension, and
  tool-using tutor are future Flue capabilities this choice unlocks but this migration
  does not deliver.
- Error mapping is unchanged from the plan §3: verifier is the only fail-soft stage
  (`unknown`); gate/tutor binding failures map to the existing `HttpError(502)` throw;
  commit conflict stays `409`.
