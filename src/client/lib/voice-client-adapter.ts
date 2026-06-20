import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  type RealtimeSessionConfig,
  type TransportEvent
} from "@openai/agents/realtime";

import {
  createAudioVoicePipelineTurn,
  createImageVoicePipelineTurn,
  requestVoicePipelineTurn
} from "./voice-pipeline-api.js";
import type {
  OpenAIVoicePipelineSessionDescriptor,
  OpenAIRealtimeSessionDescriptor,
  VoiceBackend,
  VoicePipelineSessionState,
  VoiceSessionDescriptor,
  VoiceUserTurn
} from "../../modules/voice/voice-types.js";

export type VoiceClientAdapterStatus = "idle" | "connecting" | "connected" | "disconnected";

export type VoiceClientEvent =
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "recording_started" }
  | { type: "recording_finished" }
  | { type: "reply_started" }
  | { type: "reply_finished" }
  | { error: unknown; type: "error" }
  | { text: string; type: "student_transcript" }
  | { text: string; type: "tutor_text" }
  | { session: VoicePipelineSessionState; type: "session_state" }
  | { label: string; type: "debug_event"; value?: unknown };

export type VoiceClientEventHandler = (event: VoiceClientEvent) => void;

export type VoiceClientAdapter = {
  readonly status: VoiceClientAdapterStatus;
  readonly supportsAudioTurns: boolean;
  readonly isCapturingAudio: boolean;
  connect(session: VoiceSessionDescriptor): Promise<void>;
  disconnect(): void;
  finishAudioTurn(): Promise<void>;
  getPayloadLimitBytes(): number | undefined;
  onEvent(handler: VoiceClientEventHandler): () => void;
  requestReply(instructions?: string): void;
  sendUserTurn(turn: VoiceUserTurn): void;
  startAudioTurn(): Promise<void>;
};

type VoiceClientAdapterOptions = {
  audioElement: HTMLAudioElement;
  mediaStream?: MediaStream | undefined;
};

export function createVoiceClientAdapter(
  provider: VoiceBackend,
  options: VoiceClientAdapterOptions
): VoiceClientAdapter {
  if (provider === "openai-voice-pipeline") {
    return new OpenAIVoicePipelineClientAdapter(options);
  }

  if (provider === "openai-realtime") {
    return new OpenAIRealtimeClientAdapter(options);
  }

  if (provider === "livekit-agents") {
    return new LiveKitAgentsClientAdapter();
  }

  const exhaustiveProvider: never = provider;
  throw new Error(`Unsupported voice backend: ${String(exhaustiveProvider)}`);
}

function createSessionConfig(session: OpenAIRealtimeSessionDescriptor): Partial<RealtimeSessionConfig> {
  return {
    audio: {
      output: {
        voice: session.voice
      }
    },
    outputModalities: ["audio"]
  };
}

function throwLiveKitAgentsUnavailable(): never {
  throw new Error("LiveKit Agents browser adapter is not implemented in this foundation pass.");
}

abstract class BaseVoiceClientAdapter implements VoiceClientAdapter {
  private readonly eventHandlers = new Set<VoiceClientEventHandler>();

  isCapturingAudio = false;
  status: VoiceClientAdapterStatus = "idle";
  supportsAudioTurns = false;

  abstract connect(session: VoiceSessionDescriptor): Promise<void>;
  abstract disconnect(): void;
  abstract finishAudioTurn(): Promise<void>;
  abstract getPayloadLimitBytes(): number | undefined;
  abstract requestReply(instructions?: string): void;
  abstract sendUserTurn(turn: VoiceUserTurn): void;
  abstract startAudioTurn(): Promise<void>;

  onEvent(handler: VoiceClientEventHandler): () => void {
    this.eventHandlers.add(handler);

    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  protected emit(event: VoiceClientEvent): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }
}

class OpenAIVoicePipelineClientAdapter extends BaseVoiceClientAdapter {
  private readonly audioElement: HTMLAudioElement;
  private mediaStream: MediaStream | undefined;
  private descriptor: OpenAIVoicePipelineSessionDescriptor | undefined;
  private mediaRecorder: MediaRecorder | undefined;
  private problemImage: VoiceUserTurn["image"] = null;
  private readonly recordedChunks: Blob[] = [];

  constructor(options: VoiceClientAdapterOptions) {
    super();
    this.audioElement = options.audioElement;
    this.mediaStream = options.mediaStream;
    this.supportsAudioTurns = true;
  }

  async connect(session: VoiceSessionDescriptor): Promise<void> {
    if (session.provider !== "openai-voice-pipeline") {
      throw new Error(`Pipeline adapter cannot connect provider ${session.provider}.`);
    }

    this.status = "connecting";
    this.emit({ type: "connecting" });
    this.descriptor = session;
    this.status = "connected";
    this.emit({ type: "connected" });
  }

