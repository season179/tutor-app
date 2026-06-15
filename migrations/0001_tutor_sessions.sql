CREATE TABLE tutor_sessions (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'ended')),
  image_prompt TEXT,
  image_name TEXT,
  image_meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tutor_sessions_owner_updated
  ON tutor_sessions (owner_key, updated_at DESC);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  value_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_session_events_session_created
  ON session_events (session_id, created_at DESC);
