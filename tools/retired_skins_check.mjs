import assert from 'node:assert/strict';
import { STORE_ITEMS } from '../server/storecatalog.mjs';
import { getNightMarket, WEEK_MS } from '../server/nightmarket.mjs';
import { Shop } from '../src/core/Shop.js';
import { Armory } from '../src/core/Armory.js';
const storage = new Map([
  ['sio_shop', JSON.stringify({ coins: 123, owned: ['arctic_ghost', 'remake_84'] })],
  ['sio_armor_skin', 'arctic_ghost'],
  ['sio_armory', JSON.stringify({ magnum: 'magnum_kings_ransom', sword: 'sword_sovereign_blade', __owned: ['magnum_kings_ransom', 'sword_sovereign_blade', 'remake_187', 'remake_425'] })],
]);
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
assert.equal(STORE_ITEMS.length, 357);
assert.ok(STORE_ITEMS.every(item => item.id.startsWith('remake_')));
for (let week = 0; week < 357; week++) {
  const market = getNightMarket(Date.UTC(2026, 0, 5) + week * WEEK_MS);
  assert.equal(market.items.length, 5);
  assert.ok(market.items.every(item => item.id.startsWith('remake_')));
}
assert.equal(Shop.getEquipped(), null);
assert.deepEqual(Shop.getOwned(), ['remake_84']);
assert.equal(Shop.getCoins(), 123);
assert.equal(Armory.getSkinId('magnum'), null);
assert.equal(Armory.getSkinId('sword'), null);
assert.deepEqual(Armory.ownedSkins(), ['remake_187', 'remake_425']);
Shop.equip('arctic_ghost');
Armory.equipSkin('magnum', 'magnum_kings_ransom');
assert.equal(Shop.getEquipped(), null);
assert.equal(Armory.getSkinId('magnum'), null);
Shop.equip('remake_84');
Armory.equipSkin('magnum', 'remake_187');
Armory.equipSkin('sword', 'remake_425');
assert.equal(Shop.getEquipped(), 'remake_84');
assert.equal(Armory.getSkinId('magnum'), 'remake_187');
assert.equal(Armory.getSkinId('sword'), 'remake_425');
console.log('Retired skins: market exclusion, saved inventory fallback, rejected equip and current ownership preserved.');
