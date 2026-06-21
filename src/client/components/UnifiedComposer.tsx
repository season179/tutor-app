import { useState, type RefObject } from "react";

type UnifiedComposerProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  extractingQuestion: boolean;
  isRecording: boolean;
  isRunning: boolean;
  onFinishAudioTurn: () => void;
  onHint?: (() => void) | undefined;
  onPark?: (() => void) | undefined;
  onSendText: (text: string) => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  sessionReady: boolean;
};

/**
 * The one place every turn happens: type a message or tap the mic, both sending a
 * normal turn to Coach Echo. There is no photo-only path — the confirmed problem
 * is reconstructed server-side each turn, so the image is just context. While a
 * session is live the run controls (Hint / Park / End) sit above the field; the
 * audio sink for Echo's replies lives here too.
 */
export function UnifiedComposer({
  audioRef,
  canRecordAudioTurn,
  extractingQuestion,
  isRecording,
  isRunning,
  onFinishAudioTurn,
  onHint,
  onPark,
  onSendText,
  onStart,
  onStartAudioTurn,
  onStop,
  sessionReady
}: UnifiedComposerProps) {
  const [text, setText] = useState("");

  // Talking before the question is read starts a session with no problem context,
  // so the composer stays inert until extraction settles (and a session exists).
  const blocked = !sessionReady || (extractingQuestion && !isRunning);
  const canSend = !blocked && text.trim().length > 0;
  // The mic starts a session (before one is live) or begins a manual audio turn
  // once the turn-based pipeline session is connected.
  const micDisabled = blocked || (isRunning && !canRecordAudioTurn);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || blocked) {
      return;
    }

    onSendText(trimmed);
    setText("");
  };

  const handleMic = () => {
    if (!isRunning) {
      onStart();
      return;
    }

    if (canRecordAudioTurn && !isRecording) {
      onStartAudioTurn();
    }
  };

  return (
    <div className="cc-composer">
      {isRunning ? (
        <div aria-label="Lesson controls" className="run-controls" role="group">
          {onHint ? (
            <button className="mini-btn mini-btn--hint" onClick={onHint} type="button">
              <HintIcon />
              Hint
            </button>
          ) : null}
          {onPark ? (
            <button className="mini-btn" onClick={onPark} type="button">
              <ParkIcon />
              Park
            </button>
          ) : null}
          <div className="run-spacer" />
          <button className="mini-btn" onClick={onStop} type="button">
            <StopIcon />
            End
          </button>
        </div>
      ) : null}

      {isRecording ? (
        <div aria-label="Recording your answer" className="composer composer--rec" role="group">
          <span className="listening">
            <Wave />
            Listening…
          </span>
          <button
            aria-label="Stop and send"
            className="round-btn round-btn--rec"
            onClick={onFinishAudioTurn}
            type="button"
          >
            <StopRecIcon />
          </button>
        </div>
      ) : (
        <div aria-label="Message Coach Echo" className="composer" role="group">
          <input
            aria-label="Message Coach Echo"
            className="composer-input"
            disabled={blocked}
            placeholder="Message Coach Echo…"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            aria-label={isRunning ? "Talk instead of typing" : "Start talking with Coach Echo"}
            className="round-btn"
            disabled={micDisabled}
            onClick={handleMic}
            type="button"
          >
            <MicIcon />
          </button>
          <button
            aria-label="Send message"
            className="round-btn round-btn--send"
            disabled={!canSend}
            onClick={submit}
            type="button"
          >
            <SendIcon />
          </button>
        </div>
      )}

      <audio autoPlay id="remote-audio" ref={audioRef} />
    </div>
  );
}

function MicIcon() {
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
      <rect height="11" rx="3" width="6" x="9" y="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function SendIcon() {
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
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function StopIcon() {
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
      <rect height="12" rx="2" width="12" x="6" y="6" />
    </svg>
  );
}

function StopRecIcon() {
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
      <rect height="10" rx="2" width="10" x="7" y="7" />
    </svg>
  );
}

function HintIcon() {
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

function ParkIcon() {
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
      <rect height="14" rx="1" width="4" x="6" y="5" />
      <rect height="14" rx="1" width="4" x="14" y="5" />
    </svg>
  );
}

function Wave() {
  return (
    <span aria-hidden="true" className="wave">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
