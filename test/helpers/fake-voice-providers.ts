/**
 * Fake voice providers — the fetch harness for the voice-pipeline tests.
 *
 * ALL provider wire knowledge (OpenAI URLs + response shapes, the `instructions`-substring
 * routing, AND the Flue workflow-path routing over the REASONING binding) is quarantined in
 * THIS file. Tier-1 test bodies import only the domain-facing surface
 * (`installVoiceProviders`, `VoiceProviderFakeConfig`, `CallLog`) and never name a URL, a
 * wire shape, an OpenAI token, or a workflow path. Swapping providers later means rewriting
 * this layer only.
 *
 * The five named slots are transport-agnostic — they name a *reasoning/audio role*, not a
 * wire. Each slot can be served by either transport:
 *   transcribe  → POST /v1/audio/transcriptions  (FormData body)           [fetch only]
 *   gateChecker → POST /v1/responses (instructions ⊃ "comprehension-gate checker")
 *                 OR  POST /workflows/gate-check?wait=result                [binding]
 *   verifier    → POST /v1/responses (instructions ⊃ "narrow answer verifier")
 *                 OR  POST /workflows/verifier?wait=result                  [binding]
 *   tutor       → POST /v1/responses  (neither marker — the else branch)
 *                 OR  POST /workflows/tutor-turn?wait=result                [binding]
 *   tts         → POST /v1/audio/speech                                     [fetch only]
 *
 * Two routers, one per transport, both write to the SAME slot counters — so a Tier-1 test
 * asserts the same `counts.gateChecker` and `tutorBodies()` regardless of which transport
 * a migrated stage used. `routeVoiceProviderCall` routes the OpenAI fetch transport;
 * `routeReasoningWorkflowCall` routes the REASONING binding transport.
 *
 * The matcher precedence within `/responses` (gateChecker → verifier → tutor-else) is
 * load-bearing and is pinned in `test/adapters/voice-provider-router.test.ts`.
 */

import assert from "node:assert/strict";

/** The five slots a voice-pipeline turn can hit. */
export type VoiceProviderSlot = "transcribe" | "gateChecker" | "verifier" | "tutor" | "tts";

/** Workflow path → slot, for the REASONING binding transport (Phase 2+ migration). */
const reasoningWorkflowSlots: Record<string, VoiceProviderSlot> = {
  "gate-check": "gateChecker",
  verifier: "verifier",
  "tutor-turn": "tutor"
};

/**
 * Routes a captured REASONING-binding call to its slot, or null if it isn't a reasoning
 * workflow call. The path is `/workflows/<stage>`; the slot is derived from the stage
 * name. This is the transport-aware counterpart to `routeVoiceProviderCall` — the two
 * never overlap (a binding fetch hits `/workflows/*`, an OpenAI fetch hits `/responses`).
 *
 * Exported (and unit-tested) so the binding routing can't drift silently.
 */
export function routeReasoningWorkflowCall(input: RequestInfo | URL): VoiceProviderSlot | null {
  const url = String(input);
  const match = url.match(/\/workflows\/([^/?]+)/);
  if (!match) {
    return null;
  }
  return reasoningWorkflowSlots[match[1]] ?? null;
}

/**
 * Routes a captured OpenAI-wire fetch call to its slot, or null if it isn't a
 * voice-pipeline call. This is the explicit ordered matcher for the fetch transport.
 * Priority within `/responses`: gateChecker → verifier → tutor (else).
 *
 * The discriminator is the `instructions` preamble ONLY, never the `input` field: a
 * future tutor prompt that quotes the marker inside the student-facing input must still
 * route to the tutor slot. That invariant is pinned in the router's unit test.
 *
 * Exported (and unit-tested directly) so the precedence can never drift silently.
 */
export function routeVoiceProviderCall(input: RequestInfo | URL, init?: RequestInit): VoiceProviderSlot | null {
  const url = String(input);

  if (url.includes("/audio/transcriptions")) {
    return "transcribe";
  }

  if (url.includes("/audio/speech")) {
    return "tts";
  }

  if (url.includes("/responses")) {
    const body = init?.body;
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as { instructions?: unknown };
        const instructions = typeof parsed.instructions === "string" ? parsed.instructions : "";
        // Order matters: gate first, then verifier, else tutor.
        if (instructions.includes("comprehension-gate checker")) {
          return "gateChecker";
        }
        if (instructions.includes("narrow answer verifier")) {
          return "verifier";
        }
      } catch {
        // Not JSON — falls through to the tutor (else) branch.
      }
    }
    return "tutor";
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Domain-facing slot configuration
//
// These types express *domain intent*, never wire shapes. The harness translates each
// into the OpenAI request/response format internally — that translation is the only
// OpenAI knowledge in the system, and it lives here.
// ──────────────────────────────────────────────────────────────────────────────

