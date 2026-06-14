import {
  createVoiceClientAdapter,
  type VoiceClientAdapter,
  type VoiceClientEvent
} from "./voice-client-adapter.js";
import { tutorPolicy } from "./tutor-policy.js";
import {
  voiceSessionPath,
  type CreateVoiceSessionRequest,
  type VoicePreparedImage,
  type VoiceSessionDescriptor,
  type VoiceUserTurn
} from "./voice-types.js";

type TutorSessionState = {
  adapter: VoiceClientAdapter;
  descriptor: VoiceSessionDescriptor;
  mediaStream: MediaStream;
  unsubscribe: () => void;
};

type StatusTone = "ready" | "working" | "connected" | "error";

type StartSessionOptions = {
  greet?: boolean;
};

type PreparedImage = {
  dataUrl: string;
  height: number;
  name: string;
  originalBytes: number;
  originalHeight: number;
  originalType: string;
  originalWidth: number;
  quality: number;
  size: number;
  width: number;
};

type DecodedImage = {
  close: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
};

const startButton = getElement<HTMLButtonElement>("start");
const stopButton = getElement<HTMLButtonElement>("stop");
const statusText = getElement<HTMLElement>("status");
const eventLog = getElement<HTMLPreElement>("event-log");
const remoteAudio = getElement<HTMLAudioElement>("remote-audio");
const imageForm = getElement<HTMLFormElement>("image-form");
const imageEmpty = getElement<HTMLElement>("image-empty");
const imageInput = getElement<HTMLInputElement>("image-input");
const imageMeta = getElement<HTMLElement>("image-meta");
const imagePreview = getElement<HTMLImageElement>("image-preview");
const imagePrompt = getElement<HTMLTextAreaElement>("image-prompt");
const sendImageButton = getElement<HTMLButtonElement>("send-image");

let session: TutorSessionState | undefined;
let startSessionPromise: Promise<TutorSessionState> | undefined;
let hasLoggedEvents = false;
let imagePreparationId = 0;
let isPreparingImage = false;
let isStoppingSession = false;
let preparedImage: PreparedImage | undefined;
let selectedImageFile: File | undefined;

const defaultImageByteLimit = 1_500_000;
const imageJsonOverheadBytes = 4_096;
const maxImageDimension = 2048;
const minImageLargestSide = 256;
const initialJpegQuality = 0.88;
const minJpegQuality = 0.62;
const jpegQualityStep = 0.08;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as T;
}

