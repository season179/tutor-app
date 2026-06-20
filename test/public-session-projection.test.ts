import assert from "node:assert/strict";
import test from "node:test";

import {
  toPublicActiveStep,
  toPublicSessionDetail
} from "../dist/modules/sessions/session-types.js";

const fullActiveStep = {
  ask: "How many stickers does each friend get?",
  defaultWrongNudge: "Not quite — how many does each friend get after sharing equally?",
  distractorNudges: { "24": "That's the total — we need how many each friend gets." },
  expectedAnswers: [6],
  scaffoldAid: "24 ÷ 4"
};

const sessionRecord = {
  activeStep: fullActiveStep,
  createdAt: "2026-06-19T00:00:00.000Z",
  currentPhase: "step_loop",
  extractionNotes: null,
  extractionOutcome: "extracted",
  gateStatus: "complete",
  id: "session-1",
  imageMeta: null,
  imageName: null,
  imageObjectKey: null,
  imagePrompt: "Share 24 stickers among 4 friends.",
  ownerKey: "owner-1",
  promptConfirmed: true,
  status: "active",
  supportLevel: 0,
  title: "Sharing stickers",
  updatedAt: "2026-06-19T00:00:00.000Z"
};

const detail = {
  events: [],
  problemContext: null,
  reflection: null,
  session: sessionRecord
};

test("toPublicActiveStep exposes only ask and scaffoldAid", () => {
  const publicStep = toPublicActiveStep(fullActiveStep);
  assert.deepEqual(publicStep, { ask: fullActiveStep.ask, scaffoldAid: fullActiveStep.scaffoldAid });
  assert.equal(toPublicActiveStep(null), null);
});

test("toPublicSessionDetail never serializes the answer key", () => {
  const publicDetail = toPublicSessionDetail(detail);
  const serialized = JSON.stringify(publicDetail);

  assert.ok(!serialized.includes("expectedAnswers"), "expectedAnswers must not cross the wire");
  assert.ok(!serialized.includes("distractorNudges"), "distractorNudges must not cross the wire");
  assert.ok(!serialized.includes("defaultWrongNudge"), "defaultWrongNudge must not cross the wire");
  assert.ok(!serialized.includes("[6]") && !/"expectedAnswers"/.test(serialized));

  // The child still gets what they legitimately see.
  assert.equal(publicDetail.session.activeStep?.ask, fullActiveStep.ask);
  assert.equal(publicDetail.session.activeStep?.scaffoldAid, fullActiveStep.scaffoldAid);
});

test("toPublicSessionDetail does not mutate the server-side record", () => {
  toPublicSessionDetail(detail);
  assert.deepEqual(sessionRecord.activeStep.expectedAnswers, [6], "server record keeps its answer key");
});
