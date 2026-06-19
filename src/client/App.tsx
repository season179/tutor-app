import { useMemo, useRef } from "react";

import { BrandLockup } from "./components/BrandLockup.js";
import { CenterAnchor } from "./components/CenterAnchor.js";
import { PhaseRail } from "./components/PhaseRail.js";
import { ProblemContextPanel } from "./components/ProblemContextPanel.js";
import { RightSidebar } from "./components/RightSidebar.js";
import { SessionStream } from "./components/SessionStream.js";
import { SignInScreen } from "./components/SignInScreen.js";
import { Sidebar } from "./components/Sidebar.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { useAuth } from "./hooks/use-auth.js";
import { useEventLog } from "./hooks/use-event-log.js";
import { useLiveSession } from "./hooks/use-live-session.js";
import { useProblemContextStep1 } from "./hooks/use-problem-context-step1.js";
import { useProblemImageSend } from "./hooks/use-problem-image.js";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed.js";
import { useTutorSessions } from "./hooks/use-tutor-sessions.js";
import { useVoiceSession } from "./hooks/use-voice-session.js";
import { errorMessage } from "./lib/error-message.js";
import { railStations } from "./lib/phase-rail.js";
import type { LoadedSessionContext, StatusTone } from "./types.js";
import { hasPriorActivity, rightSidebarCollapsedStorageKey } from "./types.js";

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
  const { collapsed: rightSidebarCollapsed, toggleCollapsed: toggleRightSidebarCollapsed } =
    useSidebarCollapsed(rightSidebarCollapsedStorageKey);

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
    isRecording,
    isRunning,
    setStatus,
    startAudioTurn,
    startSession,
    status,
    stopSession,
    turnSessionState
  } = useVoiceSession({
    audioRef,
    logEvent,
    sessionId: tutorSessions.activeSessionId
  });

  isVoiceRunningRef.current = isRunning;
  setStatusRef.current = setStatus;
  stopVoiceSessionRef.current = stopSession;

  const sessionReady =
    Boolean(tutorSessions.activeSessionId) &&
    !tutorSessions.isSwitching &&
    !tutorSessions.isHydrating;

  const liveSession = useLiveSession({
    activeSessionId: tutorSessions.activeSessionId,
    eventCount: tutorSessions.eventCount,
    ready: sessionReady,
    turnSessionState
  });

  const problemContextStep1 = useProblemContextStep1({
    activeSessionId: tutorSessions.activeSessionId,
    logEvent,
    sessionReady,
    setStatus
  });

  const problemImageSend = useProblemImageSend({
    activeSessionId: tutorSessions.activeSessionId,
    ensureSessionReadyForImage,
    getPayloadLimitBytes,
    imagePrompt: problemContextStep1.imagePrompt,
    logEvent,
    objectKey: problemContextStep1.objectKey,
    onPreparedImageChange: problemContextStep1.setPreparedImageFromSend,
    preparedImage: problemContextStep1.preparedImage,
    selectedImageFile: problemContextStep1.selectedImageFile,
    setStatus
  });

  loadSessionContextRef.current = problemContextStep1.loadSessionContext;
  resetProblemImageRef.current = problemContextStep1.resetStep1;
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

        <PhaseRail stations={railStations(liveSession.currentPhase, liveSession.gateStatus)} />

        <SessionStream
          gateStatus={liveSession.gateStatus}
          problemPin={
            <ProblemContextPanel
              confirmDisabled={
                problemContextStep1.isBusy ||
                !problemContextStep1.imagePrompt.trim() ||
                problemContextStep1.promptConfirmed
              }
              emptyMessage={problemContextStep1.emptyMessage}
              extractionAlert={problemContextStep1.extractionAlert}
              extractionStatusHint={problemContextStep1.extractionStatusHint}
              fileInputDisabled={problemContextStep1.isBusy || !sessionReady}
              imageMeta={problemContextStep1.imageMeta}
              imagePrompt={problemContextStep1.imagePrompt}
              isBusy={problemContextStep1.isBusy}
              onConfirmPrompt={problemContextStep1.confirmPrompt}
              onFileChange={problemContextStep1.handleFileChange}
              onPromptChange={problemContextStep1.handlePromptChange}
              onReExtract={problemContextStep1.reExtractQuestion}
              onRetryUpload={problemContextStep1.retryUpload}
              onSubmit={problemImageSend.sendImage}
              previewUrl={problemContextStep1.previewUrl}
              previewWarning={problemContextStep1.previewWarning}
              reExtractDisabled={
                problemContextStep1.isBusy ||
                !problemContextStep1.objectKey ||
                !sessionReady
              }
              retryUploadVisible={
                problemContextStep1.uploadStatus === "failed" && Boolean(problemContextStep1.preparedImage)
              }
              sendDisabled={
                problemImageSend.sendDisabled ||
                !sessionReady ||
                problemContextStep1.isBusy ||
                !problemContextStep1.promptConfirmed
              }
            />
          }
          turns={liveSession.turns}
          unknownTarget={liveSession.unknownTarget}
        />

        <CenterAnchor
          audioRef={audioRef}
          canRecordAudioTurn={canRecordAudioTurn}
          currentPhase={liveSession.currentPhase}
          focusAsk={liveSession.focusAsk}
          hasPriorActivity={activeSessionHasPriorActivity}
          isRecording={isRecording}
          isRunning={isRunning}
          onFinishAudioTurn={() => {
            void finishAudioTurn();
          }}
          onHint={() => {
            logEvent("Hint requested", { phase: liveSession.currentPhase });
          }}
          onPark={() => {
            logEvent("Step parked", { phase: liveSession.currentPhase });
          }}
          onStart={handleStart}
          onStartAudioTurn={startAudioTurn}
          onStop={stopSession}
          scaffoldAid={liveSession.scaffoldAid}
          sessionReady={sessionReady}
        />
      </div>

      <RightSidebar
        collapsed={rightSidebarCollapsed}
        logText={logText}
        onToggleCollapsed={toggleRightSidebarCollapsed}
      />
    </main>
  );
}
