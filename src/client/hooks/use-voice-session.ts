import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  createVoiceClientAdapter,
  type VoiceClientEvent
} from "../lib/voice-client-adapter.js";
import type { VoiceSessionDescriptor, VoicePipelineSessionState } from "../../modules/voice/voice-types.js";
import { errorLogValue, errorMessage } from "../lib/error-message.js";
import { updateSession } from "../lib/session-api.js";
import { requestVoiceSessionDescriptor } from "../lib/voice-session-api.js";
import type { AppStatus, StatusTone, TutorSessionState } from "../types.js";

type StartSessionOptions = {
  greet?: boolean;
};

const connectedStatusMessage = "Connected. Ask Coach Echo out loud.";
const connectingStatusMessage = "Connecting...";
const readyStatusMessage = "Ready when you are.";
const startCancelledMessage = "Voice session start cancelled.";

type UseVoiceSessionOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  sessionId: string | undefined;
};

function describeVoiceSession(descriptor: VoiceSessionDescriptor): Record<string, string> {
  return {
    model: descriptor.model,
    provider: descriptor.provider,
    transcribeModel: descriptor.transcribeModel,
    ttsModel: descriptor.ttsModel,
    voice: descriptor.voice
  };
}

export function useVoiceSession({ audioRef, logEvent, sessionId }: UseVoiceSessionOptions): {
  canRecordAudioTurn: boolean;
  finishAudioTurn: () => Promise<void>;
  isRunning: boolean;
  isRecording: boolean;
  sendTextTurn: (text: string) => Promise<void>;
  setStatus: (message: string, tone?: StatusTone) => void;
  startAudioTurn: () => void;
  startSession: (options?: StartSessionOptions) => Promise<TutorSessionState>;
  status: AppStatus;
  stopSession: () => void;
  turnSessionState: VoicePipelineSessionState | null;
} {
  const [status, setStatusState] = useState<AppStatus>({
    message: readyStatusMessage,
    tone: "ready"
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [turnSessionState, setTurnSessionState] = useState<VoicePipelineSessionState | null>(null);

  const sessionRef = useRef<TutorSessionState | undefined>(undefined);
  const startSessionPromiseRef = useRef<Promise<TutorSessionState> | undefined>(undefined);
  const startGenerationRef = useRef(0);
  const isStoppingSessionRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const setStatus = useCallback((message: string, tone: StatusTone = "ready") => {
    setStatusState({ message, tone });
  }, []);

  const setReadyStatus = useCallback(() => {
    setIsRunning(false);
    setStatus(readyStatusMessage);
  }, [setStatus]);

  // Clear the audio sink. The adapter's own stream teardown happens in
  // `adapter.disconnect()` (the pipeline adapter owns its mic stream internally now).
  const cleanupSessionResources = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, [audioRef]);

  const cleanupSession = useCallback(
    (activeSession: TutorSessionState | undefined) => {
      if (!activeSession) {
        return;
      }

      activeSession.unsubscribe();
      activeSession.adapter.disconnect();
      cleanupSessionResources();
    },
    [cleanupSessionResources]
  );

  const cleanupStoppingSession = useCallback(
    (activeSession: TutorSessionState, afterCleanup?: () => void) => {
      isStoppingSessionRef.current = true;

      try {
        sessionRef.current = undefined;
        cleanupSession(activeSession);
        afterCleanup?.();
        setIsRecording(false);
      } finally {
        isStoppingSessionRef.current = false;
      }
    },
    [cleanupSession]
  );

  const clearDisconnectedSession = useCallback(
    (activeSession: TutorSessionState) => {
      void activeSession;
      cleanupSessionResources();
      sessionRef.current = undefined;
      setIsRunning(false);
      setIsRecording(false);
    },
    [cleanupSessionResources]
  );

  const markCurrentSessionEnded = useCallback(() => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      return;
    }

    void updateSession(activeSessionId, { status: "ended" }).catch(() => {
      // Status sync failures should not block local cleanup.
    });
  }, []);

  const wireSessionEvents = useCallback(
    (activeSession: TutorSessionState): (() => void) =>
      activeSession.adapter.onEvent((event: VoiceClientEvent) => {
        switch (event.type) {
          case "debug_event":
            logEvent(event.label, event.value);
            return;
          case "connecting":
            setStatus(connectingStatusMessage, "working");
            return;
          case "disconnected":
            if (sessionRef.current !== activeSession) {
              return;
            }

            clearDisconnectedSession(activeSession);

            if (!isStoppingSessionRef.current) {
              setStatus("Session disconnected.", "ready");
              markCurrentSessionEnded();
            }

            return;
          case "reply_started":
            setStatus("Tutor is responding...", "connected");
            return;
          case "reply_finished":
            if (sessionRef.current === activeSession) {
              setStatus(connectedStatusMessage, "connected");
            }
            return;
          case "error": {
            const error = event.error;
            setStatus(errorMessage(error, "Voice session error."), "error");
            logEvent("Voice session error", errorLogValue(error));
            return;
          }
          case "connected":
            return;
          case "recording_started":
            setIsRecording(true);
            setStatus("Listening to your answer...", "working");
            return;
          case "recording_finished":
            setIsRecording(false);
            setStatus("Checking your answer...", "working");
            return;
          case "student_transcript":
            logEvent("Student transcript", event.text);
            return;
          case "tutor_text":
            logEvent("Tutor said", event.text);
            return;
          case "session_state":
            setTurnSessionState(event.session);
            return;
        }
      }),
    [clearDisconnectedSession, logEvent, markCurrentSessionEnded, setStatus]
  );

  const createSession = useCallback(
    async (greetOnOpen: boolean): Promise<TutorSessionState> => {
      const generation = startGenerationRef.current;
      setIsRunning(true);
      setStatus("Requesting Coach Echo session...", "working");

      let pendingSession: TutorSessionState | undefined;

      const assertNotCancelled = () => {
        if (generation !== startGenerationRef.current) {
          throw new Error(startCancelledMessage);
        }
      };

      try {
        const activeSessionId = sessionIdRef.current;
        if (!activeSessionId) {
          throw new Error("Choose a session first.");
        }

        const descriptor = await requestVoiceSessionDescriptor(activeSessionId);
        assertNotCancelled();

        if (!audioRef.current) {
          throw new Error("Audio element is not ready.");
        }

        const adapter = createVoiceClientAdapter({
          audioElement: audioRef.current
        });

        const nextSession: TutorSessionState = {
          adapter,
          descriptor,
          unsubscribe: () => undefined
        };
        pendingSession = nextSession;
        sessionRef.current = pendingSession;
        nextSession.unsubscribe = wireSessionEvents(nextSession);

        setStatus(connectingStatusMessage, "working");
        await adapter.connect(descriptor);
        assertNotCancelled();
        setStatus(connectedStatusMessage, "connected");
        logEvent("Voice session connected", describeVoiceSession(descriptor));

        if (greetOnOpen) {
          // The tutor opens the session: the turn-based pipeline sends a kickoff turn
          // so the server speaks the first move. Mic access is acquired lazily on the
          // first manual audio turn, not at connect time.
          adapter.requestOpeningTurn();
        }

        return nextSession;
      } catch (error) {
        cleanupSession(pendingSession);
        sessionRef.current = undefined;
        setIsRunning(false);

        if (error instanceof Error && error.message === startCancelledMessage) {
          setReadyStatus();
          throw error;
        }

        setStatus(errorMessage(error, "Failed to start session."), "error");
        logEvent("Start failed", errorLogValue(error));
        throw error;
      }
    },
    [audioRef, cleanupSession, logEvent, setStatus, wireSessionEvents]
  );

  const startSession = useCallback(
    async (options: StartSessionOptions = {}): Promise<TutorSessionState> => {
      const activeSession = sessionRef.current;

      if (activeSession?.adapter.status === "disconnected") {
        clearDisconnectedSession(activeSession);
      }

      if (sessionRef.current) {
        return sessionRef.current;
      }

      if (startSessionPromiseRef.current) {
        return startSessionPromiseRef.current;
      }

      startSessionPromiseRef.current = createSession(options.greet ?? true);

      try {
        return await startSessionPromiseRef.current;
      } finally {
        startSessionPromiseRef.current = undefined;
      }
    },
    [clearDisconnectedSession, createSession]
  );

  const stopSession = useCallback(() => {
    startGenerationRef.current += 1;
    startSessionPromiseRef.current = undefined;

    const activeSession = sessionRef.current;

    if (!activeSession) {
      setReadyStatus();
      return;
    }

    cleanupStoppingSession(activeSession, () => {
      setReadyStatus();
      logEvent("Voice session ended");
      markCurrentSessionEnded();
    });
  }, [cleanupStoppingSession, logEvent, markCurrentSessionEnded, setReadyStatus]);

  const startAudioTurn = useCallback(() => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setStatus("Start with Echo before recording an answer.", "error");
      return;
    }

    if (activeSession.adapter.isCapturingAudio) {
      return;
    }

    try {
      setStatus("Requesting microphone access...", "working");
      void activeSession.adapter.startAudioTurn().catch((error: unknown) => {
        setStatus(errorMessage(error, "Could not start recording."), "error");
        logEvent("Recording start failed", errorLogValue(error));
      });
    } catch (error) {
      setStatus(errorMessage(error, "Could not start recording."), "error");
      logEvent("Recording start failed", errorLogValue(error));
    }
  }, [logEvent, setStatus]);

  const finishAudioTurn = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setStatus("Start with Echo before sending an answer.", "error");
      return;
    }

    try {
      await activeSession.adapter.finishAudioTurn();
    } catch (error) {
      setIsRecording(false);
      setStatus(errorMessage(error, "Could not send your answer."), "error");
      logEvent("Recording send failed", errorLogValue(error));
    }
  }, [logEvent, setStatus]);

  // Typed turns share the audio path: connect on demand (without a greeting, since
  // the child's message is the opening turn), send the text, and the pipeline
  // answers the turn directly.
  const sendTextTurn = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const current = sessionRef.current;
      if (current?.adapter.status === "disconnected") {
        clearDisconnectedSession(current);
      }

      try {
        const connected = sessionRef.current;
        const activeSession =
          connected && connected.adapter.status === "connected"
            ? connected
            : await startSession({ greet: false });

        activeSession.adapter.sendUserTurn({ image: null, text: trimmed });

        logEvent("Student text turn", trimmed);
      } catch (error) {
        if (error instanceof Error && error.message === startCancelledMessage) {
          return;
        }

        setStatus(errorMessage(error, "Could not send your message."), "error");
        logEvent("Text turn send failed", errorLogValue(error));
      }
    },
    [clearDisconnectedSession, logEvent, setStatus, startSession]
  );

  useEffect(() => {
    setTurnSessionState(null);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      const activeSession = sessionRef.current;
      if (!activeSession) {
        return;
      }

      cleanupStoppingSession(activeSession);
    };
  }, [cleanupStoppingSession]);

  return {
    canRecordAudioTurn: Boolean(sessionRef.current?.adapter.supportsAudioTurns),
    finishAudioTurn,
    isRecording,
    isRunning,
    sendTextTurn,
    setStatus,
    startAudioTurn,
    startSession,
    status,
    stopSession,
    turnSessionState
  };
}
