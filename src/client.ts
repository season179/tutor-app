type ClientSecretResponse = {
  value?: string;
  client_secret?: {
    value?: string;
  };
};

type SessionState = {
  dataChannel: RTCDataChannel;
  localStream: MediaStream;
  peerConnection: RTCPeerConnection;
  ready: Promise<void>;
};

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

let session: SessionState | undefined;
let startSessionPromise: Promise<SessionState> | undefined;
let hasLoggedEvents = false;
let imagePreparationId = 0;
let isPreparingImage = false;
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

function setStatus(message: string): void {
  statusText.textContent = message;
}

function logEvent(message: string, value?: unknown): void {
  const time = new Date().toLocaleTimeString();
  const renderedValue = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  const previousLog = hasLoggedEvents ? eventLog.textContent : "";

  hasLoggedEvents = true;
  eventLog.textContent = `[${time}] ${message}${renderedValue}\n${previousLog}`;
}

function readClientSecret(payload: ClientSecretResponse): string {
  const secret = payload.value ?? payload.client_secret?.value;

  if (!secret) {
    throw new Error("Token response did not include a client secret value.");
  }

  return secret;
}

function setRunning(isRunning: boolean): void {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  updateImageControls();
}

async function fetchClientSecret(): Promise<string> {
  const response = await fetch("/token", { method: "POST" });
  const payload = (await response.json().catch(() => null)) as (ClientSecretResponse & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Failed to fetch Realtime client secret (${response.status}).`);
  }

  if (!payload) {
    throw new Error("Token response was not valid JSON.");
  }

  return readClientSecret(payload);
}

function waitForDataChannelOpen(dataChannel: RTCDataChannel): Promise<void> {
  if (dataChannel.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the Realtime data channel to open."));
    }, 15_000);

    const cleanup = (): void => {
      window.clearTimeout(timeout);
      dataChannel.removeEventListener("open", handleOpen);
      dataChannel.removeEventListener("close", handleClose);
      dataChannel.removeEventListener("error", handleError);
    };

    const handleOpen = (): void => {
      cleanup();
      resolve();
    };

    const handleClose = (): void => {
      cleanup();
      reject(new Error("Realtime data channel closed before it opened."));
    };

    const handleError = (): void => {
      cleanup();
      reject(new Error("Realtime data channel failed to open."));
    };

    dataChannel.addEventListener("open", handleOpen);
    dataChannel.addEventListener("close", handleClose);
    dataChannel.addEventListener("error", handleError);
  });
}

async function startSession(options: StartSessionOptions = {}): Promise<SessionState> {
  if (session?.dataChannel.readyState === "closed") {
    cleanupSession(session);
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

async function createSession(greetOnOpen: boolean): Promise<SessionState> {

  setRunning(true);
  setStatus("Requesting microphone access...");

  let pendingSession: SessionState | undefined;

  try {
    const ephemeralKey = await fetchClientSecret();
    const peerConnection = new RTCPeerConnection();
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const dataChannel = peerConnection.createDataChannel("oai-events");
    const ready = waitForDataChannelOpen(dataChannel);
    ready.catch(() => undefined);
    pendingSession = { dataChannel, localStream, peerConnection, ready };
    session = pendingSession;

    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0] ?? null;
    };

    for (const track of localStream.getAudioTracks()) {
      peerConnection.addTrack(track, localStream);
    }

    dataChannel.addEventListener("open", () => {
      setStatus("Connected. Ask your tutor out loud.");
      logEvent("Data channel opened");
      updateImageControls();
      if (!greetOnOpen) {
        return;
      }

      dataChannel.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "Greet the user as AI Tutor, briefly invite them to ask a homework question, and keep the greeting concise."
          }
        })
      );
    });

    dataChannel.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        logEvent(payload.type ?? "Realtime event", payload);
      } catch {
        logEvent("Realtime event", event.data);
      }
    });

    dataChannel.addEventListener("close", () => {
      logEvent("Data channel closed");
      updateImageControls();
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const localDescription = peerConnection.localDescription;
    if (!localDescription?.sdp) {
      throw new Error("Browser did not create a local WebRTC offer.");
    }

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: localDescription.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp"
      }
    });

    if (!sdpResponse.ok) {
      throw new Error(`Realtime SDP request failed: ${sdpResponse.status} ${await sdpResponse.text()}`);
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    setStatus("Connecting...");
    return pendingSession;
  } catch (error) {
    cleanupSession(pendingSession);
    session = undefined;
    setRunning(false);
    setStatus(error instanceof Error ? error.message : "Failed to start session.");
    logEvent("Start failed", error instanceof Error ? error.message : error);
    throw error;
  }
}

function cleanupSession(activeSession: SessionState | undefined): void {
  if (!activeSession) {
    return;
  }

  activeSession.dataChannel.close();
  activeSession.localStream.getTracks().forEach((track) => track.stop());
  activeSession.peerConnection.close();
  remoteAudio.srcObject = null;
}

function stopSession(): void {
  if (!session) {
    setRunning(false);
    return;
  }

  cleanupSession(session);
  session = undefined;
  setRunning(false);
  setStatus("Ready when you are.");
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

function getRealtimeMessageLimit(): number | undefined {
  const maxMessageSize = session?.peerConnection.sctp?.maxMessageSize;

  if (!maxMessageSize || !Number.isFinite(maxMessageSize)) {
    return undefined;
  }

  return maxMessageSize;
}

function getImageByteLimit(): number {
  const realtimeMessageLimit = getRealtimeMessageLimit();

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

function createImageConversationEvent(image: PreparedImage, prompt: string): unknown {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt
        },
        {
          type: "input_image",
          image_url: image.dataUrl
        }
      ]
    }
  };
}

async function getSendableImage(): Promise<PreparedImage> {
  if (!preparedImage) {
    throw new Error("Choose an image first.");
  }

  const messageLimit = getRealtimeMessageLimit();

  if (!messageLimit) {
    return preparedImage;
  }

  const prompt = imagePrompt.value.trim() || "Help me understand this problem step by step.";
  const payloadBytes = new TextEncoder().encode(JSON.stringify(createImageConversationEvent(preparedImage, prompt))).byteLength;

  if (payloadBytes <= messageLimit) {
    return preparedImage;
  }

  if (!selectedImageFile) {
    throw new Error("The prepared image is too large for this WebRTC session.");
  }

  const targetBytes = Math.max(80_000, Math.floor((messageLimit - imageJsonOverheadBytes) * 0.72));
  const image = await prepareImage(selectedImageFile, targetBytes);
  const resizedBytes = new TextEncoder().encode(JSON.stringify(createImageConversationEvent(image, prompt))).byteLength;

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

async function ensureSessionReadyForImage(): Promise<SessionState> {
  const activeSession = session;

  if (activeSession?.dataChannel.readyState === "open") {
    return activeSession;
  }

  if (activeSession && activeSession.dataChannel.readyState !== "closed") {
    setStatus("Connecting before sharing the problem image...");
    await activeSession.ready;
    return activeSession;
  }

  setStatus("Starting tutoring before sharing the problem image...");
  const startedSession = await startSession({ greet: false });
  await startedSession.ready;
  return startedSession;
}

async function sendImage(): Promise<void> {
  if (!preparedImage) {
    throw new Error("Choose an image first.");
  }

  const prompt = imagePrompt.value.trim() || "Help me understand this problem step by step.";

  isPreparingImage = true;
  imageMeta.textContent =
    session?.dataChannel.readyState === "open" ? "Checking image payload..." : "Starting tutoring...";
  updateImageControls();

  try {
    const activeSession = await ensureSessionReadyForImage();
    imageMeta.textContent = "Checking image payload...";
    const image = await getSendableImage();
    const imageEvent = createImageConversationEvent(image, prompt);

    activeSession.dataChannel.send(JSON.stringify(imageEvent));
    activeSession.dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions:
            "Use the attached image as learning context. Explain the problem step by step, keep the spoken reply concise, and ask one clarifying question if the student's goal is unclear."
        }
      })
    );

    setStatus("Problem image sent. Waiting for your tutor...");
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
    setStatus(error instanceof Error ? error.message : "Unexpected error.");
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
    setStatus(message);
    imageMeta.textContent = message;
    logEvent("Problem image send failed", error instanceof Error ? error.message : error);
  });
});
