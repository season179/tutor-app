# Coach Echo — Build Plan (center column → enforced tutoring)

> **Status:** proposed, 2026-06-19. Converged by Claude (Opus 4.8) × pi (Gemini), same two-model method as [`tutoring-workflow.md`](./tutoring-workflow.md).
> **Scope:** how we go from *(locked center-column design + a working but prompt-only voice pipeline)* to *a real, server-enforced tutoring surface*, built progressively.
> **Reads with:** the authoritative spec [`tutoring-workflow.md`](./tutoring-workflow.md) (the *what* and *why*) and the locked visual design [`mockups/center-column.html`](./mockups/center-column.html) (the *look*). This doc is the *sequencing* — the order we build, and where each decision lands.

---

## 1. Goal

A child opens a problem and completes **one full lesson** — gate → first step → answer check → wrap — with the pedagogy **enforced by the system**, not merely requested of the model, rendered in the locked center-column design.

We get there in **five independently-shippable milestones**. The ordering principle: **prove the hardest, most load-bearing mechanic first** (the comprehension gate), before building anything that merely displays it.

## 2. The thesis this plan serves

> **Make the pedagogy the protocol, not the prompt.**

Coach Echo's value is *withholding the answer correctly*. Today that rule lives only in the model's instructions — a request a model can ignore. The plan moves it into server-owned state and a validator, so the system **cannot** advance to solving until a separate check confirms the child understands.

## 3. Where we are today (verified against the code)

**Built and working:**
- Worker entry + routing (`src/worker.ts`, `src/api-handler.ts`); better-auth + Google OAuth + anonymous guest mode.
- Turn-by-turn voice pipeline: `POST /api/voice/turn` → STT (`gpt-4o-transcribe`) → lesson controller (`src/voice-pipeline-service.ts`, structured JSON) → TTS → `{ audio, lesson, transcript, tutorText }`.
- Problem-image upload to R2 + vision extraction (`src/problem-context/`).
- D1: `tutor_sessions` (status `draft|active|ended`, image/extraction fields) + `session_events` (append-only, capped 200). Raw SQL via `SessionStore` (`src/d1-session-store.ts`), Zod request/response schemas.
- React client shell (`src/client/App.tsx`): left sessions sidebar, **empty center**, right sidebar holding voice controls + event log.

**Absent — the gap this plan closes:**
- **No authoritative phase state at all.** The model's `phase` is just JSON in `session_events`; `tutor_sessions` only knows `draft|active|ended`. M1 is therefore *inventing* state, not refactoring an FSM.
- No enforcement: nothing blocks an illegal move (e.g. solving before comprehension). The controller is **prompt-only** and self-reports `phase`/`studentStatus`.
- No separate verifier, no support-level ladder, no learner model, no hint timer.
- Contract mismatch with the spec (see §6).
- The center column UI does not exist; voice controls live in the right sidebar (the locked design moves them into the center).

## 4. Architecture decisions (and why)

