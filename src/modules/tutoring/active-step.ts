import type { ProblemFrame } from "../problems/problem-frame.js";

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

/** Equal-sharing quotient (e.g. 24 stickers ÷ 4 friends → 6). */
export function deriveSharingQuotient(frame: ProblemFrame): number | null {
  const friendCount = parseFriendCount(frame);
  const total = parseTotalQuantity(frame);

  if (!friendCount || !total || total % friendCount !== 0) {
    return null;
  }

  return total / friendCount;
}

/**
 * Derives the framed-goal answer check. Equal-sharing is the high-precision fast path;
 * a tightly-guarded add/subtract path covers the other common single-operation problems.
 * Anything ambiguous returns null so the LLM verifier track grades it instead — the
 * deterministic track only ever fires when it can compute the answer with confidence.
 */
export function deriveFinalAnswerCheck(frame: ProblemFrame): ActiveStep | null {
  return deriveSharingAnswerCheck(frame) ?? deriveArithmeticAnswerCheck(frame);
}

function deriveSharingAnswerCheck(frame: ProblemFrame): ActiveStep | null {
  const quotient = deriveSharingQuotient(frame);
  const friendCount = parseFriendCount(frame);
  const total = parseTotalQuantity(frame);

  if (!quotient || !friendCount || !total) {
    return null;
  }

  const malay = requiresMalayPrompt(frame);
  const distractorNudges: Record<string, string> = {
    [String(total)]: "That's the total — we need how many each friend gets."
  };

  return {
    ask: malay ? "Setiap kawan dapat berapa pelekat?" : "How many stickers does each friend get?",
    defaultWrongNudge: "Not quite — how many does each friend get after sharing equally?",
    distractorNudges,
    expectedAnswers: [quotient],
    scaffoldAid: `${total} ÷ ${friendCount}`
  };
}

const additionCuePattern =
  /\b(?:altogether|in total|in all|combined|total number|sum of|jumlah|semua sekali|kesemua)\b/i;

// "more"/"less" alone are ambiguous (gained-N-more vs N-more-than), so only the
// comparison and remainder framings count as a subtraction cue. Bare "left" carries a
// spatial sense ("on the left", "the left column") that is NOT subtraction, so it only
// counts when it isn't the direction: not preceded by "the" and not naming a side/part.
const subtractionCuePattern =
  /\b(?:left over|remaining|remain|fewer|difference|how (?:many|much) more|how many fewer|baki|tinggal|berapa lagi)\b|(?<!\bthe\s)\bleft\b(?!\s+(?:side|column|hand|page|corner))/i;

// Grouping / multiplicative / sharing language means the answer is a product or quotient,
// not a sum or difference — even when an "altogether"/"in total" cue is also present
// ("5 boxes of 4, how many in total?"). Any of these voids the add/subtract fast path.
const multiplicativeCuePattern =
  /\b(?:each|every|per|times|twice|double|triple|groups? of|rows? of|boxes? of|packs? of|bags? of|multiplied|divided|shared|split|equally|setiap|sekumpulan|didarab|dibahagi)\b|×/i;

/** Every clean integer quantity in the frame, in worksheet order. */
function parseGivenNumbers(frame: ProblemFrame): number[] {
  const numbers: number[] = [];
  for (const quantity of frame.quantities) {
    const value = parseNumber(quantity.raw);
    if (value !== null && Number.isInteger(value)) {
      numbers.push(value);
    }
  }
  return numbers;
}

/**
 * Computes the answer for a simple two-quantity add or subtract problem. Guards keep
 * precision high: exactly two integer givens, exactly one (non-conflicting) operation cue,
 * and a sensible non-negative integer result — otherwise null, deferring to the LLM track.
 */
function deriveArithmeticAnswerCheck(frame: ProblemFrame): ActiveStep | null {
  const givens = parseGivenNumbers(frame);
  if (givens.length !== 2) {
    return null;
  }

  const haystack = [frame.visibleQuestion, frame.extractedText, ...frame.relationships].join(" ");

  // A grouping/multiplicative/sharing cue means the structure isn't a clean add or
  // subtract — defer to the LLM verifier rather than risk a confident wrong grade.
  if (multiplicativeCuePattern.test(haystack)) {
    return null;
  }

  const isAddition = additionCuePattern.test(haystack);
  const isSubtraction = subtractionCuePattern.test(haystack);

  // Need exactly one unambiguous operation cue.
  if (isAddition === isSubtraction) {
    return null;
  }

  const ask = frame.visibleQuestion.trim();
  if (!ask) {
    return null;
  }

  const [a, b] = givens as [number, number];
  const larger = Math.max(a, b);
  const smaller = Math.min(a, b);
  const answer = isAddition ? a + b : larger - smaller;
  const wrongOperation = isAddition ? larger - smaller : a + b;

  if (!Number.isInteger(answer) || answer < 0) {
    return null;
  }

  const malay = requiresMalayPrompt(frame);
  const distractorNudges: Record<string, string> = {};
  if (wrongOperation !== answer) {
    distractorNudges[String(wrongOperation)] = isAddition
      ? "That looks like the difference — but we're putting them together. Try adding."
      : "That looks like the total — but we're taking one away. Try subtracting.";
  }

  return {
    ask,
    defaultWrongNudge: malay
      ? "Belum tepat — semak sama ada perlu tambah atau tolak, kemudian cuba lagi."
      : "Not quite — check whether you need to add or take away, then try again.",
    distractorNudges,
    expectedAnswers: [answer],
    scaffoldAid: isAddition ? `${a} + ${b}` : `${larger} − ${smaller}`
  };
}

function requiresMalayPrompt(frame: ProblemFrame): boolean {
  const language = frame.taskLanguage?.toLowerCase() ?? "en";
  return frame.languageIsSubject || language.startsWith("ms");
}

export function deriveFirstCheckableStep(frame: ProblemFrame): ActiveStep | null {
  const friendCount = parseFriendCount(frame);
  const total = parseTotalQuantity(frame);
  // The "give each friend 1 sticker" first step only models an equal-sharing problem: a
  // group sharing a recognized pool of items. Without both a sharer count and a total to
  // share, this isn't a sharing problem — defer to the LLM verifier rather than grade an
  // unrelated problem (that merely mentions "friends") against the sharer count.
  if (!friendCount || total === null) {
    return null;
  }

  return {
    ask: "Give each friend 1 sticker first. How many stickers is that?",
    defaultWrongNudge: "Not quite — think about how many friends are sharing.",
    distractorNudges: {
      [String(total)]:
        "That's all the stickers — right now we're only giving out 1 each. How many friends get one?"
    },
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
