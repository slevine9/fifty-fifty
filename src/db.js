const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { dataDir } = require('./config');

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'fiftyfifty.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

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

  -- Question fingerprints so the same question doesn't come back on a later day.
  CREATE TABLE IF NOT EXISTS used_questions (
    hash TEXT PRIMARY KEY,
    date TEXT NOT NULL
  );
`);

module.exports = db;
