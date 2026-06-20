import { bodySizeCapMiddleware } from "./body-cap-middleware.js";
import { errorStatusMiddleware } from "./error-status-middleware.js";

// Shared server-function middleware stacks, single-sourced so the ORDER lives in
// exactly one place. `errorStatusMiddleware` MUST be first (outermost): TanStack runs
// the array front-to-back with the first element as the outermost wrapper, and it
// wraps the downstream `next()` in a try/catch. `bodySizeCapMiddleware` throws its 413
// *before* it calls `next()`, so only an outer `errorStatusMiddleware` can catch that
// 413 and map it onto the wire status — listing the body cap first silently turns every
// oversized write into a 500.

/** Baseline for every server fn: map a thrown HttpError's `.status` onto the wire. */
export const serverFnMiddleware = [errorStatusMiddleware];

/**
 * Write fns additionally carry the shared 16 KB body cap (restoring the guard the old
 * /api/* handler enforced via `readLimitedTextBody` before Phase 4). The voice *turn*
 * fn is the deliberate exception — it allows up to 8 MB and enforces that ceiling inside
 * its own handler — so it uses {@link serverFnMiddleware}, not this.
 */
export const writeServerFnMiddleware = [errorStatusMiddleware, bodySizeCapMiddleware];
