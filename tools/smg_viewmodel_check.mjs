// Measure the shipped SMG and arms through the live first-person pose path.
// Geometry-only: no browser, renderer, network, or gameplay service is needed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';
import { buildViewmodelArm } from '../src/player/ViewmodelArms.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';
import { ADS_SIGHT_SCREEN_Y, PRESENTATION_AIM_DEPTH } from '../src/weapons/ViewmodelAim.js';

const noop = () => {};
const context = new Proxy({}, { get: (_, key) => key.startsWith('create')
  ? () => ({ addColorStop: noop }) : key === 'measureText' ? () => ({ width: 10 }) : noop });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
globalThis.ProgressEvent ??= class { constructor(type, value) { Object.assign(this, value); } };
const { WeaponSystem, prepareFirstPersonModel, measureWeaponSight, adsMountForSight } =
  await import('../src/weapons/WeaponSystem.js');
const reportOnly = process.argv.includes('--report');
const check = (value, message) => { if (!reportOnly) assert(value, message); };

async function load(name) {
  const bytes = fs.readFileSync(new URL('../public/' + name, import.meta.url));
  return new GLTFLoader().register(() => ({ name: 'GeometryOnly',
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  })).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 16 / 9, .02, 300);
scene.add(camera);
const system = new WeaponSystem(camera, scene, new Proxy({}, { get: () => noop }));
const arms = await load('ev-view-arms.glb');
system._installAuthoredViewmodelArms(side => buildViewmodelArm(side, arms.scene));
const sizes = {};
for (const id of ['m4', 'uzi']) {
  const template = (await load(`models/ev-default/${id}.glb`)).scene;
  const source = template.getObjectByName(`weapon_${id}`);
  const untouched = JSON.stringify(source.userData);
  const before = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
  const record = buildBlenderWeapon(template, getWeapon(id));
  system.kickGroup.remove(system.models.get(id).group);
  prepareFirstPersonModel(record.group);
  const once = new THREE.Box3().setFromObject(record.group).getSize(new THREE.Vector3());
  prepareFirstPersonModel(record.group);
  const twice = new THREE.Box3().setFromObject(record.group).getSize(new THREE.Vector3());
  check(once.distanceTo(twice) < 1e-8, `${id}: preparing a viewmodel twice changes its size`);
  check(new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()).distanceTo(before) < 1e-8
    && JSON.stringify(source.userData) === untouched, `${id}: first-person fit mutated world/pickup template`);
  sizes[id] = once;
  system.kickGroup.add(record.group);
  record.sight = measureWeaponSight(record.group);
  record.adsMount = adsMountForSight(record.sight);
  system.models.set(id, record);
}
check(sizes.uzi.x / sizes.m4.x > .8 && sizes.uzi.x / sizes.m4.x < 1.4,
  'SMG receiver has a different human scale from the rifle (hand cannot fit both)');

const input = { mouseDown: false, rightMouseDown: false, mouseDX: 0, mouseDY: 0,
  wheelDelta: 0, consumeJustPressed: () => false };
const player = { isSprinting: false, onGround: true, baseFov: 78,
  velocity: { x: 0, y: 0, z: 0 }, _camDist: 0, reduceMotion: true };
const botManager = { getRaycastTargets: () => [] };
const report = [];
const point = new THREE.Vector3();
function projectedWidth(group) {
  let min = Infinity, max = -Infinity;
  group.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible || mesh.name === 'outline') return;
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(camera);
      if (point.z < -1 || point.z > 1 || point.y < -1 || point.y > 1) continue;
      min = Math.min(min, point.x); max = Math.max(max, point.x);
    }
  });
  return Math.max(0, Math.min(1, max) - Math.max(-1, min));
}

