Use deepwiki for package/library docs.
Use agent-browser to test it.
No flaky tests; every test must protect something real.

## Two-worker architecture (Worker A `ai-tutor` + Worker B `ai-tutor-reasoning`)
The four reasoning calls (gate-check, verifier, tutor-turn, extract-question) run on a Flue
worker (`reasoning-worker/`), called over the `REASONING` service binding. The full
rationale + the payload contract (Flue has no per-call `instructions` override, so the
dynamic prompt travels as the workflow `input`) is in `docs/adr/0001-flue-reasoning-worker.md`.
The binding is the SOLE reasoning transport — the legacy direct-OpenAI reasoning path was
removed in Phase 4 (only STT/TTS still call OpenAI directly in Worker A; Flue is LLM-only).

- **Worker A** (`wrangler.jsonc`, `src/`, pnpm): the front door. Owns all domain logic —
  scrubbing, the re-ask loop, the deterministic verifier track, phase logic, `commitTurn`,
  STT, TTS. Calls the binding via `src/providers/reasoning/reasoning-binding.ts`.
- **Worker B** (`reasoning-worker/`, npm): Flue-generated, sources in `reasoning-worker/.flue/`.
  A pure model executor — holds no stage prompt; the model is `process.env.REASONING_MODEL`
  (a `provider/model` string, so swapping providers is a one-var + secret change).

### Two-worker local dev
Worker A's `pnpm dev` does NOT auto-resolve `env.REASONING` to Worker B — a DO call
(`SessionRuntimeDO.processTurn`, where per-turn reasoning runs) to an unbound service fails
opaquely. Run both workers: every reasoning stage needs Worker B up.

```bash
# Terminal 1 — Worker B (Flue dev server):
cd reasoning-worker && npm install && npx flue dev --target cloudflare
# Terminal 2 — Worker A (the app):
pnpm dev
# Point REASONING at the local Worker B per wrangler's multi-worker dev guidance.
```

### Dual deploy
Build + deploy each worker separately. Worker B builds with Flue and deploys from its
generated `dist/` config; Worker A uses the root `pnpm deploy`.

```bash
# Worker B:
cd reasoning-worker && npm run deploy          # flue build --target cloudflare && wrangler deploy --config dist/ai_tutor_reasoning/wrangler.json
# Worker A (from repo root):
pnpm deploy
```

Secret rotation now touches BOTH workers: `OPENAI_API_KEY` lives in A (STT/TTS) and B
(reasoning). Set Worker B's provider keys with `cd reasoning-worker && npx wrangler secret
put OPENAI_API_KEY` (and `OPENROUTER_API_KEY` etc. if swapping providers in B).

### Tests
The voice-pipeline test harness (`test/helpers/fake-voice-providers.ts`) is transport-aware:
`routeVoiceProviderCall` routes the OpenAI-fetch transport (STT/TTS), `routeReasoningWorkflowCall`
routes the REASONING-binding transport (gate/verifier/tutor), and both write to the SAME slot
counters — so a Tier-1 test body asserts the same domain behavior regardless of transport. The
harness always exposes a `reasoning` Fetcher; voice fixtures read it lazily off the installed
fake (`voiceServiceEnv.REASONING`), so the binding is wired by default.

## pi (collaborating coding agent)
`pi` is preconfigured — never set `--model`/`--thinking`/`--provider`/`--api-key`. Flags: `--tools read,grep,find,ls` (read-only), `--session-id <id>` (continuity), `--wt` (worktree).
- Put any non-trivial prompt in a file: `pi -p @/abs/prompt.txt`. Inline `pi -p "…"` with symbols (`{} <> [] '' "" => ~ $`) hangs (shell mangles it); only bare prose is safe inline.
- Output buffers until exit, so an empty output file ≠ stalled. For long runs use plain text + a `timeout` cap.
