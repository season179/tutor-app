# TanStack + DDD migration plan

Goal (from the user): **adopt TanStack as much as possible** and land a **domain-driven
folder structure** with a `modules/` wrapper. This is an architectural migration of the
existing worker-native + esbuild SPA onto **TanStack Start on Cloudflare Workers**, not a
file reorg. This doc is the plan; nothing here is executed yet.

> Currency note: verified against current (June 2026) sources — Start deploys to Workers via
> `@cloudflare/vite-plugin`; docs describe a WinterCG fetch-handler contract for the Workers
> target rather than Nitro (Nitro is used for the Node target). **Do not bake "no Nitro" into
> `src/server.ts`** — re-derive the actual server contract from the plugin's *generated* entry
> during the Phase 0 spike. Local bindings come via `getPlatformProxy`; request-scope bindings
> via `import { env } from "cloudflare:workers"`. DO classes are exported from a custom server
> entry (needs `nodejs_compat` + the existing `durable_objects` binding; the export wiring is
> manual, not automatic). Re-verify exact API names at implementation time; TanStack moves fast.

---

## 1. Where we are today (baseline)

**Backend** — `src/worker.ts` (CF Worker `fetch`) → `src/api-handler.ts` (hand-rolled router)
→ domain handlers. better-auth built **per request** from the D1 `DB` binding. A Durable
Object `SessionRuntimeDO` orchestrates voice turns + hint alarms. R2 holds problem images.
A rate-limit binding guards voice endpoints.

**Frontend** — React 19 **SPA**, bundled by **esbuild** (`src/client/main.tsx` →
`public/client.js`), served through Workers Static Assets (`ASSETS`). **No routing**
(single screen), **no SSR**. Data fetching is hand-rolled hooks + `fetch` clients
(`use-tutor-sessions.ts` alone is 377 lines of async-state bookkeeping).

**Build/test** — esbuild + four `tsconfig.*` files; `wrangler dev` behind Portless; tests via
`node --test` + `--experimental-strip-types`, importing inconsistently from `dist/` and `src/`,
propped up by a `server.ts` re-export barrel.

## 2. Where we're going (target)

- **TanStack Start (React)** on CF Workers via `@cloudflare/vite-plugin`. **Vite replaces
  esbuild** and powers SSR.
- **Custom worker entry** that wraps Start's fetch handler, **exports `SessionRuntimeDO`**,
  and handles WebSocket upgrades + the voice rate-limit pre-check. `wrangler.main` → this entry.
- **TanStack Router** (file-based `src/routes/`) — SSR + room for real routes (sign-in,
  per-session views) even though today is one screen.
- **TanStack Query** for client data, with Start's SSR dehydration/hydration.
- **`createServerFn` server functions** replace most `/api/*` endpoints (type-safe RPC).
  Bindings via `cloudflare:workers`. R2 presign, DO RPC, and OpenAI calls all run server-side.
- **better-auth** stays per-request-from-D1, exposed via a Start catch-all server route
  `/api/auth/$`.
- **DDD `modules/`** structure consumed by both routes (UI) and server functions.

## 3. Target structure (DDD `modules/`, reconciled with Start conventions)

Start owns a few well-known paths (`vite.config.ts`, `src/router.tsx`, `src/routes/`, a server
entry, `src/styles`). Domain logic lives under `src/modules/`. Each module splits **only when it
has both sides**: shared domain (types + pure logic, safe for client and server) at the module
root, server-only code under `server/`, client-only code under `ui/`. This split keeps server
code out of the client bundle.

```
src/
  server.ts                  # custom CF entry: export SessionRuntimeDO, wrap Start, WS + ratelimit
  router.tsx                 # router + Query client wiring
  routes/                    # THIN Start routes — call modules + server fns
    __root.tsx
    index.tsx                # the tutoring screen
    api/auth.$.ts            # better-auth catch-all server route
  core/                      # shared kernel: http-error, request-context, bindings/env access, json helpers
  modules/
    auth/
      auth.ts realtime-token.ts          # infrastructure (better-auth instance, realtime token)
      ui/                                 # use-auth, sign-in components, auth-client
    sessions/
      session-types.ts session-schema.ts live-session-projection.ts   # domain
      server/  session-store.ts d1-session-store.ts memory-session-store.ts  # ports + adapters
               session-fns.ts                                          # createServerFn: list/create/get/update/appendEvent
      runtime/ session-runtime-do.ts hint-alarm.ts hint-timer.ts       # the Durable Object
      ui/      use-tutor-sessions.ts (slimmed by Query)
    tutoring/
      tutor-action.ts tutor-action-validator.ts tutor-policy.ts phase-policy.ts
      gate-checker.ts active-step.ts step-verifier.ts answer-checker.ts
      verifier.ts verifier-agent.ts schema-parser.ts                   # the lesson engine (mostly pure)
      ui/      phase-rail.ts (+ rail UI)
    voice/
      voice-types.ts voice-session-schema.ts                           # domain
      server/  voice-session-service.ts voice-pipeline-service.ts voice-session-handler.ts
               voice-fns.ts                                            # createServerFn: createSession, processTurn→DO RPC
      ui/      voice-client-adapter.ts use-voice-session.ts
    problems/                # was problem-context/
      problem-context-types.ts problem-context-schema.ts problem-frame.ts  # domain
      server/  question-extraction-service.ts problem-context-handler.ts problem-image-store.ts
               problem-fns.ts                                          # createServerFn: uploadUrl/extract/previewUrl
      ui/      use-problem-context-step1.ts problem-context-extraction.ts image-preparation.ts
  providers/openai/          # openai-responses (the only external-API adapter)
  components/                # cross-cutting UI: BrandLockup, Panel, StatusBadge, Sidebar, ...
  lib/                       # cross-cutting client utils: class-names, format-*, error-message
  styles/
```

