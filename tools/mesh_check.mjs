#!/usr/bin/env node
// Current Reforged geometry, rig ownership and shared-buffer lifetime checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { buildPreviewCharacter } from '../src/player/PreviewCharacter.js';
import { getSkin, BOT_SKIN } from '../src/player/skins.js';
import { REMADE_CHARACTERS } from '../server/remadecollection.mjs';
import { disposeModel, isSharedGeometry } from '../src/core/ModelResources.js';
import { Avatar } from '../src/player/Avatar.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'GeometryProbeTextures', loadTexture: async () => new THREE.Texture() }));
async function asset(path) {
  const bytes = fs.readFileSync(new URL('../public' + path, import.meta.url));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
for (const armor of ['assault', 'recon', 'heavy', 'stealth', 'vanguard', 'striker', 'phantom']) {
  const waiting = buildPreviewCharacter(getSkin('default'), armor);
  assert(waiting.userData.loadingCharacter, `${armor}: must wait for the current model`);
  let meshes = 0;
  waiting.traverse(o => { if (o.isMesh) meshes++; });
  assert.equal(meshes, 0, `${armor}: retired armor was exposed while loading`);
}
installEvCharacter(await asset('/ev-default.glb'));
const skins = [getSkin('default'), BOT_SKIN,
  REMADE_CHARACTERS.find(s => s.rarity === 'legendary' && s.id !== BOT_SKIN.id)];
const states = [
  { speed: 0, grounded: true }, { speed: 2, grounded: true },
  { speed: 6.2, sprint: true, grounded: true },
  { speed: 3, dirF: 0, dirR: 1, grounded: true },
  { speed: 1, crouch: 1, grounded: true },
  { speed: 4, grounded: false, vy: 5 },
];
let vertices = 0, weightedMeshes = 0, sampledPoses = 0;
for (const skin of skins) {
  assert(skin?.model, 'representative current skin is missing');
  installAuthoredSkin(skin.id, await asset(skin.model));
  const first = buildEvCharacter(skin), second = buildEvCharacter(skin);
  assert(await first.userData.skinReady && await second.userData.skinReady);
  const armor = first.getObjectByName('Blender authored armor');
  const otherArmor = second.getObjectByName('Blender authored armor');
  assert(armor?.children.length >= 2, `${skin.name}: missing an authored surface`);
  for (let index = 0; index < armor.children.length; index++) {
    const mesh = armor.children[index], other = otherArmor.children[index];
    assert(mesh.isSkinnedMesh && other.isSkinnedMesh);
    assert.equal(mesh.geometry, other.geometry, 'instances must reuse vertex buffers');
    assert(isSharedGeometry(mesh.geometry), 'cached geometry needs the shared tag');
    assert.notEqual(mesh.skeleton, other.skeleton, 'instances cannot share pose state');
    mesh.skeleton.bones.forEach((bone, b) => {
      assert.equal(first.userData.bones[bone.name], bone, 'surface bound to foreign bones');
      assert.notEqual(bone, other.skeleton.bones[b], 'instances share an animated bone');
    });
    [].concat(mesh.material).forEach((material, m) =>
      assert.notEqual(material, [].concat(other.material)[m], 'finishes leak between players'));
    const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
    assert(position && normal && skinIndex && skinWeight, 'incomplete skinned surface');
    for (const attribute of [normal, skinIndex, skinWeight]) assert.equal(position.count, attribute.count);
    for (const attribute of [position, normal, skinIndex, skinWeight])
      assert(attribute.array.every(Number.isFinite), `${skin.id}: non-finite vertex attribute`);
    for (let vertex = 0; vertex < position.count; vertex++) {
      let sum = 0;
      for (let influence = 0; influence < 4; influence++) {
        const weight = skinWeight.getComponent(vertex, influence);
        const bone = skinIndex.getComponent(vertex, influence);
        assert(weight >= 0 && weight <= 1, 'invalid skin weight');
        assert(Number.isInteger(bone) && bone >= 0 && bone < mesh.skeleton.bones.length,
          'vertex points outside its skeleton');
        sum += weight;
      }
      assert(Math.abs(sum - 1) < 0.002, `${skin.id}: unnormalized vertex ${vertex}`);
    }
    vertices += position.count; weightedMeshes++;
  }
  const otherPose = Object.values(second.userData.bones).map(b => b.quaternion.toArray());
  for (const state of states) {
    first.userData.setLocomotion(state.speed, state.grounded, state.sprint, 0, state.dirF ?? 1, state.dirR ?? 0);
    first.userData.setActionState({ crouch: 0, vy: 0, ...state });
    for (let frame = 0; frame < 30; frame++) first.userData.mixer.update(1 / 60);
    first.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(armor, true).getSize(new THREE.Vector3());
    assert(size.toArray().every(Number.isFinite), `${skin.id}: invalid deformed bounds`);
    assert(size.y > 0.6 && size.x < 3 && size.y < 3 && size.z < 3,
      `${skin.id}: collapsed or exploded skin ${size.toArray()}`);
    sampledPoses++;
  }
  assert.deepEqual(Object.values(second.userData.bones).map(b => b.quaternion.toArray()), otherPose,
    'animating one character changes another character');
  let geometryDisposals = 0, materialDisposals = 0;
  const uniqueGeometry = new Set();
  first.traverse(o => {
    if (!o.isMesh) return;
    if (isSharedGeometry(o.geometry)) uniqueGeometry.add(o.geometry);
    [].concat(o.material).forEach(m => m.addEventListener('dispose', () => materialDisposals++));
  });
  const onGeometryDispose = () => geometryDisposals++;
  uniqueGeometry.forEach(g => g.addEventListener('dispose', onGeometryDispose));
  // Exercise the real avatar teardown rather than a parallel implementation.
  Avatar.prototype.dispose.call({ group: first, landingEffect: { dispose() {} }, scene: new THREE.Scene() });
  assert.equal(geometryDisposals, 0, 'avatar teardown disposes a still-shared buffer');
  assert(materialDisposals > 0, 'avatar teardown leaks instance materials');
  second.userData.mixer.update(1 / 60); second.updateMatrixWorld(true);
  assert(new THREE.Box3().setFromObject(otherArmor, true).getSize(new THREE.Vector3()).y > 0.6,
    'disposing another avatar broke a surviving character');
  disposeModel(second);
  assert.equal(geometryDisposals, 0, 'model teardown disposes a cached buffer');
  uniqueGeometry.forEach(g => g.removeEventListener('dispose', onGeometryDispose));
}
console.log(`Reforged mesh checks passed: ${skins.length} skins, ${weightedMeshes} surfaces, ${vertices} vertices, ${sampledPoses} poses; isolated skeletons/materials and shared-buffer teardown.`);
