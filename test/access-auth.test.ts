import assert from "node:assert/strict";
import test from "node:test";

import { parseDevIdentity } from "../dist/access-auth.js";

test("parseDevIdentity accepts a valid JSON identity", () => {
  assert.deepEqual(parseDevIdentity('{"sub":"dev-user","email":"dev@example.com"}'), {
    email: "dev@example.com",
    sub: "dev-user"
  });
});

test("parseDevIdentity accepts sub without email", () => {
  assert.deepEqual(parseDevIdentity('{"sub":"dev-user"}'), {
    sub: "dev-user"
  });
});

test("parseDevIdentity rejects missing sub", () => {
  assert.equal(parseDevIdentity('{"email":"dev@example.com"}'), undefined);
  assert.equal(parseDevIdentity(""), undefined);
  assert.equal(parseDevIdentity("not-json"), undefined);
});