Rules:
- No per-folder `index.ts` barrels; `core/` holds framework primitives only (not a type
  junk-drawer); `providers/` is the only place that talks to external APIs.
- **Isolation is one-directional**: client code (`ui/`) may import a module's shared domain
  root but **never** its server-side code (`server/` *or* `runtime/`). The server-side sides
  may freely interdepend — `runtime/` (the DO) *does* import `server/session-store.ts` to
  persist, and that's correct. The split exists to keep server code out of the **client
  bundle**, not to wall the DO off from its repository.
- `runtime/` (the Durable Object) is a **third, server-side side** of the `sessions` module —
  a peer of `server/`, not a child of it.

## 4. Phased plan (each phase shippable; bail-out points called out)

### Phase 0 — De-risking spike (throwaway branch, timeboxed)
Prove the riskiest integrations in a minimal Start-on-CF app **before** committing:
1. better-auth per-request from D1 + Google sign-in round-trip, using the known-good template
   (`chao800404/better-auth-d1-cloudflare-tanstack-start`). Note these are **two distinct root
   causes**, fixed separately: (a) the `#5323` "Worker hung" request-handling interaction, and
   (b) better-auth's `createRequire` bundling error (#6665). Don't conflate them.
2. `SessionRuntimeDO` exported from a custom server entry; a `createServerFn` calls it via RPC.
3. **SSR-live-while-DO-active + rate-limit ordering** — the most underexplored case: an SSR'd
   (possibly streaming) route holds the request open while a server fn fires a voice turn that
   does `env.SESSION_RUNTIME.get(id)` RPC. Today the `VOICE_RATE_LIMIT` pre-check runs in the
   raw Worker `fetch` *before* delegation; under Start that ordering is wrapped. Reproduce a
   turn during a live SSR response and confirm rate-limit precedence + DO RPC semantics match
   today's behavior.
4. R2 presigned URL from a server fn; `nodejs_compat`; `import { env } from "cloudflare:workers"`.
5. SSR of one authenticated route; confirm `build+preview` for the CF target (CF `dev` has a
   known React-duplication quirk).

**Gate:** if better-auth can't be tamed on Start+Workers, STOP the Start migration and fall
back to "TanStack-in-the-SPA" (Query + optionally Router, keep worker-native backend). Phase 1
is still delivered either way.

#### Phase 0 results — ✅ GO (spike run 2026-06-20)

Ran a throwaway spike (`degit TanStack/router/examples/react/start-basic-cloudflare`, custom
`src/server.ts`) against current versions and **all five risks cleared**. Verified stack:
better-auth **1.6.19**, @tanstack/react-start **1.168.26**, @cloudflare/vite-plugin **1.42.0**,
wrangler **4.102**, vite **8.0.16**, TypeScript **6.0.3**, aws4fetch **1.0.20**. Tested via
`vite build` → `vite preview` (miniflare/workerd), the real CF target.

