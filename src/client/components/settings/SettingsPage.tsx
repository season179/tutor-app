import { useEffect, useState } from "react";

import { Link } from "@tanstack/react-router";

import { ActionButton } from "../ActionButton.js";
import { BrandLockup } from "../BrandLockup.js";
import { Panel } from "../Panel.js";
import { SignInScreen } from "../SignInScreen.js";
import { useAuth } from "../../hooks/use-auth.js";
import { useSettings } from "../../hooks/use-settings.js";
import {
  PROVIDERS,
  isModelSettingType,
  type Provider,
  type ProviderModelSetting,
  type ProviderSettings,
  type ProviderSettingsPatch,
  type SettingType
} from "../../../modules/settings/settings-types.js";
import { classNames } from "../../lib/class-names.js";

/**
 * The descriptor list that drives the page. Adding a setting slot is a new entry here + a
 * seed row + a `SettingType` union member — never a schema change (the keyed-rows table
 * accepts any key). The `group` drives the Panel section the field renders under. A field
 * renders as a provider dropdown + free-text model when its type is a model setting.
 * `tts_voice` is a bare voice name, so it stays text-only.
 */
const SETTING_FIELDS: ReadonlyArray<{
  type: SettingType;
  label: string;
  hint: string;
  group: "Audio" | "Reasoning";
}> = [
  { type: "stt_model", label: "Speech-to-text model", hint: "OpenRouter provider/model for transcription.", group: "Audio" },
  { type: "tts_model", label: "Text-to-speech model", hint: "OpenRouter provider/model for synthesis.", group: "Audio" },
  { type: "tts_voice", label: "TTS voice", hint: "Voice name the TTS model uses.", group: "Audio" },
  { type: "gate_check_model", label: "Gate-check model", hint: "Grades the Three Reads comprehension gate.", group: "Reasoning" },
  { type: "verifier_model", label: "Verifier model", hint: "Narrow answer verifier for solving steps.", group: "Reasoning" },
  { type: "tutor_model", label: "Tutor model", hint: "The conversational LLM that produces each tutor turn.", group: "Reasoning" },
  { type: "extract_model", label: "Extract-question model", hint: "Vision model that reads the problem image at upload.", group: "Reasoning" }
];

const AUDIO_FIELDS = SETTING_FIELDS.filter((f) => f.group === "Audio");
const REASONING_FIELDS = SETTING_FIELDS.filter((f) => f.group === "Reasoning");

/**
 * The provider/model settings page. Reads the global settings snapshot, lets a signed-in
 * user edit any field as free text (the point is testing arbitrary models quickly), and
 * saves the edited subset on explicit Save. Fields are controlled locally and seeded from
 * the query, so flipping several models then one Save is a single write.
 *
 * Auth-gates like the workspace: loading while the session resolves, SignInScreen on a
 * bootstrap failure. The server fns re-check auth (401) regardless.
 */
export function SettingsPage() {
  const { isAuthLoading, authError, signInWithGoogle, isAdmin } = useAuth();
  const { settings, isLoading, loadError, save, saveState, isSaving } = useSettings();
  // Local draft state, seeded from the query snapshot. `settingsVersion` invalidates the
  // draft when a fresh snapshot arrives (initial load or an external mutation).
  const [draft, setDraft] = useState<ProviderSettings>(emptyDraft);
  const [settingsVersion, setSettingsVersion] = useState(0);

  useEffect(() => {
    if (settings) {
      setDraft(settings);
      setSettingsVersion((v) => v + 1);
    }
  }, [settings]);

  if (isAuthLoading) {
    return <main className="settings-page" aria-busy="true" />;
  }

  if (authError) {
    return (
      <SignInScreen
        message="Could not start a session. Sign in with Google to manage settings."
        onSignIn={signInWithGoogle}
      />
    );
  }

  if (!isAdmin) {
    // Admin-gated: only `role === "admin"` reaches the settings UI. A signed-in non-admin
    // (or an anonymous guest) sees "not authorized" — NOT the sign-in screen, since a real
    // user shouldn't be pushed to authenticate again. The backend re-checks this (403), so a
    // direct server-fn call from a non-admin still fails closed.
    return (
      <main className="settings-page settings-page--centered">
        <div className="settings-not-authorized">
          <h1>Not authorized</h1>
          <p>You need an admin account to manage provider and model settings.</p>
          <Link className="text-button settings-back-link" to="/">
            ← Back to coaching
          </Link>
        </div>
      </main>
    );
  }

  if (isLoading) {
    return <main className="settings-page" aria-busy="true" />;
  }

  const dirty = settings ? hasChanges(draft, settings) : false;

  function updateField<T extends SettingType>(type: T, value: ProviderSettings[T]): void {
    setDraft((prev) => ({ ...prev, [type]: value }));
  }

  async function handleSave(): Promise<void> {
    if (!settings) {
      return;
    }
    const patch = diff(draft, settings);
    await save(patch);
  }

  return (
    <main className="settings-page">
      <header className="settings-header">
        <BrandLockup />
        <Link className="text-button settings-back-link" to="/">
          ← Back to coaching
        </Link>
      </header>

      {loadError ? (
        <p className="settings-error" role="alert">
          Could not load settings. {String((loadError as Error)?.message ?? "")}
        </p>
      ) : null}

      <div className="settings-body">
        <SettingsSection
          title="Audio"
          description="Speech-to-text and text-to-speech models (Worker A, OpenRouter)."
          fields={AUDIO_FIELDS}
          draft={draft}
          settingsVersion={settingsVersion}
          disabled={isSaving}
          onFieldChange={updateField}
        />
        <SettingsSection
          title="Reasoning"
          description="Per-stage LLM models. Each ships across the REASONING binding as a per-call model override."
          fields={REASONING_FIELDS}
          draft={draft}
          settingsVersion={settingsVersion}
          disabled={isSaving}
          onFieldChange={updateField}
        />

        <div className="settings-actions">
          <ActionButton variant="primary" onClick={handleSave} disabled={!dirty || isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </ActionButton>
          <SaveStatus state={saveState} />
        </div>
      </div>
    </main>
  );
}

function SettingsSection({
  title,
  description,
  fields,
  draft,
  settingsVersion,
  disabled,
  onFieldChange
}: {
  title: string;
  description: string;
  fields: ReadonlyArray<{ type: SettingType; label: string; hint: string }>;
  draft: ProviderSettings;
  settingsVersion: number;
  disabled: boolean;
  onFieldChange: <T extends SettingType>(type: T, value: ProviderSettings[T]) => void;
}) {
  // The settingsVersion key forces a fresh remount of the inputs when a new snapshot
  // arrives, so each field reflects the server value rather than a stale local edit.
  return (
    <Panel id={`settings-${title.toLowerCase()}`} title={title} description={description}>
      <div className="settings-fields">
        {fields.map((field) =>
          isModelSettingType(field.type) ? (
            <ModelField
              key={field.type}
              field={field}
              value={draft[field.type]}
              settingsVersion={settingsVersion}
              disabled={disabled}
              onChange={(value) => onFieldChange(field.type, value)}
            />
          ) : (
            <label key={field.type} className="settings-field">
              <span className="settings-field-label">{field.label}</span>
              <input
                key={`${field.type}-${settingsVersion}`}
                className="settings-field-input"
                type="text"
                value={draft[field.type] as string}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => onFieldChange(field.type, e.target.value)}
              />
              <span className="settings-field-hint">{field.hint}</span>
            </label>
          )
        )}
      </div>
    </Panel>
  );
}

