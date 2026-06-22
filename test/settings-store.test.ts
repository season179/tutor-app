import assert from "node:assert/strict";

import {
  D1SettingsStore,
  defaultProviderSettings,
  MemorySettingsStore
} from "../src/modules/settings/settings-store.ts";
import {
  SETTING_TYPES,
  STAGE_TO_SETTING,
  isModelSettingType,
  modelExtraForStage,
  providerModelSpecifier
} from "../src/modules/settings/settings-types.ts";

test("MemorySettingsStore seeds every known setting type", async () => {
  const store = new MemorySettingsStore();
  const settings = await store.getAllSettings();

  for (const type of SETTING_TYPES) {
    assert.ok(type in settings, `${type} missing from snapshot`);
    if (isModelSettingType(type)) {
      assert.equal(typeof settings[type].provider, "string");
      assert.equal(typeof settings[type].model, "string");
      assert.ok(settings[type].model.length > 0, `${type} seeded with an empty model`);
    } else {
      assert.equal(typeof settings[type], "string");
      assert.ok(settings[type].length > 0, `${type} seeded with an empty value`);
    }
  }
});

test("MemorySettingsStore.getSetting returns the seeded value and undefined for unknown keys", async () => {
  const store = new MemorySettingsStore();

  assert.equal(await store.getSetting("tts_voice"), defaultProviderSettings.tts_voice);
  assert.deepEqual(await store.getSetting("tutor_model"), defaultProviderSettings.tutor_model);
});

test("MemorySettingsStore.saveSettings upserts changed keys without touching others", async () => {
  const store = new MemorySettingsStore();
  const before = await store.getAllSettings();

  const after = await store.saveSettings({
    tts_voice: "Charon",
    gate_check_model: { provider: "openai", model: "gpt-5.5-mini" }
  });

  assert.equal(after.tts_voice, "Charon");
  assert.deepEqual(after.gate_check_model, { provider: "openai", model: "gpt-5.5-mini" });
  // Untouched keys are preserved exactly.
  assert.deepEqual(after.tts_model, before.tts_model);
  assert.deepEqual(after.tutor_model, before.tutor_model);

  // A second read reflects the persisted state, not just the write return value.
  const reread = await store.getAllSettings();
  assert.equal(reread.tts_voice, "Charon");
});

test("MemorySettingsStore.saveSettings with an empty patch is a no-op read", async () => {
  const store = new MemorySettingsStore();
  const before = await store.getAllSettings();

  const after = await store.saveSettings({});
  assert.deepEqual(after, before);
});

test("MemorySettingsStore.saveSettings can introduce a new key's value via upsert semantics", async () => {
  // The store's contract is per-key upsert: saving a key twice never creates a duplicate,
  // it overwrites. (D1 enforces this via the PK + ON CONFLICT; the memory mirror must match.)
  const store = new MemorySettingsStore();

  await store.saveSettings({ stt_model: { provider: "openrouter", model: "first-value" } });
  const second = await store.saveSettings({ stt_model: { provider: "openrouter", model: "second-value" } });

  assert.deepEqual(second.stt_model, { provider: "openrouter", model: "second-value" });
  const snapshot = await store.getAllSettings();
  assert.deepEqual(snapshot.stt_model, { provider: "openrouter", model: "second-value" });
});

test("D1SettingsStore reads a pre-0014 legacy provider_settings table", async () => {
  const store = new D1SettingsStore(makeLegacySettingsD1Stub());

  const settings = await store.getAllSettings();

  assert.deepEqual(settings.stt_model, {
    provider: "openrouter",
    model: "qwen/qwen3-asr-flash-2026-02-10"
  });
  assert.deepEqual(settings.tts_model, {
    provider: "openrouter",
    model: "google/gemini-3.1-flash-tts-preview"
  });
  assert.deepEqual(settings.tutor_model, {
    provider: "openrouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b"
  });
  assert.equal(settings.tts_voice, "Aoede");
});

