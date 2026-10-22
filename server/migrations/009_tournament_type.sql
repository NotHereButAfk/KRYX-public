ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tournament_type TEXT
  CHECK (tournament_type IN ('most_kills','longest_survival'));