/**
 * A model field: provider dropdown + free-text model name. The draft stores the split
 * provider/model object directly, so save/diff/store all share one shape.
 */
function ModelField({
  field,
  value,
  settingsVersion,
  disabled,
  onChange
}: {
  field: { type: SettingType; label: string; hint: string };
  value: ProviderModelSetting;
  settingsVersion: number;
  disabled: boolean;
  onChange: (value: ProviderModelSetting) => void;
}) {
  return (
    <div key={field.type} className="settings-field">
      <span className="settings-field-label">{field.label}</span>
      <div className="settings-model-row">
        <select
          key={`${field.type}-provider-${settingsVersion}`}
          className="settings-provider-select"
          value={value.provider}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, provider: e.target.value as Provider })}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          key={`${field.type}-model-${settingsVersion}`}
          className="settings-field-input"
          type="text"
          value={value.model}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder="model name"
          onChange={(e) => onChange({ ...value, model: e.target.value })}
        />
      </div>
      <span className="settings-field-hint">{field.hint}</span>
    </div>
  );
}

function SaveStatus({ state }: { state: ReturnType<typeof useSettings>["saveState"] }) {
  if (state.kind === "idle") {
    return null;
  }
  if (state.kind === "saving") {
    return (
      <span className={classNames("settings-save-status", "settings-save-status--working")} role="status">
        Saving…
      </span>
    );
  }
  return (
    <span
      className={classNames(
        "settings-save-status",
        state.kind === "saved" && "settings-save-status--ready",
        state.kind === "error" && "settings-save-status--error"
      )}
      role="status"
    >
      {state.message}
    </span>
  );
}

const emptyDraft: ProviderSettings = {
  stt_model: { provider: "openrouter", model: "" },
  tts_model: { provider: "openrouter", model: "" },
  tts_voice: "",
  gate_check_model: { provider: "openai", model: "" },
  verifier_model: { provider: "openai", model: "" },
  tutor_model: { provider: "openrouter", model: "" },
  extract_model: { provider: "openai", model: "" }
};

/** True when the draft differs from the loaded snapshot in any field. */
function hasChanges(
  draft: ProviderSettings,
  snapshot: ProviderSettings
): boolean {
  return SETTING_FIELDS.some((f) => !settingValuesEqual(f.type, draft[f.type], snapshot[f.type]));
}

/** Returns only the fields whose draft value differs from the snapshot (the patch to save). */
function diff(
  draft: ProviderSettings,
  snapshot: ProviderSettings
): ProviderSettingsPatch {
  const patch: ProviderSettingsPatch = {};
  for (const field of SETTING_FIELDS) {
    if (!settingValuesEqual(field.type, draft[field.type], snapshot[field.type])) {
      setPatchValue(patch, field.type, draft[field.type]);
    }
  }
  return patch;
}

function setPatchValue(
  patch: ProviderSettingsPatch,
  type: SettingType,
  value: ProviderSettings[SettingType]
): void {
  if (isModelSettingType(type)) {
    patch[type] = value as ProviderModelSetting;
    return;
  }
  patch[type] = value as string;
}

function settingValuesEqual(
  type: SettingType,
  left: ProviderSettings[SettingType],
  right: ProviderSettings[SettingType]
): boolean {
  if (isModelSettingType(type)) {
    const leftModel = left as ProviderModelSetting;
    const rightModel = right as ProviderModelSetting;
    return leftModel.provider === rightModel.provider && leftModel.model === rightModel.model;
  }
  return left === right;
}
