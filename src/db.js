const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { dataDir } = require('./config');

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'fiftyfifty.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token         TEXT UNIQUE,
    name          TEXT NOT NULL,
    email         TEXT,
    google_id     TEXT,
    avatar_url    TEXT,
    password_hash TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'guest',
    created_at    INTEGER NOT NULL
  );

  -- Multi-device session tokens mapped to a player account.
  CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

  -- One row per day. "questions" is a JSON array of
  -- { q, options: [a, b], answer: 0|1, category, source }
  CREATE TABLE IF NOT EXISTS daily_sets (
    date       TEXT PRIMARY KEY,
    questions  TEXT NOT NULL,
    sources    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- One attempt per player per day.
  CREATE TABLE IF NOT EXISTS runs (
    date            TEXT NOT NULL,
    player_id       INTEGER NOT NULL REFERENCES players(id),
    status          TEXT NOT NULL,            -- in_progress | out | perfect
    streak          INTEGER NOT NULL DEFAULT 0,
    current_index   INTEGER NOT NULL DEFAULT 0,
    served_at       INTEGER NOT NULL,         -- when the current question was first shown
    last_correct_at INTEGER,                  -- tie-breaker: earlier wins
    started_at      INTEGER NOT NULL,
    PRIMARY KEY (date, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_runs_board ON runs(date, streak DESC, last_correct_at ASC);

  -- Unlimited arcade runs per player.
  CREATE TABLE IF NOT EXISTS arcade_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,            -- in_progress | out
    streak          INTEGER NOT NULL DEFAULT 0,
    question_json   TEXT,
    seen_hashes     TEXT NOT NULL DEFAULT '[]',
    served_at       INTEGER NOT NULL,
    last_correct_at INTEGER,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_arcade_player ON arcade_runs(player_id, status, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_arcade_board ON arcade_runs(status, streak DESC, started_at ASC);

  -- Cached pool of questions for instant arcade mode starts.
  CREATE TABLE IF NOT EXISTS arcade_pool (
    hash          TEXT PRIMARY KEY,
    question_json TEXT NOT NULL,
    source        TEXT NOT NULL,
    difficulty    TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  -- Question fingerprints so the same question doesn't come back on a later day.
  CREATE TABLE IF NOT EXISTS used_questions (
    hash TEXT PRIMARY KEY,
    date TEXT NOT NULL
  );
`);

// Backfill new columns for databases created before accounts existed.
const playerCols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
const migrations = [
  ['email', 'TEXT'],
  ['google_id', 'TEXT'],
  ['avatar_url', 'TEXT'],
  ['password_hash', 'TEXT'],
  ['auth_provider', "TEXT NOT NULL DEFAULT 'guest'"],
];
for (const [col, def] of migrations) {
  if (!playerCols.has(col)) db.exec(`ALTER TABLE players ADD COLUMN ${col} ${def}`);
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_google_id ON players(google_id) WHERE google_id IS NOT NULL;
`);

module.exports = db;
