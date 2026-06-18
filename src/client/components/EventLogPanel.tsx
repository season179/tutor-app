import { useState } from "react";

import { classNames } from "../lib/class-names.js";
import { Panel } from "./Panel.js";

type EventLogPanelProps = {
  logText: string;
};

export function EventLogPanel({ logText }: EventLogPanelProps) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | "idle">("idle");

  const handleCopy = () => {
    copyTextToClipboard(logText)
      .then(() => {
        setCopyStatus("copied");
        window.setTimeout(() => setCopyStatus("idle"), 1800);
      })
      .catch(() => {
        setCopyStatus("error");
        window.setTimeout(() => setCopyStatus("idle"), 2200);
      });
  };

  const label =
    copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy logs";
  const statusText = copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "";

  return (
    <Panel
      actions={
        <button
          aria-label={label}
          className={classNames("icon-button", "copy-log-icon", `copy-log-icon-${copyStatus}`)}
          onClick={handleCopy}
          title={label}
          type="button"
        >
          <CopyIcon status={copyStatus} />
        </button>
      }
      className="events-panel"
      description="Connection, image, and voice events."
      id="events-title"
      title="Session log"
    >
      <span className="sr-only" role="status">
        {statusText}
      </span>
      <pre aria-live="polite">{logText}</pre>
    </Panel>
  );
}

function CopyIcon({ status }: { status: "copied" | "error" | "idle" }) {
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
      {status === "copied" ? (
        <path d="M5 13l4 4L19 7" />
      ) : status === "error" ? (
        <path d="M6 6l12 12M18 6L6 18" />
      ) : (
        <>
          <rect height="9" rx="2" width="9" x="9" y="9" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )}
    </svg>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.inset = "0";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";

  document.body.append(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    textArea.remove();
  }
}