  disconnect(): void {
    if (this.isCapturingAudio) {
      this.mediaRecorder?.stop();
    }

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = undefined;
    this.status = "disconnected";
    this.emit({ type: "disconnected" });
  }

  async finishAudioTurn(): Promise<void> {
    const recorder = this.mediaRecorder;

    if (!recorder || !this.isCapturingAudio) {
      throw new Error("No student answer is being recorded.");
    }

    await new Promise<void>((resolve, reject) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve();
        },
        { once: true }
      );
      recorder.addEventListener(
        "error",
        (event) => {
          reject(event.error);
        },
        { once: true }
      );
      recorder.stop();
    });

    this.isCapturingAudio = false;
    this.emit({ type: "recording_finished" });

    const mimeType = recorder.mimeType || "audio/webm";
    const audioBlob = new Blob(this.recordedChunks, { type: mimeType });
    this.recordedChunks.length = 0;

    if (audioBlob.size === 0) {
      throw new Error("No audio was recorded.");
    }

    const dataUrl = await blobToDataUrl(audioBlob);
    await this.createPipelineTurn({
      audioDataUrl: dataUrl,
      audioMimeType: mimeType,
      audioSize: audioBlob.size
    });
  }

  getPayloadLimitBytes(): number | undefined {
    const limit = this.descriptor?.capabilities.payloadLimitBytes;
    return typeof limit === "number" ? limit : undefined;
  }

  requestReply(instructions?: string): void {
    if (!instructions) {
      return;
    }

    this.createPipelineTurn({ text: instructions }).catch((error: unknown) => {
      this.emit({ error, type: "error" });
    });
  }

  sendUserTurn(turn: VoiceUserTurn): void {
    if (turn.image) {
      this.problemImage = turn.image;
    }

    this.createPipelineTurn({
      image: turn.image,
      text: turn.text
    }).catch((error: unknown) => {
      this.emit({ error, type: "error" });
    });
  }

  async startAudioTurn(): Promise<void> {
    if (this.status !== "connected") {
      throw new Error("Start the tutoring session before recording an answer.");
    }

    if (this.isCapturingAudio) {
      return;
    }

    this.mediaStream ??= await navigator.mediaDevices.getUserMedia({ audio: true });

    const recorder = new MediaRecorder(this.mediaStream);
    this.recordedChunks.length = 0;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    });
    recorder.addEventListener("error", (event) => {
      this.emit({ error: event.error, type: "error" });
    });

    this.mediaRecorder = recorder;
    this.isCapturingAudio = true;
    recorder.start();
    this.emit({ type: "recording_started" });
  }

  private async createPipelineTurn({
    audioDataUrl,
    audioMimeType,
    audioSize,
    image,
    text
  }: {
    audioDataUrl?: string;
    audioMimeType?: string;
    audioSize?: number;
    image?: VoiceUserTurn["image"];
    text?: string;
  }): Promise<void> {
    const descriptor = this.requireDescriptor();
    this.emit({ type: "reply_started" });

    const response = await requestVoicePipelineTurn(
      audioDataUrl && audioMimeType && audioSize
        ? createAudioVoicePipelineTurn(descriptor.sessionId, {
            dataUrl: audioDataUrl,
            mimeType: audioMimeType,
            name: "student-turn.webm",
            size: audioSize
          }, this.problemImage)
        : createImageVoicePipelineTurn(descriptor.sessionId, image ?? null, text ?? "")
    );

    if (response.transcript) {
      this.emit({ text: response.transcript, type: "student_transcript" });
    }

    this.emit({ text: response.tutorText, type: "tutor_text" });
    this.emit({ session: response.session, type: "session_state" });
    await this.playTutorAudio(response.audio.dataUrl);
    this.emit({ type: "reply_finished" });
  }

  private async playTutorAudio(dataUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.audioElement.removeEventListener("ended", handleEnded);
        this.audioElement.removeEventListener("error", handleError);
      };
      const handleEnded = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Could not play tutor audio."));
      };

      this.audioElement.addEventListener("ended", handleEnded);
      this.audioElement.addEventListener("error", handleError);
      this.audioElement.srcObject = null;
      this.audioElement.src = dataUrl;
      this.audioElement.play().catch((error: unknown) => {
        cleanup();
        reject(error);
      });
    });
  }

  private requireDescriptor(): OpenAIVoicePipelineSessionDescriptor {
    if (!this.descriptor) {
      throw new Error("Voice session is not connected.");
    }

    return this.descriptor;
  }
}

