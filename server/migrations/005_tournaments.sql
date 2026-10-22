CREATE TABLE IF NOT EXISTS tournament_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  solana_address VARCHAR(44), discord_id VARCHAR(24) UNIQUE, discord_name VARCHAR(80)
);
CREATE TABLE IF NOT EXISTS discord_link_codes (
  code_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS discord_interactions (
  id VARCHAR(24) PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY, title VARCHAR(80) NOT NULL, description VARCHAR(1200) NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL, closes_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 128),
  asset VARCHAR(4) NOT NULL CHECK(asset IN ('SOL','USDC')),
  fee_units NUMERIC(30,0) NOT NULL CHECK(fee_units>0),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','completed')),
  created_by BIGINT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  announcement_id VARCHAR(24)
);
CREATE TABLE IF NOT EXISTS tournament_orders (
  id UUID PRIMARY KEY, tournament_id UUID NOT NULL REFERENCES tournaments(id),
  user_id BIGINT NOT NULL REFERENCES users(id), wallet VARCHAR(44) NOT NULL,
  asset VARCHAR(4) NOT NULL CHECK(asset IN ('SOL','USDC')),
  amount_units NUMERIC(30,0) NOT NULL CHECK(amount_units>0),
  reference VARCHAR(44) UNIQUE NOT NULL, merchant VARCHAR(44) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', signature VARCHAR(88) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  checked_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tournament_orders_pending ON tournament_orders(status,expires_at);
CREATE INDEX IF NOT EXISTS tournament_orders_user ON tournament_orders(user_id,tournament_id);
CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id UUID NOT NULL REFERENCES tournaments(id), user_id BIGINT NOT NULL REFERENCES users(id),
  order_id UUID UNIQUE NOT NULL REFERENCES tournament_orders(id), wallet VARCHAR(44) NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tournament_id,user_id)
);
