import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildEvAutoRifle } from '../src/weapons/EvAutoRifle.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const noop = () => {};
const context = new Proxy({}, { get(target, key) {
  if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (key === 'measureText') return () => ({ width: 10 });
  return target[key] ??= noop;
} });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const parse = async (relative) => {
  const bytes = fs.readFileSync(new URL(relative, import.meta.url));
  const buffer = relative.endsWith('.gltf') ? bytes.toString()
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(buffer, '');
};
const [original, fallback] = await Promise.all([
  parse('../public/ev-auto-rifle.glb'),
  parse('../public/vendor/quaternius/scifi-weapons/AR_1.gltf'),
]);
const m4 = WEAPONS.find((weapon) => weapon.id === 'm4');
const built = buildEvAutoRifle(original.scene, m4);
const clone = buildEvAutoRifle(original.scene, m4);
const bounds = new THREE.Box3().setFromObject(built.group);
const size = bounds.getSize(new THREE.Vector3());
assert(Math.abs(size.z - 0.89) < 0.00001, 'the rifle must retain its 0.89m physical length');
assert(size.x > 0.06 && size.x < 0.10 && size.y > 0.30 && size.y < 0.40, 'original silhouette dimensions');
assert(built.muzzle.position.z < -0.43, 'the original muzzle must face -Z');
assert(Math.abs(built.muzzle.position.z - bounds.min.z) < 0.01, 'muzzle remains on the barrel tip');
let triangles = 0;
built.group.traverse((object) => {
  if (!object.isMesh) return;
  triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
  assert(object.geometry.attributes.uv, 'preserve original UVs');
  const other = clone.group.getObjectByName(object.name);
  assert.equal(other.geometry, object.geometry, 'geometry is reusable');
  assert.equal(object.geometry.userData.shared, true, 'avatar teardown must retain reusable geometry');
  assert.notEqual(other.material, object.material, 'cosmetics cannot recolor another instance');
});
assert(triangles > 3688, 'reference armour plates supplement the original rifle');
assert(built.group.getObjectByName('reference_receiver_port'), 'custom receiver plate missing');
const pose = weaponHandPose(built.group);
const { humanHandContacts } = await import('../src/player/HumanRifleCarry.js');
const humanContacts = humanHandContacts(built.group);
for (const [side, markerName] of [['trigger', 'BIND_RIGHTHAND'], ['support', 'BIND_LEFTHAND']]) {
  const marker = built.group.getObjectByName(markerName);
  assert(new THREE.Vector3(...pose[side]).distanceTo(marker.position) < 1e-6, `${side} uses the authored contact`);
  assert(bounds.clone().expandByScalar(0.025).containsPoint(marker.position), `${side} contact belongs to the rifle`);
  assert(humanContacts[side].distanceTo(marker.position) < 1e-6, `${side} legacy human carry uses the same contact`);
}
assert(pose.support[2] < pose.trigger[2] - 0.25, 'hands stay on distinct grip and fore-end contacts');
assert(!buildEvAutoRifle(new THREE.Group(), m4), 'missing override permits fallback');

// Exercise real model creation through both completion orders and missing files.
// The loader is stubbed only at the transport boundary; scenes came from GLTFLoader.
const oldLoad = GLTFLoader.prototype.load;
const oldWarn = console.warn;
const loadCases = ['fallback-first', 'original-first', 'missing-original', 'missing-fallback', 'both-missing'];
for (const [index, scenario] of loadCases.entries()) {
  const requests = new Map();
  GLTFLoader.prototype.load = function (url, ok, progress, fail) { requests.set(url, { ok, fail }); };
  const api = await import(`../src/weapons/WeaponModels.js?ev-rifle-check=${index}`);
  let ready = 0, allReady = 0;
  api.onWeaponModelReady('m4', () => ready++);
  api.onWeaponModelsReady(() => allReady++);
  api.preloadWeaponModels();
  assert.equal(ready, 0);
  assert.equal(api.hasLoadedWeaponModel('m4'), false);
  assert.equal(api.buildWeaponModel(m4).group.userData.weaponId, 'm4', 'procedural startup is available');
  for (const [url, request] of requests) {
    if (url !== '/ev-auto-rifle.glb' && !url.endsWith('/AR_1.gltf')) request.ok({ scene: new THREE.Group() });
  }
  const finishOriginal = () => scenario === 'missing-original' || scenario === 'both-missing'
    ? requests.get('/ev-auto-rifle.glb').fail(new Error('expected missing fixture'))
    : requests.get('/ev-auto-rifle.glb').ok(original);
  const finishFallback = () => scenario === 'missing-fallback' || scenario === 'both-missing'
    ? requests.get('/vendor/quaternius/scifi-weapons/AR_1.gltf').fail(new Error('expected missing fixture'))
    : requests.get('/vendor/quaternius/scifi-weapons/AR_1.gltf').ok(fallback);
  console.warn = noop;
  if (scenario === 'original-first') finishOriginal(); else finishFallback();
  assert.equal(ready, 0, 'a thumbnail cannot finalize before its preferred model settles');
  assert.equal(allReady, 0);
  if (scenario === 'original-first') finishFallback(); else finishOriginal();
  console.warn = oldWarn;
  assert.equal(ready, 1, 'each model readiness callback fires exactly once');
  assert.equal(allReady, 1, 'global readiness includes the original rifle');
  api.onWeaponModelReady('m4', () => ready++);
  assert.equal(ready, 2, 'late callbacks receive readiness immediately');
  const result = api.buildWeaponModel(m4).group;
  const expected = 'reference';
  assert.equal(result.userData.modelSource, expected, `${scenario}: source priority`);
}
GLTFLoader.prototype.load = oldLoad;
console.warn = oldWarn;

