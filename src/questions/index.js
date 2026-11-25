// Builds each day's question chain from the configured mix of sources and stores it in SQLite.
// The first request of the day triggers generation (lazy), and a scheduler pre-builds tomorrow's set
// late in the evening so nobody waits at midnight.
const config = require('../config');
const db = require('../db');
const { todayKey, tomorrowKey, currentHour } = require('../dates');
const { fingerprint, shuffle } = require('./util');

const sources = {
  opentdb: require('./opentdb'),
  flags: require('./flags'),
  dogs: require('./dogs'),
  wiki: require('./wiki'),
  versus: require('./versus'),
  history: require('./history'),
  claude: require('./claude'),
  seed: require('./seed'),
};
const seed = sources.seed;

const NO_REPEAT_DAYS = 60;
const inflight = new Map(); // date -> Promise, so concurrent requests don't generate twice

function getSet(date) {
  const row = db.prepare('SELECT questions FROM daily_sets WHERE date = ?').get(date);
  return row ? JSON.parse(row.questions) : null;
}

function recentQuestionTexts(limit = 60) {
  return db.prepare('SELECT questions FROM daily_sets ORDER BY date DESC LIMIT 2').all()
    .flatMap((r) => JSON.parse(r.questions).map((q) => q.q)).slice(0, limit);
}

/** Split `target` across the mix proportionally, giving any remainder to the largest sources first. */
function quotas(mix, target) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  const out = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Math.floor((v / total) * target)]));
  let left = target - Object.values(out).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(mix).sort((a, b) => mix[b] - mix[a])) { if (left-- > 0) out[k]++; }
  return out;
}

/** Easy -> hard, shuffled within each tier, and no two questions from the same source back to back if avoidable. */
function arrange(list) {
  const rank = { easy: 0, medium: 1, hard: 2 };
  const tiers = [[], [], []];
  list.forEach((q) => tiers[rank[q.difficulty] ?? 1].push(q));
  const out = [];
  for (const tier of tiers) {
    const pool = shuffle(tier);
    while (pool.length) {
      const prev = out[out.length - 1]?.source;
      const i = pool.findIndex((q) => q.source !== prev);
      out.push(pool.splice(i === -1 ? 0 : i, 1)[0]);
    }
  }
  return out;
}

async function build(date, { force = false } = {}) {
  if (!force) {
    const existing = getSet(date);
    if (existing) return existing;
  }

  const target = config.questionsPerDay;
  const cutoff = todayKey(new Date(Date.now() - NO_REPEAT_DAYS * 86_400_000));
  const seen = new Set(db.prepare('SELECT hash FROM used_questions WHERE date >= ?').all(cutoff).map((r) => r.hash));
  const want = quotas(config.mix, target);
  const avoid = recentQuestionTexts();

  // Fetch every source in parallel; a failing source just yields nothing.
  const fetched = await Promise.all(Object.entries(want).map(async ([name, n]) => {
    const src = sources[name];
    if (!n) return [name, []];
    if (!src) { console.warn(`[questions] unknown source "${name}"`); return [name, []]; }
    try { return [name, await src.fetchQuestions(Math.ceil(n * 1.6) + 2, { avoid })]; }
    catch (err) { console.warn(`[questions] ${name} failed: ${err.message}`); return [name, []]; }
  }));

  const chosen = [];
  const counts = {};
  const spare = [];
  const take = (q, name, { force: must = false } = {}) => {
    const h = fingerprint(q);
    if (seen.has(h) || q.options[0] === q.options[1]) return false;
    if (!must && counts[name] >= (want[name] ?? Infinity)) { spare.push(q); return false; }
    seen.add(h); chosen.push(q); counts[name] = (counts[name] || 0) + 1;
    return true;
  };
  for (const [name, list] of fetched) list.forEach((q) => { if (chosen.length < target) take(q, name); });

  // Top up from leftovers, then from the offline seed list, so a down source never shrinks the chain.
  for (const q of spare) { if (chosen.length < target) take(q, q.source, { force: true }); }
  if (chosen.length < target) (await seed.fetchQuestions(target * 2)).forEach((q) => { if (chosen.length < target) take(q, 'seed', { force: true }); });
  if (chosen.length === 0) throw new Error('Could not build any questions');

  const final = arrange(chosen);
  const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(',');

  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR REPLACE INTO daily_sets (date, questions, sources, created_at) VALUES (?, ?, ?, ?)')
      .run(date, JSON.stringify(final), summary, Date.now());
    const mark = db.prepare('INSERT OR REPLACE INTO used_questions (hash, date) VALUES (?, ?)');
    for (const q of final) mark.run(fingerprint(q), date);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`[questions] built ${final.length} for ${date} (${summary})`);
  return final;
}

/** Get (building if needed) the question chain for a date. */
function ensureSet(date = todayKey(), opts) {
  const existing = !opts?.force && getSet(date);
  if (existing) return Promise.resolve(existing);
  if (!inflight.has(date)) {
    inflight.set(date, build(date, opts).finally(() => inflight.delete(date)));
  }
  return inflight.get(date);
}

/** Pre-generate tomorrow's set after 11pm game time. Safe to call repeatedly. */
function startScheduler() {
  const tick = () => {
    if (currentHour() >= 23) ensureSet(tomorrowKey()).catch((e) => console.warn('[scheduler]', e.message));
  };
  setInterval(tick, 5 * 60 * 1000).unref();
}

/** Fetch a fresh unstored batch of questions from the configured mix (used by Arcade mode pool). */
async function buildArcadeBatch(target = 30) {
  const want = quotas(config.mix, target);
  const fetched = await Promise.all(Object.entries(want).map(async ([name, n]) => {
    const src = sources[name];
    if (!n || !src) return [name, []];
    try { return [name, await src.fetchQuestions(Math.ceil(n * 1.4) + 2)]; }
    catch (err) { console.warn(`[arcade-pool] ${name} failed: ${err.message}`); return [name, []]; }
  }));

  const seen = new Set();
  const out = [];
  for (const [, list] of fetched) {
    for (const q of list) {
      const h = fingerprint(q);
      if (seen.has(h) || q.options[0] === q.options[1]) continue;
      seen.add(h);
      out.push(q);
    }
  }
  return shuffle(out);
}

module.exports = { ensureSet, getSet, startScheduler, quotas, arrange, buildArcadeBatch };
