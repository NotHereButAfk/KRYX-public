import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ArmorPreviewRenderer } from '../src/ui/ArmorPreviewRenderer.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { getSkin, BOT_SKIN } from '../src/player/skins.js';
import { ARMOR_SKINS } from '../src/player/ArmorSkins.js';

globalThis.ProgressEvent ??= class { constructor(type, init) { Object.assign(this, { type }, init); } };
async function parse(path) {
  const bytes = fs.readFileSync(new URL('../public' + path, import.meta.url));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
const defaultSkin = getSkin('default');
for (const skin of [defaultSkin, BOT_SKIN]) installAuthoredSkin(skin.id, await parse(skin.model));
const template = await parse('/ev-default.glb');
let releaseRig, releaseFinish;
const delayedRig = new Promise(resolve => { releaseRig = resolve; });
const delayedFinish = new Promise(resolve => { releaseFinish = resolve; });
const customSkin = ARMOR_SKINS.find(s => ![defaultSkin.id, 'remake_84', BOT_SKIN.id].includes(s.id));
const originalLoad = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = function (url) {
  if (url.startsWith('/ev-default.glb')) return delayedRig;
  if (url === customSkin.model) return delayedFinish;
  throw new Error('Unexpected preview request: ' + url);
};

// Only renderer-independent lifecycle is exercised here; real Three scenes,
// cameras, model loading, binding and disposal still run.
function preview() {
  return Object.assign(Object.create(ArmorPreviewRenderer.prototype), {
    _scene: new THREE.Scene(), _camera: new THREE.PerspectiveCamera(),
    _renderer: { dispose() {} }, _revision: 0, _disposed: false,
    _pendingGroup: null, _group: null, _raf: null,
  });
}
try {
  const active = preview(), closed = preview();
  const stale = active.loadArmor(defaultSkin, 'vanguard');
  const newest = active.loadArmor(BOT_SKIN, 'vanguard');
  const cancelled = closed.loadArmor(defaultSkin, 'vanguard');
  assert.equal(active._group, null, 'startup must wait instead of framing an empty placeholder');
  closed.dispose();
  releaseRig(template);
  assert.equal(await stale, false, 'older selection must not mount after a newer request');
  assert.equal(await newest, true);
  assert.equal(await cancelled, false, 'closed preview must not populate after rig download');
  assert.equal(closed._group, null);
  assert.equal(closed._scene.children.length, 0);
  assert.equal(active._group.userData.authoredSkinId, BOT_SKIN.id);
  assert([...active._group.position, ...active._group.scale, ...active._camera.position].every(Number.isFinite),
    'loaded preview framing must stay finite');
  const pending = active.loadArmor(defaultSkin, 'vanguard', customSkin);
  await new Promise(resolve => setImmediate(resolve));
  const pendingGroup = active._pendingGroup;
  assert(pendingGroup, 'custom finish request did not wait for its download');
  let sharedDisposals = 0;
  pendingGroup.traverse(node => {
    if (node.geometry?.userData.shared) node.geometry.addEventListener('dispose', () => sharedDisposals++);
  });
  active.dispose();
  releaseFinish(await parse(customSkin.model));
  assert.equal(await pending, false);
  assert.equal(active._pendingGroup, null);
  assert.equal(active._scene.children.length, 0);
  assert.equal(pendingGroup.getObjectByName('Blender authored armor'), undefined,
    'late finish must not repopulate disposed geometry');
  assert.equal(sharedDisposals, 0, 'preview disposal freed shared gameplay geometry');
  console.log('Armor preview lifecycle passed: early load, rapid selection, close during rig/finish downloads, finite framing and shared buffers.');
} finally {
  GLTFLoader.prototype.loadAsync = originalLoad;
}
