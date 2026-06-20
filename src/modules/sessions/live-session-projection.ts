import { outputLanguageLabel } from "../tutoring/answer-checker.js";
import type { ProblemContextRecord } from "../problems/problem-frame.js";
import { hintTimerEventMessage } from "./hint-timer.js";
import { studentTurnEventMessage } from "./session-types.js";
import type { ComprehensionGateStatus, SessionPhase } from "../tutoring/tutor-action.js";
import type { GoalChipStatus } from "../voice/voice-types.js";

const answerCheckEventMessage = "Answer check";

type SessionEventSlice = {
  message: string;
  value: unknown;
};

export function pendingHintFromEvents(events: SessionEventSlice[]): string | null {
  const hintIndex = events.findIndex((event) => event.message === hintTimerEventMessage);
  if (hintIndex === -1) {
    return null;
  }

  const studentSpokeAfterHint = events
    .slice(0, hintIndex)
    .some((event) => event.message === studentTurnEventMessage);
  if (studentSpokeAfterHint) {
    return null;
  }

  const hintEvent = events[hintIndex]!;
  if (!hintEvent.value || typeof hintEvent.value !== "object" || !("text" in hintEvent.value)) {
    return null;
  }

  const { text } = hintEvent.value as { text?: unknown };
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

export function goalStatusFromDetail(input: {
  events: SessionEventSlice[];
  gateStatus: ComprehensionGateStatus | null;
  phase: SessionPhase;
  reflectionPresent: boolean;
}): GoalChipStatus {
  if (input.gateStatus !== "complete") {
    return "empty";
  }

  if (
    input.reflectionPresent ||
    input.phase === "memory_write" ||
    input.phase === "wrap_up" ||
    latestAnswerCheckCorrect(input.events)
  ) {
    return "complete";
  }

  return "framed";
}

export function outputLanguageLabelFromContext(
  problemContext: ProblemContextRecord | null | undefined
): string | null {
  return problemContext ? outputLanguageLabel(problemContext) : null;
}

function latestAnswerCheckCorrect(events: SessionEventSlice[]): boolean {
  const latest = events.find((event) => event.message === answerCheckEventMessage);
  if (!latest?.value || typeof latest.value !== "object") {
    return false;
  }

  return (latest.value as { studentStatus?: unknown }).studentStatus === "correct";
}
