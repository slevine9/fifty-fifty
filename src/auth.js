// Player accounts, multi-device sessions, Google OAuth 2.0 (Gmail), and email/password auth.
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const cleanName = (name) =>
  String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hex] = stored.split(':');
  const a = Buffer.from(hex, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function toPublicPlayer(row) {
  if (!row) return null;
  const provider = row.auth_provider || 'guest';
  return {
    id: row.id,
    name: row.name,
    email: row.email || null,
    avatarUrl: row.avatar_url || null,
    authProvider: provider,
    isGuest: provider === 'guest',
  };
}

function createSession(playerId) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, player_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(token, playerId, now, now);
  return token;
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  db.prepare('UPDATE players SET token = NULL WHERE token = ?').run(token);
}

function playerByToken(token) {
  if (!token) return null;
  const fromSession = db.prepare(`
    SELECT p.*
    FROM sessions s
    JOIN players p ON p.id = s.player_id
    WHERE s.token = ?
  `).get(token);
  if (fromSession) return toPublicPlayer(fromSession);

  const legacy = db.prepare('SELECT * FROM players WHERE token = ?').get(token);
  return toPublicPlayer(legacy);
}

function createPlayer(name) {
  const clean = cleanName(name) || 'Player';
  const token = crypto.randomBytes(24).toString('hex');
  const r = db.prepare("INSERT INTO players (token, name, auth_provider, created_at) VALUES (?, ?, 'guest', ?)")
    .run(token, clean, Date.now());
  const id = Number(r.lastInsertRowid);
  const sessionToken = createSession(id);
  return { id, name: clean, token: sessionToken, isGuest: true, authProvider: 'guest' };
}

function renamePlayer(id, name) {
  const clean = cleanName(name);
  if (clean) db.prepare('UPDATE players SET name = ? WHERE id = ?').run(clean, id);
  return clean;
}

