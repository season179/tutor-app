# Coach Echo

Small TypeScript voice homework coach for turn-controlled tutoring. A student shares a homework screenshot, hears one small prompt from the tutor, records an answer, and gets the next short spoken hint only after that answer.

## Requirements

- Node.js 24
- pnpm 11
- An OpenAI API key
- Google OAuth credentials (for sign-in)

This repo pins `pnpm@11.6.0` in `package.json` and includes `.node-version` / `.nvmrc` with Node 24. Local dev runs behind [Portless](https://portless.sh), which gives the app a stable `https://ai-tutor.dev` URL.

## Setup

```bash
corepack enable
corepack prepare pnpm@11.6.0 --activate
pnpm install
cp .dev.vars.example .dev.vars
```

Set `OPENAI_API_KEY` and the better-auth / Google OAuth values in `.dev.vars` (see [Authentication](#authentication)). Then do the one-time Portless setup:

```bash
pnpm portless proxy start --tld dev   # set + persist the .dev TLD
pnpm portless trust                    # trust the local CA (for HTTPS)
```

## Authentication

Sign-in uses [better-auth](https://www.better-auth.com) with Google OAuth. Sessions are cookie-based; the cookie attaches automatically to same-origin requests.

Create a Google OAuth client at <https://console.cloud.google.com/apis/credentials> and set these in `.dev.vars` (local) and as Worker secrets (production):

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `BETTER_AUTH_URL` — public base URL of the deployment

Authorized redirect URI: `https://<your-domain>/api/auth/callback/google` — use `https://ai-tutor.dev/api/auth/callback/google` for local dev, and your production domain for deploy.

For production, set the secrets with:

```bash
pnpm wrangler secret put OPENAI_API_KEY
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put GOOGLE_CLIENT_ID
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
```

## Run

```bash
pnpm dev
```

This runs `vite dev` with the Cloudflare plugin (so D1 and the other bindings work locally) behind Portless, so better-auth has a real store in dev. Open `https://ai-tutor.dev`, sign in with Google, choose a problem image, wait for it to be prepared, and click **Ask about image**. The tutor will speak one short next step. Use **Record answer** after each prompt, then **Stop and send** to let the tutor check that answer before moving on.

Apply the database schema locally with:

```bash
pnpm db:migrate
```

## How it works

- The server keeps provider secrets private and creates a normalized voice session descriptor at `POST /api/voice/session`.
- The `openai-voice-pipeline` backend accepts one turn at a time at `POST /api/voice/turn`.
- Student audio is transcribed with `gpt-4o-transcribe`, the lesson controller uses `gpt-5.5` with strict structured output, and the spoken reply is generated with `gpt-4o-mini-tts` using the `marin` voice by default.
- The lesson controller is constrained to one small question, hint, or confirmation per turn and returns only the structured tutor action that should be spoken aloud.
- The browser uses a provider-neutral `VoiceClientAdapter`; the pipeline adapter records one answer clip at a time and plays the returned tutor audio.
- Image files are decoded in the browser, resized to a 2048px maximum side, flattened onto a white background, encoded as bounded JPEG data URLs, and sent through a provider-neutral user-turn shape.

## Cloudflare Workers

The production deployment uses a Worker-native entrypoint in `src/worker.ts`; `@cloudflare/vite-plugin` emits the client bundle and configures asset serving at build time. The Worker handles better-auth routes at `/api/auth/*`, plus `POST /api/voice/session` and `POST /api/voice/turn`, reads secrets from Cloudflare, rate-limits voice API requests, and delegates everything outside `/api/*` to TanStack Start (SSR + the client bundle). A new better-auth instance is constructed per request from the `DB` (D1) binding.

For deployment:

```bash
pnpm wrangler secret put OPENAI_API_KEY
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put GOOGLE_CLIENT_ID
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
pnpm db:migrate:remote
pnpm deploy:dry-run
pnpm deploy
```

`wrangler.jsonc` stores only non-secret defaults like model and voice. If this Worker shares a Cloudflare account with other Workers using rate limiting bindings, keep the `VOICE_RATE_LIMITER.namespace_id` unique within the account.

## Scripts

```bash
pnpm dev            # vite dev (local D1 via the CF plugin) behind Portless → https://ai-tutor.dev
pnpm dev:vite       # vite dev directly on http://localhost:3000 (no Portless)
pnpm db:migrate     # apply D1 migrations locally
pnpm db:migrate:remote
pnpm check:worker-types
pnpm typecheck
pnpm build
pnpm deploy:dry-run
pnpm deploy
```