/** A tutor action the model might propose — the domain shape tests reason about. */
export type FakeTutorAction = {
  move: string;
  nextPhase?: string;
  spokenUtterance: string;
};

/**
 * One tutor generation attempt. The tutor generator re-asks on two distinct failure
 * modes (§5b), and can also hard-fail the turn — the `kind` names the failure in
 * DOMAIN terms (never the OpenAI wire field):
 *
 * - `"legal"`        — a usable action; the generator accepts it.
 * - `"throws"`       — well-formed JSON the parser rejects (bad enum / missing field); the
 *                      generator re-asks (path i: `proposedTutorActionFromJson` throws).
 * - `"illegal"`      — legal shape but a move the phase forbids (e.g. `solve` in the gate);
 *                      the generator re-asks (path ii: `validateTutorAction` returns not-ok).
 * - `"emptyBody"`    — the response body carries no text to parse; the turn dies (502),
 *                      not caught by the retry loop.
 * - `"malformedBody"` — the response body's text isn't valid JSON; the turn dies (502),
 *                      not caught by the retry loop.
 */
export type FakeTutorAttempt =
  | (FakeTutorAction & { kind?: "legal" })
  | { kind: "throws"; action: FakeTutorAction }
  | { kind: "illegal"; action: FakeTutorAction }
  | { kind: "emptyBody" }
  | { kind: "malformedBody"; text: string };

/** A bare action is treated as a single legal attempt — keeps call sites terse. */
export type TutorSlot = FakeTutorAttempt | FakeTutorAttempt[];

export type TranscribeSlot = { text: string } | { status: number };

export type GateCheckerSlot =
  | { accepted: boolean; notes?: string | null }
  | { status: number }
  | { emptyBody: true };

export type VerifierSlot =
  | {
      studentStatus: string;
      confidence?: string;
      correctionHint?: string | null;
      misconceptionKey?: string | null;
    }
  | { status: number }
  | { emptyBody: true };

export type TtsSlot = Uint8Array | { status: number };

export type VoiceProviderFakeConfig = {
  transcribe?: TranscribeSlot;
  gateChecker?: GateCheckerSlot;
  verifier?: VerifierSlot;
  tutor?: TutorSlot;
  tts?: TtsSlot;
  /**
   * When truthy, the REASONING binding fake is exposed as `fake.reasoning` for the test
   * to install on `env.REASONING`, and migrated stages are expected to arrive over the
   * binding (`/workflows/*`) rather than `globalThis.fetch` (`/responses`). A slot
   * configured under `gateChecker`/`verifier`/`tutor` is served from whichever transport
   * actually calls — so a Tier-1 test body does not change when a stage flips transports.
   * Set this in the binding-path tests (Phase 2+); the default (undefined) keeps the
   * legacy OpenAI-fetch transport.
   */
  reasoning?: true;
};

/** The captured call log. Domain-facing: no wire tokens (`url`/`init` stay internal). */
export type CallLog = {
  /** Per-slot call counts (summed across both transports). */
  readonly counts: Record<VoiceProviderSlot, number>;
  /**
   * The full prompt the tutor model received, one string per tutor call. Over the
   * OpenAI-fetch transport this is the request body (`instructions` + `input`); over the
   * REASONING-binding transport it is the workflow payload's `input` (which carries the
   * same scrubbed prompt — see docs/adr/0001-flue-reasoning-worker.md). Tests match
   * against substrings ("separate verifier already graded", absence of "expectedAnswers").
   *
   * TRIPWIRE: this string includes the request envelope (keys like `instructions`,
   * `input`, `text.format`), not just prompt prose. Tier-1 tests MUST match only on
   * prompt content that is provider-neutral — never on envelope keys or the wire
   * envelope's structure. A Tier-1 assertion on an envelope key would silently
   * re-couple the suite to the OpenAI wire.
   */
  tutorBodies(): string[];
  /** The `input` text sent to each TTS call (what the tutor will speak aloud). */
  ttsInputs(): string[];
  /**
   * The workflow `input` strings sent to a given reasoning slot over the REASONING binding
   * (gate/verifier/tutor), in call order. Empty for slots that were never called or that
   * only ran over the OpenAI-fetch transport. Tier-2 tests assert on prompt content here.
   */
  workflowInputs(slot: VoiceProviderSlot): string[];
};

