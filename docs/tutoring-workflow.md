# Coach Echo — Tutoring Workflow & Architecture

**The single source of reference for how Coach Echo tutors and how it is built.** It moves from *why* (the pedagogy), to *what* (the converged tutoring process), to *how* (the architecture that enforces it). AI coding agents should treat this document as authoritative; where the code disagrees with this spec, the spec describes the intended target and the code is the gap to close.

**Status:** Converged design (2026-06-19). The process and architecture were reached by debate between two independent models — Claude Opus 4.8 and OpenAI Codex — grounded in research on effective one-on-one tutoring (ages 7–12) and recent (2025–2026) work on LLM tutoring systems. Both models independently arrived at the same core thesis: *make the pedagogy the protocol, not the prompt.*

**The one-sentence thesis:** Effective tutoring is **structure, not smarts**. The model has the answer instantly; the product's whole value is in *withholding it correctly*. So the architecture's job is to **constrain a model that is too eager to help** — to own the rhythm, the truth, the memory, and the boundaries, and leave only the words to the model.

**Model-name caveat:** `gpt-5.5`, `gpt-realtime-2`, `gpt-4o-transcribe`, and `gpt-4o-mini-tts` (in `wrangler.jsonc`) are past the assistant knowledge cutoff — verify they are current and that capabilities match before relying on exact behavior. The architecture is provider-neutral by design: verifier, classifier, and lesson controller are separate calls, so each can run on whichever model scores best.

---

## How to read this document

- **Part I — Foundations** is the pedagogy the whole system serves. Read it once to understand *why* each constraint exists.
- **Part II — The Process** is the canonical tutoring workflow: the step sequence a student moves through, and the invariants that hold throughout. This is what the server-owned phase machine enforces.
- **Part III — Architecture** is the implementation layer: the phase machine, the `TutorAction` contract, the verifier, the learner model, safety, voice, the data model, module boundaries, and the build sequence.
- **Part IV** records what is settled vs. what must be validated with real children, plus open questions.

---
---

# Part I — Foundations (the pedagogy)

## The mental model

Tutoring runs in three layers, **always in this order**:

1. **Human** — safe, known, not judged.
2. **Meaning** — *"What is this asking?"*
3. **Method** — one step at a time, with the student doing the work.

> Skip *Meaning* and you get guessing. Skip *Human* and you get resistance — especially with a reluctant child.

## What strong tutoring actually is

Great tutoring is not mainly about being smart or patient. It is about **making learning visible in conversation**: how the tutor asks, listens, waits, scaffolds, and adapts in real time. The student should do **most of the talking and reasoning**. For ages 7–12, sessions work best when they are **structured in short blocks**, **centered on the child's thinking**, and **grounded in a trusting relationship** — especially when the child is anxious, bored, resistant, or quick to give up.

The highest-leverage opening move is simple: **make sure the child understands what the problem is asking before solving anything.**

## Session length and rhythm

| Age | Typical length | Notes |
|-----|----------------|-------|
| **7–9** | 30–45 min | Attention fades quickly; fatigue often shows up as behavior problems. |
| **10–12** | 45–60 min | Can handle deeper work, but still needs block structure. |

Attention drops sharply after ~15 minutes on difficult material. Avoid long lecturing; end a few minutes early so the session closes cleanly. A strong session moves through predictable phases (routine reduces anxiety):

```
Warm-up & check-in     →  5–10 min
Review & activate      →  5–10 min
Targeted instruction   →  15–20 min   (I do → We do → You do)
Guided practice        →  10–15 min
Independent try         →   5–10 min
Wrap-up                →   5 min
```

- **I do** — tutor models with simple language, visuals, or analogies.
- **We do** — work two or three examples together; tutor leads, then student leads with guidance.
- **You do** — student attempts the next step alone.

**Rule of thumb:** Do not let a child struggle alone for more than ~2 minutes without a small hint. Struggle should be *productive*, not paralyzing.

## Understand the question first

Strong tutors do not jump to calculation. They first confirm: (1) what the situation is about, (2) what the student is being asked to find, and (3) what the student already knows that applies.

**The Three Reads** (especially for word problems):

| Read | Focus | Example prompt |
|------|-------|----------------|
| **First** | Context only — what is the story about? | *"What is happening here?"* (sometimes read without numbers or the final question) |
| **Second** | Quantities and relationships | *"What numbers do we have? What do they mean? How are they related?"* |
| **Third** | The actual question | *"What are we trying to find?"* |

**Restate before calculate.** Before touching numbers, the student restates the question in their own words — ideally a complete sentence with a blank for the answer: *"Each person gets ___ stickers."* If they can restate it, they usually understand it. If they cannot, solving will likely fail even when arithmetic skills are fine.

## Key tutor moves

| Move | What it sounds like | Why it works | Risk if overused |
|------|---------------------|--------------|------------------|
| **Elicit thinking** | *"What do you notice?"* / *"Why that step?"* | Surfaces misconceptions; keeps the learner active | Frustration if no support follows |
| **Scaffold** | *"Let's do just the first tiny step together."* | Reduces overload without removing challenge | Dependency if never faded |
| **Precision check** | *"Can you show me why that works?"* | *"Do you get it?"* invites false yeses | Feels like quizzing if tone is harsh |
| **Wait time** | Silence after a good question | Time to think instead of guess | Awkward without framing |
| **Feedback with why** | *"That's right because…"* | Builds a rule, not just one answer | Empty praise teaches little |
| **Adaptive re-explanation** | *"Let me try a different example."* | Matches support to need | Drifts into lecturing |

**The core interaction loop:** `Diagnose → Elicit → Scaffold (if stuck) → Check precisely → Fade support → Student tries alone`.

## Working with difficult or reluctant learners

"Difficult" usually means anxious, bored, resistant, shut down, rushing, or quick to give up. The fix is rarely *more content* — it is **relationship, pacing, and structure**. Match strategy to behavior:

| Pattern | Signs | Tutor approach |
|---------|-------|----------------|
| **Blocking / shut down** | *"I'll never get it,"* freezes | Start from what they know; tiny steps; reinforce small wins |
| **Rushing / overconfident** | Skips steps, careless errors | Slow down; require restating; ask *"show me why"* |
| **Resisting / bored** | Eye roll, refusal, *"this is stupid"* | Acknowledge honestly; connect to interests; offer choices; short tasks |
| **Anxious** | Won't try, fear of being wrong | Normalize mistakes; praise effort and strategy, not perfection |

