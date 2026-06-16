import { useCallback, useEffect, useRef, useState } from "react";

import {
  toTutorSessionSummary,
  type TutorSessionRecord,
  type TutorSessionSummary
} from "../../session-types.js";
import { errorMessage } from "../lib/error-message.js";
import { formatEventEntry } from "../lib/format-event-entry.js";
import {
  createSession,
  getSession,
  listSessions,
  SessionApiError,
  updateSession
} from "../lib/session-api.js";
import type { LoadedSessionContext, SessionListError, StatusTone } from "../types.js";
import { activeSessionStorageKey } from "../types.js";

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
    message: errorMessage(error, "Could not load sessions.")
  };
}

function toLoadedSessionContext(
  session: Pick<TutorSessionRecord, "imageMeta" | "imageName" | "imagePrompt">
): LoadedSessionContext {
  return {
    imageMeta: session.imageMeta,
    imageName: session.imageName,
    imagePrompt: session.imagePrompt
  };
}

function readStoredActiveSessionId(): string | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }

  return sessionStorage.getItem(activeSessionStorageKey) ?? undefined;
}

function writeStoredActiveSessionId(sessionId: string | undefined): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  if (sessionId) {
    sessionStorage.setItem(activeSessionStorageKey, sessionId);
    return;
  }

  sessionStorage.removeItem(activeSessionStorageKey);
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
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(readStoredActiveSessionId);
  const [isLoading, setIsLoading] = useState(true);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [listError, setListError] = useState<SessionListError | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const initializedRef = useRef(false);

  const persistActiveSessionId = useCallback((sessionId: string | undefined) => {
    setActiveSessionId(sessionId);
    writeStoredActiveSessionId(sessionId);
  }, []);

  const notifyEventLogged = useCallback(() => {
    setEventCount((previous) => previous + 1);
  }, []);

  const hydrateSession = useCallback(
    async (sessionId: string) => {
      const detail = await getSession(sessionId);
      const entries = detail.events.map((event) =>
        formatEventEntry(event.createdAt, event.message, event.value, { omitNullValue: true })
      );

      setEventCount(detail.events.length);
      loadEventLog(entries);
      loadSessionContext(toLoadedSessionContext(detail.session));
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

  const runSessionSwitch = useCallback(
    async <T>(task: () => Promise<T>): Promise<T> => {
      setIsSwitching(true);
      setListError(null);

      try {
        if (getIsVoiceRunning()) {
          stopVoiceSession();
        }

        return await task();
      } catch (error) {
        const mapped = toSessionListError(error);
        setListError(mapped);
        setStatus(mapped.message, "error");
        throw error;
      } finally {
        setIsSwitching(false);
      }
    },
    [getIsVoiceRunning, setStatus, stopVoiceSession]
  );

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) {
        return;
      }

      await runSessionSwitch(async () => {
        await hydrateSession(sessionId);
        persistActiveSessionId(sessionId);
        setStatus("Session loaded.", "ready");
      });
    },
    [
      activeSessionId,
      hydrateSession,
      persistActiveSessionId,
      runSessionSwitch,
      setStatus
    ]
  );

  const createNewSession = useCallback(() => {
    return runSessionSwitch(async () => {
      const created = await createSession();
      const nextSessions = await refreshSessions();

      if (!nextSessions.some((session) => session.id === created.id)) {
        setSessions([created, ...nextSessions]);
      }

      clearEventLog();
      resetProblemImage();
      loadSessionContext(toLoadedSessionContext(created));
      setEventCount(0);
      persistActiveSessionId(created.id);
      setStatus("New session ready.", "ready");
      logEvent("Session created", { sessionId: created.id, title: created.title }, created.id);
      return created.id;
    });
  }, [
    clearEventLog,
    loadSessionContext,
    logEvent,
    persistActiveSessionId,
    refreshSessions,
    resetProblemImage,
    runSessionSwitch,
    setStatus
  ]);

  const updateActiveSession = useCallback(
    async (request: Parameters<typeof updateSession>[1]) => {
      if (!activeSessionId) {
        return;
      }

      const updated = await updateSession(activeSessionId, request);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === updated.id ? toTutorSessionSummary(updated) : session
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

        const storedId = readStoredActiveSessionId();
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
