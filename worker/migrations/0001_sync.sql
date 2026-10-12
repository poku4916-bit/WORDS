CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  github_id TEXT NOT NULL,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS sync_changes (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  record_key TEXT NOT NULL,
  entity TEXT NOT NULL,
  value TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_records (
  record_key TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  value TEXT,
  revision INTEGER NOT NULL,
  last_operation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_records_revision ON sync_records(revision);
