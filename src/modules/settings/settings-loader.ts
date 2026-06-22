import { D1SettingsStore } from "./settings-store.js";
import type { ProviderSettings } from "./settings-types.js";

/**
 * Loads the global provider/model settings snapshot from D1. The single read site for the
 * turn path and the extraction path: each caller loads the snapshot once at the top of a
 * request and threads it through to the audio options builder and the reasoning call sites,
 * so a turn never reads the settings table more than once.
 *
 * Accepts the same env shape every domain handler already takes (`{ DB }`), so this slots in
 * next to `authenticateServerRequest` without a new binding.
 */
export async function loadProviderSettings(env: { DB: D1Database }): Promise<ProviderSettings> {
  return new D1SettingsStore(env.DB).getAllSettings();
}
