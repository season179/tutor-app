# TanStack ecosystem adoption handoff

Date: 2026-06-23

Audience: a cautious coding agent that needs small, concrete tasks.

Goal: adopt more of the TanStack ecosystem in Coach Echo without destabilizing the
voice tutoring loop. Alpha, beta, and RC packages are allowed, but each package must
earn its way in by removing real app complexity or improving local debugging.

## Current baseline

The app already uses:

- `@tanstack/react-start` for the Cloudflare/TanStack Start app.
- `@tanstack/react-router` for routes.
- `@tanstack/react-query` and `@tanstack/react-router-ssr-query` for client queries.
- `@tanstack/ai`, `@tanstack/ai-openai`, and `@tanstack/ai-openrouter` for in-app
  reasoning provider adapters.

Verified candidate packages on 2026-06-23:

- `@tanstack/react-pacer` 0.22.1
- `@tanstack/react-form` 1.33.0
- `@tanstack/react-form-start` 1.33.0
- `@tanstack/react-devtools` 0.10.7
- `@tanstack/react-virtual` 3.14.3
- `@tanstack/react-hotkeys` 0.10.0
- `@tanstack/react-db` 0.1.87
- `@tanstack/query-db-collection` 1.0.41
- `@tanstack/react-ai-devtools` 0.2.56
- `@tanstack/ai-code-mode` 0.2.10
- `@tanstack/ai-isolate-cloudflare` 0.2.26

Reference docs:

- TanStack libraries: https://tanstack.com/libraries
- Pacer: https://tanstack.com/pacer/latest/docs/overview
- Form: https://tanstack.com/form/latest/docs/overview
- Devtools: https://tanstack.com/devtools/latest/docs/overview
- Virtual: https://tanstack.com/virtual/latest/docs/overview
- DB: https://tanstack.com/db/latest/docs/overview
- AI: https://tanstack.com/ai/latest/docs/overview

## Ground rules

Do these before every phase:

1. Run `git status --short --branch`.
2. Read the files listed for the phase.
3. Keep the UI visually identical unless the phase explicitly says to change it.
4. Do not rewrite the voice pipeline, tutor policy, model prompts, auth, D1 schema, or
   Cloudflare worker entry unless the phase explicitly says to touch that area.
5. Add only the package for the phase being implemented.
6. Keep each phase as a separate commit.
7. Use `agent-browser` for browser QA. Do not use Playwright.

Validation commands for every code phase:

```bash
git diff --check
CI=true pnpm test
CI=true pnpm build
```

For UI phases, also run the app and check the affected route with `agent-browser`:

```bash
pnpm dev
agent-browser open https://ai-tutor.dev
agent-browser snapshot -i
```

If `pnpm dev` is already running, do not start a second copy. Use the existing app.

## Phase 1: Pacer for duplicate-action control

Package:

```bash
pnpm add @tanstack/react-pacer
```

Why this first:

The app is performance-sensitive and local-first. Pacer can prevent rapid repeated user
actions from creating duplicate work while keeping the existing backend untouched.

Primary files to inspect:

- `src/client/hooks/use-voice-session.ts`
- `src/client/components/UnifiedComposer.tsx`
- `src/client/components/debug/LocalTracesPage.tsx`
- `src/client/hooks/use-tutor-sessions.ts`

Implementation order:

1. Start with `LocalTracesPage`, not the voice turn. Wrap manual `Refresh` so repeated
   clicks coalesce or throttle. This is the safest first use.
2. Add one small testable helper if needed, but do not introduce a generic abstraction yet.
3. After the trace page works, apply the same pattern to the highest-risk user action:
   stop-and-send or start-recording in `use-voice-session.ts`.
4. Preserve existing disabled-button behavior. Pacer is an extra guard, not a replacement.

Success criteria:

- Repeated trace refresh clicks do not fire multiple overlapping refreshes.
- Repeated stop/send or start-recording actions do not trigger duplicate voice turns.
- Existing tests pass.
- Browser QA confirms the trace refresh button and voice controls still work.

Stop conditions:

- If Pacer makes the voice state harder to reason about, keep Pacer only on trace refresh
  and leave voice controls unchanged.
- Do not change server-side voice behavior in this phase.

## Phase 2: TanStack Form for settings

Packages:

```bash
pnpm add @tanstack/react-form @tanstack/react-form-start
```

Why:

