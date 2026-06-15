import { useCallback, useRef, useState, type RefObject } from "react";

import { appendSessionEvent } from "../lib/session-api.js";

export function useEventLog(
  activeSessionIdRef: RefObject<string | undefined>,
  onEventLoggedRef?: RefObject<(() => void) | undefined>
): {
  clearEventLog: () => void;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  logText: string;
  loadEventLog: (entries: string[]) => void;
} {
  const [entries, setEntries] = useState<string[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const appendLocalEntry = useCallback((message: string, value?: unknown) => {
    const time = new Date().toLocaleTimeString();
    const renderedValue = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
    setEntries((previous) => [`[${time}] ${message}${renderedValue}`, ...previous]);
  }, []);

  const logEvent = useCallback(
    (message: string, value?: unknown, persistSessionId?: string) => {
      appendLocalEntry(message, value);
      onEventLoggedRef?.current?.();

      const sessionId = persistSessionId ?? activeSessionIdRef.current;
      if (!sessionId) {
        return;
      }

      void appendSessionEvent(sessionId, { message, value }).catch(() => {
        // Persistence failures should not block the live session UI.
      });
    },
    [activeSessionIdRef, appendLocalEntry, onEventLoggedRef]
  );

  const loadEventLog = useCallback((nextEntries: string[]) => {
    setEntries(nextEntries);
  }, []);

  const clearEventLog = useCallback(() => {
    setEntries([]);
  }, []);

  return {
    clearEventLog,
    logEvent,
    loadEventLog,
    logText: entries.length === 0 ? "No session events yet." : entries.join("\n")
  };
}
