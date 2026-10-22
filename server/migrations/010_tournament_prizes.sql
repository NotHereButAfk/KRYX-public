ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prizes JSONB NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS tournament_scores (
 tournament_id UUID NOT NULL REFERENCES tournaments(id), user_id BIGINT NOT NULL REFERENCES users(id),
 score BIGINT NOT NULL DEFAULT 0, reached_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tournament_id,user_id)
);
CREATE TABLE IF NOT EXISTS tournament_prizes (
 id UUID PRIMARY KEY, tournament_id UUID NOT NULL REFERENCES tournaments(id), user_id BIGINT NOT NULL REFERENCES users(id),
 place INTEGER NOT NULL, score BIGINT NOT NULL, destination VARCHAR(44) NOT NULL, discord_id VARCHAR(24),
 amount_units NUMERIC(18,0) NOT NULL CHECK(amount_units>0), state TEXT NOT NULL DEFAULT 'queued',
 signature VARCHAR(88), wire TEXT, last_valid_height BIGINT, win_notified BOOLEAN NOT NULL DEFAULT FALSE,
 paid_notified BOOLEAN NOT NULL DEFAULT FALSE, next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(tournament_id,user_id), UNIQUE(tournament_id,place)
);

CREATE TABLE IF NOT EXISTS tournament_payout_lock(id INTEGER PRIMARY KEY);
INSERT INTO tournament_payout_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