`SettingsPage` is already a form: draft state, dirty state, validation, dropdowns, and
save status. TanStack Form should reduce custom state while making model/provider fields
harder to mismatch.

Primary files to inspect:

- `src/client/components/settings/SettingsPage.tsx`
- `src/client/hooks/use-settings.ts`
- `src/modules/settings/settings-schema.ts`
- `src/modules/settings/settings-types.ts`
- `src/modules/settings/reasoning-model-options.ts`
- `test/settings-schema.test.ts`
- `test/settings-store.test.ts`

Implementation order:

1. Refactor only `/settings`. Do not touch audio, reasoning, or provider runtime code.
2. Preserve `SETTING_FIELDS`, `AUDIO_FIELDS`, and `REASONING_FIELDS` unless a smaller
   typed form descriptor clearly replaces them.
3. Keep the existing visual layout and copy.
4. Use current `providerSettingsPatchSchema` for validation. Do not create a second schema
   that can drift.
5. Keep the save contract: send only the changed patch to `saveSettingsFn`.
6. Keep reasoning model dropdowns backed by `getSettingsModelOptionsFn`.

Success criteria:

- Dirty state enables Save only when something changed.
- Save sends a partial patch, not the whole snapshot.
- Unsupported reasoning models still fail before writing.
- Non-admin users still see "Not authorized".
- Browser QA covers `/settings` load, edit, save, and back navigation.

Stop conditions:

- If TanStack Form forces a visual rewrite, stop and keep the existing component.
- If validation starts duplicating `settings-schema.ts`, stop and redesign the form wiring.

## Phase 3: Local-only TanStack Devtools

Package:

```bash
pnpm add -D @tanstack/react-devtools
```

Optional later package:

```bash
pnpm add -D @tanstack/react-ai-devtools
```

Why:

The app now depends on Router, Query, Start, and AI. A local-only devtools panel can make
debugging faster without changing production behavior.

Primary files to inspect:

- `src/routes/__root.tsx`
- `src/router.tsx`
- `vite.config.ts`

Implementation order:

1. Add a tiny client-only devtools component under `src/client/components/devtools/`.
2. Render it from the root shell or app only in development.
3. Guard with an environment check so it never appears in production builds.
4. Start with base devtools only. Do not wire AI devtools until the base panel is proven.

Success criteria:

- Production build does not include a visible devtools panel.
- Local dev shows the panel.
- Existing app routes still render.
- Browser QA confirms the panel does not cover the primary tutor controls by default.

Stop conditions:

- If devtools requires server event-bus wiring, do not implement that in this phase.
- If it bloats or breaks the Worker build, revert this phase.

## Phase 4: Virtualize long trace lists

Package:

```bash
pnpm add @tanstack/react-virtual
```

Why:

The trace page can grow to hundreds of events. Virtual is a focused fit for long lists and
does not affect tutoring behavior.

Primary files to inspect:

- `src/client/components/debug/LocalTracesPage.tsx`
- `src/styles/app.css`
- `src/core/local-trace-types.ts`

Implementation order:

1. Virtualize the vertical recent-runs list first.
2. Keep the left-to-right selected trace timeline unvirtualized unless it becomes slow.
3. Preserve keyboard/mouse selection behavior.
4. Keep dimensions stable. Avoid layout jumps when virtual rows mount/unmount.

Success criteria:

- 500 trace runs remain scrollable without sluggish rendering.
- Selected run stays visually obvious.
- No horizontal overflow.
- Browser QA covers narrow and desktop widths.

Stop conditions:

- If the trace list is still small in real use, skip this phase.
- Do not introduce TanStack Table here; traces are a timeline first, not a spreadsheet.

## Phase 5: Hotkeys for local power use

Package:

```bash
pnpm add @tanstack/react-hotkeys
```

Why:

This is useful for local dogfooding once the core flow is stable. It is not required for
correctness.

Primary files to inspect:

- `src/client/App.tsx`
- `src/client/components/UnifiedComposer.tsx`
- `src/client/hooks/use-voice-session.ts`
- `src/client/components/debug/LocalTracesPage.tsx`

Suggested hotkeys:

- Start/stop mic.
- Focus composer.
- Open local traces.
- Open settings.

Implementation order:

1. Add hotkeys behind a small local hook.
2. Do not fire hotkeys while a text input, textarea, select, or contenteditable element is
   focused.
