// "Which breed is this?" using random photos from the Dog CEO API (free, no key).
const { makeQuestion, getJson, sample } = require('./util');

const title = (s) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const EASY = ['retriever', 'pug', 'husky', 'beagle', 'poodle', 'chihuahua', 'bulldog', 'dalmatian', 'boxer', 'collie', 'corgi'];

/** "hound-afghan" -> "Afghan Hound",  "pug" -> "Pug" */
function labelFromSlug(slug) {
  const [breed, sub] = slug.split('-');
  return title(sub ? `${sub} ${breed}` : breed);
}

async function fetchQuestions(count) {
  const [breedsRes, imgsRes] = await Promise.all([
    getJson('https://dog.ceo/api/breeds/list/all'),
    getJson(`https://dog.ceo/api/breeds/image/random/${Math.min(count, 50)}`),
  ]);
  const labels = Object.entries(breedsRes.message).flatMap(([breed, subs]) =>
    subs.length ? subs.map((s) => labelFromSlug(`${breed}-${s}`)) : [labelFromSlug(breed)]);

  const out = [];
  const seen = new Set();
  for (const url of imgsRes.message) {
    const slug = url.match(/\/breeds\/([^/]+)\//)?.[1];
    if (!slug) continue;
    const correct = labelFromSlug(slug);
    if (seen.has(correct)) continue; // one photo per breed per day
    seen.add(correct);
    const wrong = sample(labels.filter((l) => l !== correct), 1)[0];
    const lower = correct.toLowerCase();
    const difficulty = EASY.some((e) => lower.includes(e)) ? 'easy' : slug.includes('-') ? 'hard' : 'medium';
    out.push(makeQuestion({
      q: 'Which breed is this?', correct, wrong, category: 'Dogs', difficulty, type: 'photo',
      image: url, key: `dog:${url}`, credit: 'Photo via Dog CEO', source: 'dogs',
    }));
  }
  return out;
}

module.exports = { fetchQuestions, name: 'dogs', labelFromSlug };
