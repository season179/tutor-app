import { useCallback, useState, type RefObject } from "react";

import { formatEventEntry } from "../lib/format-event-entry.js";
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

  const appendLocalEntry = useCallback((message: string, value?: unknown) => {
    setEntries((previous) => [formatEventEntry(new Date(), message, value), ...previous]);
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
