# GPT Realtime Voice Test

Basic TypeScript project for trying `gpt-realtime-2` through the OpenAI Realtime API.

## Requirements

- Node.js 24
- pnpm 11
- An OpenAI API key with Realtime API access

This repo pins `pnpm@11.6.0` in `package.json` and includes `.node-version` / `.nvmrc` with Node 24. It uses Portless so you do not need to pick or remember a port.

## Setup

```bash
corepack enable
corepack prepare pnpm@11.6.0 --activate
pnpm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

## Run

```bash
pnpm dev
```

Portless prints a stable local URL, normally `https://realtime-voice.localhost`. Open that URL, click **Start voice session**, allow microphone access, and talk. You can also choose an image, wait for it to be prepared, and click **Send image**; if the voice session is not connected yet, the app starts it first.

## How it works

- The server keeps `OPENAI_API_KEY` private and creates a short-lived Realtime client secret at `/token`.
- The browser uses that client secret to establish a WebRTC connection to `https://api.openai.com/v1/realtime/calls`.
- The session is configured for `gpt-realtime-2` with the `marin` voice by default.
- Image files are decoded in the browser, resized to a 2048px maximum side, flattened onto a white background, encoded as bounded JPEG data URLs, and sent as `input_image` content parts.
- Portless maps the app to a named `.localhost` URL and manages local routing behind the scenes.

## Scripts

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm start
```
