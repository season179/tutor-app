import { useRef } from "react";

import { BrandLockup } from "./components/BrandLockup.js";
import { EventLogPanel } from "./components/EventLogPanel.js";
import { ProblemContextPanel } from "./components/ProblemContextPanel.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { VoiceSessionPanel } from "./components/VoiceSessionPanel.js";
import { useEventLog } from "./hooks/use-event-log.js";
import { useProblemImage } from "./hooks/use-problem-image.js";
import { useVoiceSession } from "./hooks/use-voice-session.js";

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { logEvent, logText } = useEventLog();

  const {
    ensureSessionReadyForImage,
    getPayloadLimitBytes,
    getSession,
    isRunning,
    setStatus,
    startSession,
    status,
    stopSession
  } = useVoiceSession({ audioRef, logEvent });

  const problemImage = useProblemImage({
    ensureSessionReadyForImage,
    getPayloadLimitBytes,
    getSession,
    logEvent,
    setStatus
  });

  const handleStart = () => {
    startSession().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Unexpected error.", "error");
    });
  };

  return (
    <main className="workspace">
      <header className="topbar">
        <BrandLockup />
        <StatusBadge message={status.message} tone={status.tone} />
      </header>

      <div className="main-grid">
        <VoiceSessionPanel
          audioRef={audioRef}
          isRunning={isRunning}
          onStart={handleStart}
          onStop={stopSession}
        />

        <ProblemContextPanel
          emptyMessage={problemImage.emptyMessage}
          imageMeta={problemImage.imageMeta}
          imagePrompt={problemImage.imagePrompt}
          isPreparingImage={problemImage.isPreparingImage}
          onFileChange={problemImage.handleFileChange}
          onPromptChange={problemImage.handlePromptChange}
          onSubmit={problemImage.sendImage}
          preparedImage={problemImage.preparedImage}
          sendDisabled={problemImage.sendDisabled}
        />

        <EventLogPanel logText={logText} />
      </div>
    </main>
  );
}
