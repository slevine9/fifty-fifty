// Arcade mode: unlimited two-choice streak runs backed by a cached & auto-refilling question pool.
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const seed = require('./questions/seed');
const { buildArcadeBatch } = require('./questions');
const { fingerprint } = require('./questions/util');
const { getPlayerStats } = require('./stats');

const MAX_POOL = 280;
const LOW_POOL = 40;
let refillPromise = null;

function publicQuestion(q, number, servedAt) {
  const elapsed = (Date.now() - servedAt) / 1000;
  return {
    number,
    text: q.q,
    options: q.options,
    category: q.category,
    type: q.type || 'text',
    image: q.image || null,
    credit: q.credit || null,
    secondsLeft: Math.max(0, +(config.timeLimit - elapsed).toFixed(2)),
  };
}

function storeQuestions(list) {
  if (!list.length) return;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO arcade_pool (hash, question_json, source, difficulty, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const q of list) {
      if (!q?.q || !Array.isArray(q.options) || q.options.length !== 2 || q.options[0] === q.options[1]) continue;
      ins.run(fingerprint(q), JSON.stringify(q), q.source || 'seed', q.difficulty || 'medium', now);
    }
    const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM arcade_pool').get();
    if (cnt > MAX_POOL) {
      db.prepare(`
        DELETE FROM arcade_pool
        WHERE hash IN (SELECT hash FROM arcade_pool ORDER BY created_at ASC LIMIT ?)
      `).run(cnt - MAX_POOL);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function quickSeedPool() {
  // Pull any existing daily sets + offline seed list so Arcade starts immediately with zero network wait.
  const rows = db.prepare('SELECT questions FROM daily_sets ORDER BY date DESC LIMIT 3').all();
  const fromDaily = rows.flatMap((r) => {
    try { return JSON.parse(r.questions); } catch { return []; }
  });
  storeQuestions(fromDaily);
  return seed.fetchQuestions(50).then(storeQuestions);
}

function triggerRefill() {
  if (refillPromise) return refillPromise;
  const onlySeed = Object.keys(config.mix).every((k) => k === 'seed');
  if (onlySeed) return Promise.resolve();
  refillPromise = buildArcadeBatch(45)
    .then((batch) => storeQuestions(batch))
    .catch((err) => console.warn('[arcade] background pool refill failed:', err.message))
    .finally(() => { refillPromise = null; });
  return refillPromise;
}

async function ensurePool() {
  const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM arcade_pool').get();
  if (cnt === 0) {
    await quickSeedPool();
    triggerRefill();
  } else if (cnt < LOW_POOL) {
    triggerRefill();
  }
}

function drawQuestion(seenHashes, currentStreak) {
  const rows = db.prepare('SELECT hash, question_json, difficulty FROM arcade_pool').all();
  if (!rows.length) throw new Error('Arcade question pool is empty');

  const seen = new Set(seenHashes);
  let available = rows.filter((r) => !seen.has(r.hash));
  let resetSeen = false;
  if (!available.length) {
    // Endless mode: if a player exhausts the entire pool in one run, allow cycling again (except the last item).
    const lastHash = seenHashes[seenHashes.length - 1];
    available = rows.filter((r) => r.hash !== lastHash);
    if (!available.length) available = rows;
    resetSeen = true;
  }

  const preferredTier = currentStreak < 5 ? 'easy' : currentStreak < 14 ? 'medium' : 'hard';
  const tierMatches = available.filter((r) => r.difficulty === preferredTier);
  const pool = tierMatches.length ? tierMatches : available;
  const pick = pool[crypto.randomInt(pool.length)];

  return {
    hash: pick.hash,
    question: JSON.parse(pick.question_json),
    nextSeen: resetSeen ? [pick.hash] : [...seenHashes, pick.hash],
  };
}

function getPersonalBest(playerId) {
  if (!playerId) return 0;
  const row = db.prepare("SELECT MAX(streak) AS best FROM arcade_runs WHERE player_id = ? AND status = 'out'").get(playerId);
  return row?.best || 0;
}

function getActiveRun(playerId) {
  return db.prepare("SELECT * FROM arcade_runs WHERE player_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1").get(playerId);
}

const clientPlayer = (p) =>
  p ? { name: p.name, email: p.email, avatarUrl: p.avatarUrl, authProvider: p.authProvider, isGuest: p.isGuest } : null;

async function getArcadeState(player) {
  const state = {
    mode: 'arcade',
    timeLimit: config.timeLimit,
    googleEnabled: config.googleEnabled,
    player: clientPlayer(player),
    run: null,
    question: null,
    personalBest: player ? getPersonalBest(player.id) : 0,
    stats: player ? getPlayerStats(player.id) : null,
  };
  if (!player) return state;

  const run = getActiveRun(player.id);
  if (!run) return state;

  const q = JSON.parse(run.question_json);
  if (Date.now() - run.served_at > config.timeLimit * 1000 + config.graceMs) {
    db.prepare("UPDATE arcade_runs SET status = 'out', ended_at = ? WHERE id = ?").run(Date.now(), run.id);
    state.run = { id: run.id, status: 'out', streak: run.streak };
    state.reveal = { correctIndex: q.answer, timedOut: true };
    state.personalBest = getPersonalBest(player.id);
    state.stats = getPlayerStats(player.id);
    return state;
  }

  state.run = { id: run.id, status: 'in_progress', streak: run.streak };
  state.question = publicQuestion(q, run.streak + 1, run.served_at);
  return state;
}

async function startArcadeRun(player) {
  const existing = getActiveRun(player.id);
  if (existing) {
    if (Date.now() - existing.served_at > config.timeLimit * 1000 + config.graceMs) {
      db.prepare("UPDATE arcade_runs SET status = 'out', ended_at = ? WHERE id = ?").run(Date.now(), existing.id);
    } else {
      return getArcadeState(player);
    }
  }

  await ensurePool();
  const { hash, question, nextSeen } = drawQuestion([], 0);
  const now = Date.now();
  db.prepare(`
    INSERT INTO arcade_runs (player_id, status, streak, question_json, seen_hashes, served_at, started_at)
    VALUES (?, 'in_progress', 0, ?, ?, ?, ?)
  `).run(player.id, JSON.stringify(question), JSON.stringify(nextSeen), now + config.leadMs, now);

  // Warm the pool in the background if needed.
  const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM arcade_pool').get();
  if (cnt < LOW_POOL) triggerRefill();

  return getArcadeState(player);
}

async function submitArcadeAnswer(player, choice) {
  const run = getActiveRun(player.id);
  if (!run) return { error: 'No active arcade run', status: 409 };
  if (choice !== 0 && choice !== 1) return { error: 'Bad choice', status: 400 };

  const q = JSON.parse(run.question_json);
  const now = Date.now();
  const timedOut = now - run.served_at > config.timeLimit * 1000 + config.graceMs;
  const correct = !timedOut && choice === q.answer;

  if (!correct) {
    const prevBest = getPersonalBest(player.id);
    db.prepare("UPDATE arcade_runs SET status = 'out', ended_at = ? WHERE id = ?").run(now, run.id);
    const stats = getPlayerStats(player.id);
    return {
      correct: false,
      timedOut,
      correctIndex: q.answer,
      streak: run.streak,
      over: true,
      newBest: run.streak > prevBest && run.streak > 0,
      personalBest: Math.max(prevBest, run.streak),
      stats,
    };
  }

  const streak = run.streak + 1;
  await ensurePool();
  let seen = [];
  try { seen = JSON.parse(run.seen_hashes || '[]'); } catch { seen = []; }
  const { question: nextQ, nextSeen } = drawQuestion(seen, streak);
  const servedAt = now + config.leadMs;

  db.prepare(`
    UPDATE arcade_runs
    SET streak = ?, question_json = ?, seen_hashes = ?, served_at = ?, last_correct_at = ?
    WHERE id = ?
  `).run(streak, JSON.stringify(nextQ), JSON.stringify(nextSeen), servedAt, now, run.id);

  return {
    correct: true,
    correctIndex: q.answer,
    streak,
    over: false,
    next: publicQuestion(nextQ, streak + 1, servedAt),
  };
}

function arcadeLeaderboard(player, limit = 50) {
  // All-time highest arcade streak per player; ties go to whoever reached it earliest.
  const rows = db.prepare(`
    SELECT p.id AS pid, p.name, best.streak, best.achieved_at,
           EXISTS(SELECT 1 FROM arcade_runs live WHERE live.player_id = p.id AND live.status = 'in_progress') AS is_live
    FROM players p
    JOIN (
      SELECT player_id, MAX(streak) AS streak, MIN(COALESCE(last_correct_at, started_at)) AS achieved_at
      FROM arcade_runs
      WHERE status = 'out'
      GROUP BY player_id
    ) best ON best.player_id = p.id
    ORDER BY best.streak DESC, best.achieved_at ASC
  `).all();

  const entries = rows.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    streak: r.streak,
    live: Boolean(r.is_live),
    you: !!player && r.pid === player.id,
  }));
  const idx = player ? rows.findIndex((r) => r.pid === player.id) : -1;
  return {
    mode: 'arcade',
    total: rows.length,
    entries,
    you: idx >= 0 ? { rank: idx + 1, streak: rows[idx].streak } : null,
  };
}

module.exports = {
  getArcadeState,
  startArcadeRun,
  submitArcadeAnswer,
  arcadeLeaderboard,
  ensurePool,
};
