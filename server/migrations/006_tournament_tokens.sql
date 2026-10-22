ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_asset_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_asset_check CHECK(asset IN ('SOL','USDC','K'));
ALTER TABLE tournament_orders DROP CONSTRAINT IF EXISTS tournament_orders_asset_check;
ALTER TABLE tournament_orders ADD CONSTRAINT tournament_orders_asset_check CHECK(asset IN ('SOL','USDC','K'));
ALTER TABLE e_transactions DROP CONSTRAINT IF EXISTS e_transactions_type_check;
ALTER TABLE e_transactions ADD CONSTRAINT e_transactions_type_check CHECK(type IN
 ('MATCH_EARNING','WIN_REWARD','BOSS_REWARD','EVENT_REWARD','ADMIN_ADJUSTMENT','SHOP_PURCHASE','REFUND','WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','TOURNAMENT_ENTRY'));
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS discord_interaction_id VARCHAR(24) UNIQUE;