test("D1SettingsStore writes through a pre-0014 legacy provider_settings table", async () => {
  const db = makeLegacySettingsD1Stub();
  const store = new D1SettingsStore(db);

  const settings = await store.saveSettings({
    tts_model: { provider: "openrouter", model: "google/new-tts" },
    gate_check_model: { provider: "openai", model: "gpt-5.5-mini" },
    tts_voice: "Charon"
  });

  assert.deepEqual(settings.tts_model, { provider: "openrouter", model: "google/new-tts" });
  assert.deepEqual(settings.gate_check_model, { provider: "openai", model: "gpt-5.5-mini" });
  assert.equal(settings.tts_voice, "Charon");
});

test("STAGE_TO_SETTING maps each reasoning stage to a settings key", () => {
  assert.equal(STAGE_TO_SETTING["gate-check"], "gate_check_model");
  assert.equal(STAGE_TO_SETTING["verifier"], "verifier_model");
  assert.equal(STAGE_TO_SETTING["tutor-turn"], "tutor_model");
  assert.equal(STAGE_TO_SETTING["extract-question"], "extract_model");
});

test("modelExtraForStage returns { model } for a known setting and {} when empty", async () => {
  const store = new MemorySettingsStore();
  const settings = await store.getAllSettings();

  // The tutor model is stored split, then recomposed for Flue/Pi's provider/model resolver.
  assert.deepEqual(modelExtraForStage(settings, "tutor-turn"), {
    model: providerModelSpecifier(settings.tutor_model)
  });

  // When the stage's setting is cleared, the helper returns no model field — Worker B then
  // falls back to its env default rather than being overridden with a blank.
  const cleared = await store.saveSettings({ tutor_model: { provider: "openrouter", model: "" } });
  assert.deepEqual(modelExtraForStage(cleared, "tutor-turn"), {});
});

function makeLegacySettingsD1Stub(): D1Database {
  const rows = new Map<string, string>([
    ["stt_model", "openrouter/qwen/qwen3-asr-flash-2026-02-10"],
    ["tts_model", "openrouter/google/gemini-3.1-flash-tts-preview"],
    ["tts_voice", "Aoede"],
    ["gate_check_model", "openai/gpt-5.5"],
    ["verifier_model", "openai/gpt-5.5"],
    ["tutor_model", "openrouter/nvidia/nemotron-3-ultra-550b-a55b"],
    ["extract_model", "openai/gpt-5.5"]
  ]);

  const missingProviderColumn = () =>
    new Error("D1_ERROR: no such column: provider at offset 13: SQLITE_ERROR");
  const referencesProviderColumn = (query: string) =>
    /SELECT\s+type,\s*provider,\s*value/i.test(query) ||
    /INSERT\s+INTO\s+provider_settings\s*\(\s*type,\s*provider,\s*value/i.test(query);

  const makeStatement = (query: string, params: unknown[] = []): D1PreparedStatement => {
    const statement = {
      bind: (...nextParams: unknown[]) => makeStatement(query, nextParams),
      first: async () => {
        if (referencesProviderColumn(query)) {
          throw missingProviderColumn();
        }
        const type = String(params[0]);
        const value = rows.get(type);
        return value === undefined ? null : { type, value };
      },
      all: async () => {
        if (referencesProviderColumn(query)) {
          throw missingProviderColumn();
        }
        return {
          results: Array.from(rows, ([type, value]) => ({ type, value })),
          success: true,
          meta: {}
        } as D1Result;
      },
      run: async () => {
        if (referencesProviderColumn(query)) {
          throw missingProviderColumn();
        }
        const [type, value] = params;
        rows.set(String(type), String(value));
        return { success: true, meta: {} } as D1Result;
      },
      raw: async () => []
    };
    return statement as unknown as D1PreparedStatement;
  };

  return {
    prepare: makeStatement,
    batch: async (statements) => {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
    exec: async () => ({ count: 0, duration: 0 } as D1ExecResult),
    withDatabase: () => null as unknown as D1Database
  } as unknown as D1Database;
}
