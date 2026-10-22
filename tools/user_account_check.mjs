import { webcrypto } from 'node:crypto';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

globalThis.crypto ??= webcrypto;
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.btoa ??= (value) => Buffer.from(value, 'binary').toString('base64');
globalThis.atob ??= (value) => Buffer.from(value, 'base64').toString('binary');

const { UserAccount } = await import('../src/core/UserAccount.js');
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const db = () => JSON.parse(localStorage.getItem('sio_accounts') || '{"accounts":{}}');

UserAccount.guest();
const guestName = UserAccount.getDisplayName('__guest__');
assert(/^Guest\d{6}$/.test(guestName), `guest identity has the wrong format (${guestName})`);
assert(UserAccount.getDisplayName('__guest__') === guestName,
  'guest identity changed during the same browser session');
UserAccount.logout();

const weak = await UserAccount.register('Pilot', 'short');
assert(!weak.ok, 'new registrations accepted a weak password');

const created = await UserAccount.register('Pilot', 'correct horse battery staple', 'Pilot@Example.com');
assert(created.ok, `registration failed: ${created.err}`);
const stored = db().accounts.pilot;
assert(stored.password === undefined, 'registration stored a plaintext password');
assert(typeof stored.passwordHash === 'string' && stored.passwordHash.length > 20, 'password hash missing');
assert(typeof stored.passwordSalt === 'string' && stored.passwordSalt.length > 10, 'password salt missing');
assert(stored.email === 'pilot@example.com', 'normalized email missing');

const duplicateEmail = await UserAccount.register('Wingman', 'another secure password', 'pilot@example.com');
assert(!duplicateEmail.ok, 'duplicate email accepted');

UserAccount.logout();
assert(!(await UserAccount.login('Pilot', 'wrong password')).ok, 'wrong password logged in');
assert((await UserAccount.login('Pilot', 'correct horse battery staple')).ok, 'valid hash login failed');
UserAccount.logout();
assert((await UserAccount.login('pilot@example.com', 'correct horse battery staple')).ok, 'email login failed');

localStorage.setItem('sio_accounts', JSON.stringify({
  accounts: {
    legacy: {
      displayName: 'Legacy',
      password: 'old password',
      created: 0,
      stats: {},
    },
  },
}));
UserAccount.logout();
assert((await UserAccount.login('legacy', 'old password')).ok, 'legacy login failed');
const migrated = db().accounts.legacy;
assert(migrated.password === undefined, 'legacy plaintext password was not removed');
assert(migrated.passwordHash && migrated.passwordSalt, 'legacy account was not upgraded');

console.log('account check passed: PBKDF2 storage, wrong-password rejection, and plaintext migration');