// Install the actual original model in the production first-person system and
// measure its geometry/contacts throughout framing, recoil, sprint and reload.
const { WeaponSystem, prepareFirstPersonModel, measureWeaponSight, adsMountForSight } =
  await import('../src/weapons/WeaponSystem.js');
GLTFLoader.prototype.load = noop; // no network is needed by this geometry probe
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.02, 300);
scene.add(camera);
const system = new WeaponSystem(camera, scene, new Proxy({}, { get: () => noop }));
const arms = await parse('../public/ev-view-arms.glb');
const { buildViewmodelArm } = await import('../src/player/ViewmodelArms.js');
system._installAuthoredViewmodelArms((side) => buildViewmodelArm(side, arms.scene));
const previous = system.models.get('m4');
system.kickGroup.remove(previous.group);
prepareFirstPersonModel(built.group);
system.kickGroup.add(built.group);
const sight = measureWeaponSight(built.group);
system.models.set('m4', { ...built, sight, adsMount: adsMountForSight(sight) });
system.setLoadout('m4', 'sword');
const input = { mouseDown: false, rightMouseDown: false, mouseDX: 0, mouseDY: 0, wheelDelta: 0, consumeJustPressed: () => false };
const player = { isSprinting: false, onGround: true, baseFov: 78, velocity: { x: 0, z: 0 }, _camDist: 0 };
const step = () => system.update(1 / 60, input, {}, { getRaycastTargets: () => [] }, player);
let nearest = Infinity;
let leastVisible = 1;
for (const aspect of [9 / 16, 4 / 3, 16 / 9, 21 / 9]) for (const fov of [60, 78, 110]) {
  camera.aspect = aspect; camera.fov = fov; player.baseFov = fov;
  for (let frame = 0; frame < 60; frame++) step();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  built.group.updateWorldMatrix(true, true);
  // Count actual projected vertices. Projecting a world AABB combines the
  // near stock depth with the distant muzzle height and invents giant corners
  // that the original sloped stock does not contain.
  let visibleVertices = 0, totalVertices = 0;
  const point = new THREE.Vector3();
  built.group.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    const positions = object.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld).project(camera);
      if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1) visibleVertices++;
      totalVertices++;
    }
  });
  const visibility = visibleVertices / totalVertices;
  leastVisible = Math.min(leastVisible, visibility);
  assert(visibility >= 0.20, `${aspect}/${fov}: rifle has no readable on-screen silhouette (${visibility})`);
  for (const action of ['idle', 'recoil', 'sprint', 'reload']) {
    player.isSprinting = action === 'sprint';
    if (action === 'recoil') system._applyViewmodelRecoil(m4.recoil);
    if (action === 'reload') {
      system.state.get('m4').magAmmo = m4.magSize - 3;
      system.startReload();
      assert(system.state.get('m4').reloadTimer > 0, 'the geometry probe exercises an actual reload');
    }
    for (let frame = 0; frame < 100; frame++) {
      step(); camera.updateMatrixWorld(true);
      built.group.updateWorldMatrix(true, true);
      const depth = -new THREE.Box3().setFromObject(built.group).max.z;
      nearest = Math.min(nearest, depth);
      assert(depth >= camera.near + 0.01, `${aspect}/${fov}/${action}: rifle intersects the eye plane (${depth})`);
    }
    player.isSprinting = false;
  }
}
camera.aspect = 16 / 9; camera.fov = 78; player.baseFov = 78;
for (let frame = 0; frame < 90; frame++) step();
system.kickGroup.updateWorldMatrix(true, true);
for (const [side, arm] of [['trigger', system.armGroup], ['support', system.supportArmGroup]]) {
  const palm = arm.getObjectByName('viewmodel_palm');
  palm.geometry.computeBoundingBox();
  const center = palm.geometry.boundingBox.getCenter(new THREE.Vector3());
  palm.localToWorld(center); system.kickGroup.worldToLocal(center);
  const contact = new THREE.Vector3(...pose[side]);
  if (side === 'trigger') contact.y += 0.030;
  assert(center.distanceTo(contact) < 0.015, `${side} first-person glove stays on its original grip`);
}
GLTFLoader.prototype.load = oldLoad;
console.log(`EV Auto Rifle passed: ${triangles} triangles, ${size.z.toFixed(2)}m; authored grips, five loading cases, 12 viewports; nearest action depth ${nearest.toFixed(3)}m, visibility ${(leastVisible * 100).toFixed(1)}%`);