for (const fov of [60, 78, 110]) for (const id of ['m4', 'uzi']) {
  system.setLoadout('m4', 'sword');
  if (id === 'uzi') system.addMapGun(id);
  player.baseFov = fov;
  for (const mode of ['hip', 'ads', 'run', 'return']) {
    input.rightMouseDown = mode === 'ads';
    player.isSprinting = mode === 'run';
    player.velocity.z = mode === 'run' ? -9.9 : 0;
    for (let frame = 0; frame < 180; frame++) system.update(1 / 60, input, {}, botManager, player);
    scene.updateMatrixWorld(true);
    const record = system.models.get(id), arm = system.supportArmGroup;
    const glove = arm.getObjectByName('viewmodel_palm');
    const palm = glove.localToWorld(glove.applyBoneTransform(0,
      new THREE.Vector3().fromArray(glove.userData.palmContact)));
    const localPalm = record.group.worldToLocal(palm.clone());
    const up = new THREE.Vector3(0, 1, 0).transformDirection(record.group.matrixWorld);
    const surfaces = [];
    record.group.traverse(mesh => { if (mesh.isMesh && mesh.visible && mesh.name !== 'outline') surfaces.push(mesh); });
    const hit = new THREE.Raycaster(palm.clone().addScaledVector(up, -1), up, 0, 2)
      .intersectObjects(surfaces, false)[0];
    const gap = hit ? record.group.worldToLocal(hit.point.clone()).y - localPalm.y : Infinity;
    const label = `${id}/${fov}/${mode}`;
    check(hit && gap >= -.003 && gap < .008, `${label}: support palm is buried or off the underside (${gap}m)`);
    let gloveMin = Infinity, gloveMax = -Infinity;
    const vertices = glove.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i);
      glove.applyBoneTransform(i, point); glove.localToWorld(point); record.group.worldToLocal(point);
      gloveMin = Math.min(gloveMin, point.x); gloveMax = Math.max(gloveMax, point.x);
    }
    const handToGun = (gloveMax - gloveMin) / sizes[id].x;
    check(handToGun < 1.35, `${label}: glove is oversized for the receiver (${handToGun.toFixed(2)}x)`);
    const sight = record.sight.clone().applyMatrix4(record.group.matrixWorld).project(camera);
    if (mode === 'ads') {
      check(Math.abs(sight.x) < .001, `${label}: sight is off the crosshair centre (${sight.x})`);
      check(Math.abs(sight.y - ADS_SIGHT_SCREEN_Y) < .001, `${label}: lowered sight framing drifted`);
      const muzzle = record.muzzle.getWorldPosition(new THREE.Vector3());
      const bore = new THREE.Vector3(0, 0, -1).transformDirection(record.group.matrixWorld);
      const target = camera.getWorldPosition(new THREE.Vector3())
        .addScaledVector(camera.getWorldDirection(new THREE.Vector3()), PRESENTATION_AIM_DEPTH);
      check(bore.angleTo(target.sub(muzzle).normalize()) < .0001, `${label}: bore misses the crosshair`);
    }
    report.push({ id, fov, mode, gap, handToGun, width: projectedWidth(record.group), sightX: sight.x });
  }
}
for (const fov of [60, 78, 110]) {
  const sample = (id, mode) => report.find(r => r.id === id && r.fov === fov && r.mode === mode);
  const relativeAdsWidth = sample('uzi', 'ads').width / sample('m4', 'ads').width;
  check(relativeAdsWidth > .65 && relativeAdsWidth < 1.5,
    `SMG ADS is not comparable to the rifle at ${fov} FOV (${relativeAdsWidth.toFixed(2)}x width)`);
  check(Math.abs(sample('uzi', 'hip').width - sample('uzi', 'return').width) < .003,
    `SMG does not return to the same hold after sprint at ${fov} FOV`);
}
if (reportOnly) console.log(JSON.stringify({ sizes, samples: report }, null, 2));
else console.log('SMG viewmodel passed: real gun/hand proportions, grip contact, centered ADS, barrel convergence, sprint return, and isolated world assets at 60/78/110 FOV.');
