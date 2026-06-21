import {
  createAudioVoicePipelineTurn,
  createImageVoicePipelineTurn,
  createKickoffVoicePipelineTurn,
  requestVoicePipelineTurn
} from "./voice-pipeline-api.js";
import type {
  OpenAIVoicePipelineSessionDescriptor,
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
  requestOpeningTurn(): void;
  requestReply(instructions?: string): void;
  sendUserTurn(turn: VoiceUserTurn): void;
  startAudioTurn(): Promise<void>;
};

type VoiceClientAdapterOptions = {
  audioElement: HTMLAudioElement;
  mediaStream?: MediaStream | undefined;
};

/**
 * The single voice client adapter. The turn-based OpenAI pipeline is the only
 * backend, so there is no provider switch — `createVoiceClientAdapter` always
 * returns the pipeline adapter. (The realtime/WebRTC and LiveKit adapters were
 * removed in the Flue migration plan's Phase 1.)
 *
 * `requestReply` stays on the adapter surface (the typed-turn path no-ops it) so
 * call sites don't branch on provider; the pipeline adapter implements it as a
 * turn send, mirroring what the realtime arm used to do.
 */
export function createVoiceClientAdapter(
  options: VoiceClientAdapterOptions
): VoiceClientAdapter {
  return new OpenAIVoicePipelineClientAdapter(options);
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
  abstract requestOpeningTurn(): void;
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
      this.isCapturingAudio = false;
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
          // event.error is undefined on browsers that dropped the legacy
          // MediaRecorderErrorEvent.error property; keep a diagnostic message.
          reject(event.error ?? new Error("Audio recording failed."));
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

  requestOpeningTurn(): void {
    this.createPipelineTurn({ kickoff: true }).catch((error: unknown) => {
      this.emit({ error, type: "error" });
    });
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
      this.emit({ error: event.error ?? new Error("Audio recording failed."), type: "error" });
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
    kickoff,
    text
  }: {
    audioDataUrl?: string;
    audioMimeType?: string;
    audioSize?: number;
    image?: VoiceUserTurn["image"];
    kickoff?: boolean;
    text?: string;
  }): Promise<void> {
    const descriptor = this.requireDescriptor();
    this.emit({ type: "reply_started" });

    const response = await requestVoicePipelineTurn(
      kickoff
        ? createKickoffVoicePipelineTurn(descriptor.sessionId)
        : audioDataUrl && audioMimeType && audioSize
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
