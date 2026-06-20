import { createVoiceSessionFn } from "../../modules/voice/server/voice-fns.js";
import type {
  CreateVoiceSessionRequest,
  VoiceSessionDescriptor
} from "../../modules/voice/voice-types.js";
import { errorMessage } from "./error-message.js";

export async function requestVoiceSessionDescriptor(sessionId: string): Promise<VoiceSessionDescriptor> {
  const request: CreateVoiceSessionRequest = {
    intent: "tutor",
    sessionId
  };

  try {
    return await createVoiceSessionFn({ data: request });
  } catch (error) {
    throw new Error(errorMessage(error, "Failed to create voice session."));
  }
}