function setStatus(message: string, tone: StatusTone = "ready"): void {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

function logEvent(message: string, value?: unknown): void {
  const time = new Date().toLocaleTimeString();
  const renderedValue = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  const previousLog = hasLoggedEvents ? eventLog.textContent : "";

  hasLoggedEvents = true;
  eventLog.textContent = `[${time}] ${message}${renderedValue}\n${previousLog}`;
}

function setRunning(isRunning: boolean): void {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  updateImageControls();
}

async function fetchVoiceSessionDescriptor(): Promise<VoiceSessionDescriptor> {
  const request: CreateVoiceSessionRequest = { intent: "tutor" };
  const response = await fetch(voiceSessionPath, {
    body: JSON.stringify(request),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const payload = (await response.json().catch(() => null)) as (VoiceSessionDescriptor & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Failed to create voice session (${response.status}).`);
  }

  if (!payload) {
    throw new Error("Voice session response was not valid JSON.");
  }

  return parseVoiceSessionDescriptor(payload);
}

function parseVoiceSessionDescriptor(value: unknown): VoiceSessionDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Voice session response was not a JSON object.");
  }

  const descriptor = value as Record<string, unknown>;

  if (descriptor.provider === "openai-realtime" && isOpenAIRealtimeSessionDescriptor(descriptor)) {
    return descriptor;
  }

  if (descriptor.provider === "livekit-agents" && isLiveKitAgentsSessionDescriptor(descriptor)) {
    return descriptor;
  }

  throw new Error("Voice session response did not match a supported provider shape.");
}

function isOpenAIRealtimeSessionDescriptor(
  descriptor: Record<string, unknown>
): descriptor is Extract<VoiceSessionDescriptor, { provider: "openai-realtime" }> {
  return (
    typeof descriptor.clientSecret === "string" &&
    isVoiceCapabilities(descriptor.capabilities) &&
    typeof descriptor.model === "string" &&
    typeof descriptor.sessionId === "string" &&
    isTutorPolicy(descriptor.tutorPolicy) &&
    typeof descriptor.voice === "string"
  );
}

function isLiveKitAgentsSessionDescriptor(
  descriptor: Record<string, unknown>
): descriptor is Extract<VoiceSessionDescriptor, { provider: "livekit-agents" }> {
  return (
    typeof descriptor.agentName === "string" &&
    isVoiceCapabilities(descriptor.capabilities) &&
    typeof descriptor.livekitUrl === "string" &&
    typeof descriptor.participantIdentity === "string" &&
    typeof descriptor.participantToken === "string" &&
    typeof descriptor.roomName === "string" &&
    typeof descriptor.sessionId === "string" &&
    isTutorPolicy(descriptor.tutorPolicy)
  );
}

function isVoiceCapabilities(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const capabilities = value as Record<string, unknown>;

  return (
    typeof capabilities.audioInput === "boolean" &&
    typeof capabilities.audioOutput === "boolean" &&
    typeof capabilities.imageInput === "boolean" &&
    typeof capabilities.manualReply === "boolean" &&
    (typeof capabilities.payloadLimitBytes === "number" || capabilities.payloadLimitBytes === null)
  );
}

function isTutorPolicy(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const policy = value as Record<string, unknown>;

  return (
    typeof policy.agentName === "string" &&
    typeof policy.defaultImagePrompt === "string" &&
    typeof policy.greetingInstructions === "string" &&
    typeof policy.imageResponseInstructions === "string" &&
    typeof policy.instructions === "string"
  );
}

async function startSession(options: StartSessionOptions = {}): Promise<TutorSessionState> {
  if (session?.adapter.status === "disconnected") {
    cleanupSessionResources(session);
    session = undefined;
    setRunning(false);
  }

  if (session) {
    return session;
  }

  if (startSessionPromise) {
    return startSessionPromise;
  }

  startSessionPromise = createSession(options.greet ?? true);

  try {
    return await startSessionPromise;
  } finally {
    startSessionPromise = undefined;
  }
}

async function createSession(greetOnOpen: boolean): Promise<TutorSessionState> {
  setRunning(true);
  setStatus("Requesting tutor session...", "working");

  let pendingSession: TutorSessionState | undefined;

  try {
    const descriptor = await fetchVoiceSessionDescriptor();
    setStatus("Requesting microphone access...", "working");
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const adapter = createVoiceClientAdapter(descriptor.provider, {
      audioElement: remoteAudio,
      mediaStream
    });

    pendingSession = {
      adapter,
      descriptor,
      mediaStream,
      unsubscribe: () => undefined
    };
    session = pendingSession;
    pendingSession.unsubscribe = wireSessionEvents(pendingSession);

    setStatus("Connecting...", "working");
    await adapter.connect(descriptor);
    setStatus("Connected. Ask your tutor out loud.", "connected");
    updateImageControls();
    logEvent("Voice session connected", describeVoiceSession(descriptor));

    if (greetOnOpen) {
      adapter.requestReply(descriptor.tutorPolicy.greetingInstructions);
    }

    return pendingSession;
  } catch (error) {
    cleanupSession(pendingSession);
    session = undefined;
    setRunning(false);
    setStatus(error instanceof Error ? error.message : "Failed to start session.", "error");
    logEvent("Start failed", error instanceof Error ? error.message : error);
    throw error;
  }
}

function describeVoiceSession(descriptor: VoiceSessionDescriptor): Record<string, string> {
  if (descriptor.provider === "openai-realtime") {
    return {
      model: descriptor.model,
      provider: descriptor.provider,
      voice: descriptor.voice
    };
  }

  return {
    agentName: descriptor.agentName,
    provider: descriptor.provider,
    roomName: descriptor.roomName
  };
}

function wireSessionEvents(activeSession: TutorSessionState): () => void {
  return activeSession.adapter.onEvent((event: VoiceClientEvent) => {
    if (event.type === "debug_event") {
      logEvent(event.label, event.value);
      return;
    }

    if (event.type === "connecting") {
      setStatus("Connecting...", "working");
      return;
    }

    if (event.type === "connected") {
      updateImageControls();
      return;
    }

    if (event.type === "disconnected") {
      updateImageControls();

      if (session !== activeSession) {
        return;
      }

      cleanupSessionResources(activeSession);
      session = undefined;
      setRunning(false);

      if (!isStoppingSession) {
        setStatus("Session disconnected.", "ready");
      }

      return;
    }

    if (event.type === "reply_started") {
      setStatus("Tutor is responding...", "connected");
      return;
    }

    if (event.type === "reply_finished") {
      if (session === activeSession) {
        setStatus("Connected. Ask your tutor out loud.", "connected");
      }
      return;
    }

    const error = event.error;
    setStatus(error instanceof Error ? error.message : "Voice session error.", "error");
    logEvent("Voice session error", error instanceof Error ? error.message : error);
  });
}

function cleanupSessionResources(activeSession: TutorSessionState | undefined): void {
  if (!activeSession) {
    return;
  }

  activeSession.mediaStream.getTracks().forEach((track) => track.stop());
  remoteAudio.srcObject = null;
}

function cleanupSession(activeSession: TutorSessionState | undefined): void {
  if (!activeSession) {
    return;
  }

  activeSession.unsubscribe();
  activeSession.adapter.disconnect();
  cleanupSessionResources(activeSession);
}

function stopSession(): void {
  if (!session) {
    setRunning(false);
    return;
  }

  const activeSession = session;

  isStoppingSession = true;
  try {
    cleanupSession(activeSession);
    if (session === activeSession) {
      session = undefined;
    }

    setRunning(false);
    setStatus("Ready when you are.");
  } finally {
    isStoppingSession = false;
  }
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function updateImageControls(): void {
  imageInput.disabled = isPreparingImage;
  imagePrompt.disabled = isPreparingImage;
  sendImageButton.disabled = isPreparingImage || !preparedImage;
}

function clearPreparedImage(message = "No problem image yet."): void {
  selectedImageFile = undefined;
  preparedImage = undefined;
  imageEmpty.hidden = false;
  imageEmpty.textContent = "No problem image yet.";
  imagePreview.hidden = true;
  imagePreview.removeAttribute("src");
  imageMeta.textContent = message;
  updateImageControls();
}

function getVoiceMessageLimit(): number | undefined {
  return session?.adapter.getPayloadLimitBytes();
}

function getImageByteLimit(): number {
  const realtimeMessageLimit = getVoiceMessageLimit();

  if (!realtimeMessageLimit) {
    return defaultImageByteLimit;
  }

  const imageBudget = Math.floor((realtimeMessageLimit - imageJsonOverheadBytes) * 0.72);

  if (imageBudget <= 0) {
    return defaultImageByteLimit;
  }

  return Math.max(80_000, Math.min(defaultImageByteLimit, imageBudget));
}

function fitWithin(width: number, height: number, maxDimension: number): { height: number; width: number } {
  const largestSide = Math.max(width, height);

  if (largestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / largestSide;

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale))
  };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a problem image file.");
  }

  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width
      };
    } catch {
      // Fall back to an HTMLImageElement because browser support varies by format.
    }
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";
    const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error("The selected image could not be decoded.")), {
        once: true
      });
      image.src = objectUrl;
    });

    return {
      close: () => URL.revokeObjectURL(objectUrl),
      height: loadedImage.naturalHeight,
      source: loadedImage,
      width: loadedImage.naturalWidth
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function renderJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser could not prepare the image.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("This browser could not encode the image."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("This browser could not read the prepared image."));
        return;
      }

      resolve(reader.result);
    });
    reader.addEventListener("error", () => reject(new Error("This browser could not read the prepared image.")));
    reader.readAsDataURL(blob);
  });
}

async function encodeJpegWithinBudget(
  decoded: DecodedImage,
  targetBytes: number
): Promise<{ blob: Blob; height: number; quality: number; width: number }> {
  let { width, height } = fitWithin(decoded.width, decoded.height, maxImageDimension);
  let quality = initialJpegQuality;
  let blob = await renderJpeg(decoded.source, width, height, quality);

  while (blob.size > targetBytes && quality > minJpegQuality) {
    quality = Math.max(minJpegQuality, quality - jpegQualityStep);
    blob = await renderJpeg(decoded.source, width, height, quality);
  }

  while (blob.size > targetBytes && Math.max(width, height) > minImageLargestSide) {
    const scale = Math.max(0.5, Math.sqrt(targetBytes / blob.size) * 0.94);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    quality = initialJpegQuality;
    blob = await renderJpeg(decoded.source, width, height, quality);

    while (blob.size > targetBytes && quality > minJpegQuality) {
      quality = Math.max(minJpegQuality, quality - jpegQualityStep);
      blob = await renderJpeg(decoded.source, width, height, quality);
    }
  }

  if (blob.size > targetBytes) {
    throw new Error(`The image is still too large after resizing (${formatBytes(blob.size)}).`);
  }

  return { blob, height, quality, width };
}

async function prepareImage(file: File, targetBytes = getImageByteLimit()): Promise<PreparedImage> {
  const decoded = await decodeImage(file);

  try {
    if (decoded.width < 1 || decoded.height < 1) {
      throw new Error("The selected image has invalid dimensions.");
    }

    const encoded = await encodeJpegWithinBudget(decoded, targetBytes);

    return {
      dataUrl: await blobToDataUrl(encoded.blob),
      height: encoded.height,
      name: file.name,
      originalBytes: file.size,
      originalHeight: decoded.height,
      originalType: file.type || "unknown",
      originalWidth: decoded.width,
      quality: encoded.quality,
      size: encoded.blob.size,
      width: encoded.width
    };
  } finally {
    decoded.close();
  }
}

function describePreparedImage(image: PreparedImage): string {
  const converted = image.originalType === "image/jpeg" && image.originalWidth === image.width && image.originalHeight === image.height
    ? "JPEG"
    : "normalized JPEG";

  return `${image.name}: ${image.width}x${image.height}, ${formatBytes(image.size)} ${converted}`;
}

async function prepareSelectedImage(file: File): Promise<void> {
  const preparationId = ++imagePreparationId;

  selectedImageFile = file;
  preparedImage = undefined;
  isPreparingImage = true;
  imageEmpty.hidden = false;
  imageEmpty.textContent = "Preparing problem image...";
  imagePreview.hidden = true;
  imagePreview.removeAttribute("src");
  imageMeta.textContent = "Preparing problem image...";
  updateImageControls();

  try {
    const image = await prepareImage(file);

    if (preparationId !== imagePreparationId) {
      return;
    }

    preparedImage = image;
    imagePreview.src = image.dataUrl;
    imagePreview.hidden = false;
    imageEmpty.hidden = true;
    imageMeta.textContent = describePreparedImage(image);
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
    if (preparationId !== imagePreparationId) {
      return;
    }

    clearPreparedImage(error instanceof Error ? error.message : "Could not prepare the problem image.");
    logEvent("Problem image preparation failed", error instanceof Error ? error.message : error);
  } finally {
    if (preparationId === imagePreparationId) {
      isPreparingImage = false;
      updateImageControls();
    }
  }
}

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

async function getSendableImage(): Promise<PreparedImage> {
  if (!preparedImage) {
    throw new Error("Choose an image first.");
  }

  const messageLimit = getVoiceMessageLimit();

  if (!messageLimit) {
    return preparedImage;
  }

  const prompt = imagePrompt.value.trim() || tutorPolicy.defaultImagePrompt;
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

  preparedImage = image;
  imagePreview.src = image.dataUrl;
  imagePreview.hidden = false;
  imageEmpty.hidden = true;
  imageMeta.textContent = describePreparedImage(image);
  return image;
}

async function ensureSessionReadyForImage(): Promise<TutorSessionState> {
  const activeSession = session;

  if (activeSession?.adapter.status === "connected") {
    return activeSession;
  }

  if (startSessionPromise) {
    setStatus("Connecting before sharing the problem image...", "working");
    return startSessionPromise;
  }

  if (activeSession) {
    cleanupSession(activeSession);
    session = undefined;
  }

  setStatus("Starting tutoring before sharing the problem image...", "working");
  return startSession({ greet: false });
}

async function sendImage(): Promise<void> {
  if (!preparedImage) {
    throw new Error("Choose an image first.");
  }

  const prompt = imagePrompt.value.trim() || tutorPolicy.defaultImagePrompt;

  isPreparingImage = true;
  imageMeta.textContent =
    session?.adapter.status === "connected" ? "Checking image payload..." : "Starting tutoring...";
  updateImageControls();

  try {
    const activeSession = await ensureSessionReadyForImage();
    imageMeta.textContent = "Checking image payload...";
    const image = await getSendableImage();

    activeSession.adapter.sendUserTurn(createVoiceUserTurn(image, prompt));
    activeSession.adapter.requestReply(activeSession.descriptor.tutorPolicy.imageResponseInstructions);

    setStatus("Problem image sent. Waiting for your tutor...", "working");
    imageMeta.textContent = describePreparedImage(image);
    logEvent("Problem image sent", {
      bytes: image.size,
      height: image.height,
      prompt,
      width: image.width
    });
  } finally {
    isPreparingImage = false;
    updateImageControls();
  }
}

startButton.addEventListener("click", () => {
  startSession().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "Unexpected error.", "error");
  });
});

stopButton.addEventListener("click", stopSession);

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.item(0);

  if (!file) {
    clearPreparedImage();
    return;
  }

  prepareSelectedImage(file).catch((error: unknown) => {
    logEvent("Problem image preparation failed", error instanceof Error ? error.message : error);
  });
});

imageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  sendImage().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not send the problem image.";
    setStatus(message, "error");
    imageMeta.textContent = message;
    logEvent("Problem image send failed", error instanceof Error ? error.message : error);
  });
});
