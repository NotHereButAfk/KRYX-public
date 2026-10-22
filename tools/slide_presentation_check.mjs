import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { getSkin } from '../src/player/skins.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { AuthRoom } from '../server/authroom.mjs';
import { AuthClient } from '../src/net/AuthClient.js';
import { AUTHORITY_TEST_ARENA } from './fixtures/authorityArena.mjs';

globalThis.ProgressEvent ??= class {};
async function load(path) {
  const bytes = fs.readFileSync(new URL('../public' + path, import.meta.url));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
installEvCharacter(await load('/ev-default.glb'));
const skin = getSkin('default');
installAuthoredSkin(skin.id, await load(skin.model));
const gun = await load(BLENDER_ARSENAL.m4);
const positions = [], local = (body, bone) => body.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
for (const fps of [30, 60, 144]) {
  const body = buildEvCharacter(skin), u = body.userData;
  assert(await u.skinReady, 'test must exercise the actual Default Reforged surfaces');
  const weapon = buildBlenderWeapon(gun.scene, WEAPONS.find(w => w.id === 'm4')).group;
  u.attachWeapon(weapon);
  u.setLocomotion(11.2, true, true);
  for (let f = 0; f < fps; f++) u.mixer.update(1 / fps);
  const startHip = local(body, u.bones.Bip001_Pelvis).y;
  u.setActionState({slide: 1});
  u.setLocomotion(12, true, false);
  let previous = local(body, u.bones.Bip001_Pelvis), maxStep = 0;
  for (let f = 0; f < fps; f++) {
    u.mixer.update(1 / fps);
    const hip = local(body, u.bones.Bip001_Pelvis);
    maxStep = Math.max(maxStep, hip.distanceTo(previous)); previous = hip;
    for (const b of Object.values(u.bones)) assert(b.matrixWorld.elements.every(Number.isFinite));
    if (f % 3 === 0) {
      const box = new THREE.Box3().setFromObject(body.getObjectByName('Blender authored armor'), true);
      assert(box.min.y > -.035, `slide armor sinks through the floor (${fps}Hz frame ${f}: ${box.min.y})`);
    }
    weapon.updateWorldMatrix(true, true);
    const trigger = new THREE.Vector3(...weaponHandPose(weapon).trigger).applyMatrix4(weapon.matrixWorld);
    assert(trigger.distanceTo(u.bones.Bip001_R_Hand.getWorldPosition(new THREE.Vector3())) < .025,
      'slide separated the trigger hand from the weapon');
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(weapon.getWorldQuaternion(new THREE.Quaternion()));
    assert(forward.z < -.995, 'slide tipped the rifle away from aim');
  }
  assert(maxStep < .30, `slide entry snaps the hips (${fps}Hz: ${maxStep}m)`);
  assert(startHip - previous.y > .4, 'slide must visibly lower the whole body');
  assert.equal(u.activeAnimation, 'Slide');
  const feet = ['R', 'L'].map(s => local(body, u.bones[`Bip001_${s}_Foot`]));
  assert(feet[0].z < -.65 && feet[1].z > 0, 'slide needs extended lead leg and tucked trail leg');
  for (let f = 0; f < fps / 2; f++) u.mixer.update(1 / fps);
  for (let i = 0; i < 2; i++) assert(feet[i].distanceTo(local(body, u.bones[`Bip001_${['R', 'L'][i]}_Foot`])) < .015,
    'sliding legs continue taking crouch-walking steps');
  positions.push(local(body, u.bones.Bip001_Pelvis));
  u.setActionState({slide: 0}); u.setLocomotion(0, true, false);
  for (let f = 0; f < fps; f++) {
    u.mixer.update(1 / fps);
    if (f % 3 === 0) {
      const box = new THREE.Box3().setFromObject(body.getObjectByName('Blender authored armor'), true);
      assert(box.min.y > -.035, 'slide exit pulls the boots below the floor');
    }
  }
  assert(u.slideBlend < .001, 'slide pose sticks after release');
  assert(local(body, u.bones.Bip001_Pelvis).y > .9, 'slide does not return to standing');
  u.triggerTeleport(); assert.equal(u.slideBlend, 0, 'respawn retained slide pose');
}
for (const p of positions) assert(p.distanceTo(positions[1]) < .01, 'slide pose varies across frame rates');

// Real server serialization followed by client reconciliation must retain the
// recovery timer; otherwise prediction can slide again while authority refuses.
const client = new AuthClient('ws://fixture.invalid');
const headroomRaycast = () => Infinity;
client.raycast = headroomRaycast;
const packets = [];
const room = new AuthRoom(AUTHORITY_TEST_ARENA, {targetPopulation: 0});
room._rotateMatch = () => false;
const id = room.add(packet => { packets.push(packet); client._recv(JSON.stringify(packet)); }, 'Slider');
assert.equal(client.simWorld.raycast, headroomRaycast, 'welcome discarded prediction headroom collision');
const player = room.players.get(id);
player.state.slideCD = .30;
room.update();
const snapshot = packets.findLast(p => p.t === 'snapshot');
assert(snapshot, 'server must emit a real player snapshot');
assert(snapshot.you.slideCD > 0, 'server omitted slide recovery');
assert.equal(client.sim.slideCD, snapshot.you.slideCD, 'client discarded authoritative slide recovery');
client._recv(JSON.stringify({...snapshot, arena: client.arena}));
assert.equal(client.simWorld.raycast, headroomRaycast, 'arena snapshot discarded prediction headroom collision');
console.log('Slide presentation passed: Default Reforged low pose, stable planted silhouette, rifle contact/aim, entry/exit/respawn, 30/60/144Hz, and server-to-client recovery timer.');
