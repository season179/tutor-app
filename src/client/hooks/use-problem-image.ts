import { useCallback, useRef, useState } from "react";

import type { SessionImageMeta } from "../../session-types.js";
import type { VoicePreparedImage, VoiceUserTurn } from "../../voice-types.js";
import { errorLogValue, errorMessage } from "../lib/error-message.js";
import { getImageByteLimit, getImageResizeByteLimit } from "../lib/image-byte-limit.js";
import {
  describePreparedImage,
  prepareImage,
  preparedImageMimeType,
  type PreparedImage
} from "../lib/image-preparation.js";
import { updateSession } from "../lib/session-api.js";
import type { LoadedSessionContext, StatusTone, TutorSessionState } from "../types.js";
import { defaultImagePrompt } from "../types.js";

const checkingImagePayloadMessage = "Checking image payload...";
const chooseImageFirstMessage = "Choose an image first.";
const noProblemImageMessage = "No problem image yet.";
const problemImagePreparationFailedEvent = "Problem image preparation failed";
const preparingProblemImageMessage = "Preparing problem image...";

type UseProblemImageOptions = {
  activeSessionId: string | undefined;
  ensureSessionReadyForImage: () => Promise<TutorSessionState>;
  getPayloadLimitBytes: () => number | undefined;
  getSession: () => TutorSessionState | undefined;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  setStatus: (message: string, tone?: StatusTone) => void;
};

function createVoicePreparedImage(image: PreparedImage): VoicePreparedImage {
  return {
    dataUrl: image.dataUrl,
    height: image.height,
    mimeType: preparedImageMimeType,
    name: image.name,
    size: image.size,
    width: image.width
  };
}

function createVoiceUserTurn(image: PreparedImage, prompt: string): VoiceUserTurn {
  return {
    image: createVoicePreparedImage(image),
    text: prompt
  };
}

function estimateVoiceUserTurnBytes(image: PreparedImage, prompt: string): number {
  return new TextEncoder().encode(JSON.stringify(createVoiceUserTurn(image, prompt))).byteLength;
}

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

