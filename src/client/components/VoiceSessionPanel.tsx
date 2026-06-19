import type { RefObject } from "react";

import { classNames } from "../lib/class-names.js";
import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type VoiceSessionPanelProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  collapsed?: boolean;
  hasPriorActivity: boolean;
  isRunning: boolean;
  isRecording: boolean;
  onFinishAudioTurn: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  sessionReady: boolean;
};

export function VoiceSessionPanel({
  audioRef,
  canRecordAudioTurn,
  collapsed = false,
  hasPriorActivity,
  isRunning,
  isRecording,
  onFinishAudioTurn,
  onStart,
  onStartAudioTurn,
  onStop,
  sessionReady
}: VoiceSessionPanelProps) {
  const startLabel = hasPriorActivity ? "Continue with Echo" : "Start with Echo";
  const recordLabel = isRecording ? "Stop and send" : "Record answer";

  const controls = (
    <div className={classNames("controls", collapsed && "controls--collapsed")}>
      <ActionButton
        aria-label={collapsed ? startLabel : undefined}
        className={collapsed ? "voice-control-compact" : undefined}
        disabled={!sessionReady || isRunning}
        icon="play"
        onClick={onStart}
        title={collapsed ? startLabel : undefined}
        variant="primary"
      >
        {collapsed ? null : startLabel}
      </ActionButton>
      <ActionButton
        aria-label={collapsed ? "End session" : undefined}
        className={collapsed ? "voice-control-compact" : undefined}
        disabled={!isRunning}
        icon="stop"
        onClick={onStop}
        title={collapsed ? "End session" : undefined}
        variant="secondary"
      >
        {collapsed ? null : "End session"}
      </ActionButton>
      {canRecordAudioTurn ? (
        <ActionButton
          aria-label={collapsed ? recordLabel : undefined}
          className={collapsed ? "voice-control-compact" : undefined}
          disabled={!isRunning}
          icon={isRecording ? "send" : "play"}
          onClick={isRecording ? onFinishAudioTurn : onStartAudioTurn}
          title={collapsed ? recordLabel : undefined}
          variant="secondary"
        >
          {collapsed ? null : recordLabel}
        </ActionButton>
      ) : null}
    </div>
  );

  const audio = <audio ref={audioRef} id="remote-audio" autoPlay />;

  if (collapsed) {
    return (
      <div aria-label="Voice session" className="session-panel session-panel--collapsed" role="group">
        {controls}
        {audio}
      </div>
    );
  }

  return (
    <Panel
      className="session-panel"
      description="Speak naturally, keep the lesson moving."
      id="session-title"
      title="Voice session"
    >
      {controls}

      {audio}
    </Panel>
  );
}
