// Build (or rebuild) a day's questions from the command line:
//   node scripts/generate.js              -> today, only if missing
//   node scripts/generate.js 2026-11-24   -> a specific date
//   node scripts/generate.js --force      -> overwrite today's set (don't do this once people are playing)
const { ensureSet } = require('../src/questions');
const { todayKey } = require('../src/dates');

const args = process.argv.slice(2);
const force = args.includes('--force');
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || todayKey();

ensureSet(date, { force }).then((set) => {
  console.log(`\n${date}: ${set.length} questions\n`);
  set.forEach((q, i) => console.log(`${String(i + 1).padStart(2)}. [${q.difficulty}/${q.source}] ${q.q}\n      ${q.options.map((o, k) => (k === q.answer ? `*${o}*` : o)).join('  |  ')}`));
}).catch((e) => { console.error(e); process.exit(1); });
