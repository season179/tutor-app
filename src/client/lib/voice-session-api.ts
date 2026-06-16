import { parseVoiceSessionDescriptor } from "../../voice-session-schema.js";
import {
  voiceSessionPath,
  type CreateVoiceSessionRequest,
  type VoiceSessionDescriptor
} from "../../voice-types.js";
import { jsonRequestInit } from "./json-request.js";
import { readJsonResponse } from "./read-json-response.js";

export async function requestVoiceSessionDescriptor(sessionId: string): Promise<VoiceSessionDescriptor> {
  const request: CreateVoiceSessionRequest = {
    intent: "tutor",
    sessionId
  };
  const response = await fetch(voiceSessionPath, jsonRequestInit("POST", request));
  const payload = await readJsonResponse<unknown>(
    response,
    (_status, message) => new Error(message),
    (status) => `Failed to create voice session (${status}).`,
    "Voice session response was not valid JSON."
  );

  return parseVoiceSessionDescriptor(payload);
}
