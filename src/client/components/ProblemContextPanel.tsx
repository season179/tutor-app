import { useEffect, useRef, useState } from "react";

import type { ExtractionAlert, ExtractionStatus } from "../lib/problem-context-extraction.js";
import type { UploadStatus } from "../hooks/use-problem-context-step1.js";

type ProblemContextPanelProps = {
  confirmDisabled: boolean;
  extractionAlert: ExtractionAlert | null;
  extractionStatus: ExtractionStatus;
  fileInputDisabled: boolean;
  imageMeta: string;
  imagePrompt: string;
  isBusy: boolean;
  onConfirmPrompt: () => void;
  onFileChange: (file: File | undefined, input?: HTMLInputElement | null) => void;
  onPromptChange: (value: string) => void;
  onReExtract: () => void | Promise<void>;
  onRetryUpload: () => void | Promise<void>;
  previewUrl: string | undefined;
  previewWarning: string | null;
  promptConfirmed: boolean;
  reExtractDisabled: boolean;
  retryUploadVisible: boolean;
  uploadStatus: UploadStatus;
};

/**
 * The problem pin at the top of the stream. One job: upload a photo → review and
 * edit the extracted question → confirm it. The question is the hero; the photo is
 * a small zoomable rail. Status copy is not repeated here — the header badge owns
 * the happy path, so only genuine warnings surface inline. Once confirmed, the pin
 * folds to a single line so the lesson owns the stream.
 */
