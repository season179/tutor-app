ALTER TABLE tutor_sessions ADD COLUMN extraction_outcome TEXT;
ALTER TABLE tutor_sessions ADD COLUMN extraction_notes TEXT;
ALTER TABLE tutor_sessions ADD COLUMN prompt_confirmed INTEGER NOT NULL DEFAULT 0;
