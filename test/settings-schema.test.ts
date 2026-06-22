import assert from "node:assert/strict";

import { providerSettingsPatchSchema } from "../src/modules/settings/settings-schema.ts";

// The save flow posts only the slots the user edited (the page's diff), so the validator MUST
// accept a partial patch. An earlier version built this with z.record(z.enum(...), z.string()),
// which validates as a FULL record and rejected every partial save with the exact error the
// user hit ("expected string, received undefined" for the unedited keys). These tests pin the
// partial-acceptance contract so that regression can't silently return.

test("a partial patch (one edited slot) validates", () => {
  const parsed = providerSettingsPatchSchema.parse({
    tutor_model: { provider: "openai", model: "gpt-5.5" }
  });
  assert.deepEqual(parsed, { tutor_model: { provider: "openai", model: "gpt-5.5" } });
});

test("a two-slot patch validates and keeps only the edited keys", () => {
  const parsed = providerSettingsPatchSchema.parse({
    tts_voice: "Charon",
    gate_check_model: { provider: "openai", model: "gpt-5.5-mini" }
  });
  assert.deepEqual(parsed, {
    tts_voice: "Charon",
    gate_check_model: { provider: "openai", model: "gpt-5.5-mini" }
  });
});

test("an empty object validates as a no-op patch", () => {
  // The page posts an empty diff when the user clicks Save without changing anything.
  assert.deepEqual(providerSettingsPatchSchema.parse({}), {});
});

test("a full snapshot (every slot) still validates", () => {
  const parsed = providerSettingsPatchSchema.parse({
    stt_model: { provider: "openrouter", model: "qwen/x" },
    tts_model: { provider: "openrouter", model: "google/y" },
    tts_voice: "Aoede",
    gate_check_model: { provider: "openai", model: "a" },
    verifier_model: { provider: "openai", model: "b" },
    tutor_model: { provider: "openrouter", model: "nvidia/c" },
    extract_model: { provider: "openai", model: "d" }
  });
  assert.deepEqual(parsed.tutor_model, { provider: "openrouter", model: "nvidia/c" });
});

test("an empty model value is rejected (every slot, when present, must be non-empty)", () => {
  // The store's upsert would write a blank, and Worker B would override its env default with
  // empty — reject at the schema gate.
  assert.throws(() =>
    providerSettingsPatchSchema.parse({ tutor_model: { provider: "openrouter", model: "" } })
  );
});

test("a combined provider/model string is rejected for model slots", () => {
  assert.throws(() => providerSettingsPatchSchema.parse({ tutor_model: "openrouter/nvidia/c" }));
});

test("a stray key (not a known setting type) is rejected", () => {
  // .strict() — an unknown key is an error, not silently dropped, so a typo'd field name can't
  // look like it saved while writing nothing.
  assert.throws(() =>
    providerSettingsPatchSchema.parse({
      tutor_modal: { provider: "openai", model: "gpt-5.5" }
    } as Record<string, unknown>)
  );
});
