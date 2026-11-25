// Photo questions: "Which landmark is this?" / "Which animal is this?"
// Titles are curated below; the photo is pulled live from Wikipedia's page summary API (Wikimedia Commons).
// tier: e = easy, m = medium, h = hard.  Add more lines freely - [wikipedia title, display label, tier].
const { makeQuestion, getJson, sample, shuffle } = require('./util');

const CATEGORIES = {
  landmarks: {
    prompt: 'Which landmark is this?', category: 'Landmarks',
    items: [
      ['Eiffel Tower', 'Eiffel Tower', 'e'], ['Statue of Liberty', 'Statue of Liberty', 'e'], ['Taj Mahal', 'Taj Mahal', 'e'],
      ['Colosseum', 'Colosseum', 'e'], ['Big Ben', 'Big Ben', 'e'], ['Sydney Opera House', 'Sydney Opera House', 'e'],
      ['Golden Gate Bridge', 'Golden Gate Bridge', 'e'], ['Great Wall of China', 'Great Wall of China', 'e'],
      ['Giza pyramid complex', 'Pyramids of Giza', 'e'], ['Leaning Tower of Pisa', 'Leaning Tower of Pisa', 'e'],
      ['Empire State Building', 'Empire State Building', 'e'], ['Niagara Falls', 'Niagara Falls', 'e'],
      ['Mount Fuji', 'Mount Fuji', 'e'], ['Grand Canyon', 'Grand Canyon', 'e'],
      ['Machu Picchu', 'Machu Picchu', 'm'], ['Christ the Redeemer (statue)', 'Christ the Redeemer', 'm'],
      ['Burj Khalifa', 'Burj Khalifa', 'm'], ['Petra', 'Petra', 'm'], ['Stonehenge', 'Stonehenge', 'm'],
      ['Mount Rushmore', 'Mount Rushmore', 'm'], ['Angkor Wat', 'Angkor Wat', 'm'], ['Brandenburg Gate', 'Brandenburg Gate', 'm'],
      ['Space Needle', 'Space Needle', 'm'], ['Tower Bridge', 'Tower Bridge', 'm'], ['Hagia Sophia', 'Hagia Sophia', 'm'],
      ['Parthenon', 'Parthenon', 'm'], ['Victoria Falls', 'Victoria Falls', 'm'], ['Matterhorn', 'Matterhorn', 'm'],
      ['Uluru', 'Uluru', 'm'], ['Chichen Itza', 'Chichen Itza', 'm'], ['Forbidden City', 'Forbidden City', 'm'], ['CN Tower', 'CN Tower', 'm'],
      ['Sagrada Família', 'Sagrada Família', 'h'], ['Neuschwanstein Castle', 'Neuschwanstein Castle', 'h'],
      ['Alhambra', 'Alhambra', 'h'], ['Petronas Towers', 'Petronas Towers', 'h'], ['Louvre Pyramid', 'Louvre Pyramid', 'h'],
    ],
  },
  animals: {
    prompt: 'Which animal is this?', category: 'Animals',
    items: [
      ['Lion', 'Lion', 'e'], ['Tiger', 'Tiger', 'e'], ['Giraffe', 'Giraffe', 'e'], ['Zebra', 'Zebra', 'e'],
      ['African elephant', 'Elephant', 'e'], ['Hippopotamus', 'Hippo', 'e'], ['Giant panda', 'Giant panda', 'e'],
      ['Koala', 'Koala', 'e'], ['Kangaroo', 'Kangaroo', 'e'], ['Flamingo', 'Flamingo', 'e'], ['Polar bear', 'Polar bear', 'e'],
      ['Gorilla', 'Gorilla', 'e'],
      ['Chimpanzee', 'Chimpanzee', 'm'], ['Orangutan', 'Orangutan', 'm'], ['Red panda', 'Red panda', 'm'], ['Leopard', 'Leopard', 'm'],
      ['Cheetah', 'Cheetah', 'm'], ['Jaguar', 'Jaguar', 'm'], ['Platypus', 'Platypus', 'm'], ['Sloth', 'Sloth', 'm'],
      ['Meerkat', 'Meerkat', 'm'], ['Capybara', 'Capybara', 'm'], ['Narwhal', 'Narwhal', 'm'], ['Sea otter', 'Sea otter', 'm'],
      ['Axolotl', 'Axolotl', 'm'], ['Toucan', 'Toucan', 'm'], ['Snowy owl', 'Snowy owl', 'm'], ['Red fox', 'Red fox', 'm'],
      ['Gray wolf', 'Wolf', 'm'],
      ['Pangolin', 'Pangolin', 'h'], ['Arctic fox', 'Arctic fox', 'h'], ['Okapi', 'Okapi', 'h'], ['Aye-aye', 'Aye-aye', 'h'],
      ['Binturong', 'Binturong', 'h'], ['Quokka', 'Quokka', 'h'],
    ],
  },
};

const TIER = { e: 'easy', m: 'medium', h: 'hard' };

/** Pick a good image URL from a Wikipedia REST summary. Returns null if the page has no usable lead image. */
function pickImage(summary) {
  if (!summary || summary.type === 'disambiguation') return null;
  const thumb = summary.thumbnail, orig = summary.originalimage;
  if (!thumb && !orig) return null;
  // 960px is a standard Wikimedia thumbnail step; small originals are used as-is.
  if (thumb && orig && orig.width > 960) return thumb.source.replace(/\/\d+px-/, '/960px-');
  return (orig || thumb).source;
}

async function summary(title) {
  return getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { timeout: 10_000 });
}

async function fetchQuestions(count) {
  const cats = Object.values(CATEGORIES);
  const chosen = [];
  cats.forEach((cat) => {
    const n = Math.ceil(count / cats.length);
    sample(cat.items, n + 3).forEach((item) => chosen.push({ cat, item })); // +3 spare for pages without photos
  });

  const out = [];
  const queue = shuffle(chosen);
  const CONCURRENCY = 6;
  for (let i = 0; i < queue.length && out.length < count + 2; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(({ item }) => summary(item[0])));
    results.forEach((r, k) => {
      if (r.status !== 'fulfilled') return;
      const image = pickImage(r.value);
      if (!image) return;
      const { cat, item } = batch[k];
      const wrong = sample(cat.items.filter((x) => x[0] !== item[0]), 1)[0];
      out.push(makeQuestion({
        q: cat.prompt, correct: item[1], wrong: wrong[1], category: cat.category, difficulty: TIER[item[2]],
        type: 'photo', image, key: `wiki:${item[0]}`, credit: 'Photo: Wikipedia / Wikimedia Commons', source: 'wiki',
      }));
    });
  }
  return out;
}

module.exports = { fetchQuestions, name: 'wiki', pickImage, CATEGORIES };
