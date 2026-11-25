// "Which happened first?" built from Wikipedia's On This Day feed for today's date.
const { makeQuestion, getJson, shuffle } = require('./util');
const { todayKey } = require('../dates');

function trim(text, max = 110) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

async function fetchQuestions(count) {
  const [, mm, dd] = todayKey().split('-');
  const data = await getJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`);

  // Keep events that read well on their own and don't give the year away.
  const events = (data.events || [])
    .filter((e) => Number.isInteger(e.year) && e.text && e.text.length >= 30 && e.text.length <= 140 && !/\b\d{3,4}\b/.test(e.text))
    .map((e) => ({ year: e.year, text: trim(e.text) }));

  const used = new Set();
  const out = [];
  let attempts = 0;
  while (out.length < count && attempts++ < count * 80 && events.length > 1) {
    const [a, b] = shuffle(events).slice(0, 2);
    const gap = Math.abs(a.year - b.year);
    if (gap < 12 || used.has(a.text) || used.has(b.text)) continue;
    used.add(a.text); used.add(b.text);
    const [first, second] = a.year < b.year ? [a, b] : [b, a];
    out.push(makeQuestion({
      q: 'Which happened first?', correct: first.text, wrong: second.text, category: 'History',
      difficulty: gap >= 300 ? 'easy' : gap >= 60 ? 'medium' : 'hard',
      key: `hist:${first.year}:${first.text.slice(0, 40)}`, source: 'history',
    }));
  }
  return out;
}

module.exports = { fetchQuestions, name: 'history' };
