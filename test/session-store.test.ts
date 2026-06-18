import assert from "node:assert/strict";
import test from "node:test";

import { mapD1SessionRow, MemorySessionStore } from "../dist/memory-session-store.js";

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

test("MemorySessionStore transferOwnerSessions moves sessions and preserves events", async () => {
  const store = new MemorySessionStore();
  const ownerA = "user-a";
  const ownerB = "user-b";
  const otherOwner = "user-c";

  const sessionA1 = await store.createSession(ownerA, { title: "Session A1" });
  const sessionA2 = await store.createSession(ownerA, { title: "Session A2" });
  const sessionC = await store.createSession(otherOwner, { title: "Session C" });

  await store.appendEvent(ownerA, sessionA1.id, { message: "Event A1" });
  await store.appendEvent(ownerA, sessionA2.id, { message: "Event A2" });

  const transferred = await store.transferOwnerSessions(ownerA, ownerB);

  assert.equal(transferred, 2);
  assert.equal((await store.listSessions(ownerA)).length, 0);
  assert.deepEqual(
    (await store.listSessions(ownerB)).map((session) => session.id).sort(),
    [sessionA1.id, sessionA2.id].sort()
  );
  assert.equal((await store.listSessions(otherOwner))[0]?.id, sessionC.id);

  const detail = await store.getSession(ownerB, sessionA1.id);
  assert.ok(detail);
  assert.equal(detail.events[0]?.message, "Event A1");
});

test("mapD1SessionRow normalizes optional image columns", () => {
  const session = mapD1SessionRow({
    created_at: "2026-06-17T01:02:03.000Z",
    id: "session-1",
    image_meta_json: JSON.stringify({ bytes: 120_000, height: 900, width: 1200 }),
    image_name: "",
    image_prompt: "",
    owner_key: "access:user-a",
    status: "draft",
    title: "Algebra help",
    updated_at: "2026-06-17T01:02:03.000Z"
  });

  assert.deepEqual(session.imageMeta, { bytes: 120_000, height: 900, width: 1200 });
  assert.equal(session.imageName, null);
  assert.equal(session.imagePrompt, null);
});
