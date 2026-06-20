// The local development entrypoint is now `wrangler dev` (see package.json
// `dev` script), which provides a real D1 binding that better-auth requires.
//
// This module is retained only so `tsconfig.server.json` (which lists it as its
// sole entry) emits the shared server-side modules that tests import from
// `dist/` — e.g. `MemorySessionStore` and `handleVoicePipelineTurnWithStore`.
// It is not the dev server. To run the app locally use `pnpm dev`.

export { transferSessionsOnLink } from "./modules/auth/auth.js";
export { MemorySessionStore } from "./modules/sessions/memory-session-store.js";
export { defaultRealtimeModel, defaultRealtimeVoice } from "./modules/auth/realtime-token.js";
export { defaultVoiceBackend } from "./modules/voice/voice-session-service.js";
export {
  defaultTranscribeModel,
  defaultTtsModel,
  defaultTtsVoice,
  defaultTutorModel
} from "./modules/voice/voice-pipeline-service.js";
export { maxJsonRequestBodyBytes } from "./modules/sessions/session-handler.js";
export {
  handleExtractQuestionRequest,
  handlePreviewUrlRequest,
  handleUploadUrlRequest
} from "./modules/problems/problem-context-handler.js";
export {
  createProblemImageObjectKey,
  isOwnedProblemImageKey
} from "./modules/problems/problem-image-store.js";
export { extractQuestionFromImageUrl } from "./modules/problems/question-extraction-service.js";
export { maxVoiceTurnBodyBytes, voiceTurnPath } from "./modules/voice/voice-types.js";
export type { JsonValue } from "./core/http-error.js";
export { HttpError } from "./core/http-error.js";
export {
  goalStatusFromDetail,
  outputLanguageLabelFromContext,
  pendingHintFromEvents
} from "./modules/sessions/live-session-projection.js";
