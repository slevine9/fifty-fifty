// Head-to-head: "Which country has more people?" / "Which is bigger by area?"
const { makeQuestion, shuffle } = require('./util');
const { getCountries } = require('./countries');

const fmtTier = (ratio) => (ratio >= 6 ? 'easy' : ratio >= 2.2 ? 'medium' : 'hard');

async function fetchQuestions(count) {
  const list = await getCountries();
  const used = new Set();
  const out = [];
  let attempts = 0;
  while (out.length < count && attempts++ < count * 80) {
    const [a, b] = shuffle(list).slice(0, 2);
    if (used.has(a.cca2) || used.has(b.cca2)) continue;
    const metric = Math.random() < 0.55 ? 'pop' : 'area';
    const [hi, lo] = a[metric] >= b[metric] ? [a, b] : [b, a];
    const ratio = hi[metric] / lo[metric];
    if (ratio < 1.3) continue; // too close to call is unfair, not hard
    used.add(a.cca2); used.add(b.cca2);
    out.push(makeQuestion({
      q: metric === 'pop' ? 'Which country has more people?' : 'Which country is bigger by area?',
      correct: hi.name, wrong: lo.name, category: 'Countries', difficulty: fmtTier(ratio),
      key: `versus:${metric}:${[a.cca2, b.cca2].sort().join('-')}`, source: 'versus',
    }));
  }
  return out;
}

module.exports = { fetchQuestions, name: 'versus' };
