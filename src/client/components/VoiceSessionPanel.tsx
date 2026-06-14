import type { RefObject } from "react";

import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type VoiceSessionPanelProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
};

export function VoiceSessionPanel({ audioRef, isRunning, onStart, onStop }: VoiceSessionPanelProps) {
  return (
    <Panel
      className="session-panel"
      description="Speak naturally, keep the lesson moving."
      id="session-title"
      title="Voice session"
    >
      <div className="controls">
        <ActionButton disabled={isRunning} icon="play" onClick={onStart} variant="primary">
          Start tutoring
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
