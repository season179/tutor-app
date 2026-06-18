import { useMemo, useRef } from "react";

import { BrandLockup } from "./components/BrandLockup.js";
import { EventLogPanel } from "./components/EventLogPanel.js";
import { ProblemContextPanel } from "./components/ProblemContextPanel.js";
import { SignInScreen } from "./components/SignInScreen.js";
import { Sidebar } from "./components/Sidebar.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { VoiceSessionPanel } from "./components/VoiceSessionPanel.js";
import { useAuth } from "./hooks/use-auth.js";
import { useEventLog } from "./hooks/use-event-log.js";
import { useProblemImage } from "./hooks/use-problem-image.js";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed.js";
import { useTutorSessions } from "./hooks/use-tutor-sessions.js";
import { useVoiceSession } from "./hooks/use-voice-session.js";
import { errorMessage } from "./lib/error-message.js";
import type { LoadedSessionContext, StatusTone } from "./types.js";
import { hasPriorActivity } from "./types.js";

export function App() {
  const { authError, isAnonymous, isAuthLoading, signInWithGoogle, signOut, userEmail, userId } =
    useAuth();

  const audioRef = useRef<HTMLAudioElement>(null);
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const isVoiceRunningRef = useRef(false);
  const onEventLoggedRef = useRef<(() => void) | undefined>(undefined);
  const loadSessionContextRef = useRef<(context: LoadedSessionContext) => void>(() => undefined);
  const resetProblemImageRef = useRef<() => void>(() => undefined);
  const setStatusRef = useRef<(message: string, tone?: StatusTone) => void>(() => undefined);
  const stopVoiceSessionRef = useRef<() => void>(() => undefined);

  const { clearEventLog, loadEventLog, logEvent, logText } = useEventLog(activeSessionIdRef, onEventLoggedRef);

  const { collapsed: sidebarCollapsed, toggleCollapsed: toggleSidebarCollapsed } = useSidebarCollapsed();

  const tutorSessions = useTutorSessions({
    clearEventLog,
    getIsVoiceRunning: () => isVoiceRunningRef.current,
    loadEventLog,
    loadSessionContext: (context) => loadSessionContextRef.current(context),
    logEvent,
    resetProblemImage: () => resetProblemImageRef.current(),
    setStatus: (message, tone) => setStatusRef.current(message, tone),
    stopVoiceSession: () => stopVoiceSessionRef.current(),
    userId
  });

  activeSessionIdRef.current = tutorSessions.activeSessionId;

  const visibleSessions = useMemo(() => {
    if (!isAnonymous) {
      return tutorSessions.sessions;
    }

    if (!tutorSessions.activeSessionId) {
      return [];
    }

    return tutorSessions.sessions.filter((session) => session.id === tutorSessions.activeSessionId);
  }, [isAnonymous, tutorSessions.activeSessionId, tutorSessions.sessions]);

  const {
    ensureSessionReadyForImage,
    canRecordAudioTurn,
    finishAudioTurn,
    getPayloadLimitBytes,
    getSession,
    isRecording,
    isRunning,
    setStatus,
    startAudioTurn,
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

  const activeSessionHasPriorActivity = hasPriorActivity(
    tutorSessions.activeSession,
    tutorSessions.eventCount
  );

  const handleStart = () => {
    const greet = !activeSessionHasPriorActivity;
    startSession({ greet })
      .then(() => tutorSessions.refreshSessions())
      .catch((error: unknown) => {
        setStatus(errorMessage(error, "Unexpected error."), "error");
      });
  };

  const sessionReady =
    Boolean(tutorSessions.activeSessionId) &&
    !tutorSessions.isSwitching &&
    !tutorSessions.isHydrating;

  if (isAuthLoading) {
    return <main className="workspace" aria-busy="true" />;
  }

  if (authError) {
    return (
      <SignInScreen
        message="Could not start a guest session. Sign in with Google to continue."
        onSignIn={signInWithGoogle}
      />
    );
  }

  if (!userId) {
    return <main className="workspace" aria-busy="true" />;
  }

  return (
    <main className="workspace">
      <Sidebar
        activeSessionId={tutorSessions.activeSessionId}
        collapsed={sidebarCollapsed}
        error={tutorSessions.listError}
        isAnonymous={isAnonymous}
        isDisabled={tutorSessions.isSwitching || isRunning}
        isLoading={tutorSessions.isLoading || tutorSessions.isHydrating}
        onCreate={() => {
          void tutorSessions.createNewSession();
        }}
        onRetry={() => {
          void tutorSessions.refreshSessions();
        }}
        onSelect={(sessionId) => {
          void tutorSessions.selectSession(sessionId);
        }}
        onSignIn={signInWithGoogle}
        onSignOut={signOut}
        onToggleCollapsed={toggleSidebarCollapsed}
        sessions={visibleSessions}
        {...(userEmail ? { userEmail } : {})}
      />

      <div className="workspace-main">
        <header className="topbar">
          <BrandLockup />
          <StatusBadge message={status.message} tone={status.tone} />
        </header>

        <div className="main-grid">
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

          <div className="side-stack">
            <VoiceSessionPanel
              audioRef={audioRef}
              canRecordAudioTurn={canRecordAudioTurn}
              hasPriorActivity={activeSessionHasPriorActivity}
              isRecording={isRecording}
              isRunning={isRunning}
              onFinishAudioTurn={() => {
                void finishAudioTurn();
              }}
              onStart={handleStart}
              onStartAudioTurn={startAudioTurn}
              onStop={stopSession}
              sessionReady={sessionReady}
            />

            <EventLogPanel logText={logText} />
          </div>
        </div>
      </div>
    </main>
  );
}
