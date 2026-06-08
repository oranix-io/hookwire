CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  provider_hint TEXT,
  client_token_hash TEXT NOT NULL,
  ingest_secret_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired','deleted')),
  max_events INTEGER NOT NULL DEFAULT 100,
  ttl_hours INTEGER NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  expires_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_channels_user_id ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_channel_name ON channels(channel_name);
CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);
