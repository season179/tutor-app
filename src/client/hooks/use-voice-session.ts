import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  createVoiceClientAdapter,
  type VoiceClientEvent
} from "../../voice-client-adapter.js";
import type { VoiceSessionDescriptor } from "../../voice-types.js";
import { errorLogValue, errorMessage } from "../lib/error-message.js";
import { updateSession } from "../lib/session-api.js";
import { requestVoiceSessionDescriptor } from "../lib/voice-session-api.js";
import type { AppStatus, StatusTone, TutorSessionState } from "../types.js";

type StartSessionOptions = {
  greet?: boolean;
};

type UseVoiceSessionOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  sessionId: string | undefined;
};

function describeVoiceSession(descriptor: VoiceSessionDescriptor): Record<string, string> {
  if (descriptor.provider === "openai-realtime") {
    return {
      model: descriptor.model,
      provider: descriptor.provider,
      voice: descriptor.voice
    };
  }

  return {
    agentName: descriptor.agentName,
    provider: descriptor.provider,
    roomName: descriptor.roomName
  };
}

export function useVoiceSession({ audioRef, logEvent, sessionId }: UseVoiceSessionOptions): {
  isRunning: boolean;
  getPayloadLimitBytes: () => number | undefined;
  getSession: () => TutorSessionState | undefined;
  ensureSessionReadyForImage: () => Promise<TutorSessionState>;
  setStatus: (message: string, tone?: StatusTone) => void;
  startSession: (options?: StartSessionOptions) => Promise<TutorSessionState>;
  status: AppStatus;
  stopSession: () => void;
} {
  const [status, setStatusState] = useState<AppStatus>({
    message: "Ready when you are.",
    tone: "ready"
  });
  const [isRunning, setIsRunning] = useState(false);

  const sessionRef = useRef<TutorSessionState | undefined>(undefined);
  const startSessionPromiseRef = useRef<Promise<TutorSessionState> | undefined>(undefined);
  const startGenerationRef = useRef(0);
  const isStoppingSessionRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const setStatus = useCallback((message: string, tone: StatusTone = "ready") => {
    setStatusState({ message, tone });
  }, []);

  const cleanupSessionResources = useCallback((activeSession: TutorSessionState | undefined) => {
    if (!activeSession) {
      return;
    }

    activeSession.mediaStream.getTracks().forEach((track) => track.stop());

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
      cleanupSessionResources(activeSession);
    },
    [cleanupSessionResources]
  );

  const clearDisconnectedSession = useCallback(
    (activeSession: TutorSessionState) => {
      cleanupSessionResources(activeSession);
      sessionRef.current = undefined;
      setIsRunning(false);
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
            setStatus("Connecting...", "working");
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
              setStatus("Connected. Ask your tutor out loud.", "connected");
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
        }
      }),
    [cleanupSessionResources, logEvent, markCurrentSessionEnded, setStatus]
  );

  const createSession = useCallback(
    async (greetOnOpen: boolean): Promise<TutorSessionState> => {
      const generation = startGenerationRef.current;
      setIsRunning(true);
      setStatus("Requesting tutor session...", "working");

      let pendingSession: TutorSessionState | undefined;

      const assertNotCancelled = () => {
        if (generation !== startGenerationRef.current) {
          throw new Error("Voice session start cancelled.");
        }
      };

      try {
        const activeSessionId = sessionIdRef.current;
        if (!activeSessionId) {
          throw new Error("Choose a tutoring session first.");
        }

        const descriptor = await requestVoiceSessionDescriptor(activeSessionId);
        assertNotCancelled();
        setStatus("Requesting microphone access...", "working");
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        assertNotCancelled();

        if (!audioRef.current) {
          throw new Error("Audio element is not ready.");
        }

        const adapter = createVoiceClientAdapter(descriptor.provider, {
          audioElement: audioRef.current,
          mediaStream
        });

        pendingSession = {
          adapter,
          descriptor,
          mediaStream,
          unsubscribe: () => undefined
        };
        sessionRef.current = pendingSession;
        pendingSession.unsubscribe = wireSessionEvents(pendingSession);

        setStatus("Connecting...", "working");
        await adapter.connect(descriptor);
        assertNotCancelled();
        setStatus("Connected. Ask your tutor out loud.", "connected");
        logEvent("Voice session connected", describeVoiceSession(descriptor));

        if (greetOnOpen) {
          adapter.requestReply(descriptor.tutorPolicy.greetingInstructions);
        }

        return pendingSession;
      } catch (error) {
        cleanupSession(pendingSession);
        sessionRef.current = undefined;
        setIsRunning(false);

        if (error instanceof Error && error.message === "Voice session start cancelled.") {
          setStatus("Ready when you are.");
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
      setIsRunning(false);
      setStatus("Ready when you are.");
      return;
    }

    isStoppingSessionRef.current = true;

    try {
      sessionRef.current = undefined;
      cleanupSession(activeSession);
      setIsRunning(false);
      setStatus("Ready when you are.");
      logEvent("Voice session ended");
      markCurrentSessionEnded();
    } finally {
      isStoppingSessionRef.current = false;
    }
  }, [cleanupSession, logEvent, markCurrentSessionEnded, setStatus]);

  const ensureSessionReadyForImage = useCallback(async (): Promise<TutorSessionState> => {
    const activeSession = sessionRef.current;

    if (activeSession?.adapter.status === "connected") {
      return activeSession;
    }

    if (startSessionPromiseRef.current) {
      setStatus("Connecting before sharing the problem image...", "working");
      return startSessionPromiseRef.current;
    }

    if (activeSession) {
      cleanupSession(activeSession);
      sessionRef.current = undefined;
    }

    setStatus("Starting tutoring before sharing the problem image...", "working");
    return startSession({ greet: false });
  }, [cleanupSession, setStatus, startSession]);

  const getSession = useCallback(() => sessionRef.current, []);

  const getPayloadLimitBytes = useCallback(
    () => sessionRef.current?.adapter.getPayloadLimitBytes(),
    []
  );

  useEffect(() => {
    return () => {
      const activeSession = sessionRef.current;
      if (!activeSession) {
        return;
      }

      isStoppingSessionRef.current = true;
      sessionRef.current = undefined;
      cleanupSession(activeSession);
      isStoppingSessionRef.current = false;
    };
  }, [cleanupSession]);

  return {
    ensureSessionReadyForImage,
    getPayloadLimitBytes,
    getSession,
    isRunning,
    setStatus,
    startSession,
    status,
    stopSession
  };
}
