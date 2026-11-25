// Wordle-style all-time player statistics for both Daily and Arcade modes.
const db = require('./db');
const { todayKey } = require('./dates');

const BUCKETS = ['0', '1-4', '5-9', '10-14', '15-19', '20-29', '30+'];

function bucketFor(score) {
  if (score <= 0) return '0';
  if (score <= 4) return '1-4';
  if (score <= 9) return '5-9';
  if (score <= 14) return '10-14';
  if (score <= 19) return '15-19';
  if (score <= 29) return '20-29';
  return '30+';
}

function emptyDistribution() {
  return Object.fromEntries(BUCKETS.map((b) => [b, 0]));
}

const dayIndex = (yyyyMmDd) => Math.floor(Date.parse(`${yyyyMmDd}T00:00:00Z`) / 86_400_000);

function computeDayStreaks(datesAsc) {
  if (!datesAsc.length) return { currentDayStreak: 0, maxDayStreak: 0 };
  const indices = [...new Set(datesAsc)].sort().map(dayIndex);
  let maxDayStreak = 1;
  let run = 1;
  for (let i = 1; i < indices.length; i++) {
    run = indices[i] === indices[i - 1] + 1 ? run + 1 : 1;
    if (run > maxDayStreak) maxDayStreak = run;
  }

  const todayIdx = dayIndex(todayKey());
  const lastIdx = indices[indices.length - 1];
  // Active day streak if the player finished today's or yesterday's daily game.
  let currentDayStreak = 0;
  if (lastIdx === todayIdx || lastIdx === todayIdx - 1) {
    currentDayStreak = 1;
    for (let i = indices.length - 2; i >= 0; i--) {
      if (indices[i] === indices[i + 1] - 1) currentDayStreak++;
      else break;
    }
  }
  return { currentDayStreak, maxDayStreak };
}

function summarizeRuns(rows) {
  const distribution = emptyDistribution();
  let bestStreak = 0;
  let totalCorrect = 0;
  for (const r of rows) {
    if (r.streak > bestStreak) bestStreak = r.streak;
    totalCorrect += r.streak;
    distribution[bucketFor(r.streak)]++;
  }
  const played = rows.length;
  const avgStreak = played ? +(totalCorrect / played).toFixed(1) : 0;
  return { played, bestStreak, avgStreak, totalCorrect, distribution };
}

function getPlayerStats(playerId) {
  if (!playerId) return null;

  const dailyRows = db.prepare(`
    SELECT date, status, streak
    FROM runs
    WHERE player_id = ? AND status IN ('out', 'perfect')
    ORDER BY date ASC
  `).all(playerId);

  const dailySummary = summarizeRuns(dailyRows);
  const perfects = dailyRows.filter((r) => r.status === 'perfect').length;
  const { currentDayStreak, maxDayStreak } = computeDayStreaks(dailyRows.map((r) => r.date));
  const dailyLast = dailyRows.length ? dailyRows[dailyRows.length - 1].streak : null;

  const arcadeRows = db.prepare(`
    SELECT streak, started_at, ended_at
    FROM arcade_runs
    WHERE player_id = ? AND status = 'out'
    ORDER BY started_at ASC
  `).all(playerId);

  const arcadeSummary = summarizeRuns(arcadeRows);
  const arcadeLast = arcadeRows.length ? arcadeRows[arcadeRows.length - 1].streak : null;
  const recentRuns = arcadeRows.slice(-5).reverse().map((r) => ({
    streak: r.streak,
    startedAt: r.started_at,
  }));

  return {
    buckets: BUCKETS,
    daily: {
      ...dailySummary,
      perfects,
      currentDayStreak,
      maxDayStreak,
      lastScore: dailyLast,
      lastBucket: dailyLast === null ? null : bucketFor(dailyLast),
    },
    arcade: {
      ...arcadeSummary,
      lastScore: arcadeLast,
      lastBucket: arcadeLast === null ? null : bucketFor(arcadeLast),
      recentRuns,
    },
  };
}

module.exports = { getPlayerStats, bucketFor, BUCKETS };
