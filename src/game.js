// Game rules. The server is the only place that knows the answers.
//   - Questions are revealed one at a time, only after the previous one was answered correctly.
//   - Each question has a server-enforced timer that keeps running across page reloads.
//   - Wrong answer or timeout ends the daily run. One run per player per day.
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const { ensureSet } = require('./questions');
const { todayKey } = require('./dates');
const { getPlayerStats } = require('./stats');

// ---------- runs ----------
const getRun = (date, playerId) =>
  db.prepare('SELECT * FROM runs WHERE date = ? AND player_id = ?').get(date, playerId);

function publicQuestion(set, run) {
  const q = set[run.current_index];
  // served_at may be slightly in the future (config.leadMs) so the clock doesn't start until the
  // client has finished its reveal/transition animation. secondsLeft can therefore exceed timeLimit.
  const elapsed = (Date.now() - run.served_at) / 1000;
  return {
    number: run.current_index + 1,
    text: q.q,
    options: q.options,
    category: q.category,
    type: q.type || 'text',
    image: q.image || null,
    credit: q.credit || null,
    secondsLeft: Math.max(0, +(config.timeLimit - elapsed).toFixed(2)),
  };
}

const clientPlayer = (p) =>
  p ? { name: p.name, email: p.email, avatarUrl: p.avatarUrl, authProvider: p.authProvider, isGuest: p.isGuest } : null;

/** Everything the client needs to render the current screen. Never includes answers. */
async function getState(player) {
  const date = todayKey();
  const state = {
    mode: 'daily',
    date,
    timeLimit: config.timeLimit,
    googleEnabled: config.googleEnabled,
    player: clientPlayer(player),
    run: null,
    question: null,
    stats: player ? getPlayerStats(player.id) : null,
  };
  if (!player) return state;

  const run = getRun(date, player.id);
  if (!run) return state;

  state.run = { status: run.status, streak: run.streak };
  if (run.status === 'in_progress') {
    const set = await ensureSet(date);
    const q = publicQuestion(set, run);
    // If the page was closed long enough for the timer to expire, the question is already lost.
    if (Date.now() - run.served_at > config.timeLimit * 1000 + config.graceMs) {
      const answer = set[run.current_index].answer;
      db.prepare("UPDATE runs SET status = 'out' WHERE date = ? AND player_id = ?").run(date, player.id);
      state.run.status = 'out';
      state.reveal = { correctIndex: answer, timedOut: true };
      state.stats = getPlayerStats(player.id);
    } else {
      state.question = q;
    }
  }
  return state;
}

async function startRun(player) {
  const date = todayKey();
  await ensureSet(date);
  const existing = getRun(date, player.id);
  if (!existing) {
    const now = Date.now();
    db.prepare(
      "INSERT INTO runs (date, player_id, status, streak, current_index, served_at, started_at) VALUES (?, ?, 'in_progress', 0, 0, ?, ?)",
    ).run(date, player.id, now + config.leadMs, now);
  }
  return getState(player);
}

/** choice: 0 or 1. Returns the verdict plus the next question when the streak continues. */
async function submitAnswer(player, choice) {
  const date = todayKey();
  const run = getRun(date, player.id);
  if (!run || run.status !== 'in_progress') return { error: 'No active run', status: 409 };
  if (choice !== 0 && choice !== 1) return { error: 'Bad choice', status: 400 };

  const set = await ensureSet(date);
  const q = set[run.current_index];
  const now = Date.now();
  const timedOut = now - run.served_at > config.timeLimit * 1000 + config.graceMs;
  const correct = !timedOut && choice === q.answer;

  if (!correct) {
    db.prepare("UPDATE runs SET status = 'out' WHERE date = ? AND player_id = ?").run(date, player.id);
    return { correct: false, timedOut, correctIndex: q.answer, streak: run.streak, over: true, stats: getPlayerStats(player.id) };
  }

  const streak = run.streak + 1;
  const nextIndex = run.current_index + 1;
  if (nextIndex >= set.length) {
    db.prepare("UPDATE runs SET status = 'perfect', streak = ?, current_index = ?, last_correct_at = ? WHERE date = ? AND player_id = ?")
      .run(streak, nextIndex, now, date, player.id);
    return { correct: true, correctIndex: q.answer, streak, over: true, perfect: true, stats: getPlayerStats(player.id) };
  }

  db.prepare('UPDATE runs SET streak = ?, current_index = ?, served_at = ?, last_correct_at = ? WHERE date = ? AND player_id = ?')
    .run(streak, nextIndex, now + config.leadMs, now, date, player.id);
  const next = publicQuestion(set, { ...run, current_index: nextIndex, served_at: now + config.leadMs });
  return { correct: true, correctIndex: q.answer, streak, over: false, next };
}

// ---------- leaderboard ----------
function leaderboard(player, limit = 50) {
  const date = todayKey();
  // Most correct in a row wins; ties go to whoever got there first.
  const rows = db.prepare(`
    SELECT p.id AS pid, p.name, r.streak, r.status
    FROM runs r JOIN players p ON p.id = r.player_id
    WHERE r.date = ?
    ORDER BY r.streak DESC, COALESCE(r.last_correct_at, r.started_at) ASC
  `).all(date);

  const entries = rows.slice(0, limit).map((r, i) => ({
    rank: i + 1, name: r.name, streak: r.streak, live: r.status === 'in_progress', you: !!player && r.pid === player.id,
  }));
  const idx = player ? rows.findIndex((r) => r.pid === player.id) : -1;
  return { date, total: rows.length, entries, you: idx >= 0 ? { rank: idx + 1, streak: rows[idx].streak } : null };
}

module.exports = {
  createPlayer: auth.createPlayer,
  playerByToken: auth.playerByToken,
  renamePlayer: auth.renamePlayer,
  getState,
  startRun,
  submitAnswer,
  leaderboard,
};
