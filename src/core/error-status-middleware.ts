import { createMiddleware } from "@tanstack/react-start";
import { setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

// The voice rate-limit window, in seconds. Mirrors the static `Retry-After: "60"` the
// old Worker entry set on its 429 (the CF RateLimit binding doesn't expose a
// retry-after, so the window length is the faithful value).
const rateLimitRetryAfterSeconds = "60";

// Server-function middleware that maps a thrown {@link HttpError}'s status onto the
// HTTP response. Without it, TanStack Start's server-fn error path emits the real
// status only inside the serialized error body (seroval preserves `.status`, which
// the client recovers) but sets the wire HTTP status to 500
// (`status: response.status ?? 500` in @tanstack/start-server-core). That 500 masks
// 401/404/413/429 from raw-HTTP-status consumers (logs, proxies, monitoring).
//
// Catching in the middleware and calling `setResponseStatus(error.status)` writes to
// the same per-request response object the framework's own error path then reads, so
// the emitted HTTP status matches the semantic error. A 429 also restores the
// `Retry-After` header the old Worker entry set.
//
// Registered per-fn (via the shared `serverFnMiddleware`/`writeServerFnMiddleware`
// arrays in core/server-fn-middleware.ts) on every server fn rather than globally:
// global request/function middleware is currently buggy in
// TanStack Start (#5107 setResponseStatus no-ops on throw, #5239 global middleware
// fires multiple times, #5407 status/headers set in global middleware don't
// propagate). Per-fn function middleware is the well-trodden path and avoids all
// three. Confirm the status/headers actually reach the wire during the live
// pre-merge validation.
export const errorStatusMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
      ) {
        const status = (error as { status: number }).status;
        // Duck-typed: seroval rehydrates thrown errors as plain Error objects with
        // their own enumerable props intact, so `.status` survives even though the
        // reconstructed value is not an HttpError instance. The message (if present)
        // goes through as the status text.
        const message = error instanceof Error ? error.message : undefined;
        setResponseStatus(status, message);
        if (status === 429) {
          setResponseHeader("Retry-After", rateLimitRetryAfterSeconds);
        }
      }
      throw error;
    }
  }
);
