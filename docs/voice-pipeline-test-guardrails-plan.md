# Voice Pipeline Test Guardrails — Provider-Agnostic Plan

*Developed jointly by Claude and `pi` (independent review pass). This is the agreed plan.*

## 1. Goal

Lock the **current behavior of the turn-based voice tutoring pipeline** as a regression
safety net, so that future changes — swapping a provider (OpenAI → OpenRouter), or removing
the OpenAI Agents SDK — cannot silently break behavior. Crucially, **the tests themselves must
survive those swaps**: they must not be coupled to OpenAI's wire format.

## 2. Priorities & constraints (decided with the user)

1. **Decoupling > snapshot fidelity.** If a snapshot would couple tests to provider output,
   don't use it. Domain-shape assertions are the backbone.
2. **Test-layer only — NO production refactor.** Tests stub `globalThis.fetch`. The provider
   port/adapter refactor is a separate, later ADR.
3. **Realtime backend is out of scope entirely.** It is being **removed** once these guardrails
   exist. Do not test it — not the WebRTC path, not the token-mint contract.
4. **No flaky tests** (AGENTS.md): every test must protect something real and be deterministic.

## 3. The problem (this is a decoupling refactor, not greenfield)

`test/voice-pipeline-service.test.ts` already provides strong **behavioral** coverage, but the
test bodies are **coupled to OpenAI's wire format**:

- hardcoded `https://api.openai.com/v1/responses`, `/v1/audio/transcriptions`, `/v1/audio/speech`
- calls routed by OpenAI request internals: `isGateCheckerRequest` / `isVerifierRequest` sniff
  `body.instructions`; audio asserts `init.body instanceof FormData`
- OpenAI response shapes returned inline: `{ output_text }` and `{ output: [{ content: [{ text }] }] }`

A swap to OpenRouter (chat-completions `messages` + `choices[].message.content`, or JSON
`input_audio` instead of multipart) breaks **every** test — on *format*, not *behavior*. That is
exactly the coupling to eliminate.

## 4. Strategy: two tiers, all wire knowledge quarantined

- **Tier 1 — portable guardrails (the bulk).** Test bodies express **domain intent** and assert
  **domain behavior**. They never name OpenAI, a URL, or a wire shape. Unchanged by a provider swap.
- **Tier 2 — wire conformance (thin, isolated).** ONE harness owns all OpenAI URL/shape knowledge,
  plus a small set of "does our adapter encode/parse OpenAI correctly" tests. Provider-specific
  **by design**; on a swap you rewrite only this layer.

## 5. The fake-provider harness (`test/helpers/fake-voice-providers.ts`)

Installs a `fetch` double configured in **domain terms**. The four+1 prod wire calls map to named
slots:

| Slot | Prod call | Wire signal (lives ONLY in the harness) |
|---|---|---|
| `transcribe` | `transcribeAudio` | URL `/v1/audio/transcriptions` + FormData body |
| `gateChecker` | `checkGateStage` | URL `/v1/responses` + `instructions` ⊃ `"comprehension-gate checker"` |
| `verifier` | `runVerifierAgent` | URL `/v1/responses` + `instructions` ⊃ `"narrow answer verifier"` |
| `tutor` | `proposeTutorAction` | URL `/v1/responses` + **neither marker** (the else branch) |
| `tts` | `createTutorSpeech` | URL `/v1/audio/speech` |

### 5a. Matcher precedence is load-bearing — make it explicit

The tutor slot is *"a `/v1/responses` call that is neither gate nor verifier."* The router must
apply an explicit **priority list**: `gateChecker` → `verifier` → `tutor` (else). This precedence
is the single behavior most likely to silently break on a swap (a future provider's router key
could collide). Therefore:

- The harness routes via a documented, ordered matcher list — **not** emergent string-sniffing.
  The matcher list is the *only* artifact that changes on a provider swap.
- The precedence gets **its own unit test** (`test/adapters/voice-provider-router.test.ts`):
  given representative request bodies, assert each lands in the right slot, in priority order.

### 5b. Slot types must capture behavior, not just happy-path values

`pi`'s review surfaced three places where a naive slot shape would test only a subset:

- **`tutor` re-ask sequence carries rejection *kind*.** `proposeTutorAction` loops
  `maxTutorAttempts = 2` and re-asks on **two** distinct failure modes: (i) `proposedTutorActionFromJson`
  *throws* (malformed JSON / bad enum), and (ii) `validateTutorAction` returns `{ ok: false }`
  (legal-shape but illegal move). The slot must express a sequence like
  `[{ malformedJson }, { move: "solve" /* illegal */ }, { legal move }]` so both re-ask paths are
  exercised, and the harness should let a test assert the re-ask happened (call count) and that
  rejection reasons were fed back into the next prompt.