3. Do not add visible instructional text to the app. Keep shortcuts discoverable later via
   tooltips or docs.

Success criteria:

- Hotkeys do not interfere with typing.
- Voice controls still work by mouse/touch.
- Browser QA confirms hotkeys work on the tutor screen and do nothing harmful on settings.

Stop conditions:

- If hotkeys conflict with browser/system shortcuts, remove or change them.

## Phase 6: TanStack DB spike only

Packages for spike branch only:

```bash
pnpm add @tanstack/react-db @tanstack/query-db-collection
```

Why:

TanStack DB may be the biggest local-first win, but it is also the biggest architecture
change. Do not adopt it directly. Spike it in isolation.

Primary files to inspect:

- `src/client/hooks/use-tutor-sessions.ts`
- `src/client/hooks/use-live-session.ts`
- `src/modules/sessions/server/session-fns.ts`
- `src/modules/sessions/session-types.ts`
- `src/modules/sessions/live-session-projection.ts`

Spike target:

Use only session summaries or local traces. Do not start with full voice events.

Questions the spike must answer:

1. Can a DB collection wrap the existing server functions without changing D1 schema?
2. Does `useLiveQuery` simplify the session list or make it harder to follow?
3. Can optimistic session title updates be represented cleanly?
4. What is the rollback story if a server mutation fails?
5. Does it reduce code in `use-tutor-sessions.ts` or just move complexity?

Success criteria for adoption:

- The spike removes meaningful state code.
- The server remains the source of truth.
- Optimistic updates are easy to roll back.
- Tests and browser QA stay straightforward.

Stop conditions:

- If DB requires a broad rewrite of session/event storage, do not adopt.
- If it fights TanStack Query instead of complementing it, do not adopt.
- If the only win is "more TanStack", do not adopt.

## Phase 7: Deeper TanStack AI, no free-form tutor agent

Already installed:

- `@tanstack/ai`
- `@tanstack/ai-openai`
- `@tanstack/ai-openrouter`

Optional packages for later research only:

```bash
pnpm add @tanstack/ai-code-mode @tanstack/ai-isolate-cloudflare
```

Why:

TanStack AI can eventually help with structured outputs, tools, streaming, and observability.
But Coach Echo's tutoring constraints are valuable. Do not turn the tutor into an unconstrained
agent.

Primary files to inspect:

- `src/providers/reasoning/reasoning-binding.ts`
- `src/modules/tutoring/tutor-action-validator.ts`
- `src/modules/tutoring/phase-policy.ts`
- `src/modules/voice/voice-pipeline-service.ts`
- `src/modules/problems/question-extraction-service.ts`

Allowed AI work:

- Improve structured-output handling if TanStack AI has a cleaner current API.
- Add narrow observability around AI calls if it improves trace analysis.
- Explore streaming tutor text only if it helps TTS start earlier without breaking validation.
- Explore typed tools only for deterministic safe operations, such as reading current session
  state, never for revealing answers.

Forbidden AI work:

- Do not add Code Mode to production tutoring.
- Do not let the model call arbitrary tools.
- Do not remove `phase-policy`, `tutor-action-validator`, or deterministic verifier checks.
- Do not reveal hidden solution state to the tutor model.

Success criteria:

- Tutor guardrails remain deterministic.
- Structured outputs are at least as strict as today.
- Local traces still separate model time, validation time, commit time, STT, and TTS.

Stop conditions:

- If deeper AI usage weakens guardrails, revert.
- If streaming cannot be validated before TTS, keep the existing turn flow.

## Packages not recommended yet

Do not add these unless a later task explicitly asks for them:

- `@tanstack/react-table`: useful only if traces become a sortable/filterable data grid.
- `@tanstack/store`: use only if React state remains tangled after Query/Form cleanup.
- `@tanstack/react-ranger`: use only if the app adds sliders.
- TanStack CLI / Config / Intent: tooling value is unclear for Coach Echo right now.

## Final implementation order

Use this order:

1. Pacer on trace refresh, then one voice duplicate-action guard.
2. Form for `/settings`.
3. Devtools local-only.
4. Virtual for trace run list if real traces are long enough.
5. Hotkeys.
6. DB spike in a separate branch.
7. Deeper AI research, keeping tutor guardrails intact.

After each phase, write a short note in the PR or commit body:

- What package was added.
- What behavior changed.
- What behavior was intentionally left unchanged.
- Commands run.
- Browser QA performed.
