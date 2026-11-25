// Offline test of every question source. External APIs are stubbed with realistic payloads,
// so this checks parsing, shape, tiering and the daily blend without touching the network.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-src-'));
process.env.OPENTDB_DELAY_MS = '0';
process.env.QUESTION_MIX = 'opentdb:14,flags:6,dogs:4,wiki:6,versus:6,history:4';

// ---------- stubbed APIs ----------
const regions = ['Europe', 'Asia', 'Africa', 'Americas', 'Oceania'];
const countries = Array.from({ length: 120 }, (_, i) => ({
  name: { common: `Country${i}` }, cca2: `C${i}`.padEnd(2, 'X').slice(0, 3), region: regions[i % 5], independent: true,
  population: Math.floor(1.4e9 / (i + 1) ** 1.3) + 5000, area: Math.floor(1.7e7 / (i + 1) ** 1.1) + 100,
  flags: { svg: `https://flagcdn.com/c${i}.svg`, png: `https://flagcdn.com/w320/c${i}.png` },
}));
const events = Array.from({ length: 40 }, (_, i) => ({ year: 1000 + i * 23, text: `A notable thing number ${String.fromCharCode(65 + (i % 26))}${'x'.repeat(i % 7)} happened to some people somewhere` }));
events.push({ year: 1969, text: 'Something in 1969 that gives the year away and should be filtered out entirely' });

const stub = async (url) => {
  const u = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('restcountries.com')) return json(countries);
  if (u.includes('dog.ceo/api/breeds/list/all')) return json({ message: { retriever: ['golden', 'labrador'], hound: ['afghan', 'basset'], pug: [], husky: [], akita: [], beagle: [] } });
  if (u.includes('dog.ceo/api/breeds/image/random')) {
    const slugs = ['retriever-golden', 'hound-afghan', 'pug', 'husky', 'akita', 'beagle', 'retriever-labrador'];
    return json({ message: slugs.map((s, i) => `https://images.dog.ceo/breeds/${s}/img_${i}.jpg`) });
  }
  if (u.includes('/page/summary/')) {
    const t = decodeURIComponent(u.split('/page/summary/')[1]);
    if (t === 'Okapi') return json({ type: 'standard' }); // no photo -> must be skipped
    return json({ type: 'standard', thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${t}.jpg/320px-${t}.jpg`, width: 320 }, originalimage: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${t}.jpg`, width: 3000 } });
  }
  if (u.includes('onthisday')) return json({ events });
  if (u.includes('opentdb.com')) {
    const diff = new URL(u).searchParams.get('difficulty');
    const enc = encodeURIComponent;
    return json({ response_code: 0, results: Array.from({ length: 30 }, (_, i) => ({
      type: i % 4 === 0 ? 'boolean' : 'multiple', difficulty: diff, category: enc('Science'), question: enc(`${diff} question ${i}, with a number ${i}?`),
      correct_answer: enc(i % 4 === 0 ? 'True' : `right${i}`), incorrect_answers: i % 4 === 0 ? [enc('False')] : [enc('w1'), enc('w2'), enc('w3')],
    })) });
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
global.fetch = stub;

const db = require('../src/db');
const { fingerprint } = require('../src/questions/util');
const { ensureSet, quotas } = require('../src/questions');

const checkShape = (q, label) => {
  assert.equal(q.options.length, 2, `${label}: two options`);
  assert.notEqual(q.options[0], q.options[1], `${label}: options differ`);
  assert.ok(q.answer === 0 || q.answer === 1, `${label}: answer index`);
  assert.ok(['easy', 'medium', 'hard'].includes(q.difficulty), `${label}: difficulty ${q.difficulty}`);
  assert.ok(q.q.length > 5);
  assert.ok(q.key || q.type === 'text', `${label}: key for dedupe`);
};

(async () => {
  for (const name of ['flags', 'dogs', 'wiki', 'versus', 'history', 'opentdb']) {
    const src = require(`../src/questions/${name}`);
    const list = await src.fetchQuestions(8);
    assert.ok(list.length >= 3, `${name} produced ${list.length}`);
    list.forEach((q) => checkShape(q, name));
    if (['flags', 'dogs', 'wiki'].includes(name)) list.forEach((q) => assert.match(q.image, /^https:\/\//, `${name}: image url`));
    console.log(`  ok  ${name.padEnd(8)} ${list.length} questions   e.g. "${list[0].q}" -> ${list[0].options[list[0].answer]}`);
  }

  // specific parsers
  const { labelFromSlug } = require('../src/questions/dogs');
  assert.equal(labelFromSlug('hound-afghan'), 'Afghan Hound');
  assert.equal(labelFromSlug('pug'), 'Pug');
  const { pickImage } = require('../src/questions/wiki');
  assert.match(pickImage({ thumbnail: { source: 'https://x/thumb/a/ab/F.jpg/320px-F.jpg' }, originalimage: { source: 'https://x/a/ab/F.jpg', width: 3000 } }), /\/960px-F\.jpg$/);
  assert.equal(pickImage({ thumbnail: { source: 't' }, originalimage: { source: 'o', width: 800 } }), 'o');
  assert.equal(pickImage({ type: 'disambiguation', thumbnail: { source: 't' } }), null);
  assert.equal(pickImage({}), null);
  const wikiList = await require('../src/questions/wiki').fetchQuestions(12);
  assert.ok(!wikiList.some((q) => q.options.includes('Okapi') && q.key === 'wiki:Okapi'), 'photo-less page skipped');
  const hist = await require('../src/questions/history').fetchQuestions(10);
  assert.ok(hist.every((q) => !/1969/.test(q.options.join(' '))), 'year-leaking events filtered');

  assert.deepEqual(quotas({ a: 14, b: 6, c: 4 }, 24), { a: 14, b: 6, c: 4 });
  assert.equal(Object.values(quotas({ a: 1, b: 1, c: 1 }, 10)).reduce((x, y) => x + y), 10);

  // full blend
  const set = await ensureSet('2026-11-24');
  assert.equal(set.length, 40, `full chain, got ${set.length}`);
  const bySource = set.reduce((o, q) => ((o[q.source] = (o[q.source] || 0) + 1), o), {});
  console.log('  blend', JSON.stringify(bySource));
  assert.ok(Object.keys(bySource).length >= 5, 'multiple sources in the blend');
  const rank = { easy: 0, medium: 1, hard: 2 };
  for (let i = 1; i < set.length; i++) assert.ok(rank[set[i].difficulty] >= rank[set[i - 1].difficulty], 'easy -> hard order');
  const adjacent = set.filter((q, i) => i && q.source === set[i - 1].source).length;
  console.log(`  same-source neighbours: ${adjacent}`);

  // repeat protection: tomorrow's set shares no fingerprints with today's
  const today = new Set(set.map(fingerprint));
  const next = await ensureSet('2026-11-25');
  const overlap = next.filter((q) => today.has(fingerprint(q)));
  assert.equal(overlap.length, 0, `no repeats across days (found ${overlap.length})`);

  // a dead network still yields a full chain from the seed list
  global.fetch = async () => { throw new Error('offline'); };
  const offline = await ensureSet('2026-11-26');
  assert.ok(offline.length >= 30, `offline fallback gave ${offline.length}`);
  console.log(`  offline fallback: ${offline.length} questions from seed`);

  console.log('\nAll source tests passed.');
})().catch((e) => { console.error('\nFAILED:', e.stack || e.message); process.exitCode = 1; })
  .finally(() => { db.close?.(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });
