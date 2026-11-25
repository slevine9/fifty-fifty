// "Which country's flag is this?"  Easy = big/famous countries, hard = small countries in the same region.
const { makeQuestion, shuffle, sample } = require('./util');
const { getCountries } = require('./countries');

// Flags that are practically identical make for an unfair coin flip, so never pair them.
const TWINS = [['Chad', 'Romania'], ['Indonesia', 'Monaco']].map((p) => p.sort().join('|'));
const twins = (a, b) => TWINS.includes([a, b].sort().join('|'));

const tierOf = (c) => (c.rank < 45 ? 'easy' : c.rank < 120 ? 'medium' : 'hard');

async function fetchQuestions(count) {
  const list = await getCountries();
  const want = { easy: Math.ceil(count * 0.35), medium: Math.ceil(count * 0.4), hard: Math.ceil(count * 0.25) };
  const pools = { easy: [], medium: [], hard: [] };
  shuffle(list).forEach((c) => pools[tierOf(c)].push(c));

  const out = [];
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const c of pools[tier].slice(0, want[tier])) {
      const sameRegion = list.filter((d) => d.region === c.region && d.cca2 !== c.cca2 && !twins(c.name, d.name));
      const pool = sameRegion.length ? sameRegion : list.filter((d) => d.cca2 !== c.cca2);
      const wrong = sample(pool, 1)[0];
      out.push(makeQuestion({
        q: "Which country's flag is this?", correct: c.name, wrong: wrong.name, category: 'Flags',
        difficulty: tier, type: 'flag', image: c.flag, key: `flag:${c.cca2}`, credit: 'Flags via flagcdn.com', source: 'flags',
      }));
    }
  }
  return out;
}

module.exports = { fetchQuestions, name: 'flags' };
