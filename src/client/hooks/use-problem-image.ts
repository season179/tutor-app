import { useCallback, useRef, useState } from "react";

import type { VoicePreparedImage, VoiceUserTurn } from "../../voice-types.js";
import {
  describePreparedImage,
  getImageByteLimit,
  imageJsonOverheadBytes,
  prepareImage,
  type PreparedImage
} from "../lib/image-preparation.js";
import type { StatusTone, TutorSessionState } from "../types.js";

type UseProblemImageOptions = {
  ensureSessionReadyForImage: () => Promise<TutorSessionState>;
  getPayloadLimitBytes: () => number | undefined;
  getSession: () => TutorSessionState | undefined;
  logEvent: (message: string, value?: unknown) => void;
  setStatus: (message: string, tone?: StatusTone) => void;
};

function createVoicePreparedImage(image: PreparedImage): VoicePreparedImage {
  return {
    dataUrl: image.dataUrl,
    height: image.height,
    mimeType: "image/jpeg",
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

export function useProblemImage({
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
  sendImage: () => Promise<void>;
} {
  const [preparedImage, setPreparedImage] = useState<PreparedImage | undefined>(undefined);
  const [selectedImageFile, setSelectedImageFile] = useState<File | undefined>(undefined);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [imageMeta, setImageMeta] = useState("No problem image yet.");
  const [emptyMessage, setEmptyMessage] = useState("No problem image yet.");
  const [imagePrompt, setImagePrompt] = useState("Help me understand this problem step by step.");

  const imagePreparationIdRef = useRef(0);

  const clearPreparedImage = useCallback((message = "No problem image yet.") => {
    setSelectedImageFile(undefined);
    setPreparedImage(undefined);
    setEmptyMessage("No problem image yet.");
    setImageMeta(message);
  }, []);

  const prepareSelectedImage = useCallback(
    async (file: File) => {
      const preparationId = ++imagePreparationIdRef.current;

      setSelectedImageFile(file);
      setPreparedImage(undefined);
      setIsPreparingImage(true);
      setEmptyMessage("Preparing problem image...");
      setImageMeta("Preparing problem image...");

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
            mime: "image/jpeg",
            width: image.width
          },
          source: {
            bytes: image.originalBytes,
            height: image.originalHeight,
            mime: image.originalType,
            width: image.originalWidth
          }
        });
      } catch (error) {
        if (preparationId !== imagePreparationIdRef.current) {
          return;
        }

        clearPreparedImage(error instanceof Error ? error.message : "Could not prepare the problem image.");
        logEvent("Problem image preparation failed", error instanceof Error ? error.message : error);
      } finally {
        if (preparationId === imagePreparationIdRef.current) {
          setIsPreparingImage(false);
        }
      }
    },
    [clearPreparedImage, getPayloadLimitBytes, logEvent]
  );

  const handleFileChange = useCallback(
    (file: File | undefined) => {
      if (!file) {
        clearPreparedImage();
        return;
      }

      prepareSelectedImage(file).catch((error: unknown) => {
        logEvent("Problem image preparation failed", error instanceof Error ? error.message : error);
      });
    },
    [clearPreparedImage, logEvent, prepareSelectedImage]
  );

  const getSendableImage = useCallback(
    async (defaultImagePrompt: string, prompt: string): Promise<PreparedImage> => {
      if (!preparedImage) {
        throw new Error("Choose an image first.");
      }

      const messageLimit = getPayloadLimitBytes();

      if (!messageLimit) {
        return preparedImage;
      }

      const payloadBytes = estimateVoiceUserTurnBytes(preparedImage, prompt);

      if (payloadBytes <= messageLimit) {
        return preparedImage;
      }

      if (!selectedImageFile) {
        throw new Error("The prepared image is too large for this WebRTC session.");
      }

      const targetBytes = Math.max(80_000, Math.floor((messageLimit - imageJsonOverheadBytes) * 0.72));
      const image = await prepareImage(selectedImageFile, targetBytes);
      const resizedBytes = estimateVoiceUserTurnBytes(image, prompt);

      if (resizedBytes > messageLimit) {
        throw new Error("The image is too large for this WebRTC session, even after resizing.");
      }

      setPreparedImage(image);
      setImageMeta(describePreparedImage(image));
      return image;
    },
    [getPayloadLimitBytes, preparedImage, selectedImageFile]
  );

  const sendImage = useCallback(async () => {
    if (!preparedImage) {
      throw new Error("Choose an image first.");
    }

    setIsPreparingImage(true);
    setImageMeta(
      getSession()?.adapter.status === "connected" ? "Checking image payload..." : "Starting tutoring..."
    );

    try {
      const activeSession = await ensureSessionReadyForImage();
      const defaultImagePrompt = activeSession.descriptor.tutorPolicy.defaultImagePrompt;
      const prompt = imagePrompt.trim() || defaultImagePrompt;
      setImageMeta("Checking image payload...");
      const image = await getSendableImage(defaultImagePrompt, prompt);

      activeSession.adapter.sendUserTurn(createVoiceUserTurn(image, prompt));
      activeSession.adapter.requestReply(activeSession.descriptor.tutorPolicy.imageResponseInstructions);

      setStatus("Problem image sent. Waiting for your tutor...", "working");
      setImageMeta(describePreparedImage(image));
      logEvent("Problem image sent", {
        bytes: image.size,
        height: image.height,
        prompt,
        width: image.width
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send the problem image.";
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
    preparedImage,
    setStatus
  ]);

  return {
    emptyMessage,
    handleFileChange,
    handlePromptChange: setImagePrompt,
    imageMeta,
    imagePrompt,
    isPreparingImage,
    preparedImage,
    sendDisabled: isPreparingImage || !preparedImage,
    sendImage
  };
}
