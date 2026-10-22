import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { buildEvAutoRifle } from '../src/weapons/EvAutoRifle.js';
import { applySkinToCharacter } from '../src/player/PreviewCharacter.js';
import { ARMOR_SKINS } from '../src/player/ArmorSkins.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { applyWeaponSkin, WEAPON_SKINS } from '../src/weapons/WeaponSkins.js';
import { disposeModel } from '../src/core/ModelResources.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
async function parse(name) {
  const bytes = fs.readFileSync(new URL(`../public/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
installEvCharacter(await parse('ev-default.glb'));
const a = buildEvCharacter(), fresh = buildEvCharacter();
const u = a.userData, rifle = a.getObjectByName('Auto_Rifle_-_root');
const rifleColors = new Map();
rifle.traverse((o) => { if (o.isMesh) rifleColors.set(o.material, o.material.color.getHex()); });
const original = u.bodyMats.map((m) => [m.color.getHex(), m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity]);
// Authored GLB replacements are exercised by authored_skin_check.mjs.
for (const finish of ARMOR_SKINS.filter(s => !s.model)) {
  applySkinToCharacter(a, { id: 'default' }, finish);
  const role = (name) => u.bodyMats.find((m) => m.userData.armorRole === name);
  assert(role('plate').color.equals(new THREE.Color(finish.primary).multiplyScalar(0.92)));
  assert(role('under').color.equals(new THREE.Color(finish.secondary).lerp(new THREE.Color(0x4b5766), 0.42)));
  assert.equal(role('accent').emissive.getHex(), finish.emissive);
  assert.equal(role('accent').emissiveIntensity, finish.emissiveIntensity);
  for (const m of u.bodyMats) { assert.equal(m.roughness, finish.roughness); assert.equal(m.metalness, finish.metalness); }
  if (finish.theme) {
    const theme = a.getObjectByName(`EV helmet theme - ${finish.theme}`);
    assert.equal(theme.parent, u.bones.Bip001_Head);
    const mount = theme.matrix.clone();
    let disposed = 0;
    theme.children[0].geometry.addEventListener('dispose', () => disposed++);
    u.setLocomotion(5, true, true); u.setAim(0.6, 0.3);
    for (let i = 0; i < 30; i++) u.mixer.update(1 / 60);
    applySkinToCharacter(a, null, finish);
    assert.equal(disposed, 1, 'replacing a helmet theme releases its owned geometry');
    assert.deepEqual(a.getObjectByName(theme.name).matrix.elements, mount.elements, 'retinting mid-animation preserves the helmet mount');
  }
  for (const [m, color] of rifleColors) assert.equal(m.color.getHex(), color, 'armor cannot recolor the embedded rifle');
}
applySkinToCharacter(a, { id: 'default' });
assert.deepEqual(u.bodyMats.map((m) => [m.color.getHex(), m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity]), original);
applySkinToCharacter(a, { id: 'custom', primary: 0xabcdef, secondary: 0x123456 });
assert.equal(u.primaryMat.color.getHex(), 0xabcdef, 'character palettes also apply without an armor finish');

// Absolute death progress must produce the same pose regardless of rate or the
// action playing before death, and the first respawn frame must be clean.
let expectedDeath;
for (const hz of [30, 60, 144]) {
  const c = buildEvCharacter(), d = c.userData;
  d.setLocomotion(hz / 30, true, hz > 30); d.setAim(0.6, 0.4);
  for (let frame = 0; frame < hz; frame++) d.mixer.update(1 / hz);
  for (let frame = 1; frame <= hz; frame++) { d.setDeathState(frame / hz, -1); d.mixer.update(1 / hz); }
  const pose = Object.values(d.bones).flatMap((bone) => [...bone.position, ...bone.quaternion]);
  assert(pose.every(Number.isFinite));
  if (expectedDeath) assert(pose.every((v, i) => Math.abs(v - expectedDeath[i]) < 1e-6), `${hz}Hz: absolute death pose`);
  expectedDeath = pose;
  assert.equal(d.activeAnimation, 'Death');
  assert(!c.getObjectByName('Auto_Rifle_-_root').visible, 'death hides the held weapon');
  assert(d.bones.Bip001_R_Thigh.quaternion.angleTo(fresh.userData.bones.Bip001_R_Thigh.quaternion) > 0.1, 'death bends the legs');
  d.setDeathState(0);
  assert(c.getObjectByName('Auto_Rifle_-_root').visible);
  for (const [name, bone] of Object.entries(d.bones)) {
    assert(bone.quaternion.toArray().every((v, i) => Math.abs(v - fresh.userData.bones[name].quaternion.toArray()[i]) < 1e-6), `${name}: respawn rotation`);
    assert(bone.position.distanceTo(fresh.userData.bones[name].position) < 1e-6, `${name}: respawn position`);
  }
}

// Exercise material-role data after the real GLB loader and instance cloning.
const built = buildEvAutoRifle((await parse('ev-auto-rifle.glb')).scene, WEAPONS.find((w) => w.id === 'm4'));
// This probe exercises palette application; authored mesh replacement is
// covered by collection_models_check. Current catalog entries all have models.
const finish = { ...WEAPON_SKINS.find((s) => !s.decal), model: null };
applyWeaponSkin(built.group, finish);
const roles = new Set();
built.group.traverse((o) => {
  if (!o.isMesh) return;
  const role = o.material.userData.role; roles.add(role);
  if (['body', 'accent', 'metal'].includes(role)) assert.equal(o.material.color.getHex(), finish[role]);
});
assert.deepEqual([...roles].sort(), ['accent', 'body', 'energy', 'metal']);

function ownedWeapon(id, shared = false) {
  const group = new THREE.Group(); group.userData.weaponId = id;
  const geometry = new THREE.BoxGeometry(0.05, 0.05, 0.3); geometry.userData.shared = shared;
  const material = new THREE.MeshStandardMaterial();
  group.add(new THREE.Mesh(geometry, material));
  const counts = { geometry: 0, material: 0 };
  geometry.addEventListener('dispose', () => counts.geometry++);
  material.addEventListener('dispose', () => counts.material++);
  return { group, counts };
}
const discarded = ownedWeapon('m4'); u.attachWeapon(discarded.group);
assert.deepEqual(discarded.counts, { geometry: 1, material: 1 });
const external = ownedWeapon('sidearm', true); u.attachWeapon(external.group);
const replacement = ownedWeapon('shotgun'); u.attachWeapon(replacement.group);
assert.deepEqual(external.counts, { geometry: 0, material: 1 });
assert.equal(external.group.parent, null);
u.attachWeapon(null);
assert.deepEqual(replacement.counts, { geometry: 1, material: 1 });
const sharedMaterial = new THREE.MeshStandardMaterial(); sharedMaterial.userData.shared = true;
let sharedMaterialDisposals = 0; sharedMaterial.addEventListener('dispose', () => sharedMaterialDisposals++);
const multi = ownedWeapon('test');
multi.group.children[0].material = [multi.group.children[0].material, sharedMaterial, multi.group.children[0].material];
disposeModel(multi.group);
assert.deepEqual(multi.counts, { geometry: 1, material: 1 });
assert.equal(sharedMaterialDisposals, 0);
console.log('EV review regressions passed: all armor finishes, stable helmet mounts, death/respawn at 30/60/144Hz, rifle skins and resource ownership');
