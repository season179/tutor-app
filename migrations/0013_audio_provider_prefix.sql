-- Corrects the audio model rows from 0011: STT/TTS run ON OpenRouter, so the legacy
-- combined value carries the openrouter provider prefix (the model may nest a vendor
-- namespace, e.g. openrouter/qwen/qwen3-...). The original 0011 seed dropped the prefix,
-- which made the provider dropdown on /settings mis-attribute the model to a bare "qwen" /
-- "google" provider.
--
-- Preserve any already-customized model value. Migration 0014 then splits this legacy
-- provider prefix into its own column and leaves the audio API value bare again.
UPDATE provider_settings
  SET value = 'openrouter/' || value, updated_at = CURRENT_TIMESTAMP
  WHERE type = 'stt_model' AND value NOT LIKE 'openrouter/%';
UPDATE provider_settings
  SET value = 'openrouter/' || value, updated_at = CURRENT_TIMESTAMP
  WHERE type = 'tts_model' AND value NOT LIKE 'openrouter/%';
