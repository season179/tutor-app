import type { RefObject } from "react";

import type { ComprehensionGateStatus, SessionPhase } from "../../tutor-action.js";
import { VoiceBar } from "./VoiceBar.js";

type CenterAnchorProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  currentPhase: SessionPhase;
  extractingQuestion: boolean;
  focusAsk: string | null;
  gateStatus: ComprehensionGateStatus | null;
  hasPriorActivity: boolean;
  isRecording: boolean;
  isRunning: boolean;
  onFinishAudioTurn: () => void;
  onHint: () => void;
  onPark: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  outputLanguageLabel: string | null;
  pendingHint: string | null;
  scaffoldAid: string | null;
  sessionReady: boolean;
};

/**
 * The Anchor: the one fixed instrument panel at the bottom of the center column.
 * A single focus card (the current call to action) sits above the voice bar.
 */
export function CenterAnchor({
  audioRef,
  canRecordAudioTurn,
  currentPhase,
  extractingQuestion,
  focusAsk,
  gateStatus,
  hasPriorActivity,
  isRecording,
  isRunning,
  onFinishAudioTurn,
  onHint,
  onPark,
  onStart,
  onStartAudioTurn,
  onStop,
  outputLanguageLabel,
  pendingHint,
  scaffoldAid,
  sessionReady
}: CenterAnchorProps) {
  const inStepLoop = currentPhase === "step_loop";
  const inAnswerCheck = currentPhase === "answer_check";
  const inWrap = currentPhase === "wrap_up" || currentPhase === "memory_write";
  // During the gate, the focus card shows which of the Three Reads the child is on.
  const readStep = currentPhase === "frame_task" ? gateReadLabel(gateStatus) : null;
  // Reading the question from a photo blocks the start of a session, so while the
  // vision model is working we tell the learner that here instead of the idle prompt.
  const showExtraction = extractingQuestion && !isRunning;

  return (
    <div className="cc-anchor">
      <div className="focus-card" data-state={showExtraction ? "extracting" : undefined}>
        <div className="focus-kicker">
          {showExtraction
            ? "Reading the photo"
            : readStep
              ? readStep.kicker
              : kickerLabel(currentPhase, Boolean(focusAsk))}
          {outputLanguageLabel && inAnswerCheck ? (
            <span className="lang-chip">{outputLanguageLabel}</span>
          ) : null}
        </div>
        <div className="ask">
          {showExtraction ? (
            <>
              <Spinner />
              Reading the question from your photo…
            </>
          ) : readStep ? (
            readStep.prompt
          ) : (
            resolveAsk(focusAsk, inWrap, isRunning, isRecording)
          )}
        </div>
        {pendingHint && inStepLoop ? (
          <div className="aid aid--hint">
            <HintBulb />
            {pendingHint}
          </div>
        ) : null}
        {scaffoldAid && inStepLoop && !pendingHint ? (
          <div className="aid">
            <AidDots />
            {scaffoldAid}
          </div>
        ) : null}
      </div>

      <VoiceBar
        audioRef={audioRef}
        canRecordAudioTurn={canRecordAudioTurn}
        extractingQuestion={extractingQuestion}
        hasPriorActivity={hasPriorActivity}
        isRecording={isRecording}
        isRunning={isRunning}
        onFinishAudioTurn={onFinishAudioTurn}
        onHint={inStepLoop ? onHint : undefined}
        onPark={inStepLoop ? onPark : undefined}
        onStart={onStart}
        onStartAudioTurn={onStartAudioTurn}
        onStop={onStop}
        sessionReady={sessionReady}
      />
    </div>
  );
}

function Spinner() {
  return (
    <span aria-hidden="true" className="focus-spinner" role="presentation">
      <svg
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <path d="M21 12a9 9 0 1 1-6.2-8.6" />
      </svg>
    </span>
  );
}

/** The Three Reads progress label shown on the focus card during the comprehension gate. */
function gateReadLabel(
  gateStatus: ComprehensionGateStatus | null
): { kicker: string; prompt: string } | null {
  switch (gateStatus) {
    case "needs_context_read":
      return { kicker: "Read 1 of 3", prompt: "Read it through — what's this problem about?" };
    case "needs_quantity_read":
      return { kicker: "Read 2 of 3", prompt: "What are the important numbers, and what do they mean?" };
    case "needs_target_read":
      return { kicker: "Read 3 of 3", prompt: "What is the problem asking you to find?" };
    case "needs_restatement":
      return { kicker: "Final read", prompt: "Say it back in your own words — what are we finding?" };
    default:
      return null;
  }
}

function kickerLabel(phase: SessionPhase, hasFocusAsk: boolean): string {
  if (phase === "wrap_up") {
    return "You did it";
  }

  if (phase === "memory_write") {
    return "Quick reflection";
  }

  if (phase === "answer_check") {
    return "Say the answer";
  }

  if ((phase === "step_loop" || phase === "plan_first_step") && hasFocusAsk) {
    return "One step";
  }

  return "Your turn";
}

function resolveAsk(
  focusAsk: string | null,
  inWrap: boolean,
  isRunning: boolean,
  isRecording: boolean
): string {
  if (focusAsk?.trim()) {
    return focusAsk;
  }

  if (inWrap) {
    return "Take a breath — you worked that all the way through.";
  }

  if (!isRunning) {
    return "Ready to start? Tap to talk and say hi 👋";
  }

  if (isRecording) {
    return "I'm listening — tell me what you're thinking.";
  }

  return "Your turn — tap the mic and talk it out.";
}

function AidDots() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function HintBulb() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 3a6 6 0 0 0-4 10c.8.7 1 1.2 1 2v1h6v-1c0-.8.2-1.3 1-2a6 6 0 0 0-4-10z" />
      <path d="M9 21h6" />
    </svg>
  );
}
