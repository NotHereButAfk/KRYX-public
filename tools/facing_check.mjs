import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetKyxLocomotionClips } from '../src/player/HumanSoldier.js';
import {
  bodyForwardAtYaw,
  cameraYawToBodyYaw,
  directionToBodyYaw,
  movementInBodySpace,
  turnBodyYaw,
} from '../src/player/Facing.js';

const EPS = 1e-8;
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

// Camera yaw zero looks down world -Z. All cardinal camera headings must match
// the model's local -Z forward after conversion.
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const bodyYaw = cameraYawToBodyYaw(yaw);
  const forward = bodyForwardAtYaw(bodyYaw);
  assert(near(forward.x, -Math.sin(yaw)), `camera yaw ${yaw}: x inverted`);
  assert(near(forward.z, -Math.cos(yaw)), `camera yaw ${yaw}: z inverted`);
}

// During a smoothed turn, locomotion must use the yaw actually visible on the
// mesh rather than the newer network target yaw.
const turningTravel = movementInBodySpace(0, -1, 0);
assert(near(turningTravel.forward, 1), 'visible forward travel became a sideways gait');
assert(near(turningTravel.right, 0), 'visible forward travel has false strafe');
const rightTravel = movementInBodySpace(1, 0, 0);
assert(near(rightTravel.forward, 0) && near(rightTravel.right, 1), 'body-space strafe projection is inverted');

let boundedYaw = Math.PI - 0.02;
for (let i = 0; i < 60; i++) {
  const before = boundedYaw;
  boundedYaw = turnBodyYaw(boundedYaw, -Math.PI + 0.2, 1 / 60, 3.2);
  let step = boundedYaw - before;
  step = ((step + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  assert(Math.abs(step) <= 3.2 / 60 + 1e-8, `body spun too fast (${step})`);
}
assert(Math.abs(boundedYaw - (-Math.PI + 0.2)) < 0.01,
  'body yaw did not take the short path across the seam');

// A movement-derived yaw starts from atan2(dx, dz), which describes local +Z.
// directionToBodyYaw must rotate local -Z onto the requested world vector.
for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1]]) {
  const len = Math.hypot(dx, dz);
  const forward = bodyForwardAtYaw(directionToBodyYaw(dx, dz));
  assert(near(forward.x, dx / len), `direction ${dx},${dz}: x inverted`);
  assert(near(forward.z, dz / len), `direction ${dx},${dz}: z inverted`);
}

// Prove the assumption against the actual soldier asset. During the planted
// portion of its walk cycle the foot moves toward +Z beneath the body, so the
// body's travel/visual-forward direction is -Z.
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

const bytes = fs.readFileSync(new URL('../public/kyx-player.glb', import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(buffer, '', resolve, reject);
});
const motionBytes = fs.readFileSync(new URL('../public/kyx-locomotion.glb', import.meta.url));
const motionGltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
  motionBytes.buffer.slice(motionBytes.byteOffset, motionBytes.byteOffset + motionBytes.byteLength),
  '', resolve, reject,
));
const walk = retargetKyxLocomotionClips(motionGltf.animations).find((clip) => clip.name === 'Walk');
assert(walk, 'kyx-locomotion.glb is missing its Walk clip');

const mixer = new THREE.AnimationMixer(gltf.scene);
mixer.clipAction(walk).play();
const foot = gltf.scene.getObjectByName('mixamorigLeftToeBase')
  || gltf.scene.getObjectByName('mixamorigLeftFoot');
assert(foot, 'kyx-player.glb is missing its left foot bones');

const samples = [];
const point = new THREE.Vector3();
for (let i = 0; i <= 120; i++) {
  mixer.setTime(walk.duration * i / 120);
  gltf.scene.updateMatrixWorld(true);
  foot.getWorldPosition(point);
  samples.push({ y: point.y, z: point.z });
}
const minY = Math.min(...samples.map((sample) => sample.y));
const maxY = Math.max(...samples.map((sample) => sample.y));
const plantedCutoff = minY + (maxY - minY) * 0.30;
let plantedDz = 0;
let plantedSegments = 0;
for (let i = 1; i < samples.length; i++) {
  if (samples[i - 1].y < plantedCutoff && samples[i].y < plantedCutoff) {
    plantedDz += samples[i].z - samples[i - 1].z;
    plantedSegments++;
  }
}
assert(plantedSegments >= 20, 'walk clip did not expose a stable planted phase');
assert(plantedDz > 0.25, `walk clip forward-axis proof inverted (${plantedDz.toFixed(3)})`);

console.log(
  `facing check passed: camera/network/bot yaw agree; soldier planted-foot dz=${plantedDz.toFixed(3)} (+Z), body forward=-Z`
);
