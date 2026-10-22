-- Additive: all existing server balances remain eligible. No balance conversion.
ALTER TABLE e_transactions DROP CONSTRAINT IF EXISTS e_transactions_type_check;
ALTER TABLE e_transactions ADD CONSTRAINT e_transactions_type_check CHECK(type IN
 ('MATCH_EARNING','WIN_REWARD','BOSS_REWARD','EVENT_REWARD','ADMIN_ADJUSTMENT',
  'SHOP_PURCHASE','REFUND','WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','TOURNAMENT_ENTRY'));
CREATE TABLE IF NOT EXISTS k_withdrawals (
 id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL, destination VARCHAR(44) NOT NULL,
 terms_version TEXT NOT NULL DEFAULT '2026-09-17-K',
 k_amount NUMERIC(18,4) NOT NULL CHECK(k_amount>0),
 usdc_units NUMERIC(18,0) NOT NULL CHECK(usdc_units>0),
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','submitted','completed','failed','review')),
 provider_id TEXT UNIQUE, signature VARCHAR(88) UNIQUE, reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 lease_until TIMESTAMPTZ, UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS k_withdrawals_queue ON k_withdrawals(state,lease_until);
CREATE TABLE IF NOT EXISTS k_withdrawal_lock (id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO k_withdrawal_lock VALUES(1) ON CONFLICT DO NOTHING;
