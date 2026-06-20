import { useCallback, useRef, useState } from "react";

import type { ExtractionOutcome } from "../../modules/problems/problem-context-types.js";
import type { SessionImageMeta } from "../../modules/sessions/session-types.js";
import { maxProblemImageBytes } from "../../modules/problems/problem-context-types.js";
import { errorLogValue, errorMessage } from "../lib/error-message.js";
import {
  describePreparedImage,
  prepareImage,
  preparedImageMimeType,
  type PreparedImage
} from "../lib/image-preparation.js";
import {
  getExtractionAlert,
  legacyReadyExtractionAlert,
  mapOutcomeToExtractionStatus,
  resolvePromptConfirmedForSession,
  shouldPrefillExtractedQuestion,
  type ExtractionAlert,
  type ExtractionStatus
} from "../lib/problem-context-extraction.js";
import {
  extractProblemQuestion,
  requestProblemImagePreviewUrl,
  requestProblemImageUploadUrl,
  uploadProblemImageToR2
} from "../lib/problem-context-api.js";
import { updateSession } from "../lib/session-api.js";
import type { LoadedSessionContext, StatusTone } from "../types.js";

const noProblemImageMessage = "No problem image yet.";

export type UploadStatus = "failed" | "idle" | "uploaded" | "uploading";

type UseProblemContextStep1Options = {
  activeSessionId: string | undefined;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  sessionReady: boolean;
  setStatus: (message: string, tone?: StatusTone) => void;
};

function describeImageMeta(image: PreparedImage): SessionImageMeta {
  return {
    bytes: image.size,
    height: image.height,
    width: image.width
  };
}

