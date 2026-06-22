import { HttpError } from "../../../core/http-error.js";

/**
 * The settings admin gate. Lives in its own module (free of `cloudflare:workers` /
 * `@tanstack/react-start` imports) so the gate logic can be unit-tested in the plain Node
 * vitest pool — it's the real protection layer (the frontend gate is defense-in-depth).
 *
 * Fails closed: anything other than the exact string `"admin"` throws, so a missing/blank/
 * typo role (e.g. `"user"`, undefined, `"Admin"`) is rejected. The role comes from the
 * better-auth admin plugin's `session.user.role` (default `"user"`).
 */
export function requireAdmin(role: string): void {
  if (role !== "admin") {
    throw new HttpError(403, "Admin access required to manage settings.");
  }
}
