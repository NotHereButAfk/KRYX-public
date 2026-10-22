import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import fs from 'node:fs';
import { REMADE_CHARACTERS, REMADE_GUNS, REMADE_SWORDS } from '../server/remadecollection.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { installAuthoredWeaponSkin, applyAuthoredWeaponSkin, clearAuthoredWeaponSkin } from '../src/weapons/AuthoredWeaponSkins.js';
import { buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { disposeModel } from '../src/core/ModelResources.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('art/collection-remakes/catalog.json', root)));
const materialMaps = JSON.parse(fs.readFileSync(new URL('art/collection-remakes/material-maps.json', root)));
const fit = JSON.parse(fs.readFileSync(new URL('art/collection-remakes/weapon-fit.json', root)));
const weaponIds = { 'Auto Rifle': 'm4', 'Hand Cannon': 'magnum', 'Burst Rifle': 'battlerifle', 'Sweeper': 'energyshotgun', 'Laser Rifle': 'plasmarifle', Sword: 'sword' };
const pilot = process.argv.includes('--pilot');
const available = process.argv.includes('--available');
const items = pilot ? manifest.items.filter(x => ['110', '170'].includes(x.sourceId)) : available ? manifest.items.filter(x => fs.existsSync(new URL(`artifacts/collection-remodeled/${x.kryxId}/preview.png`,root))) : manifest.items;
assert.equal(manifest.items.length, 357);
const runtime = [...REMADE_CHARACTERS, ...REMADE_GUNS, ...REMADE_SWORDS];
assert.equal(runtime.length, 357);
for (const item of manifest.items) { const skin = runtime.find(s => s.id === item.kryxId); assert(skin); assert.equal(skin.rarity, item.rarity); assert.equal(skin.model, item.model); }
assert(!manifest.items.some(x => x.rarity === 'relic' || ['371', '677'].includes(x.sourceId)));
assert.equal(new Set(manifest.items.map(x => x.sourceId)).size, 357);
async function load(path) {
  const b = fs.readFileSync(new URL(path, root));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Geometry/rig probe; actual image appearance is covered by Blender renders.
  loader.register(parser => ({ name: 'GeometryOnlyProbe', beforeRoot() { parser.loadTexture = async () => new THREE.Texture(); } }));
  return loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
}
installEvCharacter(await load('public/ev-default.glb'));
const bases = new Map(), results = [], failures = [];
for (const item of items) {
 try {
  const path = (pilot || available) ? `artifacts/collection-remodeled/${item.kryxId}/model.glb` : `public${item.model}`;
  const gltf = await load(path);
  const expectedMaps = materialMaps[item.kryxId];
  if (expectedMaps?.map) assert(gltf.parser.json.materials.some(m => m.pbrMetallicRoughness?.baseColorTexture), item.kryxId + ': missing surface texture');
  if (expectedMaps?.emissiveMap) assert(gltf.parser.json.materials.some(m => m.emissiveTexture), item.kryxId + ': missing glow mask (washed-out weapon)');
  let triangles = 0;
  gltf.scene.traverse(o => { if (o.isMesh) { triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; assert(o.geometry.attributes.position.array.every(Number.isFinite)); } });
  assert(triangles > 100 && triangles < 200000, `${item.kryxId}: triangle budget ${triangles}`);
  if (item.category === 'character') {
    const skin = { id: item.kryxId, model: '/unused-test-cache.glb', rarity: item.rarity, primary: 0x405060, secondary: 0x101820, emissive: 0x70ccff, energyColor: 0x70ccff, roughness: .54, metalness: .25 };
    installAuthoredSkin(skin.id, gltf);
    const player = buildEvCharacter(null, skin);
    assert(await player.userData.skinReady);
    for (const state of [{ speed: 0, grounded: true }, { speed: 7.425, grounded: true }, { speed: 11.1375, sprint: true, grounded: true }, { speed: 4, grounded: false, vy: 5 }, { speed: 0, grounded: true, crouch: 1 }]) {
      for (let i = 0; i < 30; i++) { player.userData.setLocomotion(state.speed, state.grounded, state.sprint); player.userData.setActionState(state); player.userData.mixer.update(1 / 30); }
      player.updateMatrixWorld(true);
      const armor = player.getObjectByName('Blender authored armor');
      const box = new THREE.Box3().setFromObject(armor, true), size = box.getSize(new THREE.Vector3());
      assert(size.x < 3 && size.y < 3 && size.z < 3 && size.y > .6, `${skin.id}: bad rig bounds ${size.toArray()}`);
      armor.traverse(o => { if (o.isSkinnedMesh) assert(o.skeleton.bones.every(b => Object.values(player.userData.bones).includes(b)), `${skin.id}: foreign skeleton`); });
    }
    disposeModel(player);
  } else {
    const wid = weaponIds[item.weapon];
    if (!bases.has(wid)) bases.set(wid, await load(`public/models/arsenal-v1/${wid}.glb`));
    gltf.scene.updateMatrixWorld(true);
    const source = gltf.scene.getObjectByName(`weapon_${wid}`);
    assert(source, item.kryxId + ': weapon root missing');
    for (const [name, key] of [['BIND_BULLET', 'muzzle'], ['BIND_RIGHTHAND', 'trigger'], ['BIND_LEFTHAND', 'support']]) {
      const point = source.getObjectByName(name).getWorldPosition(new THREE.Vector3());
      assert(point.distanceTo(new THREE.Vector3(...fit[wid][key])) < .0001, item.kryxId + ': changed ' + key);
    }
    const built = buildBlenderWeapon(bases.get(wid).scene, WEAPONS.find(w => w.id === wid));
    const native = []; built.group.traverse(o => { if (o.isMesh) native.push(o); });
    const before = JSON.stringify(built.group.userData.authoredHandPose);
    const skin = { id: item.kryxId, weaponId: wid, model: '/unused-test-cache.glb', rarity: item.rarity };
    installAuthoredWeaponSkin(skin.id, gltf);
    assert(await applyAuthoredWeaponSkin(built.group, skin));
    assert(native.every(o => !o.visible));
    assert.equal(before, JSON.stringify(built.group.userData.authoredHandPose));
    const box = new THREE.Box3(); built.group.updateMatrixWorld(true);
    built.group.traverse(o => { if (o.isMesh && o.visible && !native.includes(o)) box.expandByObject(o); });
    const size = box.getSize(new THREE.Vector3());
    assert(size.x < 1.5 && size.y < 1.8 && size.z < 2.5, `${skin.id}: oversized weapon ${size.toArray()}`);
    clearAuthoredWeaponSkin(built.group); assert(native.every(o => o.visible));
    const stale = applyAuthoredWeaponSkin(built.group, skin); clearAuthoredWeaponSkin(built.group); assert.equal(await stale, false);
    const late = applyAuthoredWeaponSkin(built.group, skin); disposeModel(built.group); assert.equal(await late, false);
  }
  results.push({ id: item.kryxId, triangles });
  console.log('Collection model passed:', item.kryxId);
 } catch(error) { failures.push({id:item.kryxId,error:error.message}); console.error('FAILED',item.kryxId,error.message); }
}
fs.writeFileSync(new URL('artifacts/collection-model-check.json', root), JSON.stringify(results, null, 2));


fs.writeFileSync(new URL('artifacts/collection-model-failures.json',root),JSON.stringify(failures,null,2));
assert.equal(failures.length,0,JSON.stringify(failures));

console.log(`Collection checks passed: ${results.length} models; rig, grip, bounds, switching, disposal, and Relic exclusion.`);
