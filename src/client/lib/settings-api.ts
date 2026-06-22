import { getSettingsFn, saveSettingsFn } from "../../modules/settings/server/settings-fns.js";
import type { ProviderSettings, ProviderSettingsPatch } from "../../modules/settings/settings-types.js";
import { errorMessage } from "./error-message.js";

export class SettingsApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Mirrors session-api's `toSessionApiError`: server-fn rejections deserialize with their
// properties intact but not as a typed instance, so normalize every failure to the
// `{ status, message }` shape the hook branches on.
function toSettingsApiError(error: unknown, fallbackMessage: string): SettingsApiError {
  if (error instanceof SettingsApiError) {
    return error;
  }

  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : 0;

  return new SettingsApiError(status, errorMessage(error, fallbackMessage));
}

export async function getSettings(): Promise<ProviderSettings> {
  try {
    return await getSettingsFn();
  } catch (error) {
    throw toSettingsApiError(error, "Could not load settings.");
  }
}

export async function saveSettings(patch: ProviderSettingsPatch): Promise<ProviderSettings> {
  try {
    return await saveSettingsFn({ data: patch });
  } catch (error) {
    throw toSettingsApiError(error, "Could not save settings.");
  }
}
