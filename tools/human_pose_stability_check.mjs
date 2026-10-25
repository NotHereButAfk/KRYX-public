import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { disposeModel } from '../src/core/ModelResources.js';

globalThis.ProgressEvent ??= class { constructor(type, init) { Object.assign(this, init); } };
const bytes = fs.readFileSync(new URL('../public/ev-default.glb', import.meta.url));
const loader = new GLTFLoader().register(() => ({
  name: 'PoseProbeTextures', loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
installEvCharacter(asset);

for (const fps of [30, 60, 144]) {
  const body = buildEvCharacter(), runtime = body.userData;
  const spine = runtime.bones.Bip001_Spine1;
  const hips = runtime.bones.Bip001_Pelvis;
  assert(spine && hips, 'current gameplay skeleton is required');
  let reference, maxDrift = 0;
  for (let frame = 0; frame < fps * 20; frame++) {
    runtime.setLocomotion(0, true, false, 0, 1, 0);
    runtime.setAim(0.12, 0.45);
    runtime.mixer.update(1 / fps);
    if (frame === fps * 3) reference = spine.quaternion.clone();
    if (reference) maxDrift = Math.max(maxDrift, reference.angleTo(spine.quaternion));
  }
  console.log(`stationary aim ${fps}Hz: spine drift ${(maxDrift * 180 / Math.PI).toFixed(2)}deg`);
  assert(maxDrift < 0.12, 'stationary aim accumulates into a spinning/folded torso');
  disposeModel(body);
}
for (const fps of [30, 60, 144]) {
  const body = buildEvCharacter(), runtime = body.userData;
  const stages = [
    { speed: 2, f: -1, r: 0, motion: 'walking', sprint: false },
    { speed: 5, f: -1, r: 0, motion: 'running', sprint: true },
    { speed: 5, f: 1, r: 0, motion: 'running', sprint: true },
    { speed: 2, f: 0, r: 1, motion: 'walking', sprint: false },
    { speed: 2, f: 0, r: -1, motion: 'walking', sprint: false },
    { speed: 0, f: 1, r: 0, motion: 'idle', sprint: false },
  ];
  for (const stage of stages) {
    for (let frame = 0; frame < fps * 3; frame++) {
      const before = runtime.animationMixer.time;
      const distance = stage.speed / fps;
      body.position.x += stage.r * distance;
      body.position.z -= stage.f * distance;
      runtime.setLocomotion(stage.speed, true, stage.sprint, stage.r, stage.f, stage.r, distance);
      runtime.setAim(0.12, Math.sin(frame / fps) * 0.45);
      runtime.mixer.update(1 / fps);
      assert(runtime.animationMixer.time > before, 'backpedalling reversed the transition clock');
      body.updateMatrixWorld(true);
      const head = runtime.bones.Bip001_Head.getWorldPosition(new THREE.Vector3());
      const hips = runtime.bones.Bip001_Pelvis.getWorldPosition(new THREE.Vector3());
      assert(head.y > hips.y + 0.45,
        `${fps}Hz ${stage.motion}: locomotion folded the head below the torso`);
      for (const bone of Object.values(runtime.bones)) {
        assert(bone.matrixWorld.elements.every(Number.isFinite), `${fps}Hz: non-finite pose`);
      }
    }
    // The current distance-driven gait intentionally uses the same authored
    // locomotion clip at different rates; verify its pose and travel calibration.
    assert.equal(runtime.activeAnimation, asset.animations[stage.speed ? 2 : 0].name,
      'current runtime selects locomotion while moving and idle only when stopped');
    if (stage.speed) assert(Math.abs(runtime.measuredSpeeds[2] * runtime.animationCadence - stage.speed) < 0.01,
      'walking and running cadence must follow their actual travel speeds');
    const action = runtime.animationActions.find(a => a.getClip().name === runtime.activeAnimation);
    assert(action?.getEffectiveWeight() > 0.99, `${fps}Hz: ${runtime.activeAnimation} crossfade is stuck`);
  }
  disposeModel(body);
  console.log(`${fps}Hz: backward walk/run, forward, both strafes and idle transitions passed`);
}
console.log('Current Reforged pose stability passed');
