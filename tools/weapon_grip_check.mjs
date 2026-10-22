// Real shipped meshes and live skeleton: both palms must retain their grip.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
import { disposeModel } from '../src/core/ModelResources.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, data); } };
async function load(path) {
  const bytes = fs.readFileSync(new URL('../public/' + path, import.meta.url));
  return new GLTFLoader().register(() => ({
    name: 'GeometryProbeTextures', loadTexture: () => Promise.resolve(new THREE.Texture()),
  })).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
installEvCharacter(await load('ev-default.glb'));
const states = [
  { name: 'idle', speed: 0 },
  { name: 'run', speed: 9, sprint: true },
  { name: 'strafe', speed: 5, dirF: 0, dirR: 1 },
  { name: 'crouch', speed: 1, crouch: 1 },
  { name: 'fire', speed: 4, firing: true },
  { name: 'reload', speed: 0, reload: .5 },
  { name: 'rise', speed: 4, grounded: false, vy: 8 },
  { name: 'fall', speed: 4, grounded: false, vy: -8 },
];
let count = 0;
const models = [...WEAPONS, {id:'boltsniper',kind:'hitscan'}];
for (const def of models) {
  const character = buildEvCharacter(), rig = character.userData;
  const template = await load(BLENDER_ARSENAL[def.id].split('?')[0].replace(/^\//, ''));
  const weapon = buildBlenderWeapon(template.scene, def).group;
  rig.attachWeapon(weapon, def.kind === 'melee');
  for (const state of states) for (const pitch of [-1, 0, 1]) {
    rig.setLocomotion(state.speed, state.grounded !== false, state.sprint, 0, state.dirF ?? 1, state.dirR ?? 0);
    rig.setActionState({ crouch: 0, vy: 0, reload: 0, firing: false, ...state });
    rig.setAim(pitch);
    for (let frame = 0; frame < 40; frame++) rig.mixer.update(1 / 60);
    character.updateMatrixWorld(true);
    const authoredPose = weaponHandPose(weapon);
    const pose = authoredPose.characterSupport
      ? { ...authoredPose, support: authoredPose.characterSupport } : authoredPose;
    const trigger = new THREE.Vector3(...pose.trigger).applyMatrix4(weapon.matrixWorld);
    const right = rig.bones.Bip001_R_Hand.getWorldPosition(new THREE.Vector3());
    const label = `${def.id}/${state.name}/pitch ${pitch}`;
    assert(right.distanceTo(trigger) < .005, label + ': trigger hand detached');
    if (def.kind !== 'melee') {
      const gunRotation = weapon.getWorldQuaternion(new THREE.Quaternion()).invert();
      const triggerPalm = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(rig.bones.Bip001_R_Hand.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(gunRotation);
      assert(triggerPalm.x < -.999, label + ': trigger palm rotates away from grip');
      if (pose.supportVisible !== false) {
        const supportPalm = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(rig.bones.Bip001_L_Hand.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(gunRotation);
        assert(supportPalm.y > .999, label + ': support palm no longer faces the underside');
      }
    }
    if (pose.supportVisible !== false) {
      const target = state.reload && def.kind !== 'melee' ? pose.reload : pose.support;
      const support = new THREE.Vector3(...target).applyMatrix4(weapon.matrixWorld);
      const left = rig.bones.Bip001_L_Hand.getWorldPosition(new THREE.Vector3());
      const palm = weapon.worldToLocal(left);
      assert(Math.hypot(palm.x-target[0], palm.y-target[1]) < .005, label + ': support hand detached');
      assert(palm.z >= target[2]-.005 && palm.z <= Math.max(target[2],state.reload ? target[2] : pose.trigger[2]-.04)+.005, label + ': support hand off fore-end');
    }
    count++;
  }
  if (def.kind !== 'melee') {
    // A correct mid-reload target can still teleport at the start/end. Measure
    // consecutive rendered poses at the boundaries, including long fore-ends.
    for (const pitch of [-1, 0, 1]) for (const [before, after] of [[0, .0001], [.9999, 0]]) {
      rig.triggerTeleport(); rig.setLocomotion(0, true, false); rig.setAim(pitch);
      rig.setActionState({ crouch: 0, vy: 0, firing: false, reload: before });
      for (let frame = 0; frame < 60; frame++) rig.mixer.update(1 / 60);
      character.updateMatrixWorld(true);
      const hand = rig.bones.Bip001_L_Hand.getWorldPosition(new THREE.Vector3());
      const origin = weapon.getWorldPosition(new THREE.Vector3());
      rig.setActionState({ reload: after }); rig.mixer.update(1 / 60);
      character.updateMatrixWorld(true);
      assert(hand.distanceTo(rig.bones.Bip001_L_Hand.getWorldPosition(new THREE.Vector3())) < .025,
        `${def.id}: support hand jumps at reload boundary`);
      assert(origin.distanceTo(weapon.getWorldPosition(new THREE.Vector3())) < .025,
        `${def.id}: whole gun jumps at reload boundary`);
    }
  }
  disposeModel(character);
}
console.log(`Shipped weapon grips passed: ${count} carry poses across ${models.length} models.`);
