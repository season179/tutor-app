import {
  SETTING_TYPES,
  isModelSettingType,
  isProvider,
  providerModelSpecifier,
  splitProviderModelSpecifier,
  type Provider,
  type ProviderModelSetting,
  type ProviderSettings,
  type ProviderSettingsPatch,
  type SettingType
} from "./settings-types.js";

/**
 * The provider/model settings store. Read-mostly: the turn path and the /settings page read
 * the full snapshot; the page writes individual keys. Mirrors the `SessionStore` split — an
 * in-memory implementation backs the test suite (the vitest pool deliberately doesn't load
 * Cloudflare bindings; see `vitest.config.ts`), `D1SettingsStore` backs production.
 */
export interface SettingsStore {
  getAllSettings(): Promise<ProviderSettings>;
  getSetting<T extends SettingType>(type: T): Promise<ProviderSettings[T] | undefined>;
  saveSettings(patch: ProviderSettingsPatch): Promise<ProviderSettings>;
}

/**
 * The fallback values for any setting that has no row. These are the same defaults that used
 * to live as the `default*` constants / wrangler `vars` — kept here as a hard floor so a
 * missing row (or a freshly migrated DB before the seed runs) never produces an empty model.
 */
export const defaultProviderSettings: ProviderSettings = {
  stt_model: { provider: "openrouter", model: "qwen/qwen3-asr-flash-2026-02-10" },
  tts_model: { provider: "openrouter", model: "google/gemini-3.1-flash-tts-preview" },
  tts_voice: "Aoede",
  gate_check_model: { provider: "openai", model: "gpt-5.5" },
  verifier_model: { provider: "openai", model: "gpt-5.5" },
  tutor_model: { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b" },
  extract_model: { provider: "openai", model: "gpt-5.5" }
};

/** D1-backed settings store. Reads/writes the `provider_settings` keyed-rows table. */
export class D1SettingsStore implements SettingsStore {
  constructor(private readonly db: D1Database) {}

  async getAllSettings(): Promise<ProviderSettings> {
    const result = await this.selectAllRows();
    const rows = result.results ?? [];
    const settings = cloneDefaultProviderSettings();
    for (const row of rows) {
      if (isSettingType(row.type)) {
        setSettingValue(settings, row.type, rowToSettingValue(row.type, row));
      }
    }
    return settings;
  }

  async getSetting<T extends SettingType>(type: T): Promise<ProviderSettings[T] | undefined> {
    const row = await this.selectOneRow(type);
    return row ? (rowToSettingValue(type, row) as ProviderSettings[T]) : undefined;
  }

  async saveSettings(patch: ProviderSettingsPatch): Promise<ProviderSettings> {
    const entries = Object.entries(patch) as [SettingType, ProviderSettings[SettingType]][];
    if (entries.length === 0) {
      return this.getAllSettings();
    }
    // One upsert per changed key. SQLite's ON CONFLICT DO UPDATE turns an insert into an
    // update of value + updated_at when the PK (type) already exists — the keyed-row design
    // means a new slot never needs a schema change.
    try {
      await this.db.batch(entries.map(([type, value]) => this.modernUpsert(type, value)));
    } catch (error) {
      if (!isMissingProviderColumnError(error)) {
        throw error;
      }
      await this.db.batch(entries.map(([type, value]) => this.legacyUpsert(type, value)));
    }
    return this.getAllSettings();
  }

  private async selectAllRows(): Promise<D1Result<SettingsRow>> {
    try {
      return await this.db.prepare("SELECT type, provider, value FROM provider_settings").all<SettingsRow>();
    } catch (error) {
      if (!isMissingProviderColumnError(error)) {
        throw error;
      }
      const legacy = await this.db.prepare("SELECT type, value FROM provider_settings").all<LegacySettingsRow>();
      return {
        ...legacy,
        results: (legacy.results ?? []).map((row) => ({ ...row, provider: null }))
      } as D1Result<SettingsRow>;
    }
  }

  private async selectOneRow(type: SettingType): Promise<SettingsRow | null> {
    try {
      return await this.db
        .prepare("SELECT type, provider, value FROM provider_settings WHERE type = ?")
        .bind(type)
        .first<SettingsRow>();
    } catch (error) {
      if (!isMissingProviderColumnError(error)) {
        throw error;
      }
      const row = await this.db
        .prepare("SELECT type, value FROM provider_settings WHERE type = ?")
        .bind(type)
        .first<LegacySettingsRow>();
      return row ? { ...row, provider: null } : null;
    }
  }

  private modernUpsert(
    type: SettingType,
    value: ProviderSettings[SettingType]
  ): D1PreparedStatement {
    const row = settingValueToRow(type, value);
    return this.db
      .prepare(
        `INSERT INTO provider_settings (type, provider, value, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(type) DO UPDATE SET
           provider = excluded.provider,
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(type, row.provider, row.value);
  }

  private legacyUpsert(
    type: SettingType,
    value: ProviderSettings[SettingType]
  ): D1PreparedStatement {
    const row = settingValueToLegacyRow(type, value);
    return this.db
      .prepare(
        `INSERT INTO provider_settings (type, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(type) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .bind(type, row.value);
  }
}

/**
 * In-memory settings store for the test suite. Seeds from {@link defaultProviderSettings} so
 * tests don't have to seed every key, mirroring how `MemorySessionStore` is the test double
 * for `D1SessionStore`.
 */
export class MemorySettingsStore implements SettingsStore {
  private rows: ProviderSettings = cloneDefaultProviderSettings();

  async getAllSettings(): Promise<ProviderSettings> {
    return cloneSettings(this.rows);
  }

  async getSetting<T extends SettingType>(type: T): Promise<ProviderSettings[T] | undefined> {
    return cloneSettingValue(this.rows[type]) as ProviderSettings[T];
  }

  async saveSettings(patch: ProviderSettingsPatch): Promise<ProviderSettings> {
    for (const [type, value] of Object.entries(patch) as [SettingType, ProviderSettings[SettingType]][]) {
      setSettingValue(this.rows, type, cloneSettingValue(value));
    }
    return this.getAllSettings();
  }
}

type SettingsRow = {
  type: string;
  provider: string | null;
  value: string;
};

type LegacySettingsRow = {
  type: string;
  value: string;
};

function isSettingType(type: string): type is SettingType {
  return (SETTING_TYPES as readonly string[]).includes(type);
}

function rowToSettingValue(type: SettingType, row: SettingsRow): ProviderSettings[SettingType] {
  if (!isModelSettingType(type)) {
    return row.value;
  }
  if (row.provider && isProvider(row.provider)) {
    return { provider: row.provider, model: row.value };
  }
  return splitProviderModelSpecifier(row.value);
}

function settingValueToRow(
  type: SettingType,
  value: ProviderSettings[SettingType]
): { provider: Provider | null; value: string } {
  if (isModelSettingType(type)) {
    const setting = value as ProviderModelSetting;
    return { provider: setting.provider, value: setting.model };
  }
  return { provider: null, value: value as string };
}

function settingValueToLegacyRow(
  type: SettingType,
  value: ProviderSettings[SettingType]
): { value: string } {
  if (isModelSettingType(type)) {
    return { value: providerModelSpecifier(value as ProviderModelSetting) };
  }
  return { value: value as string };
}

function isMissingProviderColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column:\s*provider/i.test(message);
}

function setSettingValue(
  settings: ProviderSettings,
  type: SettingType,
  value: ProviderSettings[SettingType]
): void {
  if (isModelSettingType(type)) {
    settings[type] = value as ProviderModelSetting;
    return;
  }
  settings[type] = value as string;
}

function cloneDefaultProviderSettings(): ProviderSettings {
  return cloneSettings(defaultProviderSettings);
}

function cloneSettings(settings: ProviderSettings): ProviderSettings {
  return Object.fromEntries(
    SETTING_TYPES.map((type) => [type, cloneSettingValue(settings[type])])
  ) as ProviderSettings;
}

function cloneSettingValue(value: ProviderSettings[SettingType]): ProviderSettings[SettingType] {
  if (typeof value === "string") {
    return value;
  }
  return { ...value };
}
