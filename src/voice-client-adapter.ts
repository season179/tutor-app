import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  type RealtimeSessionConfig,
  type TransportEvent
} from "@openai/agents/realtime";

import type {
  OpenAIRealtimeSessionDescriptor,
  VoiceBackend,
  VoiceSessionDescriptor,
  VoiceUserTurn
} from "./voice-types.js";

export type VoiceClientAdapterStatus = "idle" | "connecting" | "connected" | "disconnected";

export type VoiceClientEvent =
  | { type: "connecting" }
  | { detail?: unknown; type: "connected" }
  | { detail?: unknown; type: "disconnected" }
  | { type: "reply_started" }
  | { type: "reply_finished" }
  | { error: unknown; type: "error" }
  | { label: string; type: "debug_event"; value?: unknown };

export type VoiceClientEventHandler = (event: VoiceClientEvent) => void;

export type VoiceClientAdapter = {
  readonly status: VoiceClientAdapterStatus;
  connect(session: VoiceSessionDescriptor): Promise<void>;
  disconnect(): void;
  getPayloadLimitBytes(): number | undefined;
  onEvent(handler: VoiceClientEventHandler): () => void;
  requestReply(instructions?: string): void;
  sendUserTurn(turn: VoiceUserTurn): void;
};

type VoiceClientAdapterOptions = {
  audioElement: HTMLAudioElement;
  mediaStream: MediaStream;
};

export function createVoiceClientAdapter(
  provider: VoiceBackend,
  options: VoiceClientAdapterOptions
): VoiceClientAdapter {
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

  status: VoiceClientAdapterStatus = "idle";

  abstract connect(session: VoiceSessionDescriptor): Promise<void>;
  abstract disconnect(): void;
  abstract getPayloadLimitBytes(): number | undefined;
  abstract requestReply(instructions?: string): void;
  abstract sendUserTurn(turn: VoiceUserTurn): void;

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

class OpenAIRealtimeClientAdapter extends BaseVoiceClientAdapter {
  private readonly audioElement: HTMLAudioElement;
  private readonly mediaStream: MediaStream;
  private realtimeSession: RealtimeSession | undefined;
  private transport: OpenAIRealtimeWebRTC | undefined;

  constructor(options: VoiceClientAdapterOptions) {
    super();
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
      this.emit({
        detail: {
          model: session.model,
          provider: session.provider,
          voice: session.voice
        },
        type: "connected"
      });
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

  getPayloadLimitBytes(): number | undefined {
    const maxMessageSize = this.transport?.connectionState.peerConnection?.sctp?.maxMessageSize;

    if (!maxMessageSize || !Number.isFinite(maxMessageSize)) {
      return undefined;
    }

    return maxMessageSize;
  }

  requestReply(instructions?: string): void {
    const transport = this.requireTransport();

    if (instructions) {
      transport.requestResponse({ instructions });
      return;
    }

    transport.requestResponse({});
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
      this.emit({ detail: { provider: "openai-realtime" }, type: "disconnected" });
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

  getPayloadLimitBytes(): number | undefined {
    return undefined;
  }

  requestReply(): void {
    throwLiveKitAgentsUnavailable();
  }

  sendUserTurn(): void {
    throwLiveKitAgentsUnavailable();
  }
}