- **`gateChecker` / `verifier` distinguish error *kinds*** — these are different prod behaviors:
  - **non-2xx HTTP** → `gradeStudentTurn` catches → returns `unknown` verdict → **turn continues**.
  - **2xx with missing `output_text`** → `runVerifierAgent` *throws* `HttpError(502)` → **turn dies (502)**.
  - Slot API: `verifier: { status: 500 }` vs `verifier: { ok: true, noOutputText: true }`. Same for
    gate-checker. The shorthand `"error"` is banned because it hides which behavior is under test.
- **`tts` stays raw bytes**, but Tier-1 keeps the response-shape assertions
  (`response.audio.mimeType === "audio/mpeg"`, `response.audio.size === bytes.byteLength`) — a swap
  that chunks/streams differently could break the base64 round-trip.

### 5c. Swap interface (the real decoupling proof)

```ts
interface VoiceProviderFake { install(): void; restore(): void; calls: CallLog; }
makeOpenAiProviderFake(config): VoiceProviderFake     // now
makeOpenRouterProviderFake(config): VoiceProviderFake // later — SAME config shape, different matchers/shapes
```

`installVoiceProviders(config)` selects the active impl (default OpenAI). Because both impls accept
the **same domain config** and the Tier-1 bodies only touch domain config + domain assertions, the
entire Tier-1 suite can run against either wire. **That run — not a grep — is the proof of decoupling.**

## 6. Assertions: domain-shape, not raw snapshots

Per "decoupling > snapshot fidelity":

- **Backbone:** explicit `assert.deepEqual` on domain objects (`response.session`, `response.lesson`)
  + store/event assertions. Already provider-neutral; it's what the suite does today.
- **Snapshots:** only where provider-neutral; if used, a custom serializer redacts audio bytes to a
  descriptor and never captures wire internals. Optional polish, not the mechanism.
- **Safety invariants get explicit, loud assertions** (cannot be silently re-baselined).

## 7. Coverage matrix

### 7a. Existing tests — migrate onto the harness, keep assertions identical
legacy projection+advance · kickoff ×3 · audio transcription turn · gate solving-move rejection
pre-TTS · re-ask illegal→legal · gate hold · gate advance on accept · skip gate-checker when
complete · three-reads full walk · rejected read holds · plan-phase no-grade · wrong step → stuck
+ support↑ · correct step → support↓ + phase override · LLM verifier track · verifier error →
unknown fail-safe · final answer → memory_write · reflection → wrap_up.

### 7b. Move to Tier 2 (genuinely wire-specific) → `test/adapters/openai-wire.test.ts`
- "reads the tutor action from response output content" (tests OpenAI `output[].content[].text`
  parse fallback; mirror `src/providers/openai/openai-responses.ts:extractOutputText`).
- request-encoding assertions (`init.body instanceof FormData`, `JSON.parse(body).input === utterance`).

### 7c. Gaps to ADD (new guardrails — from the joint review)
**Safety / highest value**
- **Answer scrubbing** *(single highest-value add)*: parse the captured tutor `init.body`; assert the
  prompt contains **no `expectedAnswers` / `distractorNudges`** keys and **no computed-solution
  substring** (`toPublicActiveStep` drops the answer key; `scrubComputedSolutionFromText` covers
  frame/relationships/unknownTarget/visibleQuestion).
- **Tutor hard-fail**: persistent illegal move across `maxTutorAttempts` → 502, **TTS never called**.

**STT branches (a swap could flip these)**
- Audio with typed-text fallback: empty transcript **+ typed text present** → uses typed text.
- Audio with empty transcript **and no typed text** → `transcribeAudio` **throws 502** (NOT fallback).

