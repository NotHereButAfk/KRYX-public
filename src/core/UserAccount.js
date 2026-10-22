// Production uses server authentication and an HttpOnly session cookie.
// Localhost retains a salted-password demo store for offline development.
import { isCrazyGames, restoreCrazyGamesAccount } from './CrazyGamesAccount.js';

const _DB  = 'sio_accounts';
const _SES = 'sio_session';
const _GUEST = 'sio_guest_name';
const _PBKDF2_ITERS = 210_000;
const _SALT_BYTES = 16;
const _usesServer = () => typeof location !== 'undefined'
  && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';

function _storeServerProfile(user) {
  localStorage.setItem('sio_server_profile', JSON.stringify(user));
  const entitlements = Array.isArray(user?.ownedSkins) ? user.ownedSkins : [];
  const cached = (key) => { try { const value=JSON.parse(localStorage.getItem(key));return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; } };
  const shop = cached('sio_shop');
  const armory = cached('sio_armory');
  shop.owned = []; // Replace the previous account's character entitlements.
  armory.__owned = []; // Account entitlements replace prior local ownership.
  for (const item of entitlements) {
    const target = item.kind === 'character' ? shop.owned : armory.__owned;
    if (!target.includes(item.id)) target.push(item.id);
  }
  localStorage.setItem('sio_shop', JSON.stringify(shop));
  localStorage.setItem('sio_armory', JSON.stringify(armory));
}

function _load() {
  try { return JSON.parse(localStorage.getItem(_DB) || '{"accounts":{}}'); }
  catch { return { accounts: {} }; }
}
function _save(db) { localStorage.setItem(_DB, JSON.stringify(db)); }

function _base64(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function _fromBase64(value) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function _derive(password, salt, iterations = _PBKDF2_ITERS) {
  if (!globalThis.crypto?.subtle) throw new Error('secure password storage unavailable');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256
  );
  return new Uint8Array(bits);
}

function _sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function _passwordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(_SALT_BYTES));
  const hash = await _derive(password, salt);
  return {
    passwordHash: _base64(hash),
    passwordSalt: _base64(salt),
    passwordIterations: _PBKDF2_ITERS,
  };
}

