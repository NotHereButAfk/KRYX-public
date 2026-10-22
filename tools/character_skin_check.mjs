import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARMOR_SKINS } from '../src/player/ArmorSkins.js';
import { resolveViewmodelPalette } from '../src/player/PreviewCharacter.js';

assert.equal(new Set(ARMOR_SKINS.map((skin) => skin.id)).size, ARMOR_SKINS.length,
  'character skin ids must be unique');
assert.equal(ARMOR_SKINS.length, 154);
assert.ok(ARMOR_SKINS.every(s => s.collection === 'Reforged Collection' && s.model));
assert.ok(ARMOR_SKINS.every(s => ['common', 'rare', 'epic', 'legendary'].includes(s.rarity) && !s.starter && !s.unlocked));

for (const skin of ARMOR_SKINS) {
  for (const field of ['primary', 'secondary', 'emissive']) {
    assert.ok(Number.isInteger(skin[field]) && skin[field] >= 0 && skin[field] <= 0xffffff,
      `${skin.id}.${field} must be a valid RGB hex`);
  }
  assert.equal(skin.shield, 0, `${skin.id} must remain cosmetic-only`);

  const view = resolveViewmodelPalette(null, 'vanguard', skin);
  const bodyPlate = new THREE.Color(skin.primary).multiplyScalar(0.92).getHex();
  const bodySleeve = new THREE.Color(skin.secondary)
    .lerp(new THREE.Color(0x4b5766), 0.42).getHex();
  const bodyGlove = new THREE.Color(skin.secondary)
    .lerp(new THREE.Color(0x303844), 0.28).multiplyScalar(0.72).getHex();
  assert.equal(view.plate, bodyPlate, `${skin.id} FPS plate differs from the third-person body`);
  assert.equal(view.sleeve, bodySleeve, `${skin.id} FPS sleeve differs from the third-person body`);
  assert.equal(view.glove, bodyGlove, `${skin.id} FPS glove differs from the third-person body`);
  assert.equal(view.accent, skin.emissive,
    `${skin.id} FPS accent differs from the third-person body`);
}

console.log(`ok   ${ARMOR_SKINS.length} current Reforged character models`);

const collection=ARMOR_SKINS.filter(s=>s.collection==='Frontier Ten');
assert.equal(collection.length,0,'legacy collection is retired');

const { STORE_ITEMS } = await import('../server/storecatalog.mjs');
assert.deepEqual(STORE_ITEMS.filter(s => s.kind === 'character').map(s => s.id), ARMOR_SKINS.map(s => s.id));
const storage = new Map([['sio_shop', JSON.stringify({coins:500,owned:['cobalt_circuit']})], ['sio_armor_skin','cobalt_circuit']]);
globalThis.localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const { Shop } = await import('../src/core/Shop.js');
assert.equal(Shop.getEquipped(),null);
assert.deepEqual(Shop.getOwned(),[]);
assert.equal(Shop.isOwned('arctic_ghost'),false);
Shop.equip('arctic_ghost'); assert.equal(Shop.getEquipped(),null);
Shop.unlock('arctic_ghost'); Shop.equip('arctic_ghost');
assert.equal(Shop.getEquipped(),null,'retired ownership cannot re-equip legacy skins');
Shop.unlock('remake_84'); Shop.equip('remake_84');
assert.equal(Shop.getEquipped(),'remake_84');