| # | Spike case | Result |
|---|---|---|
| 1 | better-auth per-request from D1; signup/signin/session | **PASS** — all 200, **no hang**. `#5323` did **not** reproduce; `#6665` `createRequire` bundling error did **not** occur. Both appear fixed upstream on current versions. |
| 2 | DO exported from custom `src/server.ts`; `createServerFn` RPC during SSR | **PASS** — `env.COUNTER.getByName(...)` RPC resolves inside the SSR loader. Custom entry re-exports the DO class and wraps `startServer.fetch`. |
| 3 | SSR-live + DO RPC + rate-limit **ordering** (pi's #1 risk) | **PASS** — rate-limit pre-check in the raw `fetch` short-circuits **before** Start (3 allowed → 429 with `Retry-After`). Deferred DO RPC streamed to the live SSR response at ~612ms via `Await`/`Suspense`. Ordering matches today's worker-native behavior. |
| 4 | R2 from a server fn (`nodejs_compat`, `cloudflare:workers` env) | **PASS** — aws4fetch `AwsClient.sign(signQuery:true)` produces a signed URL server-side (`X-Amz-Signature` present); R2 binding `put`/`get` round-trips in local miniflare. |
| 5 | `build + preview` for the CF target | **PASS** — clean Vite build; SSR HTML served by `vite preview`. (CF `dev` React-dup quirk sidestepped by testing preview.) |

**The hard gate (better-auth) is green** → full Start migration is safe to pursue.

**Caveats carried into the real migration (not blockers):**
- Tested **email/password**, not **Google OAuth** — the OAuth redirect round-trip still needs
  validation against real credentials early in Phase 2.
- pnpm **11.7** hard-errors on ignored build scripts (esbuild/sharp/workerd) during its
  pre-run deps check; the spike bypassed it by calling binaries directly
  (`node_modules/.bin/{vite,wrangler}`). Real repo needs `onlyBuiltDependencies` in
  `pnpm-workspace.yaml` + an `.npmrc` `verify-deps-before-run=false` decision.
- The esbuild→Vite **dev workflow** (`pnpm dev` behind Portless / `.dev` TLD) was **not**
  exercised — only `build`/`preview`. Validate the live-reload dev loop early in Phase 2.
- React SSR injects `<!-- -->` markers between static text and dynamic values — greps on
  rendered HTML must account for it (cosmetic, testing-only).

### Phase 1 — DDD reorg of the *existing* app (no TanStack yet) — ✅ DONE (commit `616f0ff`, 2026-06-20)
Executed via a deterministic move+import-rewrite script (39 `git mv` renames, relative `.js`
specifiers recomputed, `tsconfig.server`/`worker` paths + `dist/`-and-`src/` test imports
remapped). Landed `core/` (incl. `schema-parser`, deviating from the draft below — it's a generic
zod parser used by every module, so `core/` beats `tutoring/` and avoids 10 cross-module edges),
`providers/openai/`, and `modules/{auth,tutoring,sessions,voice,problems}` (flat at module root —
the `server`/`ui`/`runtime` sub-split stays deferred to P3–P4 as planned). `worker.ts`/`server.ts`/
`api-handler.ts` stayed at `src/` root; the stranded `voice-client-adapter` moved into `client/lib`.
Incidental fix: added `voice-session-handler` to the server tsconfig include (its test was passing
only off stale `dist/` output). Verified green: 171/171 tests on a clean build, all three tsc
projects, client bundle, `wrangler types --check`, and `wrangler deploy --dry-run`. Original spec
below.


Move today's worker-native code into `modules/<context>/`, but **only as far as the boundary is
stable today**. Concretely: relocate the **leaf/pure modules** (the `tutoring/` engine, all
`*-types`/`*-schema` domain files, `problems/` domain) and group each module's files at the
module root. **Defer the internal `server/` ÷ `ui/` ÷ `runtime/` sub-split** for modules whose
server boundary is redrawn later — that boundary only crystallizes when `createServerFn` lands
in Phase 4, and splitting now means moving `voice-session-service.ts` et al. *twice*. (Per pi's
review: do the coarse grouping now, the fine sub-split per-module during Phases 3–4.) Pure
structural change, behavior identical, tests stay green. `git mv` to preserve history; rewrite
`.js` import specifiers; update the hard-coded paths in `tsconfig.*` and `wrangler.main` as
files move. **Independently valuable** — the "great folder structure" win, banked regardless of
how far the TanStack adoption goes.

### Phase 2 — Vite + Start scaffolding (build swap) — ✅ DONE (commit `b7d1e10`, 2026-06-20)
Vite (`@cloudflare/vite-plugin` → `tanstackStart()` → `viteReact()`) replaced esbuild as the
bundler + SSR engine. Added `src/router.tsx` and `src/routes/{__root,index}.tsx`; the root
document shell replaced `public/index.html`, styles moved to `src/styles/app.css` (Vite-imported).
The custom CF entry is **`src/worker.ts`** (not a new `server.ts` — avoids clashing with the test
barrel and keeps `wrangler.main`): it still owns auth + voice rate-limit + the ownership-gated
`/api/*` handler, exports `SessionRuntimeDO`, and delegates everything else to
`startServer.fetch(request)` (Start reads CF bindings via `cloudflare:workers`, so only the
Request is passed — the spike's 3-arg call doesn't typecheck under strict mode). The manual
`assets` block is gone (the vite plugin wires assets). **Decision: the tutoring screen renders
client-only (`ssr:false`)** — it's browser-stateful (audio, voice, localStorage, refs) — so Start
SSRs only the shell. Bumped wrangler to 4.102 for the plugin peer range. Verified on miniflare:
`GET /` returns the SSR shell + client bundle, `GET /api/*` stays worker-handled (401 JSON),
171/171 tests, all typechecks, `wrangler deploy --dry-run` with the DO binding intact.

> **MIGRATION STATUS (2026-06-20):** Paused after Phase 2 by decision — the branch
> `feat/tanstack-ddd-migration` (DDD + Vite/Start foundation) is the review deliverable. Phases
> 3–5 are deferred to a **follow-up branch** once the foundation is run & approved, because they
> rewrite the *client* (Query hook ports, `/api/*`→server-fn cutover) and this app has **no
> client/UI tests** — typecheck/build/backend-tests stay green but cannot prove the interactive
> voice/tutoring UX. Validate that live before resuming.

### Phase 2 — original spec
Add `vite.config.ts` (`cloudflare({viteEnvironment:{name:'ssr'}})` + `tanstackStart()` +
`viteReact()`), `src/router.tsx`, `src/routes/__root.tsx` + `index.tsx`, and the custom
`src/server.ts` entry. Point `wrangler.main` at it; export `SessionRuntimeDO` there. Render the
existing single screen through Start SSR. Keep the legacy `/api/*` routes working (proxied
through the entry) so the client keeps functioning unchanged. **Swap esbuild → Vite**; update
`pnpm dev` (and the Portless wiring) to Vite. Bail-out: routes can be `ssr:false` (SPA-mode
Start) if SSR fights auth.

### Phase 3 — TanStack Query in the client
Introduce a `QueryClient` + Start SSR dehydration. Port hand-rolled hooks to Query, starting
with the 377-line `use-tutor-sessions.ts` (its `initGenerationRef` stale-request guard becomes
Query's built-in cancellation/dedup). Then live-session, problem-context, auth.

### Phase 4 — Server functions replace `/api/*`
Convert endpoints to `createServerFn`, **module by module** (sessions → problems → voice),
deleting the matching hand-rolled `fetch` client and `api-handler` branch as each lands. Voice
turn becomes a server fn that calls the DO via RPC. better-auth remains the `/api/auth/$`
catch-all route. After the last domain, delete `api-handler.ts`.

### Phase 5 — Test + build cleanup
Move tests to **Vitest** (Vite-native, runs TS directly) — this dissolves the `dist/`-vs-`src/`
inconsistency, the `server.ts` barrel, and `tsconfig.server.json`'s emit role in one move.
Consolidate tsconfigs around Vite/Start. Remove esbuild, `public/client.js` artifacts, dead CORS
file (`r2-cors.json` vs `config/r2-problem-images-cors.json` — keep one, re-apply to bucket).

### Phase 6 — Optional further TanStack (only where it earns its place)
TanStack **Form** for the problem composer; **Store**/**Pacer** for voice-turn debounce/local
state. Skip **Table** (no tabular data). Each evaluated on merit, not adopted reflexively.

## 5. Honest risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **SSR-live + DO RPC + rate-limit ordering** under Start's wrapped handler (pi's #1) | ~~High~~ **cleared P0** | Spike case #3 passed — pre-check short-circuits before Start; deferred DO RPC streamed |
| better-auth `#5323` "Worker hung" interaction | ~~High~~ **cleared P0** | Did not reproduce on current versions; no hang. (OAuth round-trip still TBD) |
| better-auth `createRequire` bundling error (#6665) — *separate* cause | ~~Med~~ **cleared P0** | Did not occur on current versions |
| esbuild→Vite dev-workflow churn (Portless, CF `dev` React dup) | Med | Spike covered `build`/`preview` only; **validate `pnpm dev` + Portless early in Phase 2** |
| Google OAuth redirect round-trip (spike tested email/password only) | Med | Validate against real Google creds early in Phase 2 |
| pnpm 11.7 ignored-builds hard-error on `build`/run | Low | `onlyBuiltDependencies` in `pnpm-workspace.yaml`; decide `verify-deps-before-run` |
| SSR adds complexity for one authed screen | Med | `ssr:false` per-route fallback = SPA-mode Start |
| Module boundary churn (moving server files twice) | Med | P1 coarse grouping only; fine split during P4 (see Phase 1) |
| DO export under Start's `main` | Low (solved) | custom entry re-exports DO class; needs `nodejs_compat` + binding wiring |
| Bundle size / Worker cold start with Start runtime | Low–Med | measure in spike; acceptable for this app size |
| Scope: weeks, not days | — | Phase 1 banks value early; phases independently shippable |

## 6. Recommendation
Do **Phase 0 then Phase 1 first**. Phase 0 tells us whether full Start is safe given the
better-auth dependency; Phase 1 delivers the domain-driven structure no matter what. Only commit
to Phases 2–4 once the spike is green. This honors "use TanStack as much as possible" while
refusing to bet the app on an unproven auth integration sight-unseen.
