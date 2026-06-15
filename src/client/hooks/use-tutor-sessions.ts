import { useCallback, useEffect, useRef, useState } from "react";

import type { TutorSessionSummary } from "../../session-types.js";
import {
  createSession,
  getSession,
  listSessions,
  SessionApiError,
  updateSession
} from "../lib/session-api.js";
import type { LoadedSessionContext, SessionListError, StatusTone } from "../types.js";
import {
  activeSessionStorageKey,
  defaultImagePrompt
} from "../types.js";

type UseTutorSessionsOptions = {
  clearEventLog: () => void;
  getIsVoiceRunning: () => boolean;
  loadEventLog: (entries: string[]) => void;
  loadSessionContext: (context: LoadedSessionContext) => void;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  resetProblemImage: () => void;
  setStatus: (message: string, tone?: StatusTone) => void;
  stopVoiceSession: () => void;
};

function formatEventEntry(createdAt: string, message: string, value: unknown): string {
  const time = new Date(createdAt).toLocaleTimeString();
  const renderedValue = value === null || value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  return `[${time}] ${message}${renderedValue}`;
}

function toSessionListError(error: unknown): SessionListError {
  if (error instanceof SessionApiError) {
    if (error.status === 403) {
      return {
        kind: "auth",
        message: "Sign in required to load sessions."
      };
    }

    return {
      kind: "network",
      message: error.message
    };
  }

  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : "Could not load sessions."
  };
}

export function useTutorSessions({
  clearEventLog,
  getIsVoiceRunning,
  loadEventLog,
  loadSessionContext,
  logEvent,
  resetProblemImage,
  setStatus,
  stopVoiceSession
}: UseTutorSessionsOptions): {
  activeSession: TutorSessionSummary | undefined;
  activeSessionId: string | undefined;
  createNewSession: () => Promise<string | undefined>;
  eventCount: number;
  isHydrating: boolean;
  isLoading: boolean;
  isSwitching: boolean;
  listError: SessionListError | null;
  refreshSessions: () => Promise<TutorSessionSummary[]>;
  selectSession: (sessionId: string) => Promise<void>;
  sessions: TutorSessionSummary[];
  updateActiveSession: (request: Parameters<typeof updateSession>[1]) => Promise<void>;
  notifyEventLogged: () => void;
} {
  const [sessions, setSessions] = useState<TutorSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(() => {
    if (typeof sessionStorage === "undefined") {
      return undefined;
    }

    return sessionStorage.getItem(activeSessionStorageKey) ?? undefined;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [listError, setListError] = useState<SessionListError | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const initializedRef = useRef(false);

  const persistActiveSessionId = useCallback((sessionId: string | undefined) => {
    setActiveSessionId(sessionId);

    if (typeof sessionStorage === "undefined") {
      return;
    }

    if (sessionId) {
      sessionStorage.setItem(activeSessionStorageKey, sessionId);
      return;
    }

    sessionStorage.removeItem(activeSessionStorageKey);
  }, []);

  const notifyEventLogged = useCallback(() => {
    setEventCount((previous) => previous + 1);
  }, []);

  const hydrateSession = useCallback(
    async (sessionId: string) => {
      const detail = await getSession(sessionId);
      const entries = detail.events.map((event) =>
        formatEventEntry(event.createdAt, event.message, event.value)
      );

      setEventCount(detail.events.length);
      loadEventLog(entries);
      loadSessionContext({
        imageMeta: detail.session.imageMeta,
        imageName: detail.session.imageName,
        imagePrompt: detail.session.imagePrompt ?? defaultImagePrompt
      });
    },
    [loadEventLog, loadSessionContext]
  );

  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    setListError(null);

    try {
      const nextSessions = await listSessions();
      setSessions(nextSessions);
      return nextSessions;
    } catch (error) {
      setListError(toSessionListError(error));
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) {
        return;
      }

      setIsSwitching(true);
      setListError(null);

      try {
        if (getIsVoiceRunning()) {
          stopVoiceSession();
        }

        await hydrateSession(sessionId);
        persistActiveSessionId(sessionId);
        setStatus("Session loaded.", "ready");
      } catch (error) {
        const mapped = toSessionListError(error);
        setListError(mapped);
        setStatus(mapped.message, "error");
        throw error;
      } finally {
        setIsSwitching(false);
      }
    },
    [
      activeSessionId,
      getIsVoiceRunning,
      hydrateSession,
      persistActiveSessionId,
      setStatus,
      stopVoiceSession
    ]
  );

  const createNewSession = useCallback(async () => {
    setIsSwitching(true);
    setListError(null);

    try {
      if (getIsVoiceRunning()) {
        stopVoiceSession();
      }

      const created = await createSession();
      const nextSessions = await refreshSessions();
      const ordered = nextSessions.some((session) => session.id === created.id)
        ? nextSessions
        : [created, ...nextSessions];
      setSessions(ordered);

      clearEventLog();
      resetProblemImage();
      loadSessionContext({
        imageMeta: null,
        imageName: null,
        imagePrompt: defaultImagePrompt
      });
      setEventCount(0);
      persistActiveSessionId(created.id);
      setStatus("New session ready.", "ready");
      logEvent("Session created", { sessionId: created.id, title: created.title }, created.id);
      return created.id;
    } catch (error) {
      const mapped = toSessionListError(error);
      setListError(mapped);
      setStatus(mapped.message, "error");
      throw error;
    } finally {
      setIsSwitching(false);
    }
  }, [
    clearEventLog,
    getIsVoiceRunning,
    loadSessionContext,
    logEvent,
    persistActiveSessionId,
    refreshSessions,
    resetProblemImage,
    setStatus,
    stopVoiceSession
  ]);

  const updateActiveSession = useCallback(
    async (request: Parameters<typeof updateSession>[1]) => {
      if (!activeSessionId) {
        return;
      }

      const updated = await updateSession(activeSessionId, request);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === updated.id
            ? {
                createdAt: updated.createdAt,
                id: updated.id,
                status: updated.status,
                title: updated.title,
                updatedAt: updated.updatedAt
              }
            : session
        )
      );
    },
    [activeSessionId]
  );

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    void (async () => {
      setIsHydrating(true);

      try {
        const nextSessions = await refreshSessions();

        if (nextSessions.length === 0) {
          await createNewSession();
          return;
        }

        const storedId = typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(activeSessionStorageKey)
          : null;
        const targetId =
          storedId && nextSessions.some((session) => session.id === storedId)
            ? storedId
            : nextSessions[0]!.id;

        await hydrateSession(targetId);
        persistActiveSessionId(targetId);
      } catch {
        // Errors are surfaced through listError and status.
      } finally {
        setIsHydrating(false);
      }
    })();
  }, [createNewSession, hydrateSession, persistActiveSessionId, refreshSessions]);

  const activeSession = sessions.find((session) => session.id === activeSessionId);

  return {
    activeSession,
    activeSessionId,
    createNewSession,
    eventCount,
    isHydrating,
    isLoading,
    isSwitching,
    listError,
    notifyEventLogged,
    refreshSessions,
    selectSession,
    sessions,
    updateActiveSession
  };
}
