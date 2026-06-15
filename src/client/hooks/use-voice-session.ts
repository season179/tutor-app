import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  createVoiceClientAdapter,
  type VoiceClientEvent
} from "../../voice-client-adapter.js";
import { parseVoiceSessionDescriptor } from "../../voice-session-schema.js";
import {
  voiceSessionPath,
  type CreateVoiceSessionRequest,
  type VoiceSessionDescriptor
} from "../../voice-types.js";
import { updateSession } from "../lib/session-api.js";
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

  const wireSessionEvents = useCallback(
    (activeSession: TutorSessionState): (() => void) =>
      activeSession.adapter.onEvent((event: VoiceClientEvent) => {
        if (event.type === "debug_event") {
          logEvent(event.label, event.value);
          return;
        }

        if (event.type === "connecting") {
          setStatus("Connecting...", "working");
          return;
        }

        if (event.type === "disconnected") {
          if (sessionRef.current !== activeSession) {
            return;
          }

          cleanupSessionResources(activeSession);
          sessionRef.current = undefined;
          setIsRunning(false);

          if (!isStoppingSessionRef.current) {
            setStatus("Session disconnected.", "ready");

            const activeSessionId = sessionIdRef.current;
            if (activeSessionId) {
              void updateSession(activeSessionId, { status: "ended" }).catch(() => {
                // Status sync failures should not block local cleanup.
              });
            }
          }

          return;
        }

        if (event.type === "reply_started") {
          setStatus("Tutor is responding...", "connected");
          return;
        }

        if (event.type === "reply_finished") {
          if (sessionRef.current === activeSession) {
            setStatus("Connected. Ask your tutor out loud.", "connected");
          }
          return;
        }

        if (event.type === "error") {
          const error = event.error;
          setStatus(error instanceof Error ? error.message : "Voice session error.", "error");
          logEvent("Voice session error", error instanceof Error ? error.message : error);
        }
      }),
    [cleanupSessionResources, logEvent, setStatus]
  );

  const fetchVoiceSessionDescriptor = useCallback(async (): Promise<VoiceSessionDescriptor> => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      throw new Error("Choose a tutoring session first.");
    }

    const request: CreateVoiceSessionRequest = {
      intent: "tutor",
      sessionId: activeSessionId
    };
    const response = await fetch(voiceSessionPath, {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => null)) as (VoiceSessionDescriptor & { error?: string }) | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? `Failed to create voice session (${response.status}).`);
    }

    if (!payload) {
      throw new Error("Voice session response was not valid JSON.");
    }

    return parseVoiceSessionDescriptor(payload);
  }, []);

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
        const descriptor = await fetchVoiceSessionDescriptor();
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

        setStatus(error instanceof Error ? error.message : "Failed to start session.", "error");
        logEvent("Start failed", error instanceof Error ? error.message : error);
        throw error;
      }
    },
    [audioRef, cleanupSession, fetchVoiceSessionDescriptor, logEvent, setStatus, wireSessionEvents]
  );

  const startSession = useCallback(
    async (options: StartSessionOptions = {}): Promise<TutorSessionState> => {
      const activeSession = sessionRef.current;

      if (activeSession?.adapter.status === "disconnected") {
        cleanupSessionResources(activeSession);
        sessionRef.current = undefined;
        setIsRunning(false);
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
    [cleanupSessionResources, createSession]
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

      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        void updateSession(activeSessionId, { status: "ended" }).catch(() => {
          // Status sync failures should not block ending the live call.
        });
      }
    } finally {
      isStoppingSessionRef.current = false;
    }
  }, [cleanupSession, logEvent, setStatus]);

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
