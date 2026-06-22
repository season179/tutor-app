-- Split model provider from model value. The previous provider_settings shape stored model
-- rows as one combined value like `openrouter/google/gemini-...`; that leaked the internal
-- provider prefix into OpenRouter's audio REST API. After this migration:
--
--   provider = routing/UI owner (`openrouter`, `openai`, ...)
--   value    = bare model string for that provider (`google/gemini-...`, `gpt-5.5`, ...)
--
-- `tts_voice` is not a model row, so its provider stays NULL.
ALTER TABLE provider_settings ADD COLUMN provider TEXT;

UPDATE provider_settings
SET
  provider = CASE
    WHEN instr(value, '/') > 0 THEN substr(value, 1, instr(value, '/') - 1)
    ELSE 'openai'
  END,
  value = CASE
    WHEN instr(value, '/') > 0 THEN substr(value, instr(value, '/') + 1)
    ELSE value
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE type IN (
  'stt_model',
  'tts_model',
  'gate_check_model',
  'verifier_model',
  'tutor_model',
  'extract_model'
);