class OpenAIRealtimeClientAdapter extends BaseVoiceClientAdapter {
  private readonly audioElement: HTMLAudioElement;
  private readonly mediaStream: MediaStream;
  private realtimeSession: RealtimeSession | undefined;
  private transport: OpenAIRealtimeWebRTC | undefined;

  constructor(options: VoiceClientAdapterOptions) {
    super();
    if (!options.mediaStream) {
      throw new Error("Realtime adapter requires microphone access.");
    }

    this.audioElement = options.audioElement;
    this.mediaStream = options.mediaStream;
  }

  async connect(session: VoiceSessionDescriptor): Promise<void> {
    if (session.provider !== "openai-realtime") {
      throw new Error(`OpenAI adapter cannot connect provider ${session.provider}.`);
    }

    this.status = "connecting";
    this.emit({ type: "connecting" });

    const transport = new OpenAIRealtimeWebRTC({
      audioElement: this.audioElement,
      mediaStream: this.mediaStream
    });
    const tutorAgent = new RealtimeAgent({
      instructions: session.tutorPolicy.instructions,
      name: session.tutorPolicy.agentName
    });
    const realtimeSession = new RealtimeSession(tutorAgent, {
      config: createSessionConfig(session),
      model: session.model,
      transport
    });

    this.transport = transport;
    this.realtimeSession = realtimeSession;
    this.wireEvents(realtimeSession, transport);

    try {
      await realtimeSession.connect({ apiKey: session.clientSecret });
      this.status = "connected";
      this.emit({ type: "connected" });
    } catch (error) {
      this.status = "disconnected";
      this.emit({ error, type: "error" });
      throw error;
    }
  }

  disconnect(): void {
    this.status = "disconnected";
    this.realtimeSession?.close();
  }

  finishAudioTurn(): Promise<void> {
    throw new Error("Manual audio turns are not supported by the realtime adapter.");
  }

  getPayloadLimitBytes(): number | undefined {
    const maxMessageSize = this.transport?.connectionState.peerConnection?.sctp?.maxMessageSize;

    if (!maxMessageSize || !Number.isFinite(maxMessageSize)) {
      return undefined;
    }

    return maxMessageSize;
  }

  requestReply(instructions?: string): void {
    const transport = this.requireTransport();
    transport.requestResponse(instructions ? { instructions } : {});
  }

  async startAudioTurn(): Promise<void> {
    throw new Error("Manual audio turns are not supported by the realtime adapter.");
  }

  sendUserTurn(turn: VoiceUserTurn): void {
    const content: Array<{ text: string; type: "input_text" } | { image: string; type: "input_image" }> = [
      {
        text: turn.text,
        type: "input_text"
      }
    ];

    if (turn.image) {
      content.push({
        image: turn.image.dataUrl,
        type: "input_image"
      });
    }

    this.requireTransport().sendMessage(
      {
        content,
        role: "user",
        type: "message"
      },
      {},
      { triggerResponse: false }
    );
  }

  private requireTransport(): OpenAIRealtimeWebRTC {
    if (!this.transport) {
      throw new Error("Voice session is not connected.");
    }

    return this.transport;
  }

  private wireEvents(realtimeSession: RealtimeSession, transport: OpenAIRealtimeWebRTC): void {
    transport.on("connection_change", (connectionStatus) => {
      this.emit({ label: `Voice connection ${connectionStatus}`, type: "debug_event" });

      if (connectionStatus !== "disconnected") {
        return;
      }

      this.status = "disconnected";
      this.emit({ type: "disconnected" });
    });

    transport.on("*", (event: TransportEvent) => {
      this.emit({
        label: event.type || "Provider event",
        type: "debug_event",
        value: event
      });
    });

    realtimeSession.on("audio_start", () => {
      this.emit({ type: "reply_started" });
    });

    realtimeSession.on("audio_stopped", () => {
      this.emit({ type: "reply_finished" });
    });

    realtimeSession.on("error", ({ error }) => {
      this.emit({ error, type: "error" });
    });
  }
}

class LiveKitAgentsClientAdapter extends BaseVoiceClientAdapter {
  connect(): Promise<void> {
    throwLiveKitAgentsUnavailable();
  }

  disconnect(): void {
    this.status = "disconnected";
  }

  finishAudioTurn(): Promise<void> {
    throwLiveKitAgentsUnavailable();
  }

  getPayloadLimitBytes(): number | undefined {
    return undefined;
  }

  requestReply(): void {
    throwLiveKitAgentsUnavailable();
  }

  sendUserTurn(): void {
    throwLiveKitAgentsUnavailable();
  }

  async startAudioTurn(): Promise<void> {
    throwLiveKitAgentsUnavailable();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Could not encode audio."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Could not read audio."));
    });
    reader.readAsDataURL(blob);
  });
}
