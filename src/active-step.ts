import type { ProblemFrame } from "./problem-context/problem-frame.js";

/** The one checkable step the verifier grades (M4). */
export type ActiveStep = {
  ask: string;
  defaultWrongNudge: string;
  /** Common wrong numeric answers → a specific, kind redirect (never the final answer). */
  distractorNudges: Record<string, string>;
  expectedAnswers: number[];
  scaffoldAid: string;
};

const friendCountPatterns: readonly RegExp[] = [
  /\b(?:among|between|with|for)\s+(\d+)\s+(?:friends?|kawan|people|groups?|children|kids|students)\b/i,
  /\b(\d+)\s+(?:friends?|kawan|people|groups?|children|kids|students)\b/i,
  /\b(?:shared|sharing|divided)\s+(?:equally\s+)?(?:among|between)\s+(\d+)\b/i
];

const totalQuantityPatterns: readonly RegExp[] = [
  /\bstickers?\b/i,
  /\bpelekat\b/i,
  /\btotal\b/i,
  /\bcookies?\b/i,
  /\bsweets?\b/i
];

function parseNumber(raw: string): number | null {
  const match = raw.trim().match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

const friendLabelPattern = /friends?|kawan|people|groups?|children|kids|students/i;

function parseFriendCount(frame: ProblemFrame): number | null {
  for (const relationship of frame.relationships) {
    for (const pattern of friendCountPatterns) {
      const match = relationship.match(pattern);
      if (match?.[1]) {
        const count = Number(match[1]);
        if (Number.isInteger(count) && count > 0) {
          return count;
        }
      }
    }
  }

  for (const quantity of frame.quantities) {
    if (friendLabelPattern.test(quantity.label)) {
      const fromRaw = parseNumber(quantity.raw);
      if (fromRaw !== null && Number.isInteger(fromRaw) && fromRaw > 0) {
        return fromRaw;
      }
    }

    const haystack = `${quantity.label} ${quantity.raw}`;
    for (const pattern of friendCountPatterns) {
      const match = haystack.match(pattern);
      if (match?.[1]) {
        const count = Number(match[1]);
        if (Number.isInteger(count) && count > 0) {
          return count;
        }
      }
    }
  }

  return null;
}

function parseTotalQuantity(frame: ProblemFrame): number | null {
  for (const quantity of frame.quantities) {
    const label = quantity.label.toLowerCase();
    if (totalQuantityPatterns.some((pattern) => pattern.test(label) || pattern.test(quantity.raw))) {
      const value = parseNumber(quantity.raw);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Derives the canonical first checkable step for equal-sharing word problems.
 * Returns null when the frame does not expose a friend/group count to verify.
 */
export function deriveFirstCheckableStep(frame: ProblemFrame): ActiveStep | null {
  const friendCount = parseFriendCount(frame);
  if (!friendCount) {
    return null;
  }

  const total = parseTotalQuantity(frame);
  const distractorNudges: Record<string, string> = {};

  if (total !== null) {
    distractorNudges[String(total)] =
      "That's all the stickers — right now we're only giving out 1 each. How many friends get one?";
  }

  return {
    ask: "Give each friend 1 sticker first. How many stickers is that?",
    defaultWrongNudge: "Not quite — think about how many friends are sharing.",
    distractorNudges,
    expectedAnswers: [friendCount],
    scaffoldAid: `${friendCount} friends · 1 sticker each`
  };
}

export function parseActiveStep(value: unknown): ActiveStep | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const ask = typeof record.ask === "string" ? record.ask.trim() : "";
  const scaffoldAid = typeof record.scaffoldAid === "string" ? record.scaffoldAid.trim() : "";
  const defaultWrongNudge =
    typeof record.defaultWrongNudge === "string" ? record.defaultWrongNudge.trim() : "";

  if (!ask || !scaffoldAid || !defaultWrongNudge) {
    return null;
  }

  const expectedAnswers = Array.isArray(record.expectedAnswers)
    ? record.expectedAnswers
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry))
    : [];

  if (expectedAnswers.length === 0) {
    return null;
  }

  const distractorNudges: Record<string, string> = {};
  if (record.distractorNudges && typeof record.distractorNudges === "object") {
    for (const [key, nudge] of Object.entries(record.distractorNudges as Record<string, unknown>)) {
      if (typeof nudge === "string" && nudge.trim()) {
        distractorNudges[key] = nudge.trim();
      }
    }
  }

  return {
    ask,
    defaultWrongNudge,
    distractorNudges,
    expectedAnswers,
    scaffoldAid
  };
}

export function serializeActiveStep(step: ActiveStep | null): string | null {
  return step ? JSON.stringify(step) : null;
}
