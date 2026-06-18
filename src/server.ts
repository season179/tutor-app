// The local development entrypoint is now `wrangler dev` (see package.json
// `dev` script), which provides a real D1 binding that better-auth requires.
//
// This module is retained only so `tsconfig.server.json` (which lists it as its
// sole entry) emits the shared server-side modules that tests import from
// `dist/` — e.g. `MemorySessionStore` and `handleVoicePipelineTurnWithStore`.
// It is not the dev server. To run the app locally use `pnpm dev`.

export { transferSessionsOnLink } from "./auth.js";
export { MemorySessionStore } from "./memory-session-store.js";
export { defaultRealtimeModel, defaultRealtimeVoice } from "./realtime-token.js";
export { defaultVoiceBackend } from "./voice-session-service.js";
export {
  defaultTranscribeModel,
  defaultTtsModel,
  defaultTtsVoice,
  defaultTutorModel
} from "./voice-pipeline-service.js";
export { maxJsonRequestBodyBytes } from "./session-handler.js";
export { maxVoiceTurnBodyBytes, voiceTurnPath } from "./voice-types.js";
export type { JsonValue } from "./http-error.js";
export { HttpError } from "./http-error.js";