export function useProblemImage({
  activeSessionId,
  ensureSessionReadyForImage,
  getPayloadLimitBytes,
  getSession,
  logEvent,
  setStatus
}: UseProblemImageOptions): {
  emptyMessage: string;
  imageMeta: string;
  imagePrompt: string;
  isPreparingImage: boolean;
  preparedImage: PreparedImage | undefined;
  sendDisabled: boolean;
  handleFileChange: (file: File | undefined) => void;
  handlePromptChange: (value: string) => void;
  loadSessionContext: (context: LoadedSessionContext) => void;
  resetProblemImage: () => void;
  sendImage: () => Promise<void>;
} {
  const [preparedImage, setPreparedImage] = useState<PreparedImage | undefined>(undefined);
  const [selectedImageFile, setSelectedImageFile] = useState<File | undefined>(undefined);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [imageMeta, setImageMeta] = useState(noProblemImageMessage);
  const [emptyMessage, setEmptyMessage] = useState(noProblemImageMessage);
  const [imagePrompt, setImagePrompt] = useState(defaultImagePrompt);

  const imagePreparationIdRef = useRef(0);
  const promptPersistTimeoutRef = useRef<number | undefined>(undefined);

  const clearPreparedImage = useCallback((message = noProblemImageMessage) => {
    setSelectedImageFile(undefined);
    setPreparedImage(undefined);
    setEmptyMessage(noProblemImageMessage);
    setImageMeta(message);
  }, []);

  const loadSessionContext = useCallback((context: LoadedSessionContext) => {
    imagePreparationIdRef.current += 1;
    setIsPreparingImage(false);
    setPreparedImage(undefined);
    setSelectedImageFile(undefined);
    setImagePrompt(context.imagePrompt || defaultImagePrompt);
    setEmptyMessage(context.imageMeta ? "Saved problem image metadata loaded." : noProblemImageMessage);
    setImageMeta(formatStoredImageMeta(context.imageMeta, context.imageName));
  }, []);

  const resetProblemImage = useCallback(() => {
    imagePreparationIdRef.current += 1;
    setIsPreparingImage(false);
    clearPreparedImage();
    setImagePrompt(defaultImagePrompt);
  }, [clearPreparedImage]);

  const persistImageContext = useCallback(
    async (image: PreparedImage | undefined, prompt: string) => {
      if (!activeSessionId) {
        return;
      }

      await updateSession(activeSessionId, {
        imageMeta: image ? describeImageMeta(image) : null,
        imageName: image?.name ?? null,
        imagePrompt: prompt
      });
    },
    [activeSessionId]
  );

  const prepareSelectedImage = useCallback(
    async (file: File) => {
      const preparationId = ++imagePreparationIdRef.current;

      setSelectedImageFile(file);
      setPreparedImage(undefined);
      setIsPreparingImage(true);
      setEmptyMessage(preparingProblemImageMessage);
      setImageMeta(preparingProblemImageMessage);

      try {
        const image = await prepareImage(file, getImageByteLimit(getPayloadLimitBytes()));

        if (preparationId !== imagePreparationIdRef.current) {
          return;
        }

        setPreparedImage(image);
        setImageMeta(describePreparedImage(image));
        logEvent("Problem image prepared", {
          prepared: {
            bytes: image.size,
            height: image.height,
            mime: preparedImageMimeType,
            width: image.width
          },
          source: {
            bytes: image.originalBytes,
            height: image.originalHeight,
            mime: image.originalType,
            width: image.originalWidth
          }
        });
        await persistImageContext(image, imagePrompt);
      } catch (error) {
        if (preparationId !== imagePreparationIdRef.current) {
          return;
        }

        clearPreparedImage(errorMessage(error, "Could not prepare the problem image."));
        logEvent(problemImagePreparationFailedEvent, errorLogValue(error));
      } finally {
        if (preparationId === imagePreparationIdRef.current) {
          setIsPreparingImage(false);
        }
      }
    },
    [clearPreparedImage, getPayloadLimitBytes, imagePrompt, logEvent, persistImageContext]
  );

  const handleFileChange = useCallback(
    (file: File | undefined) => {
      if (!file) {
        clearPreparedImage();
        void persistImageContext(undefined, imagePrompt);
        return;
      }

      prepareSelectedImage(file).catch((error: unknown) => {
        logEvent(problemImagePreparationFailedEvent, errorLogValue(error));
      });
    },
    [clearPreparedImage, imagePrompt, logEvent, persistImageContext, prepareSelectedImage]
  );

  const handlePromptChange = useCallback(
    (value: string) => {
      setImagePrompt(value);

      if (promptPersistTimeoutRef.current !== undefined) {
        window.clearTimeout(promptPersistTimeoutRef.current);
      }

      promptPersistTimeoutRef.current = window.setTimeout(() => {
        void persistImageContext(preparedImage, value);
      }, 400);
    },
    [persistImageContext, preparedImage]
  );

  const getSendableImage = useCallback(
    async (image: PreparedImage, prompt: string): Promise<PreparedImage> => {
      const messageLimit = getPayloadLimitBytes();

      if (!messageLimit) {
        return image;
      }

      const payloadBytes = estimateVoiceUserTurnBytes(image, prompt);

      if (payloadBytes <= messageLimit) {
        return image;
      }

      if (!selectedImageFile) {
        throw new Error("The prepared image is too large for this WebRTC session.");
      }

      const targetBytes = getImageResizeByteLimit(messageLimit);
      const resizedImage = await prepareImage(selectedImageFile, targetBytes);
      const resizedBytes = estimateVoiceUserTurnBytes(resizedImage, prompt);

      if (resizedBytes > messageLimit) {
        throw new Error("The image is too large for this WebRTC session, even after resizing.");
      }

      setPreparedImage(resizedImage);
      setImageMeta(describePreparedImage(resizedImage));
      return resizedImage;
    },
    [getPayloadLimitBytes, selectedImageFile]
  );

  const sendImage = useCallback(async () => {
    if (!preparedImage) {
      throw new Error(chooseImageFirstMessage);
    }

    setIsPreparingImage(true);
    setImageMeta(
      getSession()?.adapter.status === "connected" ? checkingImagePayloadMessage : "Starting tutoring..."
    );

    try {
      const activeSession = await ensureSessionReadyForImage();
      const fallbackPrompt = activeSession.descriptor.tutorPolicy.defaultImagePrompt;
      const prompt = imagePrompt.trim() || fallbackPrompt;
      setImageMeta(checkingImagePayloadMessage);
      const image = await getSendableImage(preparedImage, prompt);

      activeSession.adapter.sendUserTurn(createVoiceUserTurn(image, prompt));
      activeSession.adapter.requestReply(activeSession.descriptor.tutorPolicy.imageResponseInstructions);

      setStatus("Problem image sent. Waiting for your tutor...", "working");
      setImageMeta(describePreparedImage(image));
      await persistImageContext(image, prompt);
      logEvent("Problem image sent", {
        bytes: image.size,
        height: image.height,
        prompt,
        width: image.width
      });
    } catch (error) {
      const message = errorMessage(error, "Could not send the problem image.");
      setStatus(message, "error");
      setImageMeta(message);
      logEvent("Problem image send failed", message);
    } finally {
      setIsPreparingImage(false);
    }
  }, [
    ensureSessionReadyForImage,
    getSendableImage,
    getSession,
    imagePrompt,
    logEvent,
    persistImageContext,
    preparedImage,
    setStatus
  ]);

  return {
    emptyMessage,
    handleFileChange,
    handlePromptChange,
    imageMeta,
    imagePrompt,
    isPreparingImage,
    loadSessionContext,
    preparedImage,
    resetProblemImage,
    sendDisabled: isPreparingImage || !preparedImage,
    sendImage
  };
}
