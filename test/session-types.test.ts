import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTutorSessionUpdate,
  type TutorSessionRecord
} from "../src/modules/sessions/session-types.ts";

const baseSession: TutorSessionRecord = {
  activeStep: null,
  createdAt: "2026-06-17T01:02:03.000Z",
  currentPhase: "session_open",
  extractionNotes: null,
  extractionOutcome: null,
  gateStatus: null,
  id: "session-1",
  imageMeta: { bytes: 120_000, height: 900, width: 1200 },
  imageName: "worksheet.jpg",
  imageObjectKey: "session-1/image.jpg",
  imagePrompt: "Walk me through this problem.",
  ownerKey: "access:user-a",
  promptConfirmed: true,
  status: "draft",
  supportLevel: 0,
  title: "Algebra help",
  updatedAt: "2026-06-17T01:02:03.000Z"
};

test("applyTutorSessionUpdate trims provided title and preserves omitted fields", () => {
  const updated = applyTutorSessionUpdate(
    baseSession,
    {
      status: "active",
      title: "  Geometry help  "
    },
    "2026-06-17T02:03:04.000Z"
  );

  assert.deepEqual(updated, {
    ...baseSession,
    status: "active",
    title: "Geometry help",
    updatedAt: "2026-06-17T02:03:04.000Z"
  });
});

test("applyTutorSessionUpdate applies explicit null image fields", () => {
  const updated = applyTutorSessionUpdate(
    baseSession,
    {
      imageMeta: null,
      imageName: null,
      imagePrompt: null
    },
    "2026-06-17T02:03:04.000Z"
  );

  assert.equal(updated.imageMeta, null);
  assert.equal(updated.imageName, null);
  assert.equal(updated.imagePrompt, null);
});
