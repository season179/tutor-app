import { createMiddleware } from "@tanstack/react-start";

import { HttpError } from "./http-error.js";

// Shared 16 KB cap on server-function write payloads, restoring the
// `maxJsonRequestBodyBytes` guard the old /api/* handler enforced via
// `readLimitedTextBody` before Phase 4 moved everything onto server functions.
//
// TanStack Start owns body parsing, so this runs after the payload is parsed as
// `data` rather than as it streams off the wire. We measure the UTF-8 byte length of
// `JSON.stringify(data)` (the /_serverFn/* body IS that JSON) so the cap matches the
// old byte-based `readLimitedTextBody` guard — counting `.length` (UTF-16 code units)
// would under-count multi-byte content (CJK, emoji) and let a payload several times
// the limit through. It still rejects an oversized write before it reaches the
// store/pipeline. Per-fn overrides that need a different ceiling (the voice turn's
// 8 MB cap) stay in their own fns and run alongside this; this middleware is the
// baseline for every other write.
export const maxJsonRequestBodyBytes = 16_384;

/**
 * Reject `data` whose serialized size exceeds {@link maxJsonRequestBodyBytes}.
 * Split out from the middleware so the cap (and its 413) is unit-testable without
 * the TanStack RPC machinery.
 */
export function assertWithinRequestBodyBytes(data: unknown): void {
  const size = new TextEncoder().encode(JSON.stringify(data ?? null)).length;
  if (size > maxJsonRequestBodyBytes) {
    throw new HttpError(413, "Request body was too large");
  }
}

/**
 * Server-function middleware that rejects any payload whose serialized size
 * exceeds {@link maxJsonRequestBodyBytes}. Apply it to write fns via `.middleware([...])`.
 */
export const bodySizeCapMiddleware = createMiddleware({ type: "function" }).server(
  async ({ data, next }) => {
    assertWithinRequestBodyBytes(data);
    return next();
  }
);
