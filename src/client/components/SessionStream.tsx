import type { ReactNode } from "react";

import { classNames } from "../lib/class-names.js";
import type { ComprehensionGateStatus } from "../../tutor-action.js";
import type { TranscriptTurn } from "../lib/transcript.js";

type SessionStreamProps = {
  gateStatus: ComprehensionGateStatus | null;
  problemPin: ReactNode;
  turns: TranscriptTurn[];
  unknownTarget: string | null;
};

/**
 * The Stream: the problem pin (the folded-in problem context), the north-star
 * target chip, and the growing transcript. The target chip is intentionally
 * empty and inert until the comprehension gate (M3) decides what we're finding.
 */
export function SessionStream({ gateStatus, problemPin, turns, unknownTarget }: SessionStreamProps) {
  const framed = gateStatus === "complete" && Boolean(unknownTarget?.trim());

  return (
    <div className="cc-stream">
      {problemPin}

      <div className="target-row">
        <span
          className={classNames("target-chip", framed ? "target-chip--framed" : "target-chip--empty")}
        >
          {framed ? <TargetStar /> : null}
          <span className="tlabel">{framed ? "Find:" : "We need to find"}</span>
          {framed ? ` ${unknownTarget}` : " ___"}
        </span>
      </div>

      {turns.length > 0 ? (
        <div className="transcript" aria-label="Conversation">
          {turns.map((turn) => (
            <div className={classNames("turn", `turn--${turn.role}`)} key={turn.id}>
              {turn.role === "coach" ? <EchoMark /> : null}
              <div className="bubble">
                {turn.verdict ? <VerdictChip verdict={turn.verdict} /> : null}
                {turn.text}
                {turn.role === "child" ? (
                  <span aria-hidden="true" className="mic">
                    {" "}
                    🎙
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EchoMark() {
  return (
    <span aria-hidden="true" className="echo-mark">
      <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M4 12h2l2-6 4 14 3-9 2 4h3" />
      </svg>
    </span>
  );
}

function TargetStar() {
  return (
    <svg
      aria-hidden="true"
      className="star"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />
    </svg>
  );
}

function VerdictChip({ verdict }: { verdict: NonNullable<TranscriptTurn["verdict"]> }) {
  return (
    <span className={classNames("vchip", `vchip--${verdict.chip}`)}>
      {verdict.chip === "ok" ? <CheckIcon /> : verdict.chip === "retry" ? <RetryIcon /> : <span>◐</span>}
      {verdict.label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
    </svg>
  );
}
