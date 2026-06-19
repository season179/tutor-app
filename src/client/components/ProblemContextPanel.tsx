import type { FormEvent } from "react";

import type { ExtractionAlert } from "../lib/problem-context-extraction.js";
import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type ProblemContextPanelProps = {
  confirmDisabled: boolean;
  emptyMessage: string;
  extractionAlert: ExtractionAlert | null;
  extractionStatusHint: string | null;
  fileInputDisabled: boolean;
  imageMeta: string;
  imagePrompt: string;
  isBusy: boolean;
  onConfirmPrompt: () => void;
  onFileChange: (file: File | undefined, input?: HTMLInputElement | null) => void;
  onPromptChange: (value: string) => void;
  onReExtract: () => void | Promise<void>;
  onRetryUpload: () => void | Promise<void>;
  onSubmit: () => void | Promise<void>;
  previewUrl: string | undefined;
  previewWarning: string | null;
  reExtractDisabled: boolean;
  retryUploadVisible: boolean;
  sendDisabled: boolean;
};

export function ProblemContextPanel({
  confirmDisabled,
  emptyMessage,
  extractionAlert,
  extractionStatusHint,
  fileInputDisabled,
  imageMeta,
  imagePrompt,
  isBusy,
  onConfirmPrompt,
  onFileChange,
  onPromptChange,
  onReExtract,
  onRetryUpload,
  onSubmit,
  previewUrl,
  previewWarning,
  reExtractDisabled,
  retryUploadVisible,
  sendDisabled
}: ProblemContextPanelProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <Panel
      className="problem-panel"
      description="Add the page or prompt the tutor should reason from."
      id="problem-title"
      title="Problem context"
    >
      <div className="workflow-step">
        <p className="workflow-step-label">Step 1 · Confirm the question</p>
        <p className="workflow-step-description">
          Upload a photo of the problem. We&apos;ll read the question so you can check it before tutoring.
        </p>
      </div>

      <form className="image-form" onSubmit={handleSubmit}>
        <label className="field file-field">
          <span>Problem image</span>
          <input
            accept="image/*"
            disabled={fileInputDisabled}
            type="file"
            onChange={(event) => onFileChange(event.target.files?.item(0) ?? undefined, event.target)}
          />
        </label>

        <div className="image-grid">
          <label className="field question-field">
            <span>Question</span>
            {extractionStatusHint ? (
              <p className="extraction-status" aria-live="polite">
                {extractionStatusHint}
              </p>
            ) : null}
            {extractionAlert ? (
              <div
                className={`extraction-alert extraction-alert--${extractionAlert.tone}`}
                aria-live="polite"
              >
                <p>{extractionAlert.message}</p>
                {extractionAlert.notes ? <p className="extraction-alert-notes">{extractionAlert.notes}</p> : null}
              </div>
            ) : null}
            <textarea
              disabled={isBusy}
              rows={5}
              value={imagePrompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </label>

          <div className="image-preview-block" aria-live="polite">
            <div className="image-preview">
              {previewUrl ? (
                <img alt="Problem image preview" src={previewUrl} />
              ) : (
                <p>{emptyMessage}</p>
              )}
            </div>
            <p className="image-meta">{imageMeta}</p>
            {previewWarning ? <p className="preview-warning">{previewWarning}</p> : null}
          </div>
        </div>

        <div className="form-actions">
          {retryUploadVisible ? (
            <ActionButton
              disabled={isBusy}
              type="button"
              variant="secondary"
              onClick={() => {
                void onRetryUpload();
              }}
            >
              Retry upload
            </ActionButton>
          ) : null}

          <ActionButton
            disabled={reExtractDisabled}
            type="button"
            variant="secondary"
            onClick={() => {
              void onReExtract();
            }}
          >
            Re-extract
          </ActionButton>

          <ActionButton
            disabled={confirmDisabled}
            type="button"
            variant="secondary"
            onClick={onConfirmPrompt}
          >
            Confirm question
          </ActionButton>

          <ActionButton
            className="send-action later-step-action"
            disabled={sendDisabled}
            icon="send"
            type="submit"
            variant="secondary"
          >
            Ask about image
          </ActionButton>
        </div>
      </form>
    </Panel>
  );
}