When behavior spikes mid-session, adapt instead of forcing the plan: shorten the review, switch to interactive practice, take a brief reset (stand, stretch, return), and **return to something they *can* do** before rebuilding.

## What separates great sessions from weak ones

**Great:** one clear goal; student-centered talk (questions before explanations); productive struggle; emotional safety (mistakes are information); a transfer check (the child can do something similar *alone* before the session ends); continuity (each session connects to the last; the tutor remembers what failed before).

**Weak:** the tutor talks for 20+ minutes; full answers come too fast; check-ins are only *"Does that make sense?"*; the child nods but cannot reproduce the step; *"I don't know"* is treated as failure rather than information.

**Ages 7–8** need shorter blocks, movement, visuals, multisensory work, and predictable routine. **Ages 9–12** can handle more abstract reasoning and longer independent work, are more sensitive to feeling talked down to (offer choices and real relevance), and may hide confusion to look competent.

---
---

# Part II — The converged tutoring process (the what)

This is the canonical specification of the **tutoring process**: the step-by-step sequence a student moves through for a homework problem, and the rules that hold throughout. Part III is the implementation layer that enforces it.

## Cross-cutting invariants

These hold in **every** step, enforced by the system rather than left to the model's discretion:

1. **Never reveal the full path or the final answer** before the child has done the cognitive work.
2. **The comprehension gate is a hard invariant, adaptively passed.** Solving stays locked until the child shows they understand what's being asked — but *how* they prove it flexes by age and behavior.
3. **One cognitive demand per turn.** Ask one thing, then stop and wait.
4. **Correctness comes from a separate verifier, and only on checkable claims.** The conversational tutor never self-certifies an answer. Open reasoning turns ("what do you notice?") are judged by *engagement*, not correctness — so valid exploratory thinking is never flagged wrong.
5. **Emotional safety.** Process praise over empty praise; mistakes are information; never humiliate ("you should know this"); *"I don't know"* is a useful signal, not a failure.
6. **"Just give me the answer" is redirected into Frame the Task**, never refused coldly.
7. **Speak the child's languages.** Match the task's language for subject terms and required output; mirror the child's comfortable language (Malay, Chinese, or English) for rapport and scaffolding; default to English when uncertain; treat code-switching (Manglish / rojak) as normal, not a mistake. See [Languages](#languages--malaysia-trilingual--code-switching).

## The flow

```
SESSION WRAPPER                          PER-PROBLEM CORE (repeats per problem)
─────────────────                        ──────────────────────────────────────
0. Session Open  ──────────────┐
   (once per session)           │   1. Capture & Parse
                                 │   2. Frame the Task  ◀── THE GATE
                                 │        └─ 2b. Prior knowledge (only if needed)
                                 ├──▶   3. Plan only the FIRST step
                                 │   4. ┌──────────── STEP LOOP (the heart) ────────────┐
                                 │      │ Elicit → Wait → Scaffold → Act →              │
                                 │      │ Verify(if checkable) → Explain → Feedback →   │
                                 │      │ Fade/Adjust → Advance     (repeat per step)   │
                                 │      └────────────────────────────────────────────────┘
                                 │   5. Answer Check (against the framed "find ___")
                                 │   6. Per-problem memory write
8. Session Wrap-up  ◀────────────┤   7. Transfer check (session/skill-level, near close)
   (once per session)            
```

**Granularity:** Steps 0 and 8 happen **once per session**. Steps 1–6 repeat **per problem**. Step 7 happens **once near session close**, at the skill level. A new problem mid-session gets a 10–20-second micro-orient ("New problem — first, what's it asking?"), not a fresh warm-up.

## The steps

### 0. Session Open — *Human before Method* (once per session)
Greet by name; recall one relevant thing from last time ("last time, regrouping tripped you up"); normalize mistakes; set **one** goal for the session. If behavior spikes later, perform a *reset* (return to something they can do), not another warm-up.

### 1. Capture & Parse
Student shares the problem (image / audio / text). Extraction produces candidate problem text, **problem type**, givens, the unknown, any diagram, a **confidence** score, and the problem's **language / script** plus whether *language is the subject*. On low confidence, the tutor asks the child to confirm or read the problem aloud rather than proceeding on a bad parse. **Extraction is fallible:** if the child's later restatement contradicts the extraction, prefer the child's / human-confirmed problem context and mark extraction quality.

### 2. Frame the Task — the gate
Before any solving, the child must identify *what success looks like*. This is the generalized form of "identify the question"; the check branches by problem type:

| Problem type | Framing check |
|---|---|
| **Word problem** | The **Three Reads**: (1) what's the situation? (2) what quantities and how are they related? (3) what exactly are we asked to find? |
| **Equation** | "What are we solving for? What does the `=` tell us? What will a finished answer look like?" |
| **Geometry / diagram** | "What are we trying to find? What facts are given? Which parts of the diagram matter?" |
| **Computation** | "What operation or form is requested? Estimate — what kind of answer makes sense?" |

**Pass condition:** the child produces or selects a valid *"We need to find ___."*

**Hard invariant, adaptive proof** — the gate never opens without the child participating, but the *form* of proof adapts:

| Child's state | How they may pass |
|---|---|
| **Anxious / shut down** | Choose between two restatements, fill one blank, point/tap, or co-restate with the tutor. |
| **Steady** | State the *"We need to find ___"* sentence in their own words. |
| **Rushing / overconfident** | The stricter version: full restatement **plus** "show me why that's what it's asking." |

#### 2b. Activate prior knowledge — conditional, not a gate
Fires **only when** framing reveals a missing tool, learner memory flags a directly relevant past misconception, or the child is stuck and needs a bridge ("this is like when regrouping tripped us up last time"). Otherwise, skip straight to action — stacking three gates before the child touches the problem is exactly what triggers shutdown.

### 3. Plan only the first step
Elicit the **first tiny step** — "what's the very first step, not the answer?" Full-path planning is forbidden. If the child can't propose a first step, the tutor models **one** micro-step ("I'll start the first move, then you take the next one"), then hands control back.

### 4. The Step Loop — the heart (repeats per step)

```
Elicit → Wait → Scaffold(if stuck) → Act → Verify(if checkable)
       → Explain(minimal why) → Feedback-with-why → Fade/Adjust → Advance
```