export function ProblemContextPanel({
  confirmDisabled,
  extractionAlert,
  extractionStatus,
  fileInputDisabled,
  imageMeta,
  imagePrompt,
  isBusy,
  onConfirmPrompt,
  onFileChange,
  onPromptChange,
  onReExtract,
  onRetryUpload,
  previewUrl,
  previewWarning,
  promptConfirmed,
  reExtractDisabled,
  retryUploadVisible,
  uploadStatus
}: ProblemContextPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoomRef = useRef<HTMLDialogElement>(null);
  const dragDepthRef = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // A new image (previewUrl change) re-folds an expanded pin so the next problem
  // opens in review. Confirming does NOT collapse: once "Show problem" expands a
  // confirmed pin, it stays open until a new photo arrives. There is no plain
  // collapse affordance today; add one here if that becomes annoying.
  useEffect(() => {
    setExpanded(false);
  }, [previewUrl]);

  const isExtracting = extractionStatus === "extracting";
  const isUploading = uploadStatus === "uploading" || (isBusy && !previewUrl);
  const hasImage = Boolean(previewUrl) || uploadStatus === "uploaded";
  const showWarning = extractionAlert?.tone === "warning";

  const openFilePicker = () => fileInputRef.current?.click();
  const openZoom = () => zoomRef.current?.showModal();

  // Drag-and-drop onto the empty dropzone. dragenter/dragleave fire for every
  // child the pointer crosses, so a depth counter (not a bare boolean) keeps the
  // highlight steady instead of flickering over the icon and button.
  const handleDragEnter = (event: React.DragEvent) => {
    if (fileInputDisabled || !dragHasFile(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (fileInputDisabled || !dragHasFile(event.dataTransfer)) {
      return;
    }
    // Both preventDefault and dropEffect are required for the drop to fire.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    if (fileInputDisabled) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const file = firstImageFile(event.dataTransfer);
    if (file) {
      onFileChange(file);
    }
  };

  // Empty: no image yet, nothing in flight.
  if (!hasImage && !isUploading) {
    return (
      <section className="pin" aria-labelledby="problem-title">
        <h2 className="sr-only" id="problem-title">
          Problem
        </h2>
        <HiddenFileInput
          disabled={fileInputDisabled}
          inputRef={fileInputRef}
          onFileChange={onFileChange}
        />
        <div
          className={isDragging ? "dropzone dropzone--dragging" : "dropzone"}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className="dz-icon" aria-hidden="true">
            <CameraIcon />
          </span>
          <div className="dz-text">
            <h3>Add the problem</h3>
            <p>Snap, upload, or drag in a photo. Coach Echo reads the question so you can check it.</p>
          </div>
          <button
            className="pin-btn pin-btn--ghost dz-action"
            disabled={fileInputDisabled}
            onClick={openFilePicker}
            type="button"
          >
            <UploadIcon />
            Upload photo
          </button>
        </div>
      </section>
    );
  }

  // Confirmed: fold to a single line. The "Find: ___" goal lives in the target
  // chip just below, so we never truncate the problem body here.
  if (promptConfirmed && !expanded && !isExtracting) {
    return (
      <section className="pin pin--collapsed" aria-labelledby="problem-title">
        <h2 className="sr-only" id="problem-title">
          Problem
        </h2>
        <HiddenFileInput
          disabled={fileInputDisabled}
          inputRef={fileInputRef}
          onFileChange={onFileChange}
        />
        <div className="collapsed-row">
          <span className="chip chip--ok">
            <CheckIcon />
            Problem ready
          </span>
          <span className="collapsed-q">{imagePrompt}</span>
          {previewUrl ? <PhotoThumb onZoom={openZoom} small src={previewUrl} /> : null}
          <button className="expand-btn" onClick={() => setExpanded(true)} type="button">
            <ChevronDown />
            Show problem
          </button>
        </div>
        <ZoomDialog dialogRef={zoomRef} meta={imageMeta} src={previewUrl} />
      </section>
    );
  }

  // Review: photo rail + question hero + actions.
  return (
    <section className="pin pin--rail" aria-labelledby="problem-title">
      <h2 className="sr-only" id="problem-title">
        Problem
      </h2>
      <HiddenFileInput disabled={fileInputDisabled} inputRef={fileInputRef} onFileChange={onFileChange} />

      <div className="pin-head">
        <span className="pin-eyebrow">
          <ProblemGlyph />
          Problem
        </span>
        {showWarning ? (
          <span className="chip chip--warn">
            <WarnIcon />
            {warningLabel(extractionStatus)}
          </span>
        ) : null}
        <div className="pin-head-right">
          <button
            className="replace-btn"
            disabled={fileInputDisabled}
            onClick={openFilePicker}
            type="button"
          >
            <ReplaceIcon />
            Replace
          </button>
        </div>
      </div>

      <div className="pin-body">
        {previewUrl ? (
          <PhotoThumb onZoom={openZoom} src={previewUrl} />
        ) : (
          <div className="photo-rail photo-rail--loading" aria-hidden="true" />
        )}

        <div className="rail-main">
          {isExtracting || isUploading ? (
            <div className="skeleton-q" aria-live="polite" aria-label="Reading the question from your photo">
              <span className="sk" />
              <span className="sk" />
              <span className="sk" />
            </div>
          ) : (
            <>
              <label className="sr-only" htmlFor="problem-question">
                Extracted question
              </label>
              <textarea
                className="question"
                disabled={isBusy}
                id="problem-question"
                value={imagePrompt}
                onChange={(event) => onPromptChange(event.target.value)}
              />

              {showWarning && extractionAlert ? (
                <div className="note-line note-line--warn" aria-live="polite">
                  <WarnIcon />
                  <span>
                    <strong>{extractionAlert.message}</strong>
                    {extractionAlert.notes ? ` ${extractionAlert.notes}` : null}
                  </span>
                </div>
              ) : null}

              {previewWarning ? <p className="preview-warning">{previewWarning}</p> : null}

              <div className="pin-actions">
                {retryUploadVisible ? (
                  <button
                    className="pin-btn pin-btn--quiet"
                    disabled={isBusy}
                    onClick={() => void onRetryUpload()}
                    type="button"
                  >
                    <ReplaceIcon />
                    Retry upload
                  </button>
                ) : null}
                <button
                  className="pin-btn pin-btn--quiet"
                  disabled={reExtractDisabled}
                  onClick={() => void onReExtract()}
                  type="button"
                >
                  <ReExtractIcon />
                  Re-extract
                </button>
                <div className="pin-actions-spacer" />
                <button
                  className="pin-btn pin-btn--primary"
                  disabled={confirmDisabled}
                  onClick={onConfirmPrompt}
                  type="button"
                >
                  Confirm question
                  <ArrowRightIcon />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ZoomDialog dialogRef={zoomRef} meta={imageMeta} src={previewUrl} />
    </section>
  );
}

function warningLabel(status: ExtractionStatus): string {
  return status === "no_question" ? "No question" : "Partial";
}

// During a drag, the OS withholds the actual files for privacy, so we read the
// `items` list (kind/type only) to decide whether to highlight the dropzone.
function dragHasFile(transfer: DataTransfer): boolean {
  return Array.from(transfer.items).some((item) => item.kind === "file");
}

// On drop the files become readable. Take the first image, matching the hidden
// input's accept="image/*"; anything else (a dragged folder, a text snippet) is
// ignored rather than handed to the upload pipeline.
function firstImageFile(transfer: DataTransfer): File | undefined {
  return Array.from(transfer.files).find((file) => file.type.startsWith("image/"));
}

type HiddenFileInputProps = {
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (file: File | undefined, input?: HTMLInputElement | null) => void;
};

function HiddenFileInput({ disabled, inputRef, onFileChange }: HiddenFileInputProps) {
  return (
    <input
      accept="image/*"
      className="sr-only"
      disabled={disabled}
      ref={inputRef}
      tabIndex={-1}
      type="file"
      onChange={(event) => onFileChange(event.target.files?.item(0) ?? undefined, event.target)}
    />
  );
}

function PhotoThumb({ onZoom, small, src }: { onZoom: () => void; small?: boolean; src: string }) {
  return (
    <button
      className={small ? "photo-thumb photo-thumb--sm" : "photo-rail"}
      onClick={onZoom}
      type="button"
      aria-label="Zoom problem photo to full size"
    >
      <img alt="" className="photo" src={src} />
      <span className="zoombadge" aria-hidden="true">
        <ZoomIcon />
      </span>
    </button>
  );
}

function ZoomDialog({
  dialogRef,
  meta,
  src
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  meta: string;
  src: string | undefined;
}) {
  return (
    <dialog className="zoom" ref={dialogRef} aria-label="Problem photo, full size">
      {src ? <img alt="Problem photo" className="zoom-photo" src={src} /> : null}
      <div className="zoom-meta">
        <span>{meta}</span>
        <button className="zoom-close" onClick={() => dialogRef.current?.close()} type="button">
          Close
        </button>
      </div>
    </dialog>
  );
}

function ProblemGlyph() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 15l5-4 4 3 5-5 4 4" />
      <circle cx="9" cy="9" r="1.4" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function ReplaceIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function ReExtractIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4M11 8v6M8 11h6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" viewBox="0 0 24 24">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
