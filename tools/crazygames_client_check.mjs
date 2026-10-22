import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreCrazyGamesAccount, isCrazyGames } from '../src/core/CrazyGamesAccount.js';
globalThis.location = { pathname: '/crazygames.html', reload() { reloaded++; } };
let reloaded = 0, listener, loggedIn = true, id = '15', refuse = false;
globalThis.window = { top: {}, self: {}, CrazyGames: { SDK: { init: async () => {}, user: {
  isUserAccountAvailable: true,
  getUser: async () => loggedIn ? { username: 'One' } : null,
  getUserToken: async () => 'signed-token',
  addAuthListener: fn => { listener = fn; },
} } } };
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  if (url === '/api/account/crazygames/guest') return { ok: true };
  if (url === '/api/account/crazygames') return { ok: !refuse, json: async () => refuse ? { ok: false, err: 'rejected' } : { ok: true, user: { id } } };
  return { ok: true, json: async () => ({ user: { id, username: 'One', ownedSkins: [{ id: 'owned-skin' }] } }) };
};
let current = 'stale-user', profile;
const account = { clearServerProfile() { current = null; profile = null; }, acceptServerProfile(user) { current = user.username; profile = user; }, guest() { current = '__guest__'; }, current() { return current; } };
assert(isCrazyGames());
assert.equal(await restoreCrazyGamesAccount(account), 'One');
assert.equal(profile.ownedSkins[0].id, 'owned-skin');
assert.equal(JSON.parse(requests[1].options.body).token, 'signed-token');
listener(); assert.equal(reloaded, 1);
loggedIn = false;
assert.equal(await restoreCrazyGamesAccount(account), '__guest__');
assert.equal(profile, null);
loggedIn = true; refuse = true;
await assert.rejects(restoreCrazyGamesAccount(account), /rejected/);
assert.equal(current, null);
location.pathname = '/'; assert(!isCrazyGames());
const html = readFileSync('dist/crazygames.html', 'utf8');
assert(!html.includes('src="https://pagead2.googlesyndication.com'));
assert(!/\ssrc="https:\/\/acceptable\.a-ads\.com/.test(html));
assert(readFileSync('dist/index.html', 'utf8').includes('src="https://pagead2.googlesyndication.com'));
console.log('PASS platform login, guest/account switching, rejection isolation, ownership refresh and ad-free build separation');
