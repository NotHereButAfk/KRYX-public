import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { getSkin, BOT_SKIN } from '../src/player/skins.js';

const read = path => {
  const bytes = fs.readFileSync(path), length = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + length)), bin: bytes.subarray(28 + length), bytes };
};
const original = read('art/player-skins/rig-source.glb'), current = read('public/ev-default.glb');
const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const components = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
function accessorData(asset, index) {
  const a = asset.json.accessors[index], v = asset.json.bufferViews[a.bufferView];
  assert(!a.sparse, 'rig samples must remain dense');
  const length = size[a.type] * components[a.componentType], stride = v.byteStride || length;
  const offset = (v.byteOffset || 0) + (a.byteOffset || 0);
  const data = Buffer.concat(Array.from({ length: a.count }, (_, n) => asset.bin.subarray(offset + n * stride, offset + n * stride + length)));
  const { bufferView, byteOffset, ...format } = a;
  return { format, data };
}
assert.equal(current.json.animations.length, 13);
for (let i = 0; i < original.json.animations.length; i++) {
  const a = original.json.animations[i], b = current.json.animations[i];
  assert.equal(b.name, a.name);
  assert.deepEqual(b.channels, a.channels, 'animation targets must remain identical');
  assert.equal(b.samplers.length, a.samplers.length);
  for (let n = 0; n < a.samplers.length; n++) {
    assert.equal(b.samplers[n].interpolation, a.samplers[n].interpolation);
    for (const key of ['input', 'output']) assert.deepEqual(
      accessorData(current, b.samplers[n][key]), accessorData(original, a.samplers[n][key]),
      `${a.name}: original ${key} sample bytes must remain identical`);
  }
}
for (const i of original.json.skins[0].joints) assert.deepEqual(current.json.nodes[i], original.json.nodes[i], 'published joints must not move');
for (const [i, node] of original.json.nodes.entries()) if (node.name?.startsWith('BIND_')) assert.deepEqual(current.json.nodes[i], node);
assert.equal(current.json.meshes.length, 3, 'only the rifle and both current body meshes remain');
assert(!current.json.meshes.some(mesh => /source topology/.test(mesh.name)), 'retired armor geometry must be removed');
assert.equal(current.json.scenes[0].extras.embeddedSkinId, 'remake_84');
assert(current.json.scenes[0].extras.rigBounds.height > 2, 'retain rig normalization independent of armor silhouette');

// Compare the embedded fallback to the same collection asset used by inventory.
// CPU vertex deformation tests catches missing surfaces and incorrect bind matrices.
// No browser, network, or image decoding is required by these material-only skins.
globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = async bytes => loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
installEvCharacter(await load(current.bytes));
for (const skin of [getSkin('default'), BOT_SKIN]) installAuthoredSkin(skin.id, await load(fs.readFileSync('public' + skin.model)));
const embedded = buildEvCharacter();
const reference = buildEvCharacter(getSkin('default'));
assert.equal(await reference.userData.skinReady, true);
const nativeMeshes = [];
embedded.traverse(mesh => { if (mesh.isSkinnedMesh) nativeMeshes.push(mesh); });
const authored = reference.getObjectByName('Blender authored armor').children;
assert.equal(nativeMeshes.length, 6, 'both current meshes must include all six material surfaces');
assert.equal(nativeMeshes.length, authored.length);
let maxVertexError = 0;
for (const [motion, speed, sprint] of [['idle', 0, false], ['walk', 2, false], ['run', 6.2, true]]) {
  for (const body of [embedded, reference]) {
    body.userData.setLocomotion(speed, true, sprint);
    for (let frame = 0; frame < 30; frame++) body.userData.mixer.update(1 / 60);
    body.updateMatrixWorld(true);
  }
  nativeMeshes.forEach((mesh, i) => {
    const other = authored[i];
    mesh.skeleton.update(); other.skeleton.update();
    assert.equal(mesh.geometry.attributes.position.count, other.geometry.attributes.position.count);
    assert.deepEqual(mesh.material.color.toArray(), other.material.color.toArray());
    const count = mesh.geometry.attributes.position.count;
    for (let vertex = 0; vertex < count; vertex += Math.max(1, Math.floor(count / 40))) {
      const actual = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      const expected = other.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(other.matrixWorld);
      maxVertexError = Math.max(maxVertexError, actual.distanceTo(expected));
    }
  });
  assert(maxVertexError < .00001, `${motion}: embedded Reforged silhouette differs from collection (${maxVertexError})`);
}
embedded.userData.applyFinish(BOT_SKIN);
assert.equal(await embedded.userData.skinReady, true);
assert.equal(embedded.userData.authoredSkinId, BOT_SKIN.id);
assert(nativeMeshes.every(mesh => !mesh.visible), 'custom authored surfaces hide the default');
embedded.userData.applyFinish(null, null);
await embedded.userData.skinReady;
assert(nativeMeshes.every(mesh => mesh.visible), 'unequip restores current Default Reforged');
assert(!embedded.getObjectByName('Blender authored armor'), 'unequip removes previous armor');
const originalWarn = console.warn;
try {
  console.warn = () => {};
  embedded.userData.applyFinish({ id: 'failed-load-test', model: 'invalid-skin-protocol:missing' });
  assert.equal(await embedded.userData.skinReady, false);
} finally { console.warn = originalWarn; }
assert(nativeMeshes.every(mesh => mesh.visible), 'failed load keeps the current default visible');
embedded.userData.applyFinish(BOT_SKIN);
const pending = embedded.userData.skinReady;
embedded.userData.applyFinish(null, null);
await pending;
assert(!embedded.getObjectByName('Blender authored armor'), 'late completion cannot resurrect an unequipped skin');
console.log(`Reforged default: all 13 original actions and joints preserved; six current surfaces match within ${maxVertexError}; default/bot/unequip/failure paths pass.`);
