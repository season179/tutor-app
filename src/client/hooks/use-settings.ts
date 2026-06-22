import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ProviderSettings, ProviderSettingsPatch } from "../../modules/settings/settings-types.js";
import { errorMessage } from "../lib/error-message.js";
import { getSettings, saveSettings } from "../lib/settings-api.js";

const SETTINGS_QUERY_KEY = ["settings"] as const;

export type SettingsSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

/**
 * Loads the global provider/model settings snapshot and exposes a `save` mutation that
 * upserts a partial patch. The cache key is the single global `["settings"]` tuple —
 * settings are not per-user, so there's no user scoping (unlike `["sessions", userId]`).
 */
export function useSettings() {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<SettingsSaveState>({ kind: "idle" });

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getSettings
  });

  const { mutateAsync: saveSettingsAsync, isPending: isSaving } = useMutation({
    mutationFn: (patch: ProviderSettingsPatch) => saveSettings(patch),
    onSuccess: (snapshot: ProviderSettings) => {
      queryClient.setQueryData<ProviderSettings>(SETTINGS_QUERY_KEY, snapshot);
    }
  });

  async function save(patch: ProviderSettingsPatch): Promise<void> {
    setSaveState({ kind: "saving" });
    try {
      await saveSettingsAsync(patch);
      setSaveState({ kind: "saved", message: "Settings saved." });
    } catch (error) {
      setSaveState({ kind: "error", message: errorMessage(error, "Could not save settings.") });
      throw error;
    }
  }

  return {
    settings: settingsQuery.data,
    isLoading: settingsQuery.isPending,
    loadError: settingsQuery.error,
    isSaving,
    saveState,
    save
  };
}
