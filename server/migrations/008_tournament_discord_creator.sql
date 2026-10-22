-- Discord moderators do not need a game account; retain their audit identity.
ALTER TABLE tournaments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_by_discord_id VARCHAR(24);
