import { voicePipelineTurnFn } from "../../modules/voice/server/voice-fns.js";
import type {
  VoicePipelineAudioInput,
  VoicePipelineTurnRequest,
  VoicePipelineTurnResponse,
  VoicePreparedImage
} from "../../modules/voice/voice-types.js";
import { errorMessage } from "./error-message.js";

export async function requestVoicePipelineTurn(request: VoicePipelineTurnRequest): Promise<VoicePipelineTurnResponse> {
  try {
    return await voicePipelineTurnFn({ data: request });
  } catch (error) {
    throw new Error(errorMessage(error, "Failed to create tutor turn."));
  }
}

export function createImageVoicePipelineTurn(
  sessionId: string,
  image: VoicePreparedImage | null,
  text: string
): VoicePipelineTurnRequest {
  return {
    image,
    sessionId,
    text
  };
}

export function createAudioVoicePipelineTurn(
  sessionId: string,
  audio: VoicePipelineAudioInput,
  image: VoicePreparedImage | null = null
): VoicePipelineTurnRequest {
  return {
    audio,
    image,
    sessionId
  };
}
