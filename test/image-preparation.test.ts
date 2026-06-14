import assert from "node:assert/strict";
import test from "node:test";

import { getImageByteLimit, imageJsonOverheadBytes } from "../src/client/lib/image-byte-limit.ts";

test("getImageByteLimit returns the default when no realtime limit is known", () => {
  assert.equal(getImageByteLimit(undefined), 1_500_000);
});

test("getImageByteLimit scales down for small WebRTC payload limits", () => {
  const limit = 200_000;
  const expected = Math.max(80_000, Math.min(1_500_000, Math.floor((limit - imageJsonOverheadBytes) * 0.72)));

  assert.equal(getImageByteLimit(limit), expected);
});

test("getImageByteLimit falls back to the default for unusable limits", () => {
  assert.equal(getImageByteLimit(1_000), 1_500_000);
});
