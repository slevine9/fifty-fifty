// Fifty Fifty - zero-dependency Node server (needs Node 22.13+ for the built-in SQLite module).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config');
const auth = require('./src/auth');
const game = require('./src/game');
const arcade = require('./src/arcade');
const { getPlayerStats } = require('./src/stats');
const { ensureSet, startScheduler } = require('./src/questions');
const { todayKey, msUntilReset } = require('./src/dates');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------- helpers ----------
const send = (res, status, body, headers = {}) => {
  const isObj = typeof body === 'object';
  res.writeHead(status, { 'content-type': isObj ? 'application/json' : 'text/plain', 'cache-control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};

const cookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

const readJson = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });

const secureFlag = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
const sessionCookie = (token) =>
  `ff_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}${secureFlag}`;
const clearSessionCookie = () =>
  `ff_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`;

// Light per-IP throttle on the write endpoints.
const hits = new Map();
function throttled(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 40;
}
setInterval(() => hits.clear(), 60_000).unref();

// ---------- API ----------
async function api(req, res, url) {
  const cookieMap = cookies(req);
  const player = game.playerByToken(cookieMap.ff_token);
  const route = `${req.method} ${url.pathname}`;

  if (req.method === 'POST' && throttled(req)) return send(res, 429, { error: 'Slow down' });

  switch (route) {
    // --- Daily mode ---
    case 'GET /api/state': {
      const state = await game.getState(player);
      return send(res, 200, { ...state, resetsInMs: msUntilReset() });
    }
    case 'POST /api/join': {
      const { name } = await readJson(req);
      if (player) {
        game.renamePlayer(player.id, name);
        return send(res, 200, { ok: true });
      }
      const created = game.createPlayer(name);
      return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie(created.token) });
    }
    case 'POST /api/start': {
      if (!player) return send(res, 401, { error: 'Pick a name first' });
      return send(res, 200, { ...(await game.startRun(player)), resetsInMs: msUntilReset() });
    }
    case 'POST /api/answer': {
      if (!player) return send(res, 401, { error: 'Pick a name first' });
      const { choice } = await readJson(req);
      const result = await game.submitAnswer(player, choice);
      return send(res, result.status || 200, result);
    }
    case 'GET /api/leaderboard':
      return send(res, 200, game.leaderboard(player));

    // --- Arcade mode ---
    case 'GET /api/arcade/state': {
      const state = await arcade.getArcadeState(player);
      return send(res, 200, { ...state, resetsInMs: msUntilReset() });
    }
    case 'POST /api/arcade/start': {
      if (!player) return send(res, 401, { error: 'Pick a name first' });
      return send(res, 200, { ...(await arcade.startArcadeRun(player)), resetsInMs: msUntilReset() });
    }
    case 'POST /api/arcade/answer': {
      if (!player) return send(res, 401, { error: 'Pick a name first' });
      const { choice } = await readJson(req);
      const result = await arcade.submitArcadeAnswer(player, choice);
      return send(res, result.status || 200, result);
    }
    case 'GET /api/arcade/leaderboard':
      return send(res, 200, arcade.arcadeLeaderboard(player));

    // --- Account & Stats ---
    case 'GET /api/stats':
      return send(res, 200, { stats: player ? getPlayerStats(player.id) : null });
    case 'POST /api/auth/register': {
      const { email, password, name } = await readJson(req);
      const result = auth.registerWithEmail({ email, password, name, currentPlayer: player });
      if (result.error) return send(res, result.status || 400, { error: result.error });
      return send(res, 200, { ok: true, player: result.player }, { 'set-cookie': sessionCookie(result.token) });
    }
    case 'POST /api/auth/login': {
      const { email, password } = await readJson(req);
      const result = auth.loginWithEmail({ email, password, currentPlayer: player });
      if (result.error) return send(res, result.status || 401, { error: result.error });
      return send(res, 200, { ok: true, player: result.player }, { 'set-cookie': sessionCookie(result.token) });
    }
    case 'POST /api/auth/logout': {
      auth.deleteSession(cookieMap.ff_token);
      return send(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
    }

    // --- Admin ---
    case 'POST /admin/regenerate': {
      // Rebuild today's set (only safe before people start playing). Requires ADMIN_TOKEN.
      if (!config.adminToken || req.headers['x-admin-token'] !== config.adminToken) return send(res, 403, { error: 'Forbidden' });
      const set = await ensureSet(todayKey(), { force: true });
      return send(res, 200, { ok: true, count: set.length });
    }
    default:
      return send(res, 404, { error: 'Not found' });
  }
}

// ---------- static ----------
function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (url.pathname === '/auth/google') return auth.startGoogleOAuth(req, res);
    if (url.pathname === '/auth/google/callback') {
      const cookieMap = cookies(req);
      const player = game.playerByToken(cookieMap.ff_token);
      return await auth.handleGoogleCallback(req, res, url, cookieMap, player, sessionCookie);
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error' });
  }
});

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`Fifty Fifty on http://localhost:${config.port}  (day rolls over at midnight ${config.timezone})`);
    ensureSet()
      .then(() => arcade.ensurePool())
      .catch((e) => console.warn('[startup] could not pre-build today:', e.message));
    startScheduler();
  });
}

module.exports = server;