export const UserAccount = {
  clearServerProfile() {
    _storeServerProfile({ ownedSkins: [] });
    sessionStorage.removeItem(_SES);
    localStorage.removeItem('sio_server_profile');
  },
  acceptServerProfile(user) {
    sessionStorage.setItem(_SES, user.username.toLowerCase());
    _storeServerProfile(user);
  },
  current()    { return sessionStorage.getItem(_SES) || null; },
  isGuest()    { return sessionStorage.getItem(_SES) === '__guest__'; },
  isLoggedIn() { return !!sessionStorage.getItem(_SES); },

  async login(username, password) {
    if (_usesServer()) {
      try {
        const response = await fetch('/api/account/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: username, password }) });
        const result = await response.json();
        if (!result.ok) return result;
        sessionStorage.setItem(_SES, result.user.username.toLowerCase());
        _storeServerProfile(result.user);
        return { ok: true };
      } catch { return { ok: false, err: 'Unable to reach the account server' }; }
    }
    if (!username) return { ok: false, err: 'Enter a username' };
    const db = _load();
    const lookup = username.trim().toLowerCase();
    const key = db.accounts[lookup]
      ? lookup
      : Object.keys(db.accounts).find((candidate) => db.accounts[candidate]?.email === lookup);
    const acc = db.accounts[key];
    if (!acc) return { ok: false, err: 'Account not found' };

    try {
      let valid = false;
      if (acc.passwordHash && acc.passwordSalt) {
        const actual = await _derive(
          password,
          _fromBase64(acc.passwordSalt),
          acc.passwordIterations || _PBKDF2_ITERS
        );
        valid = _sameBytes(actual, _fromBase64(acc.passwordHash));
      } else if (typeof acc.password === 'string') {
        // One-time compatibility path for accounts created before hashes.
        valid = acc.password === password;
        if (valid) {
          Object.assign(acc, await _passwordRecord(password));
          delete acc.password;
          _save(db);
        }
      }
      if (!valid) return { ok: false, err: 'Incorrect password' };
    } catch {
      return { ok: false, err: 'Secure login is unavailable in this browser' };
    }

    sessionStorage.setItem(_SES, key);
    return { ok: true };
  },

  async register(username, password, email = '') {
    if (_usesServer()) {
      try {
        const response = await fetch('/api/account/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, email }) });
        const result = await response.json();
        if (!result.ok) return result;
        sessionStorage.setItem(_SES, result.user.username.toLowerCase());
        _storeServerProfile(result.user);
        return { ok: true };
      } catch { return { ok: false, err: 'Unable to reach the account server' }; }
    }
    const u = (username || '').trim();
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (u.length < 2)               return { ok: false, err: 'Username must be 2+ characters' };
    if (u.length > 24)              return { ok: false, err: 'Username must be 24 characters or fewer' };
    if (!/^[a-zA-Z0-9_]+$/.test(u)) return { ok: false, err: 'Letters, numbers and _ only' };
    if (!password || password.length < 8) return { ok: false, err: 'Password must be 8+ characters' };
    if (normalizedEmail && !/^\S+@\S+\.\S+$/.test(normalizedEmail)) return { ok: false, err: 'Enter a valid email address' };
    const db = _load();
    if (db.accounts[u.toLowerCase()]) return { ok: false, err: 'Username already taken' };
    if (normalizedEmail && Object.values(db.accounts).some((account) => account?.email === normalizedEmail)) {
      return { ok: false, err: 'Email already registered' };
    }
    let passwordFields;
    try {
      passwordFields = await _passwordRecord(password);
    } catch {
      return { ok: false, err: 'Secure registration is unavailable in this browser' };
    }
    db.accounts[u.toLowerCase()] = {
      displayName: u,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...passwordFields,
      created: Date.now(),
      stats: { kills: 0, deaths: 0, score: 0, games: 0 },
    };
    _save(db);
    sessionStorage.setItem(_SES, u.toLowerCase());
    return { ok: true };
  },

  logout() {
    sessionStorage.removeItem(_SES);
    localStorage.removeItem('sio_server_profile');
    if (_usesServer()) {
      fetch('/api/account/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }
  },
  async restore() {
    if (isCrazyGames()) return restoreCrazyGamesAccount(this);
    if (typeof location === 'undefined' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return this.current();
    const session = this.current();
    try {
      const response = await fetch('/api/account/me', { credentials: 'same-origin', cache: 'no-store' });
      const result = await response.json();
      if (session !== this.current()) return this.current();
      if (!response.ok && response.status !== 401) return this.current();
      if (!result.ok) { sessionStorage.removeItem(_SES); localStorage.removeItem('sio_server_profile'); return null; }
      sessionStorage.setItem(_SES, result.user.username.toLowerCase());
      _storeServerProfile(result.user);
      return this.current();
    } catch { return this.current(); }
  },
  guest()  {
    sessionStorage.setItem(_SES, '__guest__');
    if (!sessionStorage.getItem(_GUEST)) {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      sessionStorage.setItem(_GUEST, `Guest${(bytes[0] % 1_000_000).toString().padStart(6, '0')}`);
    }
  },

  getDisplayName(username) {
    if (username === '__guest__') {
      if (!sessionStorage.getItem(_GUEST)) this.guest();
      return sessionStorage.getItem(_GUEST);
    }
    const serverProfile = JSON.parse(localStorage.getItem('sio_server_profile') || 'null');
    if (serverProfile?.username?.toLowerCase() === username) return serverProfile.username;
    const { accounts } = _load();
    return accounts[username]?.displayName || username;
  },

  getStats(username) {
    const serverProfile = JSON.parse(localStorage.getItem('sio_server_profile') || 'null');
    if (serverProfile?.username?.toLowerCase() === username) return serverProfile;
    const { accounts } = _load();
    return accounts[username]?.stats || { kills: 0, deaths: 0, score: 0, games: 0 };
  },

  addGameStats(username, kills, score, deaths = 0) {
    if (!username || username === '__guest__') return;
    const db = _load();
    const acc = db.accounts[username];
    if (!acc) return;
    acc.stats.kills  = (acc.stats.kills  || 0) + kills;
    acc.stats.deaths = (acc.stats.deaths || 0) + deaths;
    acc.stats.score  = (acc.stats.score  || 0) + score;
    acc.stats.games  = (acc.stats.games  || 0) + 1;
    _save(db);
  },
};
