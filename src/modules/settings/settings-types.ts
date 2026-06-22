/**
 * Global provider/model settings — the editable knob behind the /settings page.
 *
 * Each known setting key is one row in `provider_settings` (keyed rows, not one column per
 * setting, so a future slot is a new row + a union member here, never a schema migration).
 * Model rows store provider and model separately: `provider` is routing/UI metadata, while
 * `value` is the bare model string each downstream consumer can format for its own wire.
 *
 * Worker A owns the model strings (read from here); provider credentials stay as Wrangler
 * secrets. See `settings-store.ts` and AGENTS.md "Two-worker architecture".
 */

/** The known provider/model setting keys. Adding a slot = extend this union + seed a row. */
export type SettingType =
  // Audio (Worker A, OpenRouter)
  | "stt_model"
  | "tts_model"
  | "tts_voice"
  // Reasoning stages (shipped across the REASONING binding as a per-call model override)
  | "gate_check_model"
  | "verifier_model"
  | "tutor_model"
  | "extract_model";

export const PROVIDERS = [
  "openai",
  "openrouter",
  "anthropic",
  "google",
  "meta",
  "mistral",
  "x-ai"
] as const;

export type Provider = (typeof PROVIDERS)[number];

/** The settings keys that hold a provider/model pair. `tts_voice` is a bare voice name. */
export type ModelSettingType = Exclude<SettingType, "tts_voice">;

export type ProviderModelSetting = {
  provider: Provider;
  model: string;
};

export const MODEL_SETTING_TYPES: readonly ModelSettingType[] = [
  "stt_model",
  "tts_model",
  "gate_check_model",
  "verifier_model",
  "tutor_model",
  "extract_model"
];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function isModelSettingType(type: SettingType): type is ModelSettingType {
  return (MODEL_SETTING_TYPES as readonly SettingType[]).includes(type);
}

/**
 * Splits a legacy `provider/model` value. Only the store/migration compatibility path should
 * need this now; the current settings shape stores provider and model in separate fields.
 */
export function splitProviderModelSpecifier(
  value: string,
  fallbackProvider: Provider = PROVIDERS[0]
): ProviderModelSetting {
  const slash = value.indexOf("/");
  if (slash < 0) {
    return { provider: fallbackProvider, model: value };
  }
  const rawProvider = value.slice(0, slash);
  if (!isProvider(rawProvider)) {
    return { provider: fallbackProvider, model: value };
  }
  return { provider: rawProvider, model: value.slice(slash + 1) };
}

/**
 * Formats a split model setting for runtimes that expect a provider/model specifier.
 * Flue/Pi use this shape and resolve the provider before handing the bare model to the
 * provider implementation. Audio does not use this helper because OpenRouter's audio REST
 * endpoints want the bare `model` field.
 */
export function providerModelSpecifier(setting: ProviderModelSetting): string {
  const model = setting.model.trim();
  if (!model) {
    return "";
  }
  return `${setting.provider}/${model}`;
}

/** Ordered list of the known setting types — drives the store seed, the schema enum, and the UI. */
export const SETTING_TYPES: readonly SettingType[] = [
  "stt_model",
  "tts_model",
  "tts_voice",
  "gate_check_model",
  "verifier_model",
  "tutor_model",
  "extract_model"
];

/** The full typed snapshot of every known setting (each key always present in a snapshot). */
export type ProviderSettings = Record<ModelSettingType, ProviderModelSetting> & {
  tts_voice: string;
};

/** A partial map of setting type → value, as accepted by `saveSettings`. */
export type ProviderSettingsPatch = Partial<ProviderSettings>;

/** The reasoning stages Worker B exposes as Flue workflows (workflow filename). */
export type ReasoningStage = "gate-check" | "verifier" | "tutor-turn" | "extract-question";

/** Maps each reasoning stage to the settings key that holds its model. */
export const STAGE_TO_SETTING: Record<ReasoningStage, ModelSettingType> = {
  "gate-check": "gate_check_model",
  verifier: "verifier_model",
  "tutor-turn": "tutor_model",
  "extract-question": "extract_model"
};

/**
 * Builds the `extra` payload field that ships a stage's model across the REASONING binding.
 * `runReasoningWorkflow` merges `extra` into the Flue workflow payload; Worker B forwards
 * `payload.model` into `session.prompt({ model })`. Returns an empty object when the model is
 * empty so we never override Worker B's env default with a blank.
 */
export function modelExtraForStage(
  settings: ProviderSettings,
  stage: ReasoningStage
): { model: string } | Record<string, never> {
  const model = providerModelSpecifier(settings[STAGE_TO_SETTING[stage]]);
  return model ? { model } : {};
}
