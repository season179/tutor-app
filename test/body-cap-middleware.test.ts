import assert from "node:assert/strict";

import { HttpError } from "../src/core/http-error.ts";
import {
  assertWithinRequestBodyBytes,
  maxJsonRequestBodyBytes
} from "../src/core/body-cap-middleware.ts";

test("maxJsonRequestBodyBytes matches the old /api/* handler's 16 KB cap", () => {
  assert.equal(maxJsonRequestBodyBytes, 16_384);
});

test("assertWithinRequestBodyBytes accepts a payload under the cap", () => {
  assert.doesNotThrow(() => assertWithinRequestBodyBytes({ title: "Algebra help" }));
});

test("assertWithinRequestBodyBytes accepts a payload exactly at the cap", () => {
  // `{"s":"…"}` — build a string whose serialized length hits the cap exactly.
  const overhead = '{"s":""}'.length;
  const filler = "x".repeat(maxJsonRequestBodyBytes - overhead);
  assert.doesNotThrow(() => assertWithinRequestBodyBytes({ s: filler }));
});

test("assertWithinRequestBodyBytes rejects an oversized payload with 413", () => {
  const oversized = { s: "x".repeat(maxJsonRequestBodyBytes) };
  assert.throws(
    () => assertWithinRequestBodyBytes(oversized),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.message, "Request body was too large");
      return true;
    }
  );
});

test("assertWithinRequestBodyBytes treats null/undefined as the empty-payload case", () => {
  assert.doesNotThrow(() => assertWithinRequestBodyBytes(null));
  assert.doesNotThrow(() => assertWithinRequestBodyBytes(undefined));
});

test("assertWithinRequestBodyBytes measures UTF-8 bytes, not UTF-16 code units", () => {
  // "中" is one UTF-16 code unit but three UTF-8 bytes. This payload's `.length` stays
  // under the cap while its real wire size is well over — a code-unit cap would wrongly
  // accept it; the byte cap (matching the old readLimitedTextBody guard) must reject it.
  const payload = { s: "中".repeat(6000) };
  assert.ok(JSON.stringify(payload).length < maxJsonRequestBodyBytes);
  assert.throws(() => assertWithinRequestBodyBytes(payload), HttpError);
});
