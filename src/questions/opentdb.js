// Open Trivia DB (https://opentdb.com) - free, no API key, community-written questions.
// Multiple-choice questions are cut down to two options (the right answer + one random wrong one).
// True/False questions are used as-is. Rate limit: 1 request per 5 seconds, so we wait between calls.
const { makeQuestion, shuffle, sleep } = require('./util');

const API = 'https://opentdb.com/api.php';

const decode = (s) => decodeURIComponent(s);

async function fetchBatch(amount, difficulty) {
  const url = `${API}?amount=${amount}&difficulty=${difficulty}&encode=url3986`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenTDB HTTP ${res.status}`);
  const data = await res.json();
  if (data.response_code !== 0) throw new Error(`OpenTDB response_code ${data.response_code}`);
  return data.results;
}

function convert(r) {
  const q = decode(r.question);
  const correct = decode(r.correct_answer);
  if (r.type === 'boolean') {
    // True/False questions read awkwardly without a framing, so turn them into "True or false: ..."
    return makeQuestion({
      q: `True or false: ${q}`,
      correct,
      wrong: correct === 'True' ? 'False' : 'True',
      category: decode(r.category),
      difficulty: r.difficulty,
      source: 'opentdb',
    });
  }
  const wrong = shuffle(r.incorrect_answers.map(decode))[0];
  return makeQuestion({ q, correct, wrong, category: decode(r.category), difficulty: r.difficulty, source: 'opentdb' });
}

/**
 * Returns up to `count` questions, ramping easy -> medium -> hard so the chain gets tougher.
 */
async function fetchQuestions(count) {
  const plan = [
    ['easy', Math.ceil(count * 0.35)],
    ['medium', Math.ceil(count * 0.4)],
    ['hard', Math.ceil(count * 0.25)],
  ];
  const out = [];
  for (const [difficulty, n] of plan) {
    try {
      const batch = await fetchBatch(Math.min(n + 5, 50), difficulty); // +5 spare for de-duping
      out.push(...batch.map(convert));
    } catch (err) {
      console.warn(`[opentdb] ${difficulty} batch failed: ${err.message}`);
    }
    await sleep(Number(process.env.OPENTDB_DELAY_MS ?? 5500)); // respect the 5s rate limit
  }
  return out;
}

module.exports = { fetchQuestions, name: 'opentdb' };
