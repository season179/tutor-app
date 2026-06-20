import {
  parseVoicePipelineTurnResponse
} from "../../modules/voice/voice-session-schema.js";
import {
  voiceTurnPath,
  type VoicePipelineAudioInput,
  type VoicePipelineTurnRequest,
  type VoicePipelineTurnResponse,
  type VoicePreparedImage
} from "../../modules/voice/voice-types.js";
import { jsonRequestInit } from "./json-request.js";
import { readJsonResponse } from "./read-json-response.js";

export async function requestVoicePipelineTurn(request: VoicePipelineTurnRequest): Promise<VoicePipelineTurnResponse> {
  const response = await fetch(voiceTurnPath, jsonRequestInit("POST", request));
  const payload = await readJsonResponse<unknown>(
    response,
    (_status, message) => new Error(message),
    (status) => `Failed to create tutor turn (${status}).`,
    "Tutor turn response was not valid JSON."
  );

  return parseVoicePipelineTurnResponse(payload);
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