function formatStoredImageMeta(meta: SessionImageMeta | null, name: string | null): string {
  if (!meta) {
    return noProblemImageMessage;
  }

  const label = name ? `${name} · ` : "";
  return `${label}${meta.width}×${meta.height} · ${meta.bytes.toLocaleString()} bytes`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Prepared image data URL was invalid.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const mimeType = metadata.split(";")[0] || preparedImageMimeType;
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function promptFromExtraction(outcome: ExtractionOutcome, question: string): string {
  return shouldPrefillExtractedQuestion(outcome) ? question : "";
}

function extractionReadyMessage(outcome: ExtractionOutcome): string {
  switch (outcome) {
    case "extracted":
      return "Question extracted. Review it before continuing.";
    case "partial":
    case "multiple_questions":
      return "Question partially extracted. Review it before continuing.";
    case "none":
      return "No question found. Enter it manually or try another image.";
    case "not_a_problem":
      return "This image doesn't look like a problem. Enter the question manually.";
    default:
      return "Review the question before continuing.";
  }
}

export function useProblemContextStep1({
  activeSessionId,
  logEvent,
  sessionReady,
  setStatus
}: UseProblemContextStep1Options) {
  const [preparedImage, setPreparedImage] = useState<PreparedImage | undefined>(undefined);
  const [selectedImageFile, setSelectedImageFile] = useState<File | undefined>(undefined);
  const [objectKey, setObjectKey] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState(noProblemImageMessage);
  const [emptyMessage, setEmptyMessage] = useState(noProblemImageMessage);
  const [imagePrompt, setImagePrompt] = useState("");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>("idle");
  const [extractionOutcome, setExtractionOutcome] = useState<ExtractionOutcome | null>(null);
  const [extractionNotes, setExtractionNotes] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [promptConfirmed, setPromptConfirmed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const workflowIdRef = useRef(0);
  const promptPersistTimeoutRef = useRef<number | undefined>(undefined);

  const persistContext = useCallback(
    async (
      image: PreparedImage | undefined,
      prompt: string,
      nextObjectKey: string | null | undefined,
      options: {
        extractionNotes?: string | null;
        extractionOutcome?: ExtractionOutcome | null;
        promptConfirmed?: boolean;
      } = {}
    ) => {
      if (!activeSessionId) {
        return;
      }

      await updateSession(activeSessionId, {
        ...(options.extractionNotes !== undefined ? { extractionNotes: options.extractionNotes } : {}),
        ...(options.extractionOutcome !== undefined ? { extractionOutcome: options.extractionOutcome } : {}),
        imageMeta: image ? describeImageMeta(image) : null,
        imageName: image?.name ?? null,
        imageObjectKey: nextObjectKey ?? null,
        imagePrompt: prompt || null,
        ...(options.promptConfirmed !== undefined ? { promptConfirmed: options.promptConfirmed } : {})
      });
    },
    [activeSessionId]
  );

  const resetStep1 = useCallback(() => {
    workflowIdRef.current += 1;
    setPreparedImage(undefined);
    setSelectedImageFile(undefined);
    setObjectKey(undefined);
    setPreviewUrl(undefined);
    setPreviewWarning(null);
    setImageMeta(noProblemImageMessage);
    setEmptyMessage(noProblemImageMessage);
    setImagePrompt("");
    setUploadStatus("idle");
    setExtractionStatus("idle");
    setExtractionOutcome(null);
    setExtractionNotes(null);
    setExtractionError(null);
    setPromptConfirmed(false);
    setIsBusy(false);
  }, []);

  const loadPreviewForObjectKey = useCallback(
    async (sessionId: string, nextObjectKey: string, workflowId: number) => {
      try {
        const preview = await requestProblemImagePreviewUrl(sessionId, nextObjectKey);

        if (workflowId !== workflowIdRef.current) {
          return;
        }

        setPreviewUrl(preview.url);
        setPreviewWarning(null);
      } catch (error) {
        if (workflowId !== workflowIdRef.current) {
          return;
        }

        setPreviewWarning("Saved preview unavailable.");
        logEvent("Problem image preview failed", errorLogValue(error));
      }
    },
    [logEvent]
  );

  const applyExtractionResult = useCallback(
    async (
      result: Awaited<ReturnType<typeof extractProblemQuestion>>,
      workflowId: number,
      image: PreparedImage | undefined,
      nextObjectKey: string
    ) => {
      if (workflowId !== workflowIdRef.current) {
        return;
      }

      const nextPrompt = promptFromExtraction(result.outcome, result.question);
      const nextStatus = mapOutcomeToExtractionStatus(result.outcome);

      setImagePrompt(nextPrompt);
      setExtractionOutcome(result.outcome);
      setExtractionNotes(result.notes);
      setExtractionStatus(nextStatus);
      setPromptConfirmed(false);
      setStatus(extractionReadyMessage(result.outcome), nextStatus === "ready" ? "ready" : "error");
      logEvent("Question extracted", {
        confidence: result.confidence,
        extractedText: result.frame.extractedText,
        notes: result.notes,
        objectKey: nextObjectKey,
        outcome: result.outcome,
        question: result.question,
        requiresConfirmation: result.requiresConfirmation
      });

      await persistContext(image, nextPrompt, nextObjectKey, {
        extractionNotes: result.notes,
        extractionOutcome: result.outcome,
        promptConfirmed: false
      });
    },
    [logEvent, persistContext, setStatus]
  );

  const runExtraction = useCallback(
    async (
      sessionId: string,
      nextObjectKey: string,
      workflowId: number,
      image: PreparedImage | undefined
    ) => {
      setExtractionStatus("extracting");
      // Mirror the center focus card so the header badge stops saying "ready"
      // while the vision model is still reading the photo. Completion/failure
      // handlers below overwrite this with the outcome status.
      setStatus("Reading the question from your photo…", "working");
      setExtractionError(null);
      setExtractionOutcome(null);
      setExtractionNotes(null);
      setPromptConfirmed(false);

      try {
        const result = await extractProblemQuestion(sessionId, nextObjectKey);
        await applyExtractionResult(result, workflowId, image, nextObjectKey);
      } catch (error) {
        if (workflowId !== workflowIdRef.current) {
          return;
        }

        const message = errorMessage(error, "Could not extract the question.");
        setExtractionStatus("failed");
        setExtractionError(message);
        setStatus(message, "error");
        logEvent("Question extraction failed", errorLogValue(error));
      }
    },
    [applyExtractionResult, logEvent, setStatus]
  );

  const uploadPreparedImage = useCallback(
    async (
      sessionId: string,
      image: PreparedImage,
      workflowId: number,
      file: File
    ): Promise<string> => {
      setUploadStatus("uploading");
      setExtractionStatus("idle");
      setExtractionError(null);
      setImageMeta("Uploading problem image...");
      setEmptyMessage("Uploading problem image...");

      let upload;
      try {
        upload = await requestProblemImageUploadUrl(sessionId, preparedImageMimeType, image.size);
      } catch (error) {
        logEvent("Problem image upload URL failed", errorLogValue(error));
        throw error;
      }

      if (workflowId !== workflowIdRef.current) {
        throw new Error("Upload cancelled.");
      }

      try {
        await uploadProblemImageToR2(
          upload.uploadUrl,
          dataUrlToBlob(image.dataUrl),
          preparedImageMimeType
        );
      } catch (error) {
        logEvent("Problem image R2 upload failed", errorLogValue(error));
        throw error;
      }

      if (workflowId !== workflowIdRef.current) {
        throw new Error("Upload cancelled.");
      }

      setObjectKey(upload.objectKey);
      setUploadStatus("uploaded");
      setImageMeta(describePreparedImage(image));
      setPreviewUrl(image.dataUrl);
      setPreviewWarning(null);
      logEvent("Problem image uploaded", {
        bytes: image.size,
        height: image.height,
        name: file.name,
        objectKey: upload.objectKey,
        width: image.width
      });

      return upload.objectKey;
    },
    [logEvent]
  );

  const uploadAndExtract = useCallback(
    async (file: File) => {
      if (!activeSessionId) {
        const message = "Choose or create a session first.";
        setStatus(message, "error");
        throw new Error(message);
      }

      if (!sessionReady) {
        const message = "Wait for the session to finish loading.";
        setStatus(message, "error");
        throw new Error(message);
      }

      const workflowId = ++workflowIdRef.current;
      setIsBusy(true);
      setUploadStatus("uploading");
      setExtractionStatus("idle");
      setExtractionError(null);
      setExtractionOutcome(null);
      setExtractionNotes(null);
      setPromptConfirmed(false);
      setPreviewWarning(null);
      setEmptyMessage("Preparing problem image...");
      setImageMeta("Preparing problem image...");
      setPreviewUrl(undefined);
      setPreparedImage(undefined);
      setSelectedImageFile(undefined);
      setObjectKey(undefined);
      setImagePrompt("");

      try {
        if (file.size === 0) {
          throw new Error("The selected file is empty.");
        }

        setSelectedImageFile(file);
        const image = await prepareImage(file, maxProblemImageBytes);

        if (workflowId !== workflowIdRef.current) {
          return;
        }

        setPreparedImage(image);
        const nextObjectKey = await uploadPreparedImage(activeSessionId, image, workflowId, file);
        await persistContext(image, "", nextObjectKey, {
          extractionNotes: null,
          extractionOutcome: null,
          promptConfirmed: false
        });
        await runExtraction(activeSessionId, nextObjectKey, workflowId, image);
        await loadPreviewForObjectKey(activeSessionId, nextObjectKey, workflowId);
      } catch (error) {
        if (workflowId !== workflowIdRef.current) {
          return;
        }

        const message = errorMessage(error, "Could not upload the problem image.");
        setUploadStatus("failed");
        setExtractionStatus("idle");
        setExtractionError(null);
        setEmptyMessage(message);
        setImageMeta(message);
        setStatus(message, "error");
        logEvent("Problem image upload failed", errorLogValue(error));
      } finally {
        if (workflowId === workflowIdRef.current) {
          setIsBusy(false);
        }
      }
    },
    [
      activeSessionId,
      loadPreviewForObjectKey,
      logEvent,
      persistContext,
      runExtraction,
      sessionReady,
      setStatus,
      uploadPreparedImage
    ]
  );

  const retryUpload = useCallback(async () => {
    if (!activeSessionId || !preparedImage || !selectedImageFile) {
      throw new Error("Choose a problem image first.");
    }

    const workflowId = ++workflowIdRef.current;
    setIsBusy(true);

    try {
      const nextObjectKey = await uploadPreparedImage(
        activeSessionId,
        preparedImage,
        workflowId,
        selectedImageFile
      );
      await persistContext(preparedImage, imagePrompt, nextObjectKey, {
        extractionNotes: extractionNotes,
        extractionOutcome: extractionOutcome,
        promptConfirmed
      });
      await runExtraction(activeSessionId, nextObjectKey, workflowId, preparedImage);
      await loadPreviewForObjectKey(activeSessionId, nextObjectKey, workflowId);
    } catch (error) {
      if (workflowId !== workflowIdRef.current) {
        return;
      }

      const message = errorMessage(error, "Could not upload the problem image.");
      setUploadStatus("failed");
      setExtractionStatus("idle");
      setEmptyMessage(message);
      setImageMeta(message);
      setStatus(message, "error");
      logEvent("Problem image upload retry failed", errorLogValue(error));
    } finally {
      if (workflowId === workflowIdRef.current) {
        setIsBusy(false);
      }
    }
  }, [
    activeSessionId,
    extractionNotes,
    extractionOutcome,
    imagePrompt,
    loadPreviewForObjectKey,
    logEvent,
    persistContext,
    preparedImage,
    promptConfirmed,
    runExtraction,
    selectedImageFile,
    setStatus,
    uploadPreparedImage
  ]);

  const handleFileChange = useCallback(
    (file: File | undefined, input?: HTMLInputElement | null) => {
      if (input) {
        input.value = "";
      }

      if (!file) {
        resetStep1();
        void persistContext(undefined, "", null, {
          extractionNotes: null,
          extractionOutcome: null,
          promptConfirmed: false
        });
        return;
      }

      uploadAndExtract(file).catch((error: unknown) => {
        logEvent("Problem image workflow failed", errorLogValue(error));
      });
    },
    [logEvent, persistContext, resetStep1, uploadAndExtract]
  );

  const handlePromptChange = useCallback(
    (value: string) => {
      setImagePrompt(value);

      // Confirmation is the explicit "Confirm question" button's job. Editing the
      // text must not confirm it: the old behavior auto-confirmed any change, which
      // in the folded pin collapses the card on the first keystroke. Any edit leaves
      // the question unconfirmed, so the Confirm button stays available to re-confirm.
      setPromptConfirmed(false);

      if (promptPersistTimeoutRef.current !== undefined) {
        window.clearTimeout(promptPersistTimeoutRef.current);
      }

      promptPersistTimeoutRef.current = window.setTimeout(() => {
        void persistContext(preparedImage, value, objectKey ?? null, {
          extractionNotes,
          extractionOutcome,
          promptConfirmed: false
        });
      }, 400);
    },
    [extractionNotes, extractionOutcome, objectKey, persistContext, preparedImage]
  );

  const confirmPrompt = useCallback(() => {
    const trimmed = imagePrompt.trim();
    if (!trimmed) {
      return;
    }

    setPromptConfirmed(true);
    void persistContext(preparedImage, trimmed, objectKey ?? null, {
      extractionNotes,
      extractionOutcome,
      promptConfirmed: true
    });
    setStatus("Question confirmed. Start when you're ready.", "ready");
  }, [
    extractionNotes,
    extractionOutcome,
    imagePrompt,
    objectKey,
    persistContext,
    preparedImage,
    setStatus
  ]);

  const reExtractQuestion = useCallback(async () => {
    if (!activeSessionId || !objectKey) {
      throw new Error("Upload a problem image first.");
    }

    const workflowId = ++workflowIdRef.current;
    setIsBusy(true);

    try {
      await runExtraction(activeSessionId, objectKey, workflowId, preparedImage);
    } finally {
      if (workflowId === workflowIdRef.current) {
        setIsBusy(false);
      }
    }
  }, [activeSessionId, objectKey, preparedImage, runExtraction]);

  const loadSessionContext = useCallback(
    (context: LoadedSessionContext) => {
      workflowIdRef.current += 1;
      setPreparedImage(undefined);
      setSelectedImageFile(undefined);
      setObjectKey(context.imageObjectKey ?? undefined);
      setPreviewUrl(undefined);
      setPreviewWarning(null);
      setImagePrompt(context.imagePrompt ?? "");
      setExtractionOutcome(context.extractionOutcome);
      setExtractionNotes(context.extractionNotes);
      const hydratedPromptConfirmed = resolvePromptConfirmedForSession(context);
      setPromptConfirmed(hydratedPromptConfirmed);
      setUploadStatus(context.imageObjectKey ? "uploaded" : "idle");
      setExtractionError(null);
      setIsBusy(false);
      setEmptyMessage(context.imageMeta ? "Saved problem image loaded." : noProblemImageMessage);
      setImageMeta(formatStoredImageMeta(context.imageMeta, context.imageName));

      if (context.extractionOutcome) {
        setExtractionStatus(mapOutcomeToExtractionStatus(context.extractionOutcome));
      } else if (context.imagePrompt && context.imageObjectKey) {
        setExtractionStatus("ready");
      } else {
        setExtractionStatus("idle");
      }

      if (activeSessionId && context.imageObjectKey) {
        const workflowId = workflowIdRef.current;
        void loadPreviewForObjectKey(activeSessionId, context.imageObjectKey, workflowId);
      }
    },
    [activeSessionId, loadPreviewForObjectKey]
  );

  const extractionAlert: ExtractionAlert | null =
    extractionStatus === "ready" ||
    extractionStatus === "needs_review" ||
    extractionStatus === "no_question"
      ? extractionOutcome
        ? getExtractionAlert(extractionOutcome, extractionNotes)
        : extractionStatus === "ready"
          ? legacyReadyExtractionAlert()
          : null
      : null;

  return {
    confirmPrompt,
    extractionAlert,
    extractionNotes,
    extractionOutcome,
    extractionStatus,
    handleFileChange,
    handlePromptChange,
    imageMeta,
    imagePrompt,
    isBusy,
    isExtractingQuestion: extractionStatus === "extracting",
    loadSessionContext,
    objectKey,
    preparedImage,
    previewUrl,
    previewWarning,
    promptConfirmed,
    reExtractQuestion,
    resetStep1,
    retryUpload,
    uploadStatus
  };
}
