-- One-time retirement of the old implicit FFA win bonus. Never touch balances.
CREATE TABLE IF NOT EXISTS economy_data_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
WITH applied AS (
  INSERT INTO economy_data_migrations(id) VALUES ('ffa-kill-rewards-v1')
  ON CONFLICT DO NOTHING RETURNING id
)
UPDATE e_config SET
  config = jsonb_set(config, '{modes,deathmatch,winE}', '"0"'::jsonb),
  revision = revision + 1, updated_at = NOW()
WHERE EXISTS (SELECT 1 FROM applied)
  AND (config #>> '{modes,deathmatch,winE}')::numeric = 25;
