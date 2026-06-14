import { useCallback, useState } from "react";

export function useEventLog(): {
  logEvent: (message: string, value?: unknown) => void;
  logText: string;
} {
  const [entries, setEntries] = useState<string[]>([]);

  const logEvent = useCallback((message: string, value?: unknown) => {
    const time = new Date().toLocaleTimeString();
    const renderedValue = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
    setEntries((previous) => [`[${time}] ${message}${renderedValue}`, ...previous]);
  }, []);

  return {
    logEvent,
    logText: entries.length === 0 ? "No session events yet." : entries.join("\n")
  };
}