- **Elicit** — ask exactly one cognitive demand.
- **Wait** — an *adaptive* timer, not a flat two minutes (see below). Distinguish **active thinking** from **stuck silence**.
- **Scaffold** — if stuck, give the *smallest useful* hint; never the answer.
- **Act** — the child says / writes / chooses the next step.
- **Verify** — *only on checkable claims* (a computation, chosen operation, concrete assertion, substitution, diagram relationship). A separate verifier decides correctness, not the warm voice.
- **Explain** — the child gives a minimal "why," scaled by phase (lightweight or co-constructed early; required and unled in independent work). Always probe "show me why" after a correct guess or rushing.
- **Feedback** — specific, with the reason ("that's right *because*…").
- **Fade / Adjust** — reduce support on the next step after success; increase it on repeated error or shutdown.
- **Advance** — only when the step is correct (where checkable) **and** the child shows enough reasoning for the current phase.

**Adaptive wait timer** (when to offer a hint):

| Age band | Default hint threshold (unproductive silence) |
|---|---|
| 7–8 | ~20–45 seconds |
| 9–12 | ~45–90 seconds |
| Hard ceiling (all) | never exceed ~2 minutes without a small hint |

Extend the timer while the child is verbalizing useful reasoning; shorten it (and make the hint smaller) when anxious or shutting down.

**Support ladder has a floor and an exit** — the loop is guaranteed to terminate and can never trap a child:
- **Floor (deepest support):** the tutor fully models the step (I-do), then the child **redoes that same micro-step**. A hint is *never* just the bare final answer.
- **Park-it exit:** if a step is still blocked after the modeled redo, **park it** — mark the misconception, move on or go to wrap, and revisit it next session. We do not grind the child down.

> The classic **I-do / we-do / you-do** gradient is realized inside this loop by the **support-level ladder** (Part III), not as separate phases: deepest support = I-do (model then redo); mid support = we-do; zero support = you-do.

### 5. Answer Check — against the framed task
Return to the *"We need to find ___"* blank from step 2: check units, give a sentence answer, sanity-check against the earlier estimate, or substitute back — whichever fits the problem type. This closes the loop back to comprehension.

### 6. Per-problem memory write
One short reflection — "what helped you figure it out?" — then persist: skill practiced, support level required, any misconception observed, behavior signal, and the scaffold that worked. **The homework problem is done here.** No second problem is forced at this point.

### 7. Transfer check — session/skill-level, near close
**Solving a homework problem with help is *evidence*, not *proof*.** Near the end of the session, for a skill that is a candidate for a mastery upgrade, the child attempts **one** independent, reduced-help item.
- Passing the transfer item is what **promotes mastery**.
- Solving the original homework problem with heavy support leaves the skill at "developing."
- Skipped if the child is dysregulated or out of time — in which case mastery simply stays "developing."

This preserves the transfer guarantee ("the child can do something similar alone before the session ends") **without** making every homework problem feel like it spawns extra homework.

### 8. Session Wrap-up (once per session)
The child says what they learned ("what did we figure out today?"); the tutor assigns **one** small, specific practice task; previews next time; and the system writes the session summary plus mastery / misconception deltas to memory. That memory becomes the input to step 0 of the next session — this is how continuity is realized.

## Languages — Malaysia (trilingual + code-switching)

Coach Echo serves Malaysian learners, where **Malay (Bahasa Melayu), Chinese (Mandarin), and English** all appear in schoolwork and speech — often mixed in a single sentence. Language is a **cross-cutting concern, not a phase**: there is no "pick your language" quiz before tutoring starts.

**The rule (invariant):** *Match the task language for subject terms and required output, mirror the child's comfortable language for rapport and scaffolding, default to English when uncertain, and treat code-switching as normal rather than incorrect.*

### Three signals decide the language each turn
English is always the fallback.

| Signal | What it is | What it leads |
|---|---|---|
| `task_language` | The language/script of the problem itself (from extraction) | **Subject terms and the required output** |
| `learner_comfort_language` | The child's stronger language (from memory + early turns) | **Comprehension and scaffolding** |
| `turn_language` | What the child actually used this turn | The tutor may **mirror** it for rapport |

**Policy, not a lock.** Establish a `working_language_policy` early; then *adapt tone and support language freely, but keep task terms and the answer language stable within a problem* — don't flip *denominator / penyebut / 分母* every turn unless the term itself is the lesson.

### Subject vs. medium — the crux
- **Content subjects (math, science):** language is the *medium*, and it should *reduce* cognitive load. The child may frame and reason in their stronger language even if the worksheet is in Malay — comprehension of the *math* must never be blocked by *language*. Subject terms and the written answer still follow the task language.
- **Language subjects (BM karangan, English comprehension, Chinese 听写):** language *is* the lesson. The target language leads throughout; the child's first language is allowed only for emotional safety and brief instructions — never to bypass target-language practice.

### Per-step touchpoints

| Step | Language behavior |
|---|---|
| **0 · Session Open** | Infer/confirm the child's comfort language lightly from memory and the first turns. |
| **1 · Capture & Parse** | Detect the problem's language, script, type, and whether language is the subject. |
| **2 · Frame the Task** | Apply the content-subject vs. language-subject rule. |
| **4 · Step Loop** | Each tutor turn carries its spoken language, term set, code-switch policy, and required output language. |
| **5 · Answer Check** | Enforce the required output language / terms for the task. |
| **6 & 8 · Memory** | Persist comfort language, code-switch pattern, term preferences, and per-language learning signals. |

### Build notes
- **"Chinese" generates as Mandarin, Simplified** — but *detection accepts Traditional and mixed scripts* rather than flagging them as errors.
- **Per-learner term glossary** (e.g. *denominator / penyebut / 分母*) so terminology stays consistent across turns and sessions.
- **Safety, moderation, and escalation must be multilingual** — English-only guardrails are not enough.
- **STT, vision, verifier, and TTS all take language as input.** The verifier accepts the child's "why" in any of the three languages (math is language-agnostic).
- **VERIFY:** the current TTS voice (`marin`) is English-oriented; confirm natural Malay and Mandarin pronunciation before relying on it — per-language voices may be needed.

## Where the discipline matters most

Steps **2**, **4**, and **7** are where the server-owned phase machine earns its keep:
- **Step 2 (Frame the Task gate)** — structurally prevents jumping to calculation before comprehension.
- **Step 4 (Step Loop)** — enforces one-demand-per-turn, the adaptive wait, the support floor, and the termination guarantee.
- **Step 7 (Transfer check)** — gates the mastery upgrade so "solved with help" is never mistaken for "learned."

---
---

# Part III — Architecture (the how)

## Core principle

