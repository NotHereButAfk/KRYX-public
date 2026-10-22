-- Existing account IDs, credentials and server-owned skins remain unchanged.
-- Browser-local coins are untrusted and are deliberately not imported.
ALTER TABLE users ADD COLUMN IF NOT EXISTS e_balance NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(e_balance>=0);
CREATE TABLE IF NOT EXISTS e_config (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1, config JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS e_matches (id UUID PRIMARY KEY, server_id TEXT NOT NULL, mode TEXT NOT NULL, state JSONB NOT NULL, closed BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS e_finalizations (match_id UUID NOT NULL REFERENCES e_matches(id), user_id BIGINT NOT NULL REFERENCES users(id), summary JSONB NOT NULL, finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(match_id,user_id));
CREATE TABLE IF NOT EXISTS e_transactions (
 id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), match_id UUID REFERENCES e_matches(id),
 amount NUMERIC(18,4) NOT NULL, type TEXT NOT NULL CHECK(type IN ('MATCH_EARNING','WIN_REWARD','BOSS_REWARD','EVENT_REWARD','ADMIN_ADJUSTMENT','SHOP_PURCHASE','REFUND')),
 description TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), previous_balance NUMERIC(18,4) NOT NULL, new_balance NUMERIC(18,4) NOT NULL,
 game_mode TEXT, eligible_score NUMERIC(18,4), multiplier NUMERIC(18,4), server_id TEXT, session_id TEXT, metadata JSONB NOT NULL DEFAULT '{}', idempotency_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS e_transactions_user_time ON e_transactions(user_id,created_at);
CREATE TABLE IF NOT EXISTS e_daily (user_id BIGINT NOT NULL REFERENCES users(id), day DATE NOT NULL, earned NUMERIC(18,4) NOT NULL DEFAULT 0, PRIMARY KEY(user_id,day));
CREATE TABLE IF NOT EXISTS e_equipment (user_id BIGINT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('character','weapon')), item_id TEXT NOT NULL, PRIMARY KEY(user_id,kind));
CREATE TABLE IF NOT EXISTS e_boost_usage (user_id BIGINT NOT NULL REFERENCES users(id), booster_id TEXT NOT NULL, match_id UUID NOT NULL REFERENCES e_matches(id), PRIMARY KEY(user_id,booster_id,match_id));
CREATE TABLE IF NOT EXISTS e_flags (id BIGSERIAL PRIMARY KEY, match_id UUID, user_id BIGINT REFERENCES users(id), reason TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by BIGINT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS e_admin_audit (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), action TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
