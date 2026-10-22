import * as THREE from 'three';
import {
  MAIN_GUN_SKIN_SETS,
  WEAPON_SKINS,
  applyWeaponSkin,
  animateWeaponSkin,
  getWeaponIdForSkin,
  getWeaponSkinsFor,
  isSkinForWeapon,
} from '../src/weapons/WeaponSkins.js';
import { MAIN_WEAPON_IDS } from '../src/weapons/weaponDefs.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = new Proxy({}, { get(target, key) {
  if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
  if (key === 'measureText') return () => ({ width: 10 });
  return target[key] ?? (target[key] = noop);
} });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context2d }),
};
assert(Object.keys(MAIN_GUN_SKIN_SETS).length === 5, 'expected five main-gun skin sets');
const assigned = [];
for (const weaponId of MAIN_WEAPON_IDS) {
  const skins = getWeaponSkinsFor(weaponId).filter(s => !s.model);
  assert(skins.length === 15, `${weaponId} has ${skins.length} skins instead of 15`);
  assert(skins.filter(s=>s.rarity==='legendary').length===5 && skins.filter(s=>s.rarity==='rare').length===5 && skins.filter(s=>s.rarity==='common').length===5, 'five of each rarity required');
  for (const skin of skins) {
    assert(isSkinForWeapon(weaponId, skin.id), `${skin.id} is not assigned to ${weaponId}`);
    assert(getWeaponIdForSkin(skin.id) === weaponId, `${skin.id} reverse assignment is wrong`);
    assigned.push(skin.id);
  }
}
assert(new Set(assigned).size === 75, 'main-gun skin assignments must be 75 unique finishes');
assert(assigned.every((id) => WEAPON_SKINS.some((skin) => skin.id === id)), 'assigned skin is missing');

// Applying every assigned finish must leave the model hierarchy, transforms,
// and vertex data untouched. Skins are material-only, never alternate meshes.
for (const skinId of assigned) {
  const skin = WEAPON_SKINS.find((entry) => entry.id === skinId);
  const geometry = new THREE.BoxGeometry(1, 0.4, 2);
  const material = new THREE.MeshStandardMaterial();
  material.userData.role = 'body';
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  const positions = [...geometry.attributes.position.array];
  const childCount = group.children.length;
  applyWeaponSkin(group, skin);
  if(skin.rarity==='rare' || skin.rarity==='legendary') {
    if(skin.animated) {
      animateWeaponSkin(group,skin,0);const first=material.emissiveIntensity;
      animateWeaponSkin(group,skin,1);assert(first!==material.emissiveIntensity, 'Legendary glow must animate');
      assert(material.emissiveIntensity<=skin.animMax, 'glow must stay bounded');
    }
    assert(material.map?.isTexture, `${skinId} is missing its patterned wrap`);
    applyWeaponSkin(group, WEAPON_SKINS.find(s=>s.rarity==='common'));
    assert(material.map===null, 'switching back to Common must clear the Rare wrap');
  }
  assert(group.children.length === childCount, `${skinId} changed the model hierarchy`);
  assert(geometry.attributes.position.array.every((value, i) => value === positions[i]), `${skinId} changed gun geometry`);
  assert(mesh.position.length() === 0
    && mesh.rotation.x === 0 && mesh.rotation.y === 0 && mesh.rotation.z === 0,
  `${skinId} changed gun transforms`);
}

console.log('weapon skins passed: 15 finishes per main gun: five Common, Rare and Legendary (75 total)');

const { createLegendaryShot } = await import('../src/core/LegendaryAudio.js');
const themes = ['fire', 'water', 'garden', 'toxic', 'neko'];
for (const weaponId of MAIN_WEAPON_IDS) {
  for (const rarity of ['rare', 'legendary']) {
    const themed = WEAPON_SKINS.filter(s => s.weaponId === weaponId && s.rarity === rarity && !s.model);
    assert(themes.every(t => themed.some(s => s.theme === t)), `${weaponId}/${rarity}: missing theme`);
    for (const skin of themed) {
      const material = new THREE.MeshStandardMaterial();
      material.userData.role = 'body';
      const group = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), material));
      applyWeaponSkin(group, skin);
      assert(!!material.userData.legendaryEffect === (rarity === 'legendary'), 'only Legendary gets shader animation');
      if (rarity === 'rare') assert(!skin.animated && !skin.shootSound, 'Rare must not inherit Legendary effects');
      else {
        const audio = createLegendaryShot(skin.shootSound, 48000);
        assert(audio?.length > 1000 && audio.some(v => Math.abs(v) > 0.05), 'Legendary firing sound must be audible');
        assert(audio.every(v => Number.isFinite(v) && Math.abs(v) <= 0.58), 'sound must be finite and bounded');
      }
      applyWeaponSkin(group, WEAPON_SKINS.find(s => s.rarity === 'common'));
      assert(!material.userData.legendaryEffect && !material.map, 'Common must clear both shader and wrap');
    }
  }
}
console.log('theme rarity checks passed: five themes per gun, exclusive Legendary effects and bounded audio');
const { SWORD_SKINS } = await import('../server/swordskins.mjs');
const { applySwordSkin, animateSwordSkin } = await import('../src/weapons/SwordSkins.js');
for (const skin of SWORD_SKINS.filter(s => !s.model)) {
 const m = new THREE.MeshStandardMaterial();m.userData.role='metal';
 const g = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),m));
 applySwordSkin(g,skin);animateSwordSkin(g,skin,0.75);
 assert(!!m.userData.legendaryEffect === ['legendary','mythic'].includes(skin.rarity), 'sword effect must follow rarity');
 assert(Number.isFinite(m.emissiveIntensity), 'sword glow must remain finite');
 applySwordSkin(g,SWORD_SKINS.find(s=>s.rarity==='common'));
 assert(!m.userData.legendaryEffect && !m.map,'Common sword clears themed effects');
}
console.log('sword theme rarity and downgrade checks passed');
