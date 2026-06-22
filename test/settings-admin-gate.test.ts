import assert from "node:assert/strict";

import { requireAdmin } from "../src/modules/settings/server/settings-admin-gate.ts";
import { HttpError } from "../src/core/http-error.ts";

// The settings admin gate is the real protection layer — the frontend hides the page for
// non-admins, but a direct server-fn call from a non-admin still has to fail here. Pin both
// sides: exact "admin" passes, everything else throws 403 (fail closed on missing/typo).

test("requireAdmin passes for the exact admin role", () => {
  assert.doesNotThrow(() => requireAdmin("admin"));
});

test("requireAdmin throws 403 for the default user role", () => {
  assert.throws(
    () => requireAdmin("user"),
    (error: unknown) => error instanceof HttpError && error.status === 403
  );
});

test("requireAdmin throws 403 when the role is missing (fail closed)", () => {
  // The store defaults a missing role to "user", but guard the gate itself against undefined
  // in case it's ever called with a raw, un-defaulted value.
  assert.throws(
    () => requireAdmin(undefined as unknown as string),
    (error: unknown) => error instanceof HttpError && error.status === 403
  );
});

test("requireAdmin is case-sensitive — 'Admin' / 'ADMIN' are rejected", () => {
  // Fail closed on a typo or differently-cased role: only the exact lowercase token grants access.
  for (const almost of ["Admin", "ADMIN", "admin ", " admin"]) {
    assert.throws(
      () => requireAdmin(almost),
      (error: unknown) => error instanceof HttpError && error.status === 403,
      `expected "${almost}" to be rejected`
    );
  }
});

test("requireAdmin rejects arbitrary role strings", () => {
  // A role that isn't 'admin' — even a plausible one like 'editor' or 'superuser' — must not
  // grant settings access. Only the admin plugin's 'admin' token opens this gate.
  for (const role of ["editor", "superuser", "moderator", "owner", "true"]) {
    assert.throws(
      () => requireAdmin(role),
      (error: unknown) => error instanceof HttpError && error.status === 403,
      `expected "${role}" to be rejected`
    );
  }
});
