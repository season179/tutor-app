import type { RefObject } from "react";

import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type VoiceSessionPanelProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  hasPriorActivity: boolean;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  sessionReady: boolean;
};

export function VoiceSessionPanel({
  audioRef,
  hasPriorActivity,
  isRunning,
  onStart,
  onStop,
  sessionReady
}: VoiceSessionPanelProps) {
  const startLabel = hasPriorActivity ? "Continue tutoring" : "Start tutoring";

  return (
    <Panel
      className="session-panel"
      description="Speak naturally, keep the lesson moving."
      id="session-title"
      title="Voice session"
    >
      <div className="controls">
        <ActionButton
          disabled={!sessionReady || isRunning}
          icon="play"
          onClick={onStart}
          variant="primary"
        >
          {startLabel}
        </ActionButton>
        <ActionButton disabled={!isRunning} icon="stop" onClick={onStop} variant="secondary">
          End session
        </ActionButton>
      </div>

      <div className="session-note">
        <h3>Session behavior</h3>
        <p>
          The tutor keeps spoken replies concise, asks clarifying questions when needed, and guides the
          student through the reasoning.
        </p>
      </div>

      <audio ref={audioRef} id="remote-audio" autoPlay />
    </Panel>
  );
}
