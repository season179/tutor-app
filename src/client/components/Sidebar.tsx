import type { TutorSessionStatus, TutorSessionSummary } from "../../session-types.js";
import { ActionButton } from "./ActionButton.js";
import { classNames } from "../lib/class-names.js";
import { formatRelativeTime } from "../lib/format-relative-time.js";
import type { SessionListError } from "../types.js";
import { statusLabel } from "../types.js";

type SidebarProps = {
  activeSessionId: string | undefined;
  collapsed: boolean;
  error: SessionListError | null;
  isAnonymous?: boolean;
  isDisabled?: boolean;
  isLoading: boolean;
  onCreate: () => void;
  onRetry: () => void;
  onSelect: (sessionId: string) => void;
  onSignIn?: () => void;
  onSignOut: () => void;
  onToggleCollapsed: () => void;
  sessions: TutorSessionSummary[];
  userEmail?: string;
};

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

function SessionRowSkeleton() {
  return (
    <li className="session-row session-row--skeleton" aria-hidden="true">
      <span className="session-row-title skeleton-block" />
      <span className="session-row-meta skeleton-block" />
    </li>
  );
}

export function Sidebar({
  activeSessionId,
  collapsed,
  error,
  isAnonymous = false,
  isDisabled = false,
  isLoading,
  onCreate,
  onRetry,
  onSelect,
  onSignIn,
  onSignOut,
  onToggleCollapsed,
  sessions,
  userEmail
}: SidebarProps) {
  const showEmpty = !isLoading && !error && sessions.length === 0;
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <aside className={classNames("sidebar", collapsed && "sidebar--collapsed")} aria-label="Sessions">
      <div className="sidebar-header">
        {collapsed ? null : (
          <div className="sidebar-heading">
            <h2>Sessions</h2>
            <p>Pick a lesson or start a new one.</p>
          </div>
        )}
        <button
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          className="icon-button sidebar-toggle"
          onClick={onToggleCollapsed}
          title={toggleLabel}
          type="button"
        >
          <ChevronIcon collapsed={collapsed} />
        </button>
      </div>

      <div className="sidebar-actions">
        <ActionButton
          aria-label={collapsed ? "New session" : undefined}
          className="sidebar-new-action"
          disabled={isDisabled}
          onClick={onCreate}
          title={collapsed ? "New session" : undefined}
          variant="primary"
        >
          {collapsed ? <PlusIcon /> : "New session"}
        </ActionButton>
      </div>

      {isAnonymous && !collapsed ? (
        <p className="sidebar-guest-hint">Guest mode — sign in to keep all sessions.</p>
      ) : null}

      {error ? (
        <div className="sidebar-alert" role="alert">
          {collapsed ? null : <p>{error.message}</p>}
          {error.kind !== "auth" ? (
            <button
              className={classNames("icon-button", "sidebar-retry-action", collapsed && "sidebar-retry-action--collapsed")}
              aria-label="Try again"
              onClick={onRetry}
              title="Try again"
              type="button"
            >
              <RetryIcon />
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <ul className="session-list" aria-label="Loading sessions">
          {collapsed ? null : (
            <>
              <SessionRowSkeleton />
              <SessionRowSkeleton />
              <SessionRowSkeleton />
            </>
          )}
        </ul>
      ) : null}

      {showEmpty ? (
        <div className={classNames("sidebar-empty", collapsed && "sidebar-empty--collapsed")}>
          {collapsed ? null : <p>No sessions yet.</p>}
        </div>
      ) : null}

      {!isLoading && sessions.length > 0 ? (
        <ul className="session-list" aria-label="Saved sessions">
          {sessions.map((session) => {
            const selected = session.id === activeSessionId;
            const tone = statusTone(session.status);
            const summary = `${session.title} · ${statusLabel(session.status)} · ${formatRelativeTime(session.updatedAt)}`;

            return (
              <li key={session.id}>
                <button
                  aria-current={selected ? "true" : undefined}
                  aria-label={collapsed ? summary : undefined}
                  className={classNames("session-row", selected && "session-row--selected", collapsed && "session-row--collapsed")}
                  disabled={isDisabled}
                  onClick={() => onSelect(session.id)}
                  title={collapsed ? summary : undefined}
                  type="button"
                >
                  {collapsed ? (
                    <span className={classNames("session-status-dot", `session-status-dot--${tone}`)} aria-hidden="true" />
                  ) : (
                    <span className="session-row-text">
                      <span className="session-row-title">{session.title}</span>
                      <span className="session-row-meta">
                        <span className={classNames("session-status-dot", `session-status-dot--${tone}`)} aria-hidden="true" />
                        <span>
                          {statusLabel(session.status)} · {formatRelativeTime(session.updatedAt)}
                        </span>
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="sidebar-footer">
        {isAnonymous ? (
          collapsed ? (
            <button
              aria-label="Sign in with Google"
              className="icon-button sidebar-signin"
              onClick={() => onSignIn?.()}
              title="Sign in with Google"
              type="button"
            >
              <SignInIcon />
            </button>
          ) : (
            <ActionButton className="sidebar-signin-action" onClick={() => onSignIn?.()} variant="secondary">
              Sign in with Google
            </ActionButton>
          )
        ) : collapsed ? (
          <button
            aria-label="Sign out"
            className="icon-button sidebar-signout"
            onClick={onSignOut}
            title="Sign out"
            type="button"
          >
            <SignOutIcon />
          </button>
        ) : (
          <div className="sidebar-account">
            {userEmail ? <span className="sidebar-account-email" title={userEmail}>{userEmail}</span> : null}
            <button className="text-button sidebar-signout-link" onClick={onSignOut} type="button">
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      className={classNames("sidebar-chevron", collapsed && "sidebar-chevron--collapsed")}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="sidebar-new-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function SignInIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
