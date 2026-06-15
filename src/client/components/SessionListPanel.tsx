import type { TutorSessionStatus, TutorSessionSummary } from "../../session-types.js";
import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";
import { formatRelativeTime } from "../lib/format-relative-time.js";
import type { SessionListError } from "../types.js";
import { statusLabel } from "../types.js";

type SessionListPanelProps = {
  activeSessionId: string | undefined;
  error: SessionListError | null;
  isDisabled?: boolean;
  isLoading: boolean;
  onCreate: () => void;
  onRetry: () => void;
  onSelect: (sessionId: string) => void;
  sessions: TutorSessionSummary[];
};

function SessionRowSkeleton() {
  return (
    <li className="session-row session-row--skeleton" aria-hidden="true">
      <span className="session-row-title skeleton-block" />
      <span className="session-row-meta skeleton-block" />
    </li>
  );
}

function statusTone(status: TutorSessionStatus): string {
  switch (status) {
    case "active":
      return "connected";
    case "ended":
      return "ready";
    default:
      return "working";
  }
}

export function SessionListPanel({
  activeSessionId,
  error,
  isDisabled = false,
  isLoading,
  onCreate,
  onRetry,
  onSelect,
  sessions
}: SessionListPanelProps) {
  const showEmpty = !isLoading && !error && sessions.length === 0;

  return (
    <aside className="session-rail">
      <Panel
        className="session-list-panel"
        description="Pick a lesson or start a new one."
        id="sessions-title"
        title="Sessions"
      >
        <div className="session-rail-actions">
          <ActionButton className="session-new-action" disabled={isDisabled} onClick={onCreate} variant="primary">
            New session
          </ActionButton>
        </div>

        {error ? (
          <div className="session-rail-alert" role="alert">
            <p>{error.message}</p>
            {error.kind !== "auth" ? (
              <ActionButton className="session-retry-action" onClick={onRetry} variant="secondary">
                Try again
              </ActionButton>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <ul className="session-list" aria-label="Loading sessions">
            <SessionRowSkeleton />
            <SessionRowSkeleton />
            <SessionRowSkeleton />
          </ul>
        ) : null}

        {showEmpty ? (
          <div className="session-rail-empty">
            <p>No sessions yet.</p>
            <ActionButton disabled={isDisabled} onClick={onCreate} variant="secondary">
              New session
            </ActionButton>
          </div>
        ) : null}

        {!isLoading && sessions.length > 0 ? (
          <ul className="session-list" aria-label="Saved sessions">
            {sessions.map((session) => {
              const selected = session.id === activeSessionId;

              return (
                <li key={session.id}>
                  <button
                    aria-current={selected ? "true" : undefined}
                    className={["session-row", selected ? "session-row--selected" : ""].filter(Boolean).join(" ")}
                    disabled={isDisabled}
                    onClick={() => onSelect(session.id)}
                    type="button"
                  >
                    <span className="session-row-title">{session.title}</span>
                    <span className="session-row-meta">
                      <span className={`session-status-dot session-status-dot--${statusTone(session.status)}`} />
                      <span>
                        {statusLabel(session.status)} · {formatRelativeTime(session.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Panel>
    </aside>
  );
}