| # | Decision | Why |
|---|----------|-----|
| **D1** | **Build the gate first.** | It's the load-bearing wall of the thesis. If the server can't hold the gate, the FSM/verifier/ladder are decoration. Proving it first de-risks everything and forces the three hard questions (where state lives, how moves are constrained, how the UI reads truth) on a small surface. |
| **D2** | **Pipeline is the *only* tutoring path; park realtime.** | Enforcement requires the server in the loop every turn. The turn-based pipeline's request/response boundary *is* where the protocol physically lives. Realtime speech-to-speech bypasses the validator; caging it (server `nextTutorAction` tool) is a research bet, deferred. Relabel realtime "experimental, off the tutoring path" — not a "mode" with implied parity. |
| **D3** | **Defer the Durable Object.** | The only genuinely DO-only capability is **server-side timers**, and there is **no timer in the gate** (the locked design's gate is "take your time," not a countdown). The first real timer is the step-loop hint clock (M5) — the DO lands *there*, with the feature that justifies it. Until then, D1 + an optimistic lock (`UPDATE … WHERE current_phase = ?`) gives single-writer safety. `SessionRuntime` is written as an **interface** (D1-backed now, DO-backed at M5); because transition logic is a pure module, swapping storage never touches the rules. |
| **D4** | **A separate model/checker does the judging.** | The warm tutor must never self-certify comprehension or grade its own arithmetic. A narrow-rubric **gate-checker** is the verifier's seed (M3); a deterministic-where-possible **verifier** grades answers (M4). |
| **D5** | **New canonical contract, not an extension** of `LessonControllerTurn`. | Its 6-phase enum and *self-reported* `studentStatus` are wrong in the bones. Adopt the spec's `TutorAction`/phase contract as the canonical *server-side* contract; keep a stable client-facing **projection** so today's pipeline never breaks (see §6). |

### Per-turn flow (gate slice, D1-backed)

```
POST /api/voice/turn { audio | text | image, sessionId }
  → Worker: auth; load session from D1 (current_phase, gate_status, problem_context)
  → Worker: STT(audio) → text                       [Worker owns audio I/O]
  → IF phase = frame_task AND child gave a restatement/choice:
        gate-checker(problem_frame, child_text) → accepted | rejected   [separate narrow call]
        if accepted: gate_status := complete         ← runs BEFORE the generator, same turn
  → build generator input { phase, allowedMoves, forbiddenMoves, gate_status, recentTurns, problem_frame }
  → generator (proposeTutorAction): { move, supportLevel, spokenUtterance, statePatch{ nextPhase, gateStatus } }
  → TutorActionValidator: reject move ∉ allowedMoves; reject answer-leak; ≤32 words; one cognitive demand
  → TTS(spokenUtterance)                             [Worker owns audio I/O]
  → D1 txn: append event; UPDATE tutor_sessions SET current_phase=?, gate_status=?
            WHERE id=? AND current_phase=?           ← optimistic lock = single-writer guarantee
  → return { audio, lesson(public projection), transcript }
```

The gate-checker runs **before** the generator within the same request, so Echo can acknowledge a pass in the very same turn (no awkward dead turn).

## 5. Ownership

| Concern | Owner (now) | Owner (at M5) |
|---|---|---|
| Phase / gate / support state | `tutor_sessions` columns (D1) | `SessionRuntime` DO (live) → snapshot to D1 |
| Transition rules (`canTransition`, allowed/forbidden moves) | `PhasePolicy` — **pure module, unit-tested** | unchanged (storage-agnostic) |
| Single-writer guarantee | D1 optimistic lock | DO single-threaded execution |
| Timers (hint clock) | — none until M5 | DO alarm |
| Audio I/O (STT/TTS) | Worker | Worker |
| Generator + verifier/checker | model calls made within the request | model calls made by the DO |
| Durable log (events, snapshots) | D1 | D1 |

## 6. Contract reconciliation

Introduce the spec's `TutorAction` + 9-phase set as the **canonical server-side contract**, with `schemaVersion: 1` from day one. The model sees a **restricted subset that grows per milestone**; the client renders a **stable public projection**.

**Phase mapping** (current → spec):

| Current `LessonPhase` | Spec phase(s) |
|---|---|
| `orient` | `session_open`, `capture_parse` |
| — *(new)* | **`frame_task` (the GATE)**, `activate_prior` |
| `ask_step` | `plan_first_step`, `step_loop` |
| `check_answer` | `answer_check` |
| `hint` | (support-level behavior, not a phase) |
| `advance` | `transfer_check` |
| `wrap` | `wrap_up` |
| — *(new)* | `memory_write` |

Support level (0–4) and behavioral mode become **server state**, not generator fields.

**Migration path (no big-bang, pipeline never breaks):**
1. Keep the `/api/voice/turn` route and the `{ audio, lesson, transcript, tutorText }` envelope.
2. Replace `createLessonTurn` internals with `proposeTutorAction` (new strict schema, restricted to the slice's allowed moves; grows per milestone).
3. Keep `lesson.{ phase, spokenUtterance, studentStatus, tutorAction }` **present** in the projection (mapped from the canonical turn) so the existing right-sidebar UI keeps working; add new fields alongside. Retire the right-sidebar voice UI once the center column is complete.

## 7. The five milestones

Each ships on its own. Goal at the end of M5: one full gated problem, end-to-end, in the center column.

### M1 — The rulebook & referee *(backend only, invisible)*
- **Outcome:** the server can **refuse an illegal move** — a model output that tries to solve in `frame_task` is rejected before it reaches TTS. Authority moves model → server.
- **In scope:** migration `0006` adds `current_phase`, `current_support_level`, `gate_status` to `tutor_sessions`; `PhasePolicy` pure module (`canTransition`, `allowedMoves`, `forbiddenMoves`) + unit tests; canonical `TutorAction` types + Zod schema + `schemaVersion`; `proposeTutorAction` replaces `createLessonTurn` internally; `TutorActionValidator` (move legality, no-final-answer heuristic, ≤32 words, one cognitive demand); public projection preserves the four legacy fields.
- **Out of scope:** any UI; the gate-checker; the verifier; the ladder (support fixed at 0); the DO; a structured `tutor_turns` table (reuse `session_events`).
- **Done when:** a fixture test feeds a "solve now" model output at `phase=frame_task` and the validator rejects it; `PhasePolicy` unit tests pass; the existing pipeline still answers a turn unchanged via the projection.

### M2 — The live tutoring screen *(the first visible payoff)*
- **Outcome:** the locked design comes alive, driven by real state.
- **In scope:** center column **Spine · Stream · Anchor** — phase rail (from `current_phase`), transcript stream (from events), problem pin (fold in `ProblemContextPanel`), empty target chip, anchor focus-card; **move the voice bar from the right sidebar into the center**.
- **Out of scope:** gate behavior (the chip is present but inert until M3); the inspector; behavioral adaptation.
- **Done when:** a child sees the locked surface and it reflects the authoritative phase/events of a live session.

### M3 — The gate, for real *(THE THESIS, PROVEN)*
- **Outcome:** **a child cannot get Echo to solve until they restate the goal in their own words.**
- **In scope:** widen extraction `ExtractedQuestion → problem frame` (givens + unknown target + type + task language — **never the computed answer**; new `problem_contexts` table); `ComprehensionGate` state; **gate-checker** (separate narrow model call sets `gate_status`); `frame_task` `allowedMoves = [three_reads…, restate]`, `forbiddenMoves = [solve, final_answer, calc_hint]`; UI: empty → framed target chip on pass, downstream stations light up.
- **Out of scope:** the arithmetic verifier; the ladder; timers.
- **Done when:** an integration test shows the solving moves are unreachable until the gate-checker accepts a valid restatement; extraction output is verified to contain no solution.

### M4 — First step + the answer-checker *(scaffolding)*
- **Outcome:** the child works one real step; a **separate checker grades it** (Echo never marks its own work) and gives a kind, specific correction when wrong.
- **In scope:** `plan_first_step` + one checkable step (elicit → act → verify → feedback); `VerifierAgent` — **deterministic for arithmetic where practical**, narrow LLM otherwise — sets `studentStatus`; support ladder begins moving (correct + explanation → decrement); UI: verdict chip (ok/partial/retry), scaffold aid, hint/park controls.
- **Out of scope:** the hint **timer** (child takes as long as they want; no auto-hint yet); the DO.
- **Done when:** one step is solved with a real, separate verifier; a wrong answer yields a specific nudge, not the answer.

### M5 — Finish the problem + remember it *(ONE FULL LESSON; the DO lands)*
- **Outcome:** a child **completes a whole problem end-to-end**, answers in the required output language, reflects ("what helped?"), and Echo quietly remembers — with the gentle hint-timer finally real.
- **In scope:** `answer_check` (close to framed goal, required output language) + `memory_write` (reflection → persisted to a learner-model store); **`SessionRuntime` becomes a Durable Object** (one per session, owns phase + active turn + hint timer, snapshots to D1); hint timer via DO alarm (~60s nudge in the step loop).
- **Done when:** a child runs one full problem start-to-finish under server enforcement, and the ~2-minute/idle hint rule fires from a real timer.

## 8. Mapping to the locked mockup

| Milestone | Frames in `mockups/center-column.html` |
|---|---|
| M2 | 01 (session open), problem pin, rail |
| M3 | 02–03 (gate: empty → framed target chip) |
| M4 | 04–06 (redirect, step loop, verifier chips) |
| M5 | 05/07 (answer check, wrap) + memory step |

## 9. Risks & open questions

1. **M1 ↔ M3 boundary** *(pi's flagged liveliest debate)* — exactly which validations are generic (M1: move legality, no-answer-leak heuristic, stub `allowedMoves`) vs gate-specific (M3: `frame_task` allow/forbid lists + gate-checker). **Resolve before coding M3.**
2. **Gate-checker reliability** — a narrow rubric judging "did the child restate the unknown." False-locks frustrate; false-passes defeat the gate. *Mitigation:* log every verdict, build a small eval set early, allow a dev/inspector manual override.
3. **Pipeline latency** — the 2-call gate turn (checker + generator) adds latency on top of STT→LLM→TTS. *Mitigation:* stream TTS, ≤32-word utterances, listening/thinking states; measure first-audio against the spec's <2s budget for short turns.
4. **Extraction must capture the *frame*, never the answer** — widening extraction must yield givens + unknown only. *Mitigation:* a test asserting the extracted context contains no solution.
5. **Single-writer without a DO** — confirm D1's `UPDATE … WHERE current_phase = ?` gives the atomicity we need; worst case is a rejected duplicate turn, not corruption.

## 10. Deferred backlog (the progressive build, post-M5)

Session-level `transfer_check` + `wrap_up`; the Coach-view **inspector** (parent plain-language + dev raw `TutorAction`) — *our* debugging surface, deliberately off the critical path; **behavioral adaptation** (rushing → strict gate, shutdown → reset); the **Fork-3** child-vs-parent transcript split; a tappable term glossary; the **target-chip-as-lock** gate refinement; **caging realtime** (server-tool-gated); the LearnLM-style **pedagogy-spec compiler** (parameterizing the frozen `tutorPolicy.instructions`).
