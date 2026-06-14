import type { FormEvent } from "react";

import type { PreparedImage } from "../lib/image-preparation.js";
import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type ProblemContextPanelProps = {
  emptyMessage: string;
  imageMeta: string;
  imagePrompt: string;
  isPreparingImage: boolean;
  onFileChange: (file: File | undefined) => void;
  onPromptChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  preparedImage: PreparedImage | undefined;
  sendDisabled: boolean;
};

export function ProblemContextPanel({
  emptyMessage,
  imageMeta,
  imagePrompt,
  isPreparingImage,
  onFileChange,
  onPromptChange,
  onSubmit,
  preparedImage,
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
      <form className="image-form" onSubmit={handleSubmit}>
        <div className="image-grid">
          <div className="field-stack">
            <label className="field">
              <span>Problem image</span>
              <input
                accept="image/*"
                disabled={isPreparingImage}
                type="file"
                onChange={(event) => onFileChange(event.target.files?.item(0) ?? undefined)}
              />
            </label>

            <label className="field question-field">
              <span>Question</span>
              <textarea
                disabled={isPreparingImage}
                rows={5}
                value={imagePrompt}
                onChange={(event) => onPromptChange(event.target.value)}
              />
            </label>
          </div>

          <div className="image-preview-block" aria-live="polite">
            <div className="image-preview">
              {preparedImage ? (
                <img alt={`Preview of ${preparedImage.name}`} src={preparedImage.dataUrl} />
              ) : (
                <p>{emptyMessage}</p>
              )}
            </div>
            <p className="image-meta">{imageMeta}</p>
          </div>
        </div>

        <div className="form-actions">
          <ActionButton
            className="send-action"
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