/** Merge a temporary guest profile's daily & arcade runs into an existing account without losing anything. */
function mergeGuestIntoPlayer(guestId, targetId) {
  if (!guestId || !targetId || guestId === targetId) return;
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT OR IGNORE INTO runs (date, player_id, status, streak, current_index, served_at, last_correct_at, started_at)
      SELECT date, ?, status, streak, current_index, served_at, last_correct_at, started_at
      FROM runs WHERE player_id = ?
    `).run(targetId, guestId);
    db.prepare('DELETE FROM runs WHERE player_id = ?').run(guestId);
    db.prepare('UPDATE arcade_runs SET player_id = ? WHERE player_id = ?').run(targetId, guestId);
    db.prepare('UPDATE sessions SET player_id = ? WHERE player_id = ?').run(targetId, guestId);
    db.prepare("DELETE FROM players WHERE id = ? AND auth_provider = 'guest'").run(guestId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function registerWithEmail({ email, password, name, currentPlayer }) {
  const cleanEm = normalizeEmail(email);
  if (!isValidEmail(cleanEm)) return { error: 'Enter a valid email address.', status: 400 };
  if (typeof password !== 'string' || password.length < 6) {
    return { error: 'Password must be at least 6 characters.', status: 400 };
  }

  const existing = db.prepare('SELECT id FROM players WHERE email = ?').get(cleanEm);
  if (existing) return { error: 'An account with that email already exists. Try signing in.', status: 409 };

  const displayName = cleanName(name) || cleanEm.split('@')[0].slice(0, 20) || 'Player';
  const pwHash = hashPassword(password);

  let playerId;
  if (currentPlayer && currentPlayer.isGuest) {
    playerId = currentPlayer.id;
    const keepName = currentPlayer.name && currentPlayer.name !== 'Player' ? cleanName(name) || currentPlayer.name : displayName;
    db.prepare("UPDATE players SET name = ?, email = ?, password_hash = ?, auth_provider = 'email' WHERE id = ?")
      .run(keepName, cleanEm, pwHash, playerId);
  } else {
    const r = db.prepare("INSERT INTO players (name, email, password_hash, auth_provider, created_at) VALUES (?, ?, ?, 'email', ?)")
      .run(displayName, cleanEm, pwHash, Date.now());
    playerId = Number(r.lastInsertRowid);
  }

  const token = createSession(playerId);
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  return { player: toPublicPlayer(row), token };
}

function loginWithEmail({ email, password, currentPlayer }) {
  const cleanEm = normalizeEmail(email);
  if (!isValidEmail(cleanEm)) return { error: 'Enter a valid email address.', status: 400 };
  if (typeof password !== 'string' || !password) return { error: 'Enter your password.', status: 400 };

  const row = db.prepare('SELECT * FROM players WHERE email = ?').get(cleanEm);
  if (!row) return { error: 'No account found for that email.', status: 401 };
  if (!row.password_hash) {
    return { error: 'This account uses Google Sign-In. Click "Continue with Google".', status: 401 };
  }
  if (!verifyPassword(password, row.password_hash)) return { error: 'Incorrect password.', status: 401 };

  if (currentPlayer && currentPlayer.isGuest && currentPlayer.id !== row.id) {
    mergeGuestIntoPlayer(currentPlayer.id, row.id);
  }

  const token = createSession(row.id);
  return { player: toPublicPlayer(row), token };
}

function loginOrCreateGoogle({ googleId, email, name, avatarUrl, currentPlayer }) {
  const cleanEm = normalizeEmail(email);
  const displayName = cleanName(name) || (cleanEm ? cleanEm.split('@')[0].slice(0, 20) : 'Player');

  let row = db.prepare('SELECT * FROM players WHERE google_id = ?').get(googleId);
  if (!row && cleanEm) {
    row = db.prepare('SELECT * FROM players WHERE email = ?').get(cleanEm);
  }

  let playerId;
  if (row) {
    playerId = row.id;
    const nextName = row.name && row.name !== 'Player' ? row.name : displayName;
    db.prepare(`
      UPDATE players
      SET google_id = ?, email = COALESCE(?, email), avatar_url = COALESCE(?, avatar_url), name = ?, auth_provider = 'google'
      WHERE id = ?
    `).run(googleId, cleanEm || null, avatarUrl || null, nextName, playerId);

    if (currentPlayer && currentPlayer.isGuest && currentPlayer.id !== playerId) {
      mergeGuestIntoPlayer(currentPlayer.id, playerId);
    }
  } else if (currentPlayer && currentPlayer.isGuest) {
    playerId = currentPlayer.id;
    const nextName = currentPlayer.name && currentPlayer.name !== 'Player' ? currentPlayer.name : displayName;
    db.prepare(`
      UPDATE players
      SET google_id = ?, email = ?, avatar_url = ?, name = ?, auth_provider = 'google'
      WHERE id = ?
    `).run(googleId, cleanEm || null, avatarUrl || null, nextName, playerId);
  } else {
    const r = db.prepare(`
      INSERT INTO players (name, email, google_id, avatar_url, auth_provider, created_at)
      VALUES (?, ?, ?, ?, 'google', ?)
    `).run(displayName, cleanEm || null, googleId, avatarUrl || null, Date.now());
    playerId = Number(r.lastInsertRowid);
  }

  const token = createSession(playerId);
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  return { player: toPublicPlayer(updated), token };
}

function resolveOrigin(req) {
  if (config.publicUrl) return config.publicUrl;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}

function startGoogleOAuth(req, res) {
  if (!config.googleEnabled) {
    res.writeHead(302, { Location: '/?auth_error=google_not_configured' });
    res.end();
    return;
  }
  const state = crypto.randomBytes(24).toString('hex');
  const redirectUri = `${resolveOrigin(req)}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  res.writeHead(302, {
    'set-cookie': `ff_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
  res.end();
}

async function handleGoogleCallback(req, res, url, cookiesObj, currentPlayer, sessionCookieFn) {
  const clearStateCookie = 'ff_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
  const fail = (reason) => {
    res.writeHead(302, { 'set-cookie': clearStateCookie, Location: `/?auth_error=${encodeURIComponent(reason)}` });
    res.end();
  };

  if (!config.googleEnabled) return fail('google_not_configured');
  const errParam = url.searchParams.get('error');
  if (errParam) return fail('cancelled');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !cookiesObj.ff_oauth_state || state !== cookiesObj.ff_oauth_state) {
    return fail('invalid_state');
  }

  try {
    const redirectUri = `${resolveOrigin(req)}/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenRes.ok) return fail('token_exchange_failed');
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return fail('no_access_token');

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!userRes.ok) return fail('userinfo_failed');
    const profile = await userRes.json();
    if (!profile.sub || !profile.email || profile.email_verified === false) {
      return fail('email_unverified');
    }

    const { token } = loginOrCreateGoogle({
      googleId: profile.sub,
      email: profile.email,
      name: profile.name || profile.given_name,
      avatarUrl: profile.picture,
      currentPlayer,
    });

    res.writeHead(302, {
      'set-cookie': [clearStateCookie, sessionCookieFn(token)],
      Location: '/?auth=google',
    });
    res.end();
  } catch (err) {
    console.error('[auth] Google callback failed:', err.message);
    fail('oauth_error');
  }
}

module.exports = {
  createPlayer,
  playerByToken,
  renamePlayer,
  deleteSession,
  registerWithEmail,
  loginWithEmail,
  loginOrCreateGoogle,
  startGoogleOAuth,
  handleGoogleCallback,
};
