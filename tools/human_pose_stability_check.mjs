import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preloadHumanSoldier, buildHumanSoldier } from '../src/player/HumanSoldier.js';

const bytes = fs.readFileSync(new URL('../public/kyx-player.glb', import.meta.url));
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject,
));
const motionBytes = fs.readFileSync(new URL('../public/kyx-locomotion.glb', import.meta.url));
const motionGltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
  motionBytes.buffer.slice(motionBytes.byteOffset, motionBytes.byteOffset + motionBytes.byteLength), '', resolve, reject,
));
const originalLoad = GLTFLoader.prototype.load;
try {
  GLTFLoader.prototype.load = function(url, ready) {
    ready(url === '/kyx-player.glb' ? gltf : motionGltf);
  };
  await new Promise((resolve) => preloadHumanSoldier(resolve));
} finally { GLTFLoader.prototype.load = originalLoad; }

for (const fps of [30, 60, 144]) {
  const body = buildHumanSoldier(null, 'vanguard');
  const ud = body.userData;
  const spine = body.getObjectByName('mixamorigSpine1');
  const hips = body.getObjectByName('mixamorigHips');
  assert(spine && hips, 'production skeleton required');
  let reference;
  let maxDrift = 0;
  for (let frame = 0; frame < fps * 20; frame++) {
    ud.setLocomotion(0, true, false, 0, 1, 0);
    ud.setAim(0.12, 0.45);
    ud.mixer.update(1 / fps);
    ud.armorTick(1 / fps);
    if (frame === fps * 3) reference = spine.quaternion.clone();
    if (reference) maxDrift = Math.max(maxDrift, reference.angleTo(spine.quaternion));
  }
  console.log(`stationary aim ${fps}Hz: spine drift ${(maxDrift * 180 / Math.PI).toFixed(2)}deg`);
  assert(maxDrift < 0.12, 'stationary aim accumulates into a spinning/folded torso');
}
for (const fps of [30, 60, 144]) {
  const reversingBody = buildHumanSoldier(null, 'vanguard');
  const reversing = reversingBody.userData;
  const stages = [
    { speed: 2, f: -1, r: 0, clip: 'walk' },
    { speed: 5, f: -1, r: 0, clip: 'run' },
    { speed: 5, f: 1, r: 0, clip: 'run' },
    { speed: 2, f: 0, r: 1, clip: 'walk' },
    { speed: 2, f: 0, r: -1, clip: 'walk' },
    { speed: 0, f: 1, r: 0, clip: 'idle' },
  ];
  for (const stage of stages) {
    for (let frame = 0; frame < fps * 3; frame++) {
      const before = reversing.mixer.time;
      reversing.setLocomotion(stage.speed, true, stage.clip === 'run', stage.r, stage.f, stage.r);
      reversing.setAim(0.12, Math.sin(frame / fps) * 0.45);
      reversing.mixer.update(1 / fps);
      reversing.armorTick(1 / fps);
      assert(reversing.mixer.time > before, 'backpedalling reversed the transition clock');
      reversingBody.updateMatrixWorld(true);
      const head = reversingBody.getObjectByName('mixamorigHead').getWorldPosition(new THREE.Vector3());
      const hips = reversingBody.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
      assert(head.y > hips.y + 0.45,
        `${fps}Hz ${stage.clip}: locomotion folded the head below the torso`);
    }
    const weight = reversing.actions[stage.clip].getEffectiveWeight();
    assert(weight > 0.99, `${fps}Hz: ${stage.clip} crossfade stuck at ${weight}`);
  }
  console.log(`${fps}Hz: backward walk/run, forward, both strafes and idle transitions passed`);
}
console.log('production pose stability passed');
