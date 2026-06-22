-- Global provider/model settings (one keyed row per setting). The app's STT/TTS and the
-- four reasoning-stage models used to live as env `vars` in the wrangler configs; they now
-- live here so they're editable from the /settings page and swappable per-turn without a
-- redeploy. Keyed rows (type → value) instead of one column per setting: a future model
-- slot is a new row + a typed-union entry, never an ALTER TABLE.
--
-- This migration introduced the original combined provider/model value. Migration 0014
-- splits model rows into provider + bare model columns while preserving this migration for
-- databases that have already applied it.
--
-- Worker A reads the stt_model / tts_model / tts_voice rows when building voice pipeline
-- options, and ships gate_check_model / verifier_model / tutor_model / extract_model across
-- the REASONING service binding as a per-call model override (Worker B's Flue workflows
-- forward `payload.model` into `session.prompt({ model })`).
CREATE TABLE provider_settings (
  type       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed with the values that were previously the env-var defaults (see voice-pipeline-service.ts
-- `default*` constants + reasoning-worker/wrangler.jsonc `vars`), so the app keeps behaving
-- identically the moment this migration lands, before anyone touches the UI. Audio models run
-- ON OpenRouter, so the STT/TTS values carry the openrouter provider prefix here (the model
-- itself may nest a vendor namespace, e.g. openrouter/qwen/qwen3-...). Migration 0014 splits
-- that prefix into the provider column.
INSERT INTO provider_settings (type, value, updated_at) VALUES
  ('stt_model',        'openrouter/qwen/qwen3-asr-flash-2026-02-10',            CURRENT_TIMESTAMP),
  ('tts_model',        'openrouter/google/gemini-3.1-flash-tts-preview',        CURRENT_TIMESTAMP),
  ('tts_voice',        'Aoede',                                               CURRENT_TIMESTAMP),
  ('gate_check_model', 'openai/gpt-5.5',                                      CURRENT_TIMESTAMP),
  ('verifier_model',   'openai/gpt-5.5',                                      CURRENT_TIMESTAMP),
  ('tutor_model',      'openrouter/nvidia/nemotron-3-ultra-550b-a55b',         CURRENT_TIMESTAMP),
  ('extract_model',    'openai/gpt-5.5',                                      CURRENT_TIMESTAMP);
