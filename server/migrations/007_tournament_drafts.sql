CREATE TABLE IF NOT EXISTS tournament_drafts (
 id UUID PRIMARY KEY, discord_id VARCHAR(24) NOT NULL, origin_id VARCHAR(24) NOT NULL UNIQUE,
 payload JSONB NOT NULL DEFAULT '{}', stage TEXT NOT NULL DEFAULT 'schedule',
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS tournament_drafts_expiry ON tournament_drafts(expires_at);