export type VoiceProviderFake = {
  /** Replaces `globalThis.fetch`. Call in `beforeEach` or per-test. */
  install(): void;
  /** Restores the original `fetch`. Always called in `afterEach`. */
  restore(): void;
  readonly calls: CallLog;
  /**
   * A Fetcher fake for the REASONING service binding. Install on `env.REASONING` in
   * binding-path tests. Absent unless `config.reasoning === true`.
   */
  readonly reasoning?: Fetcher;
};

// ──────────────────────────────────────────────────────────────────────────────
// OpenAI wire encoding (Tier 2 — the ONLY place these shapes exist)
// ──────────────────────────────────────────────────────────────────────────────

function encodeTutorResponse(attempt: FakeTutorAttempt): Response {
  // `emptyBody` / `malformedBody` are response-shape failures that kill the turn.
  if (attempt.kind === "emptyBody") {
    return Response.json({});
  }
  if (attempt.kind === "malformedBody") {
    return Response.json({ output_text: attempt.text });
  }
  // `throws` and `illegal` both return well-formed JSON the model "said"; the generator
  // decides downstream whether the parser rejects it (`throws`) or the validator does (`illegal`).
  const action =
    attempt.kind === "legal" || attempt.kind === undefined ? attempt : attempt.action;
  return Response.json({ output_text: JSON.stringify(action) });
}

function encodeGateCheckerResponse(slot: GateCheckerSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  if ("emptyBody" in slot) {
    return Response.json({});
  }
  return Response.json({ output_text: JSON.stringify({ accepted: slot.accepted, notes: slot.notes ?? null }) });
}

function encodeVerifierResponse(slot: VerifierSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  if ("emptyBody" in slot) {
    return Response.json({});
  }
  return Response.json({
    output_text: JSON.stringify({
      confidence: slot.confidence ?? "high",
      correctionHint: slot.correctionHint ?? null,
      misconceptionKey: slot.misconceptionKey ?? null,
      studentStatus: slot.studentStatus
    })
  });
}

function encodeTranscribeResponse(slot: TranscribeSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  return Response.json({ text: slot.text });
}

function encodeTtsResponse(slot: TtsSlot): Response {
  if (slot instanceof Uint8Array) {
    return new Response(slot);
  }
  return new Response("upstream error", { status: slot.status });
}

// ──────────────────────────────────────────────────────────────────────────────
// REASONING-binding transport encoding (Tier 2 — the ONLY place the workflow shapes exist)
//
// Worker B is a Flue worker. Its `?wait=result` response does NOT return the workflow output
// bare — Flue wraps it in an envelope `{ result, runId, streamUrl, offset }` (see
// @flue/runtime runSyncMode/runDirectSyncMode), and `runReasoningWorkflow` unwraps `.result`.
// So the encoder must wrap the domain result the same way, or the tests would exercise a wire
// shape the real worker never sends. A gate-check result is `{ accepted, notes }`, a verifier
// result is `{ studentStatus, confidence, … }`, a tutor result is the action — each wrapped in
// the Flue envelope by `workflowEnvelope`. The domain values mirror the OpenAI-wire encoder, so
// a slot configured once serves whichever transport calls.
// ──────────────────────────────────────────────────────────────────────────────

/** Wraps a workflow result in Flue's `?wait=result` envelope, matching the real Worker B wire. */
function workflowEnvelope(result: unknown): Response {
  return Response.json({ result, runId: "test-run", streamUrl: "runs/test-run", offset: "-1" });
}

function encodeGateCheckerWorkflowResult(slot: GateCheckerSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  if ("emptyBody" in slot) {
    return new Response(null, { status: 204 });
  }
  return workflowEnvelope({ accepted: slot.accepted, notes: slot.notes ?? null });
}

