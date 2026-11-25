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
    const res = await fetch(base + p, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) {
      const tokenPart = sc.split(';')[0];
      if (tokenPart.endsWith('=')) this.cookie = '';
      else this.cookie = tokenPart;
    }
    return { status: res.status, json: await res.json() };
  }
}

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await sleep(100); }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'fiftyfifty.db'));
  const answers = () => JSON.parse(db.prepare('SELECT questions FROM daily_sets').get().questions).map((q) => q.answer);

  const alice = new Client(), bob = new Client(), anon = new Client();

  // anonymous can't play Daily or Arcade
  assert.equal((await anon.call('/api/start', {})).status, 401);
  assert.equal((await anon.call('/api/arcade/start', {})).status, 401);

  await alice.call('/api/join', { name: 'Alice' });
  await bob.call('/api/join', { name: 'Bob' });

  let r = (await alice.call('/api/state')).json;
  assert.equal(r.mode, 'daily');
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
  assert.equal(a.stats.daily.played, 1);
  assert.equal(a.stats.daily.bestStreak, 4);

  // run is over; can't answer again or restart daily
  assert.equal((await alice.call('/api/answer', { choice: 0 })).status, 409);
  r = (await alice.call('/api/start', {})).json;
  assert.equal(r.run.status, 'out'); assert.equal(r.run.streak, 4);

  // bob clears everything -> perfect
  await bob.call('/api/start', {});
  let last;
  for (let i = 0; i < 6; i++) last = (await bob.call('/api/answer', { choice: ans[i] })).json;
  assert.equal(last.perfect, true);
  assert.equal(last.stats.daily.perfects, 1);

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

  // ---------- Arcade mode: unlimited runs ----------
  const arcadeAnswer = (playerName) => {
    const row = db.prepare(`
      SELECT question_json FROM arcade_runs
      WHERE player_id = (SELECT id FROM players WHERE name = ?) AND status = 'in_progress'
      ORDER BY id DESC LIMIT 1
    `).get(playerName);
    return JSON.parse(row.question_json).answer;
  };

  let arc = (await alice.call('/api/arcade/start', {})).json;
  assert.equal(arc.mode, 'arcade');
  assert.equal(arc.run.status, 'in_progress');
  assert.equal(arc.question.number, 1);
  assert.ok(!JSON.stringify(arc).includes('"answer"'), 'arcade answers must not leak');

  // Alice gets 3 right, then misses #4
  for (let i = 0; i < 3; i++) {
    const ansIdx = arcadeAnswer('Alice');
    const res = (await alice.call('/api/arcade/answer', { choice: ansIdx })).json;
    assert.equal(res.correct, true);
    assert.equal(res.streak, i + 1);
    assert.equal(res.next.number, i + 2);
  }
  const wrongIdx = 1 - arcadeAnswer('Alice');
  const arcOver1 = (await alice.call('/api/arcade/answer', { choice: wrongIdx })).json;
  assert.equal(arcOver1.correct, false);
  assert.equal(arcOver1.over, true);
  assert.equal(arcOver1.streak, 3);
  assert.equal(arcOver1.newBest, true);
  assert.equal(arcOver1.stats.arcade.played, 1);
  assert.equal(arcOver1.stats.arcade.bestStreak, 3);

  // Alice can immediately start a SECOND arcade run (unlimited) and beat her best!
  arc = (await alice.call('/api/arcade/start', {})).json;
  assert.equal(arc.run.status, 'in_progress');
  assert.equal(arc.run.streak, 0);
  for (let i = 0; i < 5; i++) {
    const ansIdx = arcadeAnswer('Alice');
    const res = (await alice.call('/api/arcade/answer', { choice: ansIdx })).json;
    assert.equal(res.correct, true);
  }
  const arcOver2 = (await alice.call('/api/arcade/answer', { choice: 1 - arcadeAnswer('Alice') })).json;
  assert.equal(arcOver2.over, true);
  assert.equal(arcOver2.streak, 5);
  assert.equal(arcOver2.newBest, true);
  assert.equal(arcOver2.stats.arcade.played, 2);
  assert.equal(arcOver2.stats.arcade.bestStreak, 5);
  assert.equal(arcOver2.stats.arcade.totalCorrect, 8);
  assert.equal(arcOver2.stats.arcade.avgStreak, 4);

  const alb = (await alice.call('/api/arcade/leaderboard')).json;
  assert.deepEqual(alb.entries.map((e) => [e.name, e.streak]), [['Alice', 5]]);

  // ---------- Accounts: upgrade guest -> email, login on new device, merge guest ----------
  const reg = await alice.call('/api/auth/register', { email: 'alice@gmail.com', password: 'password123' });
  assert.equal(reg.status, 200);
  assert.equal(reg.json.player.email, 'alice@gmail.com');
  assert.equal(reg.json.player.isGuest, false);

  // New device logs into alice@gmail.com and sees all her Daily + Arcade stats
  const alicePhone = new Client();
  const login = await alicePhone.call('/api/auth/login', { email: 'alice@gmail.com', password: 'password123' });
  assert.equal(login.status, 200);
  const phoneStats = (await alicePhone.call('/api/stats')).json.stats;
  assert.equal(phoneStats.daily.bestStreak, 4);
  assert.equal(phoneStats.arcade.played, 2);
  assert.equal(phoneStats.arcade.bestStreak, 5);

  // Wrong password rejected
  const badLogin = await (new Client()).call('/api/auth/login', { email: 'alice@gmail.com', password: 'wrong' });
  assert.equal(badLogin.status, 401);

  // Logout clears session
  await alicePhone.call('/api/auth/logout', {});
  assert.equal((await alicePhone.call('/api/state')).json.player, null);

  // Google OAuth redirect fails safely when not configured
  const gRes = await fetch(base + '/auth/google', { redirect: 'manual' });
  assert.equal(gRes.status, 302);
  assert.ok(gRes.headers.get('location').includes('google_not_configured'));

  // static + path traversal
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 403);

  console.log('\nAll smoke tests passed.');
})().catch((e) => { console.error('\nFAILED:', e.stack || e.message); process.exitCode = 1; }).finally(() => {
  child.kill();
  setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 300);
});
