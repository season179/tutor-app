import type { RefObject } from "react";

import type { SessionPhase } from "../../tutor-action.js";
import { VoiceBar } from "./VoiceBar.js";

type CenterAnchorProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  currentPhase: SessionPhase;
  focusAsk: string | null;
  hasPriorActivity: boolean;
  isRecording: boolean;
  isRunning: boolean;
  onFinishAudioTurn: () => void;
  onHint: () => void;
  onPark: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
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
  focusAsk,
  hasPriorActivity,
  isRecording,
  isRunning,
  onFinishAudioTurn,
  onHint,
  onPark,
  onStart,
  onStartAudioTurn,
  onStop,
  scaffoldAid,
  sessionReady
}: CenterAnchorProps) {
  const inStepLoop = currentPhase === "step_loop";

  return (
    <div className="cc-anchor">
      <div className="focus-card">
        <div className="focus-kicker">{inStepLoop && focusAsk ? "One step" : "Your turn"}</div>
        <div className="ask">{resolveAsk(focusAsk, isRunning, isRecording)}</div>
        {scaffoldAid && inStepLoop ? (
          <div className="aid">
            <AidDots />
            {scaffoldAid}
          </div>
        ) : null}
      </div>

      <VoiceBar
        audioRef={audioRef}
        canRecordAudioTurn={canRecordAudioTurn}
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

function resolveAsk(focusAsk: string | null, isRunning: boolean, isRecording: boolean): string {
  if (focusAsk?.trim()) {
    return focusAsk;
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