function encodeVerifierWorkflowResult(slot: VerifierSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  if ("emptyBody" in slot) {
    return new Response(null, { status: 204 });
  }
  return workflowEnvelope({
    confidence: slot.confidence ?? "high",
    correctionHint: slot.correctionHint ?? null,
    misconceptionKey: slot.misconceptionKey ?? null,
    studentStatus: slot.studentStatus
  });
}

function encodeTutorWorkflowResult(attempt: FakeTutorAttempt): Response {
  // `emptyBody`/`malformedBody` are response-shape failures that kill the turn, mirrored
  // from the OpenAI transport (an empty 204 / a non-JSON body that the parser rejects).
  if (attempt.kind === "emptyBody") {
    return new Response(null, { status: 204 });
  }
  if (attempt.kind === "malformedBody") {
    return new Response(attempt.text, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  const action = attempt.kind === "legal" || attempt.kind === undefined ? attempt : attempt.action;
  return workflowEnvelope(action);
}

function decodeWorkflowInput(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") {
    return "";
  }
  try {
    const parsed = JSON.parse(body) as { input?: unknown };
    return typeof parsed.input === "string" ? parsed.input : "";
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Harness
// ──────────────────────────────────────────────────────────────────────────────

function asAttemptList(tutor: TutorSlot | undefined): FakeTutorAttempt[] {
  if (!tutor) {
    return [{ kind: "legal", move: "elicit", spokenUtterance: "What do you think?" }];
  }
  return Array.isArray(tutor) ? tutor : [tutor];
}

function normalizeAttempt(attempt: FakeTutorAttempt): FakeTutorAttempt {
  // A bare action object (no `kind`) is a legal attempt.
  if (!("kind" in attempt) || attempt.kind === undefined) {
    return { ...attempt, kind: "legal" } as FakeTutorAttempt;
  }
  return attempt;
}

export function makeOpenAiProviderFake(config: VoiceProviderFakeConfig): VoiceProviderFake {
  const tutorAttempts = asAttemptList(config.tutor).map(normalizeAttempt);
  let tutorIndex = 0;

  // Both transports record into the SAME counters and body log so Tier-1 assertions are
  // transport-agnostic. `rawCalls` holds the OpenAI-fetch captures; `bindingCalls` holds
  // the REASONING-binding captures.
  const rawCalls: { url: string; init?: RequestInit }[] = [];
  const bindingCalls: { url: string; init?: RequestInit }[] = [];
  const countBySlot: Record<VoiceProviderSlot, number> = {
    transcribe: 0,
    gateChecker: 0,
    verifier: 0,
    tutor: 0,
    tts: 0
  };

  let originalFetch: typeof globalThis.fetch | null = null;

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const slot = routeVoiceProviderCall(input, init);
    const url = String(input);
    rawCalls.push({ url, init });
    if (slot) {
      countBySlot[slot] += 1;
    }

    if (slot === "transcribe") {
      assert.ok(config.transcribe, "transcribe call made but no transcribe slot configured");
      return encodeTranscribeResponse(config.transcribe);
    }
    if (slot === "gateChecker") {
      assert.ok(config.gateChecker, "gateChecker call made but no gateChecker slot configured");
      return encodeGateCheckerResponse(config.gateChecker);
    }
    if (slot === "verifier") {
      assert.ok(config.verifier, "verifier call made but no verifier slot configured");
      return encodeVerifierResponse(config.verifier);
    }
    if (slot === "tutor") {
      const attempt = tutorAttempts[Math.min(tutorIndex, tutorAttempts.length - 1)];
      tutorIndex += 1;
      return encodeTutorResponse(attempt);
    }
    if (slot === "tts") {
      assert.ok(config.tts !== undefined, "tts call made but no tts slot configured");
      return encodeTtsResponse(config.tts as TtsSlot);
    }

    throw new Error(`fake-voice-providers: unmatched fetch ${url}`);
  }) as typeof fetch;

  // The REASONING-binding transport. Routes `/workflows/<stage>` → slot and serves the
  // SAME slot config as the fetch transport, encoded as the workflow `result`. Counted
  // into the same per-slot counters; tutor inputs captured for `tutorBodies()`.
  const fakeReasoningFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const slot = routeReasoningWorkflowCall(input);
    const url = String(input);
    bindingCalls.push({ url, init });
    if (slot) {
      countBySlot[slot] += 1;
    }

    if (slot === "gateChecker") {
      assert.ok(config.gateChecker, "gateChecker binding call made but no gateChecker slot configured");
      return encodeGateCheckerWorkflowResult(config.gateChecker);
    }
    if (slot === "verifier") {
      assert.ok(config.verifier, "verifier binding call made but no verifier slot configured");
      return encodeVerifierWorkflowResult(config.verifier);
    }
    if (slot === "tutor") {
      const attempt = tutorAttempts[Math.min(tutorIndex, tutorAttempts.length - 1)];
      tutorIndex += 1;
      return encodeTutorWorkflowResult(attempt);
    }

    throw new Error(`fake-voice-providers: unmatched REASONING fetch ${url}`);
  }) as Fetcher["fetch"];

  // The REASONING binding is ALWAYS exposed now that the binding is the sole reasoning
  // transport (the legacy direct-OpenAI path was removed in Phase 4). The `config.reasoning`
  // flag is accepted for back-compat but no longer gates availability.
  const reasoningBinding: Fetcher = { fetch: fakeReasoningFetch } as Fetcher;

  const calls: CallLog = {
    counts: countBySlot,
    tutorBodies() {
      // The OpenAI-fetch transport: the body is the full request envelope
      // (instructions + input + text.format).
      const fetchBodies = rawCalls
        .filter((captured) => routeVoiceProviderCall(captured.url, captured.init) === "tutor")
        .map((captured) => (captured.init?.body !== undefined ? String(captured.init.body) : ""));
      // The REASONING-binding transport: the body is the workflow payload `{ input }`,
      // whose `input` carries the same scrubbed prompt (instructions + user content).
      const bindingBodies = bindingCalls
        .filter((captured) => routeReasoningWorkflowCall(captured.url) === "tutor")
        .map((captured) => decodeWorkflowInput(captured.init?.body));
      return [...fetchBodies, ...bindingBodies];
    },
    ttsInputs() {
      const inputs: string[] = [];
      for (const captured of rawCalls) {
        if (routeVoiceProviderCall(captured.url, captured.init) !== "tts") {
          continue;
        }
        const body = captured.init?.body;
        if (typeof body === "string") {
          try {
            inputs.push((JSON.parse(body) as { input?: string }).input ?? "");
          } catch {
            inputs.push("");
          }
        }
      }
      return inputs;
    },
    workflowInputs(slot: VoiceProviderSlot): string[] {
      return bindingCalls
        .filter((captured) => routeReasoningWorkflowCall(captured.url) === slot)
        .map((captured) => decodeWorkflowInput(captured.init?.body));
    }
  };

  return {
    install() {
      if (originalFetch !== null) {
        // Double-install would lose the real fetch reference and break restore().
        throw new Error("fake-voice-providers: install() called twice without restore()");
      }
      originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;
      activeReasoningBinding = reasoningBinding;
    },
    restore() {
      if (originalFetch !== null) {
        globalThis.fetch = originalFetch;
        originalFetch = null;
        activeReasoningBinding = null;
      }
    },
    calls,
    get reasoning() {
      return reasoningBinding;
    }
  };
}

/**
 * The REASONING binding of the currently-installed fake, or undefined when none is
 * installed. Voice/extraction test fixtures read this lazily (`get REASONING()`) so their
 * env object points at whichever fake a given test installed — without the fixture having
 * to know about the harness's per-test lifecycle.
 */
let activeReasoningBinding: Fetcher | null = null;

export function currentReasoningBinding(): Fetcher | undefined {
  return activeReasoningBinding ?? undefined;
}

/**
 * Selects and installs the active provider fake. Today only the OpenAI wire exists; when
 * a second impl lands this becomes the provider-selecting seam (a provider arg or env
 * read), and because Tier-1 tests pass the SAME domain config and assert only domain
 * behavior, running them against either wire is the real decoupling proof (not a grep).
 * The OpenRouter impl itself is out of scope here (§13) — it belongs to the later ADR.
 */
export function installVoiceProviders(config: VoiceProviderFakeConfig): VoiceProviderFake {
  const fake = makeOpenAiProviderFake(config);
  fake.install();
  return fake;
}
