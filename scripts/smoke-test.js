// End-to-end check against a throwaway database. Uses the offline seed questions (no network needed).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const env = { ...process.env, PORT: port, DATA_DIR: dir, QUESTION_MIX: 'seed:6', QUESTION_TIME_LIMIT: '15' };
const child = spawn('node', ['--no-warnings', path.join(__dirname, '..', 'server.js')], { env, stdio: 'inherit' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Client {
  constructor() { this.cookie = ''; }
  async call(p, body) {
    const res = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    return { status: res.status, json: await res.json() };
  }
}

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await sleep(100); }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'fiftyfifty.db'));
  const answers = () => JSON.parse(db.prepare('SELECT questions FROM daily_sets').get().questions).map((q) => q.answer);

  const alice = new Client(), bob = new Client(), anon = new Client();

  // anonymous can't play
  assert.equal((await anon.call('/api/start', {})).status, 401);

  await alice.call('/api/join', { name: 'Alice' });
  await bob.call('/api/join', { name: 'Bob' });

  let r = (await alice.call('/api/state')).json;
  assert.equal(r.run, null);

  r = (await alice.call('/api/start', {})).json;
  assert.equal(r.run.status, 'in_progress');
  assert.equal(r.question.number, 1);
  assert.ok(!JSON.stringify(r).includes('"answer"'), 'answers must not be sent to the client');
  assert.ok(!('correctIndex' in r.question));

  // alice answers 4 right, then gets #5 wrong
  const ans = answers();
  for (let i = 0; i < 4; i++) {
    const a = (await alice.call('/api/answer', { choice: ans[i] })).json;
    assert.equal(a.correct, true); assert.equal(a.streak, i + 1);
    assert.equal(a.next.number, i + 2);
  }
  let a = (await alice.call('/api/answer', { choice: 1 - ans[4] })).json;
  assert.equal(a.correct, false); assert.equal(a.over, true); assert.equal(a.correctIndex, ans[4]);

  // run is over; can't answer again or restart
  assert.equal((await alice.call('/api/answer', { choice: 0 })).status, 409);
  r = (await alice.call('/api/start', {})).json;
  assert.equal(r.run.status, 'out'); assert.equal(r.run.streak, 4);

  // bob clears everything -> perfect
  await bob.call('/api/start', {});
  let last;
  for (let i = 0; i < 6; i++) last = (await bob.call('/api/answer', { choice: ans[i] })).json;
  assert.equal(last.perfect, true);

  // reload mid-run keeps your place
  const carol = new Client(); await carol.call('/api/join', { name: 'Carol' }); await carol.call('/api/start', {});
  await carol.call('/api/answer', { choice: ans[0] });
  r = (await carol.call('/api/state')).json;
  assert.equal(r.question.number, 2);

  // timeout counts as a miss
  db.prepare("UPDATE runs SET served_at = served_at - 60000 WHERE player_id = (SELECT id FROM players WHERE name='Carol')").run();
  a = (await carol.call('/api/answer', { choice: ans[1] })).json;
  assert.equal(a.correct, false); assert.equal(a.timedOut, true);

  // leaderboard: Bob (6) > Alice (4) > Carol (1)
  const lb = (await alice.call('/api/leaderboard')).json;
  assert.deepEqual(lb.entries.map((e) => [e.name, e.streak]), [['Bob', 6], ['Alice', 4], ['Carol', 1]]);
  assert.equal(lb.you.rank, 2);

  // static + path traversal
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 403);

  console.log('\nAll smoke tests passed.');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; }).finally(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
