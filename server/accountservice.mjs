import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import pg from 'pg';
import { STORE_ITEMS } from './storecatalog.mjs';
import { createPasswordReset } from './passwordreset.mjs';
import { createCrazyGamesVerifier } from './crazygames.mjs';

const activeSkins = new Map(STORE_ITEMS.map(item => [item.id, item.kind]));

const scrypt = promisify(scryptCallback);
const { Pool } = pg;
const BODY_LIMIT = 16 * 1024;
const SESSION_DAYS = 30;

const json = (res, status, value, extra = {}) => {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
};

const cookie = (req, name) => {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
};
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeUsername = (value) => String(value || '').trim();

async function passwordRecord(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt, hash };
}

async function passwordMatches(password, salt, expected) {
  const actual = await scrypt(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('invalid_json'); }
}

export function createAccountService(databaseUrl = process.env.ACCOUNT_DATABASE_URL, options = {}) {
  if (!databaseUrl && !options.pool) return null;
  const pool = options.pool || new Pool({ connectionString: databaseUrl, max: 6, idleTimeoutMillis: 30_000 });
  let ready = false;
  const verifyCrazyGames = createCrazyGamesVerifier(options.crazygames);
  const attempts = new Map();
  const allowAttempt = (req) => {
    const key = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now - entry.started > 60_000) { attempts.set(key, { started: now, count: 1 }); return true; }
    entry.count++;
    return entry.count <= 12;
  };
  const initialized = pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL,
      username_key VARCHAR(24) NOT NULL UNIQUE,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash BYTEA NOT NULL,
      password_salt BYTEA NOT NULL,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS crazygames_id VARCHAR(128) UNIQUE;
    CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS user_skins (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skin_id VARCHAR(80) NOT NULL,
      skin_kind VARCHAR(16) NOT NULL CHECK (skin_kind IN ('character','weapon')),
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, skin_id)
    );
  `).then(() => { ready = true; });
  let reset;
  const resetReady = initialized.then(async () => {
    reset = createPasswordReset(pool, { ...options.reset, passwordRecord, revoke: id => handler.onLogout?.(id) });
    await reset.ready;
  });
  resetReady.catch(() => console.error('[account] Password reset storage unavailable'));

  async function session(req) {
    const token = cookie(req, 'kyx_session');
    if (!token) return null;
    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.kills, u.deaths, u.score, u.games, s.token_hash AS "sessionId", s.expires_at AS "sessionExpiresAt"
      FROM account_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > NOW()
    `, [tokenHash(token)]);
    const user = result.rows[0] || null;
    if (user) {
      const expiry=user.sessionExpiresAt;delete user.sessionExpiresAt;Object.defineProperty(user,'sessionExpiresAt',{value:new Date(expiry).getTime(),enumerable:false});
      const sessionId=user.sessionId;delete user.sessionId;Object.defineProperty(user,'sessionId',{value:sessionId,enumerable:false});
      const owned = await pool.query('SELECT skin_id,skin_kind FROM user_skins WHERE user_id=$1 ORDER BY granted_at', [user.id]);
      user.ownedSkins = owned.rows
        .filter(row => activeSkins.get(row.skin_id) === row.skin_kind)
        .map((row) => ({ id: row.skin_id, kind: row.skin_kind }));
    }
    return user;
  }

  async function issue(res, userId, partitioned = false) {
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO account_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '${SESSION_DAYS} days')`,
      [tokenHash(token), userId]
    );
    return `kyx_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; ${partitioned ? 'SameSite=None; Partitioned' : 'SameSite=Lax'}; Max-Age=${SESSION_DAYS * 86400}`;
  }

  const handler = async (req, res, pathname) => {
    if (!pathname.startsWith('/api/account/')) return false;
    try { await initialized; } catch { json(res, 503, { ok: false, err: 'Account database unavailable' }); return true; }
    if (!ready) { json(res, 503, { ok: false, err: 'Account database unavailable' }); return true; }

    try {
      if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' ||
        req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
        json(res, 403, { ok: false, err: 'Same-origin request required' }); return true;
      }
      if (req.method === 'POST' && pathname === '/api/account/crazygames') {
        if (!allowAttempt(req)) { json(res, 429, { ok: false, err: 'Too many attempts. Try again in one minute.' }); return true; }
        const data = await body(req);
        let claim;
        try { claim = await verifyCrazyGames(data.token); }
        catch (error) {
          const unavailable = ['crazygames_not_configured', 'key_unavailable'].includes(error.message);
          const detail = error.message === 'game_mismatch'
            ? `CrazyGames game configuration mismatch${error.gameId ? ` (signed game ID: ${error.gameId})` : ''}`
            : error.message === 'key_unavailable' ? 'CrazyGames verification key is temporarily unavailable'
            : error.message === 'crazygames_not_configured' ? 'CrazyGames login is not configured yet'
            : 'Unable to verify CrazyGames login';
          json(res, unavailable ? 503 : 401, { ok: false, err: detail });
          return true;
        }
        const identity = tokenHash(claim.userId);
        // Provider identities never merge by display name or email. No password login.
        const result = await pool.query(`INSERT INTO users
          (username,username_key,email,password_hash,password_salt,crazygames_id)
          VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(crazygames_id) DO UPDATE SET username=EXCLUDED.username
          RETURNING id,username,kills,deaths,score,games`,
          [claim.username, 'cg:' + identity.slice(0,21), identity + '@crazygames.invalid', randomBytes(64), randomBytes(16), claim.userId]);
        const setCookie = await issue(res, result.rows[0].id, true);
        json(res, 200, { ok: true, user: result.rows[0] }, { 'Set-Cookie': setCookie });
        return true;
      }
      if (req.method === 'POST' && pathname === '/api/account/crazygames/guest') {
        // Expire only the partitioned platform session, not the standalone login.
        json(res, 200, { ok: true }, { 'Set-Cookie': 'kyx_session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0' });
        return true;
      }
      if (req.method === 'POST' && ['/api/account/reset/request', '/api/account/reset/confirm'].includes(pathname)) {
        if (!allowAttempt(req)) { json(res, 429, { ok: false, err: 'Too many attempts. Try again in one minute.' }); return true; }
        await resetReady;
        if (!reset.enabled) { json(res, 503, { ok: false, err: 'Password reset email is not configured yet. Please try again later.' }); return true; }
        const data = await body(req), email = normalizeEmail(data.email);
        if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) { json(res, 400, { ok: false, err: 'Enter your registered email address' }); return true; }
        if (pathname.endsWith('/request')) {
          await reset.request(email);
          json(res, 200, { ok: true, message: 'If an account uses that email, a four-digit code will arrive shortly. Check spam too. Codes expire in 10 minutes; wait 10 minutes before requesting another.' });
        } else {
          const code = String(data.code || ''), password = String(data.password || '');
          if (!/^\d{4}$/.test(code) || password.length < 8 || password.length > 128) {
            json(res, 400, { ok: false, err: 'Enter a four-digit code and a password of 8–128 characters' }); return true;
          }
          const ok = await reset.confirm(email, code, password);
          json(res, ok ? 200 : 400, ok ? { ok: true } : { ok: false, err: 'Invalid or expired code. After five incorrect attempts, request a new code when the 10-minute wait ends.' });
        }
        return true;
      }
      if (req.method === 'GET' && pathname === '/api/account/me') {
        const user = await session(req);
        json(res, user ? 200 : 401, user ? { ok: true, user } : { ok: false });
        return true;
      }
      if (req.method === 'POST' && pathname === '/api/account/register') {
        if (!allowAttempt(req)) { json(res, 429, { ok: false, err: 'Too many attempts. Try again in one minute.' }); return true; }
        const data = await body(req);
        const username = normalizeUsername(data.username);
        const usernameKey = username.toLowerCase();
        const email = normalizeEmail(data.email);
        const password = String(data.password || '');
        if (username.length < 2 || username.length > 24 || !/^[a-zA-Z0-9_]+$/.test(username)) {
          json(res, 400, { ok: false, err: 'Username must be 2–24 letters, numbers, or underscores' }); return true;
        }
        if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || email.endsWith('@crazygames.invalid')) { json(res, 400, { ok: false, err: 'Enter a valid email address' }); return true; }
        if (password.length < 8 || password.length > 128) { json(res, 400, { ok: false, err: 'Password must be 8–128 characters' }); return true; }
        const record = await passwordRecord(password);
        try {
          const result = await pool.query(
            'INSERT INTO users(username,username_key,email,password_hash,password_salt) VALUES($1,$2,$3,$4,$5) RETURNING id,username,email,kills,deaths,score,games',
            [username, usernameKey, email, record.hash, record.salt]
          );
          const setCookie = await issue(res, result.rows[0].id);
          json(res, 201, { ok: true, user: result.rows[0] }, { 'Set-Cookie': setCookie });
        } catch (error) {
          if (error?.code === '23505') json(res, 409, { ok: false, err: String(error.constraint).includes('email') ? 'Email already registered' : 'Username already taken' });
          else throw error;
        }
        return true;
      }
      if (req.method === 'POST' && pathname === '/api/account/login') {
        if (!allowAttempt(req)) { json(res, 429, { ok: false, err: 'Too many attempts. Try again in one minute.' }); return true; }
        const data = await body(req);
        const identifier = String(data.identifier || '').trim().toLowerCase();
        const result = await pool.query(
          'SELECT id,username,email,password_hash,password_salt,kills,deaths,score,games FROM users WHERE (username_key=$1 OR email=$1) AND crazygames_id IS NULL LIMIT 1',
          [identifier]
        );
        const user = result.rows[0];
        if (!user || String(data.password || '').length > 128 || !(await passwordMatches(String(data.password || ''), user.password_salt, user.password_hash))) {
          json(res, 401, { ok: false, err: 'Incorrect username, email, or password' }); return true;
        }
        const setCookie = await issue(res, user.id);
        delete user.password_hash; delete user.password_salt;
        json(res, 200, { ok: true, user }, { 'Set-Cookie': setCookie });
        return true;
      }
      if (req.method === 'POST' && pathname === '/api/account/logout') {
        const token = cookie(req, 'kyx_session');
        if (token) { await pool.query('DELETE FROM account_sessions WHERE token_hash=$1', [tokenHash(token)]); handler.onLogout?.(tokenHash(token)); }
        json(res, 200, { ok: true }, { 'Set-Cookie': 'kyx_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
        return true;
      }
      json(res, 404, { ok: false, err: 'Not found' });
      return true;
    } catch (error) {
      console.error('[account]', error?.message || error);
      json(res, error?.message === 'too_large' ? 413 : 400, { ok: false, err: 'Request failed' });
      return true;
    }
  };
  handler.ready = initialized;
  handler.pool = pool;
  handler.session = session;
  return handler;
}