**Gate-checker short-circuits (assert "no fetch", may be partially dead — don't lock dead behavior as live)**
- empty student text → early return, no fetch.
- frame without `unknownTarget` → early return, no fetch.

**Verifier track selection (not just one outcome per track)**
- Lock the **selection** between deterministic and LLM track (`shouldVerifyActiveStep` + non-empty
  `expectedAnswers`), plus the deterministic **`partial`** branch and the distractor-nudge hint.

**Pure domain invariants (zero provider coupling — must be Tier-1)**
- `nextSupportLevel` ≥4-whitespace-token rule: a **terse correct answer ("4")** keeps support level
  unchanged; only a ≥4-word correct answer decrements.
- `memory_write` with **empty/whitespace text** → reflection NOT saved AND phase **holds** (no wrap_up).
- `answer_check` correct but `canTransition(...,gateStatus)` false (gate not complete) → **no** promotion.
- Image-only turn → assert the **event message is `"Problem image submitted"`** (not `"Student turn"`).

**Concurrency / locking**
- Optimistic-lock 409: interleave a manual `advanceSessionPhase` between read and commit to force
  `commitTurn` → null → 409. *Note in the test that this simulates a race, not real concurrency*
  (MemorySessionStore is synchronous).
- Kickoff-after-kickoff → second kickoff rejected with 409 "already started".

## 8. Decoupling guardrail (structural, not lexical)

The `api.openai.com` grep alone is **too weak** (misses `output_text`, `choices[].message`,
`FormData`, `/v1/responses`, `Bearer …`). Replace with:

1. **Structural import barrier (primary):** Tier-1 files may import only the `installVoiceProviders`
   domain surface. An ESLint `no-restricted-imports` rule forbids Tier-1 tests from importing
   `src/providers/openai/*` or the harness's internal wire exports.
2. **Second-impl run (the real proof):** once an OpenRouter wire-impl exists, run the Tier-1 suite
   against it unchanged in CI.
3. **Wire-vocabulary grep (secondary tripwire only):** scan Tier-1 files for
   `api.openai.com|/v1/responses|/v1/audio/|output_text|output\[|content\[|FormData|Bearer ` and fail
   if found. Belt-and-suspenders, not the headline criterion.

## 9. File layout

```
test/helpers/fake-voice-providers.ts      # Tier 2: fetch harness (OpenAI impl) + swap interface + matcher list
test/helpers/voice-fixtures.ts            # sharingFrame, multiplicationFrame, sessionState, seed* helpers (extracted)
test/voice-pipeline-service.test.ts       # Tier 1: refactored onto the harness (domain intent + assertions only)
test/adapters/openai-wire.test.ts         # Tier 2: response-parse variants + request-encoding conformance
test/adapters/voice-provider-router.test.ts  # Tier 2: matcher precedence (gate → verifier → tutor-else)
# (future) test/helpers/fake-voice-providers.openrouter.ts
```

## 10. Migration sequence (suite green at every step)

1. Build the harness + extract fixtures. Add the router-precedence unit test. Add a tiny
   "harness reproduces current behavior" check.
2. Migrate existing tests **one at a time** onto the harness; assertions unchanged; suite green
   after each migration (pure refactor, no behavior change).
3. Extract the genuinely wire-specific assertions into `openai-wire.test.ts`.
4. Add the §7c gap tests.
5. Add the structural import barrier + secondary grep. Structure the harness so the future
   OpenRouter impl is a drop-in for the second-impl proof.

## 11. Flakiness safeguards (AGENTS.md: no flaky tests)

- **`fetch` restoration via `afterEach`** (biggest risk): the harness wires `install()` in
  `beforeEach`/per-test and **always** `restore()`s in `afterEach`, so a missed `finally` cannot leak
  the fake into the next test (which would look like a flaky cascade).
- **Never assert on non-deterministic values** — session IDs (`crypto.randomUUID()`), timestamps
  (`createdAt`/`updatedAt`/`nowIso()`). Fixtures pass IDs around; snapshots (if any) redact ISO times.
- **`AbortSignal` note:** the fake `fetch` ignores `init.signal` today (fine). Documented caveat: a
  future timeout test would need the fake to honor `signal`.
- **Noise:** the verifier-error test triggers `console.error` in `gradeStudentTurn`; capture/silence
  it in that one test to keep output clean (determinism is unaffected).

## 12. Done criteria

- `pnpm test` green.
- Every §7c safety invariant has an explicit, loud assertion (answer-scrubbing and tutor hard-fail
  in particular).
- The **matcher precedence (gate → verifier → tutor-else) is documented and has its own unit test.**
- Structural import barrier in place; Tier-1 files contain no wire vocabulary.
- The OpenAI wire knowledge lives **only** in `test/helpers/fake-voice-providers.ts` +
  `test/adapters/*` — so swapping providers later means editing those files, never the Tier-1 bodies.

## 13. Out of scope

Realtime/WebRTC backend (being removed — no tests); LLM quality evals; the production provider
port/adapter refactor (separate ADR, informed by this suite once it's green).
