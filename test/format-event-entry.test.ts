import assert from "node:assert/strict";

import { formatEventEntry } from "../src/client/lib/format-event-entry.ts";

const createdAt = "2026-01-02T03:04:05.000Z";

function expectedTime(): string {
  return new Date(createdAt).toLocaleTimeString();
}

test("formatEventEntry renders JSON payloads", () => {
  assert.equal(
    formatEventEntry(createdAt, "Voice session connected", { provider: "openai-voice-pipeline" }),
    `[${expectedTime()}] Voice session connected ${JSON.stringify({ provider: "openai-voice-pipeline" }, null, 2)}`
  );
});

test("formatEventEntry preserves live null payload rendering", () => {
  assert.equal(formatEventEntry(createdAt, "Null payload", null), `[${expectedTime()}] Null payload null`);
});

test("formatEventEntry can omit null payloads for hydrated events", () => {
  assert.equal(
    formatEventEntry(createdAt, "Session created", null, { omitNullValue: true }),
    `[${expectedTime()}] Session created`
  );
});