> **Treat the LLM as a fluent improviser inside a cage the system controls.** The system owns the rhythm, the truth (what's correct, what the learner knows), and the boundaries. The model owns the words.

When a decision is "should the model decide X, or should code?", the answer is: **code decides anything that pedagogy depends on being reliable** — which phase we're in, whether an answer is right, what the child struggled with last week, whether a turn is safe. The model decides phrasing, the specific question, the analogy, the tone.

Today, Coach Echo encodes almost all of its pedagogy inside a single prompt + a single structured-output call (`src/tutor-policy.ts`, `src/voice-pipeline-service.ts`). The structured `phase`/`studentStatus`/`tutorAction` schema and the 32-word cap are real constraints — but the model is asked to *police itself*: it *reports* which phase it's in; nothing *enforces* the rhythm, verifies an answer independently, remembers across sessions, or adapts to a shut-down child. The rearchitecture is mostly **extracting responsibilities the prompt is currently overloaded with** — not a rewrite. The Workers + D1 + R2 + better-auth foundation, the adapter pattern, and the structured turn schema are sound and stay.

## Pedagogy → architecture map

| Pedagogical principle | Architectural mechanism | Today in the code | Gap / change |
|---|---|---|---|
| **Session rhythm** (warm-up → review → I/we/you-do → guided → independent → wrap) | **Authoritative phase state machine**, server-owned; each phase declares legal moves + exit condition | `phase` enum self-reported by the model (`src/voice-types.ts:96-107`); status only `draft/active/ended` (`src/session-types.ts:5`) | Make the FSM the source of truth (server transitions it); add missing phases. The model is *told* the phase, doesn't choose it. |
| **Understand before solving** (Three Reads, restate-before-calculate) | A hard **Comprehension Gate** the session cannot exit until the child restates the goal | "Confirm the question" exists (`src/client/App.tsx:179-214`) but `orient` can slide into solving | Promote comprehension to a gated phase with an explicit exit condition. Reuse vision extraction as the thing to check against. |
| **One step at a time / never reveal the path / ~2-min struggle rule** | **Turn discipline via transport + schema** (one action per turn) + a **server-side struggle timer** | Strong: 32-word cap, "one small step" rule, request/response stops each turn (`src/voice-pipeline-service.ts:271-307`) | Keep it; add a server wait/hint timer. There is no active-turn clock today. |
| **Make thinking visible** (elicit → scaffold → check → fade) | **Tutor-move taxonomy** (closed enum) + graduated hint ladder; fade driven by the learner model | `tutorAction` enum is a coarse version; no hint levels, no fading signal | Expand moves; add `supportLevel`; drive fading from mastery, not vibes. |
| **Check precisely, not "do you get it?"** | **Separate verifier** (deterministic for arithmetic; narrow-rubric LLM otherwise) sets correctness | Same warm model judges correctness — the recipe for over-validation | Add a verifier call; its verdict sets `studentStatus`. |
| **Continuity** ("remembers what failed before") | **Externalized learner model**: per-skill mastery + misconceptions + session summaries, updated deterministically | None. Sessions are islands; only last ~14–200 in-session events feed/display (`src/d1-session-store.ts:106-128`) | Build the learner model + summary pipeline. Biggest missing pillar. |
| **Adapt to difficult learners** | **Behavioral-mode detector** (timing + transcript) → swaps pedagogy parameters | None. Same handling for every mood | Add a lightweight classifier + a `mode` dimension to the policy. |
| **Emotional safety; one goal; transfer check** | Feedback rules in a versioned spec; session `goal`; `wrap` gated on an independent transfer attempt | `safetyNotes` field unused; `wrap` is a label; no goal entity | Wire safety to moderation; add `goal`; gate the mastery upgrade on transfer. |
| **Child-appropriate, supervised** | **Moderation gate on every output**, guardian visibility, minor-aware data handling | Rate limiting + hashed safety id for Realtime only | Add pre-output moderation + a guardian-visible transcript + escalation. |

## The runtime: a server-owned phase machine in a Durable Object

Add a **`SessionRuntime` Durable Object, one per active session** (keyed by `sessionId`). It is the only thing that can advance the phase, accept a student turn, schedule a hint timer, or decide which moves are legal. This is the IntelliCode "single-writer StateGraph" pattern: every phase transition and mastery update is one coherent transformation, not a race between stateless Worker invocations.

**Why a DO now (the app has none):** the runtime needs (1) **per-session serialization** — image-send, transcript-send, manual-text, stop/restart can arrive close together; (2) **server-side timers** — the wait/hint clock tied to the active prompt; (3) **low-latency in-memory turn state** during a live lesson. That is the textbook Durable Object use case. D1 stays the durable, queryable record; the DO is the live brain of one session and can rebuild from D1 if evicted.

**Recommended control flow:**

```
React voice room
  → Worker API route (/api/voice/turn)
  → SessionRuntime Durable Object (keyed by sessionId)
  → TurnController
  → PedagogyPolicy + SafetyPolicy + LearnerMemory
  → LessonControllerAgent (or Responses structured output)
  → TutorActionValidator
  → TTS
  → D1 event/turn/memory writes + response to client
```

**Three persistence layers:** (1) DO in-memory: active phase, active turn, hint timer, currently-allowed moves; (2) DO storage: a compact snapshot for restart; (3) D1: durable phase transitions, turns, transcripts, summaries, mastery events.

### The phase model

The implementation phases enforce the Part II process. The model receives `currentPhase`, `allowedMoves`, `forbiddenMoves`, `currentGate`, `currentSupportLevel`, `learnerSignals`, and `recentTurnSummary` — never broad permission to decide the whole lesson.

```ts
type SessionPhase =
  | "session_open"        // step 0  — once/session
  | "capture_parse"       // step 1
  | "frame_task"          // step 2  — THE GATE
  | "activate_prior"      // step 2b — conditional
  | "plan_first_step"     // step 3
  | "step_loop"           // step 4  — the heart; support-level ladder lives here
  | "answer_check"        // step 5
  | "memory_write"        // step 6
  | "transfer_check"      // step 7  — once near close, skill-level
  | "wrap_up";            // step 8  — once/session
```

> Note on reconciliation: an earlier draft modeled `targeted_i_do / we_do / you_do` and `guided_practice / independent_try` as separate phases. The converged process folds the I-do/we-do/you-do gradient into the **support-level ladder inside `step_loop`** instead, which is simpler and matches how a real tutor fades support mid-problem. Keep the gradient as support levels, not phases.

| Phase | Goal | Example allowed moves | Exit condition |
|---|---|---|---|
| `session_open` | Relationship + routine + one goal | `rapport_check`, `recall_prior`, `choice_offer` | Greeting done, goal set (or quick skip if a problem is ready) |
| `capture_parse` | Get a trustworthy problem | `clarify_context` | Extraction confirmed or read aloud; confidence acceptable |
| `frame_task` | Understand the question first | `three_reads_1/2/3`, `restate_prompt` | `ComprehensionGate.status === "complete"` |
| `activate_prior` | Bridge a missing tool | `recall_prior`, `probe_prior_knowledge` | Prior concept recalled / misconception surfaced (skipped if not needed) |
| `plan_first_step` | First tiny step only | `elicit`, `model_micro_step` | Child proposes (or redoes a modeled) first step |
| `step_loop` | Do the work, one step at a time | `elicit`, `scaffold_hint`, `precision_check`, `feedback_with_why`, `model_micro_step`, `fade` | Step correct (where checkable) + enough reasoning; or step parked |
| `answer_check` | Close back to the framed goal | `check`, `precision_check` | Units/sentence/estimate/substitution done |
| `memory_write` | Persist what happened | (system) `reflect` | Memory written; problem done |
| `transfer_check` | Promote mastery honestly | `set_independent_task`, `minimal_check`, `fade` | Independent item attempted or blocker recorded (skippable) |
| `wrap_up` | Summarize + preview | `student_summary`, `assign_small_task`, `preview_next` | Session summary persisted |

## The comprehension gate

Split "problem context" into two stages: **`ProblemExtraction`** (machine extracts candidate text + metadata from the image) and **`ComprehensionGate`** (the child demonstrates understanding *in conversation*). Do not allow `model_micro_step`, `calculation_hint`, `solve`, `final_answer`, or `check_answer` until the gate is complete.

```ts
type ComprehensionGate = {
  problemContextId: string;
  status:
    | "needs_image"
    | "needs_question_confirmation"
    | "needs_context_read"      // Three Reads #1
    | "needs_quantity_read"     // Three Reads #2
    | "needs_target_read"       // Three Reads #3
    | "needs_restatement"
    | "complete";
  read1Context?: string;
  read2Quantities?: Array<{ label: string; value?: string; meaning: string }>;
  read2Relationships?: string[];
  read3Target?: string;
  studentRestatement?: string;
  priorKnowledgeProbe?: string;
  acceptedAt?: string;
};
```

Vision extraction evolves from "extract question" to "extract problem context" (stored in a `problem_contexts` table, not overloaded onto `tutor_sessions.imagePrompt`):

```ts
type ExtractedProblemContext = {
  extractedText: string;
  visibleQuestion: string;
  problemType: "word_problem" | "equation" | "geometry" | "science" | "other";
  likelySkillKeys: string[];
  quantities: Array<{ raw: string; label: string; unit?: string }>;
  relationships: string[];
  unknownTarget: string | null;
  diagramDescription: string | null;
  taskLanguage: string;             // BCP-47-ish; e.g. "ms", "zh-Hans", "en"
  languageIsTheSubject: boolean;    // BM karangan / 听写 / English comprehension
  extractionOutcome: "extracted" | "multiple_questions" | "partial" | "none" | "not_a_problem";
  confidence: "high" | "medium" | "low";
  notes: string | null;
};
```

The runtime builds the turn request so the model can phrase but cannot skip the gate:

```json
{
  "phase": "frame_task",
  "allowedMoves": ["three_reads_1", "three_reads_2", "three_reads_3", "restate_prompt"],
  "forbiddenMoves": ["calculation_hint", "solve", "final_answer"],
  "comprehensionGate": { "status": "needs_quantity_read", "read1Context": "People are sharing stickers." },
  "instruction": "Ask exactly one question that helps the child complete the current gate."
}
```

## The `TutorAction` contract

Every tutor output is a `TutorAction`, **validated by the server before TTS** against phase policy, the comprehension gate, timing policy, safety, and the "do not solve it for them" rule. This is the smallest change with the biggest pedagogical payoff.

```ts
type TutorMove =
  | "rapport_check" | "recall_prior" | "clarify_context"
  | "three_reads_1" | "three_reads_2" | "three_reads_3" | "restate_prompt"
  | "elicit" | "scaffold_hint" | "precision_check" | "feedback_with_why"
  | "model_micro_step" | "fade" | "transfer_check" | "wrap"
  | "reset" | "safety_boundary" | "escalate";

type TutorAction = {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  phase: SessionPhase;
  move: TutorMove;
  supportLevel: 0 | 1 | 2 | 3 | 4;       // see ladder below
  targetCognitiveWork:
    | "notice" | "restate" | "choose_first_step" | "explain_why"
    | "calculate_one_step" | "check_work" | "summarize";
  expectedStudentResponse:
    | "spoken_phrase" | "spoken_reasoning" | "one_number"
    | "choice" | "independent_attempt" | "none";
  spokenUtterance: string;               // keep the 32-word cap; many turns should be 10–20 words
  language: {                            // see Part II "Languages"
    spokenLanguage: string;              // what the tutor speaks this turn
    termSet: string;                     // glossary key for stable subject terms
    targetOutputLanguage: string;        // what the written answer must be in
    codeSwitchPolicy: "mirror" | "stable";
  };
  waitPolicy: { minimumQuietMs: number; nudgeAfterMs: number; hintAfterMs: number };
  assessment: {
    studentStatus: "unknown" | "correct" | "partial" | "incorrect" | "stuck" | "off_task"; // set by VERIFIER on checkable claims
    misconceptionKey?: string;
    confidence: "low" | "medium" | "high";
  };
  statePatch: {
    nextPhase?: SessionPhase;
    gateStatus?: ComprehensionGate["status"];
    supportLevelDelta?: -1 | 0 | 1;
    masteryEvidence?: Array<{ skillKey: string; kind: "success" | "struggle" | "misconception" }>;
  };
  safety: { kind: "none" | "boundary" | "escalate"; reason?: string };
};
```

The current `hiddenState` (returned by the model, then stripped) should **not** be the memory mechanism — persist server-owned `statePatch`es instead.

### The support-level ladder (scaffold ⇄ fade; subsumes I-do/we-do/you-do)

| Level | Meaning | Example |
|---|---|---|
| **4** | Tutor models a tiny step (**I-do floor**) | "Watch this first tiny setup…" then *child redoes it* |
| **3** | High scaffold (**we-do**) | "Let's identify just the total." |
| **2** | Hint | "Look for the number that says how many altogether." |
| **1** | Prompt | "What would you try first?" |
| **0** | Independent (**you-do**) | "Try this one. I'll wait." |

Server-applied transitions: correct **with** explanation → decrement support; correct **without** explanation → precision-check before decrement; partial/stuck under ~2 min → smaller elicit or scaffold (not the answer); stuck at ~2 min → one small hint; repeated stuck after hints → model one micro-step (level 4), then return control. The loop always terminates: if still blocked after the modeled redo, **park** the step and record the misconception.

## The verifier

A **separate** call whose only job is correctness + naming the specific error — never the warm conversational model. Deterministic/symbolic for arithmetic and algebra where practical; otherwise a narrow-rubric LLM grader (`VerifierAgent`, which never speaks directly). Its verdict — not the tutor's opinion — sets `assessment.studentStatus`. This directly fixes the documented "confirm correct, miss the rest" failure: LLM tutors over-validate wrong answers and over-reject valid-but-suboptimal reasoning. **Fire only on checkable claims;** open reasoning turns are judged by engagement.

## The learner model (externalized, deterministic)

The continuity pillar — *do not* ask an LLM to "remember." Per-skill mastery (knowledge-tracing-style estimate with a forgetting decay), a misconception list, and short session summaries, **updated by pure functions**. One signed-in account is **not** necessarily one child — a parent/tutor may own several learners.

At **session start** the runtime fetches: learner profile + age band; last 1–3 session summaries; due review items; active misconceptions for the likely skills; effective strategies for this learner ("responds to choices," "rushing improves when asked to restate"). At **wrap-up** the `SessionSummarizerAgent` writes: today's goal, skills touched, the child's strongest independent step, misconceptions observed, support level required, behavior signals, one small practice task, and the next-session opening review.

## Behavioral-mode detection

A `BehaviorSignalService` runs after each student turn (heuristics first, a cheap classifier later) from: transcript phrases ("I don't know," "this is stupid," "too easy"), response latency (fast = rushing; long silence = stuck/anxious), recording behavior (immediate stop/restart, empty clips, abandonment), error patterns (repeated wrong, skipped restatement, arithmetic-right-but-target-wrong), and barge-in.

```ts
type LearnerBehaviorState = {
  pattern: "regulated" | "anxious" | "rushing" | "shutdown" | "resisting" | "bored";
  confidence: "low" | "medium" | "high";
  recentSignals: string[];
  strategy:
    | "normal" | "tiny_steps" | "normalize_mistakes" | "offer_choice"
    | "slow_down_restate" | "brief_reset" | "return_to_known_success";
};
```

Strategy lives in `SessionRuntime`, not the client. **Bias toward patience** — a long silence may be thinking, not shutdown; use mode as a soft prior, not a hard switch.

## Safety & guardrails for children

For ages 7–12, safety is content moderation **and** homework integrity, emotional safety, and escalation. Required layers:

1. **Identity & ownership** — keep better-auth + owner-scoped data; support guardian linking.
2. **Problem-boundary checks** — reject/redirect non-homework images (extraction already has `not_a_problem` / `none`).
3. **Input/output moderation** — every student text, image text, and **proposed tutor utterance** passes a moderation/safety pass *before* TTS. Wire the existing `safetyNotes` field into this rather than discarding it. Use stable **hashed safety identifiers** on Responses calls too (today only Realtime has one).
4. **Homework integrity** — the validator rejects final answers, full solution paths, and multi-step plans before the child has done the work (this is Khanmigo's central stance, made structural here).
5. **Emotional safety** — forbid humiliation, sarcasm, "you should know this," and pressure; require process praise with corrective feedback.
6. **Escalation** — on self-harm, abuse, severe distress, or unsafe situations: stop tutoring and surface a guardian escalation flow.
7. **Auditability** — persist `safety_events` (reason, action taken, guardian-review-needed). Multilingual guardrails — English-only is not enough.
8. **Data minimization for minors** — child data only in an authenticated (ideally guardian-linked) context; be deliberate about voice/transcript retention. Anonymous "try before sign-in" should not accumulate durable child data without a guardian. (COPPA / CIPA / FERPA / KOSA-aware — needs a product/legal decision before storing rich learner memory.)

## Voice: control vs. naturalness

- **Turn-based pipeline (today's default)** — record → `gpt-4o-transcribe` → lesson controller → `gpt-4o-mini-tts` — is *structurally* aligned with the pedagogy: it physically cannot run ahead of the student, and every turn passes the schema gate. Cost: latency and a clunky press-to-record UX.
- **Realtime (today's fallback)** gives low latency, barge-in, and natural turn-taking — but speech-to-speech is *hard to constrain* to "one small step, then stop." Today's realtime path bypasses the structured controller (`src/voice-client-adapter.ts:354-435`).

**Recommendation:** keep the **turn-controlled pipeline as the pedagogical default**, and treat Realtime as an enhancement that **must be caged** — every realtime tutor response must call a server `nextTutorAction` tool that routes through `SessionRuntime` → `TutorActionValidator` → `SafetyPolicy` → D1. The FSM still owns the rhythm. Don't trade away one-step-at-a-time discipline for "it feels more natural."

**Child-specific tuning:** wait-time is a *feature*, but VAD fights it — tune turn detection toward patience (semantic-VAD "medium"; "low/high" both misbehave) and offer an explicit "take your time" affordance. Latency budgets by moment: extraction 3–8 s (with progress UI); after a child's answer, first audio < 2 s for simple checks, < 4 s for normal, show "checking" immediately; never fill wait-time silence; never exceed ~2 min of struggle without a small hint. Keep utterances short (10–20 words typical). For ages 7–8, slower pacing and concrete words; for 9–12, concise but not babyish.

## Agents (SDK roles)

Use `@openai/agents` (verify exact APIs against the installed `^0.11.6` at implementation time) as typed wrappers — **not** a free-running multi-agent tutor. The server owns orchestration, state, and storage:

- `ProblemExtractorAgent` — vision → `ExtractedProblemContext`.
- `LessonControllerAgent` — proposes exactly one `TutorAction`.
- `VerifierAgent` — privately checks the student's step; never speaks.
- `SessionSummarizerAgent` — wrap-up summaries, mastery events, next-session review.
- `SafetyClassifierAgent` — unsafe/off-topic classification + escalation needs.

Structured outputs (strict JSON schema) remain the key enforcement layer.

## Module decomposition

| Module | Owns | Does not own |
|---|---|---|
| `auth/IdentityService` | better-auth, Google OAuth, anonymous linking, owner/guardian identity | Tutoring state or mastery |
| `sessions/SessionRepository` | D1 reads/writes for sessions, turns, events, summaries | Live turn coordination |
| `session-runtime/SessionRuntimeDO` | Active phase, active turn, timers, allowed moves, serialization, snapshots | Long-term analytics queries |
| `pedagogy/PhasePolicy` | Phase graph, allowed moves, support-level transitions, gate rules | Model phrasing |
| `pedagogy/SpecCompiler` | Compile per-turn system instructions from `(phase × mode × learnerSnapshot)` | Choosing the phase |
| `problem-context/ProblemContextService` | R2 keys, vision extraction, human confirmation, extracted metadata | Comprehension acceptance |
| `problem-context/ComprehensionGate` | Three Reads, restatement, prior-knowledge probe | Image upload mechanics |
| `turn-controller/TutorActionController` | Build model input, call agent, validate `TutorAction`, produce TTS | Auth, client UI |
| `agents/` | Agents SDK wrappers (extractor, controller, verifier, summarizer, safety) | Business rules that must be deterministic |
| `learner-memory/LearnerMemoryService` | Profile, skill mastery, misconceptions, retrieval for warm-up/review | Live audio |
| `behavior/BehaviorSignalService` | Detect anxious/rushing/shutdown/resisting/bored + strategy | Phase transitions by itself |
| `safety/SafetyPolicy` | Moderation, topic boundaries, homework-integrity, escalation | Support-level choice (except safety override) |
| `voice/VoicePipeline` | STT, TTS, realtime transport adapters, barge-in/silence signals | Deciding the tutor move |
| `client/React room` | Image selection, recording, playback, phase/status display | Source of truth for phase or correctness |
| `evals/observability` | Trace review, tutor-move evals, safety tests, latency dashboards | Runtime enforcement |

> The **Pedagogy Spec compiler** is the LearnLM move: instead of one frozen `tutorPolicy.instructions`, store a **structured, versioned spec** rendered into per-turn instructions from `(phase, behavioralMode, learnerSnapshot)`. Pedagogy is best expressed as per-turn instruction-following you can version, A/B test, and tune — not baked into one paragraph.

## Data model

Keep existing auth tables and `tutor_sessions` / `session_events`. Evolve tutoring storage toward these entities. **Relational first — do not add vector search until structured retrieval fails** ("last misconception with fractions" beats semantic nearest-neighbor for this app).

```sql
CREATE TABLE learners (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  age_band TEXT NOT NULL CHECK (age_band IN ('7_8', '9_10', '11_12')),
  grade_band TEXT,
  comfort_language TEXT,                 -- trilingual: child's stronger language
  interests_json TEXT,
  voice_preferences_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE tutor_sessions ADD COLUMN learner_id TEXT REFERENCES learners(id);
ALTER TABLE tutor_sessions ADD COLUMN current_phase TEXT;        -- authoritative FSM state
ALTER TABLE tutor_sessions ADD COLUMN session_goal TEXT;         -- the one clear goal
ALTER TABLE tutor_sessions ADD COLUMN behavioral_mode TEXT;
ALTER TABLE tutor_sessions ADD COLUMN planned_minutes INTEGER;
ALTER TABLE tutor_sessions ADD COLUMN started_at TEXT;
ALTER TABLE tutor_sessions ADD COLUMN ended_at TEXT;

CREATE TABLE problem_contexts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  r2_object_key TEXT,
  extracted_text TEXT,
  confirmed_question TEXT,
  extraction_outcome TEXT NOT NULL,
  extraction_confidence TEXT,
  problem_type TEXT,
  skill_keys_json TEXT,
  quantities_json TEXT,
  relationships_json TEXT,
  diagram_description TEXT,
  task_language TEXT,                     -- detected problem language/script
  language_is_subject INTEGER DEFAULT 0,  -- BM karangan / 听写 / English comprehension
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE comprehension_checks (
  id TEXT PRIMARY KEY,
  problem_context_id TEXT NOT NULL REFERENCES problem_contexts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  check_kind TEXT NOT NULL CHECK (check_kind IN ('read1_context','read2_quantities','read3_target','restate','prior_knowledge')),
  tutor_turn_id TEXT,
  student_response TEXT,
  accepted INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tutor_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  phase TEXT NOT NULL,
  move TEXT NOT NULL,
  support_level INTEGER NOT NULL,
  student_transcript TEXT,
  student_status TEXT,                    -- set by VERIFIER, not the chat model
  student_latency_ms INTEGER,             -- for behavioral detection
  spoken_utterance TEXT NOT NULL,
  spoken_language TEXT,
  action_json TEXT NOT NULL,
  latency_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE learner_skill_mastery (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new','learning','developing','secure','review_due')),
  confidence REAL NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  last_evidence_at TEXT,
  next_review_at TEXT,                     -- forgetting-curve decay
  notes TEXT,
  PRIMARY KEY (learner_id, skill_key)
);

CREATE TABLE misconception_events (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  skill_key TEXT,
  misconception_key TEXT NOT NULL,
  evidence TEXT NOT NULL,                  -- "subtracts smaller-from-larger per column"
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE behavior_signals (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  confidence TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  strategy TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  goal TEXT,
  summary TEXT NOT NULL,
  wins_json TEXT,
  misconceptions_json TEXT,
  effective_strategies_json TEXT,
  next_review_json TEXT,
  practice_task_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE safety_events (
  id TEXT PRIMARY KEY,
  learner_id TEXT REFERENCES learners(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  evidence TEXT,
  action_taken TEXT NOT NULL,
  guardian_review_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

## Honest critique of the current architecture

**Good (keep):** Worker-native routing (`src/worker.ts:6-35`); better-auth + D1 ownership (`src/auth.ts:40-76`); R2 image storage with scoped keys; strict structured vision extraction + confirmation (`src/problem-context/question-extraction-service.ts`); the naturally turn-controlled request pipeline; the 32-word cap.

**Weaknesses, in priority order:**

1. **The FSM is advisory** — the model self-reports `phase`; nothing enforces legal transitions. Pedagogy is only as reliable as the model's mood.
2. **No independent verifier** — the same warm model judges correctness → over-validation.
3. **No learner model / no continuity** — sessions are islands; the event log is write-only.
4. **Pedagogy is one frozen paragraph** — `tutorPolicy.instructions` can't vary by phase/mood/learner or be versioned/A-B-tested.
5. **No behavioral adaptation** — identical handling of an anxious child and a rushing one.
6. **Comprehension gate is soft** — the #1 highest-leverage move is a suggestion `orient` can skip.
7. **Safety is thin** for a children's product — no output moderation, no guardian surface.
8. **Stateless where it should be stateful** — no Durable Object for the live, timed, single-writer session.

## Rollout sequence (highest leverage first)

Each step is independently shippable and de-risks the next:

1. **Introduce `TutorAction` + server validation around the current pipeline.** Keep `/api/voice/turn`; make it load/update a real state object; validate phase, move, word count, one-cognitive-demand, no-final-answer, and safety before TTS. Smallest change, biggest payoff.
2. **Add the Comprehension Gate** (Three Reads + restatement). Turn "Ask about image" into the start of the comprehension phase, not a solve request.
3. **Add the `SessionRuntime` Durable Object.** Route active-turn endpoints through it; serialize turns; own the wait/hint timer (this is where the ~2-min rule becomes real); snapshot to D1.
4. **Add the separate verifier** for answer checks.
5. **Externalize the learner model + session summaries.** Unlocks real warm-up/review and the continuity users will *feel*.
6. **Refactor `tutorPolicy` into a parameterized pedagogy spec** `(phase × mode × learner)`.
7. **Behavioral-mode detection → adaptation.**
8. **Safety/moderation pipeline + guardian visibility.** Required before broad use by minors.
9. **Voice: pick the default deliberately, tune wait-time, and cage Realtime behind the FSM.**

**Definition of "done":** adopt the field's **"teaching over solving"** evaluation stance — measure whether the system *teaches* (probing questions, productive struggle, transfer), not whether it's *helpful* (fast correct answers). Build a small transcript-eval harness around the tutor-move taxonomy so pedagogy regressions are visible. Add evals for "does not give the final answer," "requires restatement," "fades support," "responds safely to distress," and trilingual/code-switched fixtures.

---
---

# Part IV — Settled, to-validate, and open questions

**Settled (the structure):** the step sequence; the gate-as-hard-invariant; problem-type branching; conditional prior-knowledge; the step-loop shape with a support floor and park-it exit; verifier-on-checkable-claims-only; session/skill-level transfer; the trilingual language rule; server-owned phase FSM in a Durable Object; the `TutorAction` contract; externalized (deterministic) learner memory; cage-Realtime-behind-the-controller; relational-first data model.

**Empirical — tune with real children (ages 7–12):**
- exact wait-timer thresholds per age band;
- what counts as "enough reasoning" to advance at each phase;
- the adaptive forms of gate-proof for anxious vs. rushing learners;
- how aggressively support fades;
- behavioral-detection false-positive rate (silence ≠ shutdown);
- TTS pronunciation quality for Malay and Mandarin (current voice is English-oriented);
- STT, vision extraction, and the verifier on code-switched (Manglish / rojak) input;
- latency with multiple calls per turn (parallelize verify + move-generate where possible).

**Open questions / risks:**
- **Skill taxonomy grain** — start with a small curriculum-aligned set (elementary math) and grow; too fine = sparse data, too coarse = useless review.
- **Verifier coverage** — easy for arithmetic, hard for open word problems and non-math subjects; measure reliability of the LLM-grader path.
- **Learner identity** — one signed-in account may be a parent/tutor with several children; support multiple learners per owner before trusting memory.
- **Session scope** — full 30–60 min session vs. focused single-problem room; the FSM supports both, UX must decide how much rhythm is visible.
- **Anonymous → guardian-linked data lifecycle** — how much child data accrues before a guardian exists, and retention.
- **Ground truth** — a verifier model can still be wrong; add deterministic parsers/checkers for arithmetic/algebra where practical.
- **Cost** — more calls per turn; use cheap models for verify/classify/moderate, reserve the strong model for the conversational move.
- **Privacy & child compliance** — COPPA/CIPA/FERPA/KOSA; a product/legal decision is needed before storing rich learner memory.

---

## Sources

**Pedagogy** (effective one-on-one tutoring, ages 7–12): tutoring-move taxonomy & wait-time/scaffolding/feedback research (National Tutoring Observatory; Stanford NSSA on tutor–student relationships); the Three Reads strategy (Math Learning Center); teaching word problems (Voyager Sopris); session planning (National Tutoring Authority); high-impact tutoring systematic review (ERIC); engaging reluctant learners (Step Up Tutoring; The Pathway 2 Success); difficult tutoring situations (Duke PFS).

**LLM tutoring systems** (2025–2026):
- **LearnLM** ([arXiv 2412.16429](https://arxiv.org/pdf/2412.16429)) — pedagogy as per-turn *instruction-following* you specify, not baked in.
- **Tutor CoPilot** (Stanford NSSA) + **tutor-move taxonomy** ([arXiv 2603.05778](https://arxiv.org/pdf/2603.05778v1)) — high- vs low-quality move taxonomy; teaching over solving.
- **Beyond Helpfulness** ([arXiv 2606.16206](https://arxiv.org/html/2606.16206)) — evaluate teaching impact, not helpfulness.
- **Confirming Correct, Missing the Rest** ([arXiv 2605.16207](https://arxiv.org/html/2605.16207)) — LLM tutors over-validate wrong answers, over-reject valid suboptimal reasoning → need an independent verifier.
- **IntelliCode** ([arXiv 2512.18669](https://arxiv.org/pdf/2512.18669)) — single-writer StateGraph over the learner model.
- **LOOM** ([arXiv 2511.21037](https://arxiv.org/html/2511.21037)) & **TASA** ([arXiv 2511.15163](https://arxiv.org/html/2511.15163)) — externalized learner memory + forgetting curves.
- **Why LLMs Alone Fall Short for Learner Modelling (K-12)** ([arXiv 2512.23036](https://arxiv.org/pdf/2512.23036)) — don't trust the LLM to maintain evolving learner state.
- **A Theory of Adaptive Scaffolding for LLM Pedagogical Agents** ([arXiv 2508.01503](https://arxiv.org/pdf/2508.01503)) — graduated hint ladder; fade support.
- **State Machine Prompting** ([arXiv 2510.18395](https://arxiv.org/pdf/2510.18395)) — FSM-constrained agents reduce drift/hallucination.

**Platform docs** (verified 2026-06-19): OpenAI Realtime/audio, structured outputs, Agents SDK, safety best-practices & safety-checks guides; Cloudflare Durable Objects, D1, R2.

**Child safety:** Khanmigo safety features; age-appropriate safety architecture (eSchool News, 2026); AI & children's privacy regulatory guidance (2026).

---

*Converged design by Claude (Opus 4.8) × OpenAI Codex, 2026-06-19. This document is the single source of reference; the human-friendly companion is [`tutoring-workflow.html`](./tutoring-workflow.html).*
