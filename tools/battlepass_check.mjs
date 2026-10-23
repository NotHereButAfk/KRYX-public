import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { BP_MILESTONES, battlePassProgress, battlePassXP } from '../src/sim/BattlePassCatalog.js';
import { getArmorSkin } from '../src/player/ArmorSkins.js';
import { skinArtwork } from '../src/ui/MarketPreview.js';
import { STORE_ITEMS } from '../server/storecatalog.mjs';

const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
const sessions = new Map([['sio_session', 'player']]);
globalThis.sessionStorage = { getItem: key => sessions.get(key) || null };
const { BattlePass } = await import('../src/core/BattlePass.js');
const { Shop } = await import('../src/core/Shop.js');
for (const reward of BP_MILESTONES) {
  const skin = getArmorSkin(reward.id);
  assert.ok(skin && STORE_ITEMS.some(item => item.id === reward.id && item.kind === 'character'));
  assert.equal(skin.earningEnabled, false);
  assert.ok(existsSync(new URL('../public' + skin.model, import.meta.url)));
  assert.ok(existsSync(new URL('../public' + skinArtwork(skin), import.meta.url)));
}
assert.equal(new Set(BP_MILESTONES.map(reward => reward.id)).size, 6);
assert.equal(battlePassXP({ kills: 80, games: 5 }), 2500);
assert.equal(battlePassProgress({ xp: 1999 }).claimable, 0);
assert.equal(battlePassProgress({ xp: 2000 }).claimable, 1);
assert.equal(battlePassProgress({ xp: 14500 }).tier, 30);
assert.equal(battlePassProgress({ xp: 999999 }).claimable, 6);

// Old premium/credit claims cannot swallow new cosmetic grants; old data survives.
const legacy = { xp: 14500, premium: true, claimed: ['5_free', '10_premium', '30_free'], custom: 'preserved' };
storage.set('sio_bp', JSON.stringify(legacy));
storage.set('sio_shop', JSON.stringify({ coins: 12345, owned: ['remake_153', '__bp_premium__'] }));
assert.equal(BattlePass.getClaimableCount(), 6);
assert.equal(BattlePass.PREMIUM_COST, 0);
assert.equal(BattlePass.hasPremium(), true);
assert.equal(BattlePass.unlockPremium().ok, true);
assert.equal(Shop.buy('__bp_premium__', 1000).ok, false);
assert.equal(Shop.getCoins(), 12345);
const result = await BattlePass.claimRewards();
assert.equal(result.ok, true);
assert.equal(result.granted.length, 6);
assert.equal(BattlePass.getClaimableCount(), 0);
assert.equal((await BattlePass.claimRewards()).ok, false);
assert.equal((await BattlePass.claimRewards(1)).ok, false);
assert.equal(Shop.getCoins(), 12345);
assert.equal(Shop.isOwned('remake_153'), true);
for (const reward of BP_MILESTONES) assert.equal(Shop.isOwned(reward.id), true);
const saved = JSON.parse(storage.get('sio_bp'));
assert.equal(saved.xp, legacy.xp);
assert.equal(saved.premium, true);
assert.equal(saved.custom, 'preserved');
assert.equal(saved.claimed.length, 9);
for (const key of legacy.claimed) assert.ok(saved.claimed.includes(key));
BattlePass.addXP(-500); BattlePass.addXP(NaN); BattlePass.addXP(Infinity);
assert.equal(BattlePass.getData().xp, 14500);

// Online rewards cannot be unlocked using forged browser XP or a stale account.
globalThis.location = { hostname: 'game.test' };
const requests = [];
const owner = { id: '1', username: 'player' };
globalThis.fetch = async (url, opts) => {
  requests.push({ url, ...opts });
  return { ok: true, json: async () => ({ owner, season: 'free-v2', xp: 2000, claimed: [], ownedSkins: [] }) };
};
await BattlePass.refresh();
assert.equal(BattlePass.getTier(), 5);
assert.equal(BattlePass.getClaimableCount(), 1);
BattlePass.addXP(999999);
assert.equal(BattlePass.getTier(), 5);
assert.equal(storage.get('sio_bp'), JSON.stringify(saved));
await BattlePass.claimRewards(5);
assert.deepEqual(JSON.parse(requests.at(-1).body), { tier: 5, expectedUsername: 'player' });
assert.equal(requests.at(-1).credentials, 'same-origin');
let resolve;
globalThis.fetch = () => new Promise(done => { resolve = done; });
const pending = BattlePass.refresh();
sessions.set('sio_session', 'other-player');
resolve({ ok: true, json: async () => ({ owner, season: 'free-v2', xp: 14500, claimed: [], ownedSkins: [{ id: 'remake_163', kind: 'character' }] }) });
assert.equal((await pending).ok, false);
assert.equal(BattlePass.getTier(), 1);
assert.equal(Shop.isOwned('remake_163'), false);
// A different tab can replace the cookie while this tab retains its username.
sessions.set('sio_session', 'player');
globalThis.fetch = async () => ({ ok: true, json: async () => ({ owner: { id: '2', username: 'other-player' }, season: 'free-v2', xp: 14500, claimed: ['free-v2:30'], ownedSkins: [{ id: 'remake_163', kind: 'character' }] }) });
assert.equal((await BattlePass.refresh()).ok, false);
assert.equal(BattlePass.getTier(), 5);
assert.equal(BattlePass.isClaimed(30), false);
assert.equal(Shop.isOwned('remake_163'), false);

// Reopening during a claim may finish a newer, pre-commit GET first. The
// committed claim must win rather than leaving a collected reward claimable.
const pendingRequests = [];
globalThis.fetch = (url, opts) => new Promise(done => pendingRequests.push({ done, url, opts }));
const claimRequest = BattlePass.claimRewards(5);
const refreshRequest = BattlePass.refresh();
pendingRequests[1].done({ ok: true, json: async () => ({ owner, season: 'free-v2', xp: 2000, claimed: [], ownedSkins: [] }) });
await refreshRequest;
pendingRequests[0].done({ ok: true, json: async () => ({ owner, season: 'free-v2', xp: 2000, claimed: ['free-v2:5'], ownedSkins: [{ id: 'remake_110', kind: 'character' }] }) });
assert.equal((await claimRequest).ok, true);
assert.equal(BattlePass.isClaimed(5), true);
assert.equal(BattlePass.getClaimableCount(), 0);
console.log('Battle pass: six valid cosmetic milestones, legacy preservation, free claims, no duplicate rewards, server authority and account isolation passed.');
