// Carry clearance on the current animation rig and shipped weapon meshes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
import { disposeModel } from '../src/core/ModelResources.js';
globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, data); } };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'GeometryProbeTextures', loadTexture: async () => new THREE.Texture() }));
async function load(path) {
  const data = fs.readFileSync(new URL('../public' + path.split('?')[0], import.meta.url));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}
installEvCharacter(await load('/ev-default.glb'));
const position = o => o.getWorldPosition(new THREE.Vector3());
let count = 0, nearest = Infinity;
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  const body = buildEvCharacter(), rig = body.userData;
  const asset = await load(BLENDER_ARSENAL[def.id]);
  const weapon = buildBlenderWeapon(asset.scene, def).group;
  rig.attachWeapon(weapon);
  for (const yaw of [0, 1.4, -2.5]) for (const [speed, sprint] of [[0, false], [4, false], [8, true]]) {
    body.rotation.y = yaw;
    for (const aim of [-.6, 0, .6]) {
      rig.setLocomotion(speed, true, sprint); rig.setAim(aim);
      for (let frame = 0; frame < 60; frame++) rig.mixer.update(1 / 60);
      body.updateMatrixWorld(true);
      const contacts = weaponHandPose(weapon);
      const grip = new THREE.Vector3(...contacts.trigger).applyMatrix4(weapon.matrixWorld);
      const label = `${def.id}/${speed}/${yaw}/${aim}`;
      assert(grip.distanceTo(position(rig.bones.Bip001_R_Hand)) < .001, label + ': trigger hand detached');
      // The RPG uses a shoulder tube rather than the forward rifle pocket.
      // Its trigger and support contacts are still checked in every pose.
      if (def.id !== 'rpg') {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(weapon.getWorldQuaternion(new THREE.Quaternion()));
        const clearance = grip.clone().sub(position(rig.bones.Bip001_Spine1)).dot(forward);
        nearest = Math.min(nearest, clearance);
        assert(clearance > .45, label + ': grip tucked into chest');
      }
      if (contacts.supportVisible !== false) {
        const palm = weapon.worldToLocal(position(rig.bones.Bip001_L_Hand));
        const target = contacts.characterSupport || contacts.support;
        assert(Math.hypot(palm.x - target[0], palm.y - target[1]) < .025, label + ': support hand off underside');
        assert(palm.z >= target[2] - .025 && palm.z <= Math.max(target[2], contacts.trigger[2] - .04) + .025,
          label + ': support hand off fore-end');
      }
      count++;
    }
  }
  disposeModel(body);
}
console.log(`Current carry clearance passed: ${count} poses; nearest rifle trigger-to-chest clearance ${nearest.toFixed(3)}m and attached firearm grips.`);
