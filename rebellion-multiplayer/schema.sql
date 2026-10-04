-- D1 schema for Rebellion Race.  Apply once:  npx wrangler d1 execute rebellion --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS players (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT    NOT NULL UNIQUE,   -- SHA-256 of the random browser token (the "account")
  nickname     TEXT,
  nickname_lc  TEXT    UNIQUE,            -- case-insensitive uniqueness
  score        INTEGER NOT NULL DEFAULT 0, -- accumulated "cars beaten" (the original leaderboard metric)
  races        INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_score ON players (score DESC, id ASC);

-- One row per owned car slot (1..12). status is the game's own string, e.g.
-- "id=c3&locked=false&speedIcons=2&handlingIcons=0&accelIcons=1". Missing rows = defaults (c0 unlocked).
CREATE TABLE IF NOT EXISTS player_cars (
  player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  car       INTEGER NOT NULL CHECK (car BETWEEN 1 AND 12),
  status    TEXT    NOT NULL,
  PRIMARY KEY (player_id, car)
);
