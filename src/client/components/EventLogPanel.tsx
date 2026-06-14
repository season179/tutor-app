import { Panel } from "./Panel.js";

type EventLogPanelProps = {
  logText: string;
};

export function EventLogPanel({ logText }: EventLogPanelProps) {
  return (
    <Panel
      className="events-panel"
      description="Connection, image, and realtime events."
      id="events-title"
      title="Session log"
    >
      <pre aria-live="polite">{logText}</pre>
    </Panel>
  );
}
