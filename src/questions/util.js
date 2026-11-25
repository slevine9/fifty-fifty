const crypto = require('node:crypto');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sample = (arr, n) => shuffle(arr).slice(0, n);

/**
 * Build a normalized two-option question.
 *   type:  'text' | 'flag' | 'photo'   (anything with an `image` renders a picture)
 *   key:   stable identity used to avoid repeating the same item on later days
 * Extra fields (image, credit, key, ...) pass straight through.
 */
function makeQuestion({ q, correct, wrong, category = 'General', source, difficulty = 'medium', type = 'text', ...extra }) {
  const flip = crypto.randomInt(2); // which side the right answer lands on
  const options = flip === 0 ? [correct, wrong] : [wrong, correct];
  return { q: q.trim(), options, answer: flip === 0 ? 0 : 1, category, source, difficulty, type, ...extra };
}

/** Stable fingerprint used to avoid repeating questions on later days. */
function fingerprint(q) {
  const basis = q.key || q.q;
  return crypto.createHash('sha1').update(basis.toLowerCase().replace(/[^a-z0-9:]/g, '')).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'FiftyFifty/0.2 (daily trivia game; https://github.com/slevine9/fifty-fifty)';

async function getJson(url, { timeout = 15_000, headers = {} } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res.json();
}

module.exports = { shuffle, sample, makeQuestion, fingerprint, sleep, getJson, UA };
