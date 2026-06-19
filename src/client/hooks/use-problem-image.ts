import { useCallback, useState } from "react";

import type { VoicePreparedImage, VoiceUserTurn } from "../../voice-types.js";
import { errorMessage } from "../lib/error-message.js";
import { getImageResizeByteLimit } from "../lib/image-byte-limit.js";
import { prepareImage, preparedImageMimeType, type PreparedImage } from "../lib/image-preparation.js";
import { updateSession } from "../lib/session-api.js";
import type { SessionImageMeta } from "../../session-types.js";
import type { StatusTone, TutorSessionState } from "../types.js";

const chooseImageFirstMessage = "Choose an image first.";

type UseProblemImageSendOptions = {
  activeSessionId: string | undefined;
  ensureSessionReadyForImage: () => Promise<TutorSessionState>;
  getPayloadLimitBytes: () => number | undefined;
  imagePrompt: string;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  objectKey: string | undefined;
  onPreparedImageChange?: (image: PreparedImage) => void;
  preparedImage: PreparedImage | undefined;
  selectedImageFile: File | undefined;
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

export function useProblemImageSend({
  activeSessionId,
  ensureSessionReadyForImage,
  getPayloadLimitBytes,
  imagePrompt,
  logEvent,
  objectKey,
  onPreparedImageChange,
  preparedImage,
  selectedImageFile,
  setStatus
}: UseProblemImageSendOptions): {
  isSendingImage: boolean;
  sendDisabled: boolean;
  sendImage: () => Promise<void>;
} {
  const [isSendingImage, setIsSendingImage] = useState(false);

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

      onPreparedImageChange?.(resizedImage);
      return resizedImage;
    },
    [getPayloadLimitBytes, onPreparedImageChange, selectedImageFile]
  );

  const sendImage = useCallback(async () => {
    if (!preparedImage) {
      throw new Error(chooseImageFirstMessage);
    }

    setIsSendingImage(true);

    try {
      const activeSession = await ensureSessionReadyForImage();
      const fallbackPrompt = activeSession.descriptor.tutorPolicy.defaultImagePrompt;
      const prompt = imagePrompt.trim() || fallbackPrompt;
      const image = await getSendableImage(preparedImage, prompt);

      activeSession.adapter.sendUserTurn(createVoiceUserTurn(image, prompt));

      if (activeSession.descriptor.provider === "openai-realtime") {
        activeSession.adapter.requestReply(activeSession.descriptor.tutorPolicy.imageResponseInstructions);
      }

      setStatus("Problem image sent. Waiting for Coach Echo...", "working");
      logEvent("Problem image sent", {
        bytes: image.size,
        height: image.height,
        objectKey,
        prompt,
        width: image.width
      });

      if (activeSessionId) {
        await updateSession(activeSessionId, {
          imageMeta: describeImageMeta(image),
          imageName: image.name,
          imageObjectKey: objectKey ?? null,
          imagePrompt: prompt
        });
      }
    } catch (error) {
      const message = errorMessage(error, "Could not send the problem image.");
      setStatus(message, "error");
      logEvent("Problem image send failed", message);
    } finally {
      setIsSendingImage(false);
    }
  }, [
    activeSessionId,
    ensureSessionReadyForImage,
    getSendableImage,
    imagePrompt,
    logEvent,
    objectKey,
    preparedImage,
    setStatus
  ]);

  return {
    isSendingImage,
    sendDisabled: isSendingImage || !preparedImage,
    sendImage
  };
}
