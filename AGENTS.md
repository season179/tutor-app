Use deepwiki for package/library docs.
Use agent-browser to test it.
No flaky tests; every test must protect something real.

## Two-worker architecture (Worker A `ai-tutor` + Worker B `ai-tutor-reasoning`)
The four reasoning calls (gate-check, verifier, tutor-turn, extract-question) run on a Flue
worker (`reasoning-worker/`), called over the `REASONING` service binding. The full
rationale + the payload contract (Flue has no per-call `instructions` override, so the
dynamic prompt travels as the workflow `input`) is in `docs/adr/0001-flue-reasoning-worker.md`.
The binding is the SOLE reasoning transport — the legacy direct-OpenAI reasoning path was
removed in Phase 4. Worker A makes NO direct OpenAI calls anymore: reasoning crosses the
binding (Flue is LLM-only there), and STT/TTS were swapped to OpenRouter
(`src/providers/openrouter/openrouter-audio.ts`) — so the only audio-provider secret Worker A
holds is `OPENROUTER_API_KEY`.

- **Worker A** (`wrangler.jsonc`, `src/`, pnpm): the front door. Owns all domain logic —
  scrubbing, the re-ask loop, the deterministic verifier track, phase logic, `commitTurn`,
  STT, TTS. Calls the binding via `src/providers/reasoning/reasoning-binding.ts`. Owns the
  DB-backed provider/model settings (`src/modules/settings/`) and ships each stage's model
  across the binding as `payload.model`.
- **Worker B** (`reasoning-worker/`, npm): Flue-generated, sources in `reasoning-worker/.flue/`.
  A pure model executor — holds no stage prompt. Each workflow forwards the per-call
  `payload.model` into `session.prompt({ model })`; when that field is absent, the
  `createAgent` env specifier is the fallback (`REASONING_MODEL` for gate-check / verifier /
  extract-question, `TUTOR_MODEL ?? REASONING_MODEL` for tutor-turn). In production Worker A
  always ships the model from the `provider_settings` table; the env vars are the floor.

### Provider/model settings (DB-backed)
STT, TTS, and the four reasoning-stage models live in the `provider_settings` keyed-rows
table (`migrations/0011_provider_settings.sql` + `0014_provider_settings_provider_column.sql`),
NOT env vars — editable from the `/settings` page
(`src/client/components/settings/SettingsPage.tsx`) so models can be swapped and tested
without a redeploy. Model rows store `provider` separately from the bare `value`: Worker A
passes bare `value` to OpenRouter audio, and recomposes `provider/value` only for Flue/Pi
reasoning via `modelExtraForStage(settings, stage)`. Worker A reads the snapshot once per
turn/extraction via `loadProviderSettings(env)` (`src/modules/settings/settings-loader.ts`)
and threads it through `createVoicePipelineOptions` (STT/TTS) and `modelExtraForStage`
(reasoning → binding payload). Adding a slot is a new row + a `SettingType` union member +
a `SETTING_FIELDS` entry — never a schema migration. The provider *credentials* stay
Wrangler secrets (never the DB).

### Two-worker local dev
Every reasoning stage needs Worker B up: if `env.REASONING` has no local target, the binding
fetch returns non-2xx and `runReasoningWorkflow` throws `Reasoning workflow "<stage>" returned
an error.` (with the binding-resolution hint in the HttpError detail). `pnpm dev` now starts
BOTH workers via `concurrently` — Worker A (`dev:app`, portless→vite) and Worker B
(`dev:reasoning`, `flue dev`) — so the service binding resolves through wrangler's dev registry.

```bash
pnpm dev            # starts both: app (blue) + reasoning (magenta)
# one-time per machine:
cd reasoning-worker && npm install        # Worker B deps
# Worker B reads reasoning-worker/.dev.vars (OPENAI_API_KEY + OPENROUTER_API_KEY);
# copy from reasoning-worker/.dev.vars.example.
```

Run a worker alone with `pnpm dev:app` / `pnpm dev:reasoning` when you only need one.

### Dual deploy
Build + deploy each worker separately. Worker B builds with Flue and deploys from its
generated `dist/` config; Worker A uses the root `pnpm deploy`.

```bash
# Worker B:
cd reasoning-worker && npm run deploy          # flue build --target cloudflare && wrangler deploy --config dist/ai_tutor_reasoning/wrangler.json
# Worker A (from repo root):
pnpm deploy
```

Secret rotation touches BOTH workers, with DIFFERENT keys per worker. Only *credentials*
rotate as secrets — model provider/value settings live in the `provider_settings` DB table
(see above):
- **Worker A** holds `OPENROUTER_API_KEY` (STT/TTS) — set with `pnpm wrangler secret put
  OPENROUTER_API_KEY`.
- **Worker B** reads BOTH `OPENAI_API_KEY` (when the gate/verifier/extract model points at
  an OpenAI model) and `OPENROUTER_API_KEY` (when the tutor model points at an OpenRouter
  model) — set each with `cd reasoning-worker && npx wrangler secret put <KEY>`.

### Tests
The voice-pipeline test harness (`test/helpers/fake-voice-providers.ts`) is transport-aware:
`routeVoiceProviderCall` routes the OpenRouter-fetch transport (STT/TTS),
`routeReasoningWorkflowCall` routes the REASONING-binding transport (gate/verifier/tutor), and
both write to the SAME slot
counters — so a Tier-1 test body asserts the same domain behavior regardless of transport. The
harness always exposes a `reasoning` Fetcher; voice fixtures read it lazily off the installed
fake (`voiceServiceEnv.REASONING`), so the binding is wired by default.

## pi (collaborating coding agent)
`pi` is preconfigured — never set `--model`/`--thinking`/`--provider`/`--api-key`. Flags: `--tools read,grep,find,ls` (read-only), `--session-id <id>` (continuity), `--wt` (worktree).
- Put any non-trivial prompt in a file: `pi -p @/abs/prompt.txt`. Inline `pi -p "…"` with symbols (`{} <> [] '' "" => ~ $`) hangs (shell mangles it); only bare prose is safe inline.
- Output buffers until exit, so an empty output file ≠ stalled. For long runs use plain text + a `timeout` cap.
