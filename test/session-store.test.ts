import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/memory-session-store.js";

test("MemorySessionStore scopes sessions by owner key", async () => {
  const store = new MemorySessionStore();
  const ownerA = "access:user-a";
  const ownerB = "access:user-b";

  const sessionA = await store.createSession(ownerA, { title: "Owner A" });
  const sessionB = await store.createSession(ownerB, { title: "Owner B" });

  const listA = await store.listSessions(ownerA);
  const listB = await store.listSessions(ownerB);

  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.equal(listA[0]?.id, sessionA.id);
  assert.equal(listB[0]?.id, sessionB.id);

  assert.equal(await store.sessionExists(ownerA, sessionB.id), false);
  assert.equal(await store.getSession(ownerB, sessionA.id), null);
});

test("MemorySessionStore appends events and updates session timestamps", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  await store.appendEvent(ownerKey, session.id, {
    message: "Voice session connected",
    value: { provider: "openai-realtime" }
  });

  const detail = await store.getSession(ownerKey, session.id);
  assert.ok(detail);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0]?.message, "Voice session connected");
  assert.notEqual(detail.session.updatedAt, session.updatedAt);
});

test("MemorySessionStore updates image metadata without storing data URLs", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const updated = await store.updateSession(ownerKey, session.id, {
    imageMeta: { bytes: 120_000, height: 900, width: 1200 },
    imageName: "worksheet.jpg",
    imagePrompt: "Walk me through this problem."
  });

  assert.ok(updated);
  assert.deepEqual(updated?.imageMeta, { bytes: 120_000, height: 900, width: 1200 });
  assert.equal(updated?.imageName, "worksheet.jpg");
  assert.equal(updated?.imagePrompt, "Walk me through this problem.");
});
