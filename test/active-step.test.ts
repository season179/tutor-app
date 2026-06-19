import assert from "node:assert/strict";
import test from "node:test";

import { deriveFirstCheckableStep } from "../dist/active-step.js";
import type { ProblemFrame } from "../src/problem-context/problem-frame.ts";

const sharingFrame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "24 stickers are shared equally among 4 friends.",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [{ label: "stickers", raw: "24" }],
  relationships: ["shared equally among 4 friends"],
  taskLanguage: "en",
  unknownTarget: "how many stickers each friend gets",
  visibleQuestion: "How many stickers does each friend get?"
};

test("deriveFirstCheckableStep seeds a one-sticker-each step for sharing problems", () => {
  const step = deriveFirstCheckableStep(sharingFrame);

  assert.ok(step);
  assert.equal(step.expectedAnswers[0], 4);
  assert.match(step.ask, /1 sticker/i);
  assert.match(step.scaffoldAid, /4 friends/);
  assert.ok(step.distractorNudges["24"]?.includes("all the stickers"));
});

test("deriveFirstCheckableStep reads friend count from a friends quantity row", () => {
  const step = deriveFirstCheckableStep({
    ...sharingFrame,
    relationships: ["shared equally"],
    quantities: [
      { label: "stickers", raw: "24" },
      { label: "friends", raw: "4" }
    ]
  });

  assert.equal(step?.expectedAnswers[0], 4);
});

test("deriveFirstCheckableStep returns null without a friend count", () => {
  const step = deriveFirstCheckableStep({
    ...sharingFrame,
    relationships: ["shared equally"],
    quantities: [{ label: "stickers", raw: "24" }]
  });

  assert.equal(step, null);
});
