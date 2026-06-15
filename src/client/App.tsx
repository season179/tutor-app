import { useRef } from "react";

import { BrandLockup } from "./components/BrandLockup.js";
import { EventLogPanel } from "./components/EventLogPanel.js";
import { ProblemContextPanel } from "./components/ProblemContextPanel.js";
import { SessionListPanel } from "./components/SessionListPanel.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { VoiceSessionPanel } from "./components/VoiceSessionPanel.js";
import { useEventLog } from "./hooks/use-event-log.js";
import { useProblemImage } from "./hooks/use-problem-image.js";
import { useTutorSessions } from "./hooks/use-tutor-sessions.js";
import { useVoiceSession } from "./hooks/use-voice-session.js";
import type { LoadedSessionContext, StatusTone } from "./types.js";
import { hasPriorActivity } from "./types.js";

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const isVoiceRunningRef = useRef(false);
  const onEventLoggedRef = useRef<(() => void) | undefined>(undefined);
  const loadSessionContextRef = useRef<(context: LoadedSessionContext) => void>(() => undefined);
  const resetProblemImageRef = useRef<() => void>(() => undefined);
  const setStatusRef = useRef<(message: string, tone?: StatusTone) => void>(() => undefined);
  const stopVoiceSessionRef = useRef<() => void>(() => undefined);

  const { clearEventLog, loadEventLog, logEvent, logText } = useEventLog(activeSessionIdRef, onEventLoggedRef);

  const tutorSessions = useTutorSessions({
    clearEventLog,
    getIsVoiceRunning: () => isVoiceRunningRef.current,
    loadEventLog,
    loadSessionContext: (context) => loadSessionContextRef.current(context),
    logEvent,
    resetProblemImage: () => resetProblemImageRef.current(),
    setStatus: (message, tone) => setStatusRef.current(message, tone),
    stopVoiceSession: () => stopVoiceSessionRef.current()
  });

  activeSessionIdRef.current = tutorSessions.activeSessionId;

  const {
    ensureSessionReadyForImage,
    getPayloadLimitBytes,
    getSession,
    isRunning,
    setStatus,
    startSession,
    status,
    stopSession
  } = useVoiceSession({
    audioRef,
    logEvent,
    sessionId: tutorSessions.activeSessionId
  });

  isVoiceRunningRef.current = isRunning;
  setStatusRef.current = setStatus;
  stopVoiceSessionRef.current = stopSession;

  const problemImage = useProblemImage({
    activeSessionId: tutorSessions.activeSessionId,
    ensureSessionReadyForImage,
    getPayloadLimitBytes,
    getSession,
    logEvent,
    setStatus
  });

  loadSessionContextRef.current = problemImage.loadSessionContext;
  resetProblemImageRef.current = problemImage.resetProblemImage;
  onEventLoggedRef.current = tutorSessions.notifyEventLogged;

  const handleStart = () => {
    const greet = !hasPriorActivity(tutorSessions.activeSession, tutorSessions.eventCount);
    startSession({ greet })
      .then(() => tutorSessions.refreshSessions())
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Unexpected error.", "error");
      });
  };

  const sessionReady =
    Boolean(tutorSessions.activeSessionId) &&
    !tutorSessions.isSwitching &&
    !tutorSessions.isHydrating;

  return (
    <main className="workspace">
      <header className="topbar">
        <BrandLockup />
        <StatusBadge message={status.message} tone={status.tone} />
      </header>

      <div className="app-body">
        <SessionListPanel
          activeSessionId={tutorSessions.activeSessionId}
          error={tutorSessions.listError}
          isDisabled={tutorSessions.isSwitching || isRunning}
          isLoading={tutorSessions.isLoading}
          onCreate={() => {
            void tutorSessions.createNewSession();
          }}
          onRetry={() => {
            void tutorSessions.refreshSessions();
          }}
          onSelect={(sessionId) => {
            void tutorSessions.selectSession(sessionId);
          }}
          sessions={tutorSessions.sessions}
        />

        <div className="main-grid">
          <VoiceSessionPanel
            audioRef={audioRef}
            hasPriorActivity={hasPriorActivity(tutorSessions.activeSession, tutorSessions.eventCount)}
            isRunning={isRunning}
            onStart={handleStart}
            onStop={stopSession}
            sessionReady={sessionReady}
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
            sendDisabled={problemImage.sendDisabled || !sessionReady}
          />

          <EventLogPanel logText={logText} />
        </div>
      </div>
    </main>
  );
}
