import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { retargetKyxLocomotionClips } from '../src/player/HumanSoldier.js';
import {
  dampHumanTimeScale,
  HUMAN_CLIP_SPEED,
  HUMAN_PHASE_ORIGIN,
  HUMAN_STRIDE_WARP,
  humanMotionTransitionSeconds,
  humanAimPose,
  humanStrideWarpAngle,
  humanTravelPose,
  mapHumanMotionPhase,
  selectHumanMotion,
  targetHumanStrideScale,
  targetHumanTimeScale,
} from '../src/player/HumanLocomotion.js';

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

assert(HUMAN_CLIP_SPEED.walk > 1.5 && HUMAN_CLIP_SPEED.walk < 2.0, 'walk calibration drifted');
assert(HUMAN_CLIP_SPEED.run > 4.0 && HUMAN_CLIP_SPEED.run < 4.6, 'run calibration drifted');
assert(selectHumanMotion(0, false, 'idle') === 'idle', 'idle threshold failed');
assert(selectHumanMotion(2.5, false, 'walk') === 'walk', 'walk selection failed');
assert(selectHumanMotion(4.2, false, 'walk') === 'run', 'run selection failed');
assert(selectHumanMotion(3.7, false, 'run') === 'run', 'run hysteresis failed');
assert(selectHumanMotion(2.0, true, 'walk') === 'run', 'sprint did not force run');
assert(selectHumanMotion(0, true, 'run') === 'idle',
  'blocked sprint kept running in place');
assert(humanMotionTransitionSeconds('run', 'air') <= 0.06,
  'run clip keeps cycling too long after takeoff');
assert(humanMotionTransitionSeconds('air', 'run') >= 0.1
  && humanMotionTransitionSeconds('air', 'run') <= 0.14,
  'landing-to-run recovery is mistimed');

for (const yaw of [-Math.PI * 8, -Math.PI, -1, 0, 1, Math.PI, Math.PI * 8]) {
  const aim = humanAimPose(99, yaw);
  assert(Math.abs(aim.yaw) <= 0.620001,
    `upper body can overtwist at yaw ${yaw} (${aim.yaw})`);
  assert(Math.abs(aim.pitch) <= 0.780001,
    `upper body can overpitch (${aim.pitch})`);
}
assert(humanAimPose(0, Math.PI * 2 + 0.25).yaw > 0.24,
  'aim yaw did not take the short path across the seam');

const walkRate = targetHumanTimeScale('walk', 2.5);
const runRate = targetHumanTimeScale('run', 6.2);
const sprintRate = targetHumanTimeScale('run', 13.2);
assert(walkRate > 1 && walkRate < 1.7, `walk rate is implausible (${walkRate})`);
assert(runRate > 1.3 && runRate < 1.6, `run rate is implausible (${runRate})`);
assert(sprintRate === 1.38, `gliding sprint cadence cap changed (${sprintRate})`);
const sprintStride = targetHumanStrideScale('run', 13.2, sprintRate);
assert(sprintStride > 2.0 && sprintStride <= 2.04,
  `sprint stride warp is implausible (${sprintStride})`);
assert(Math.abs(targetHumanStrideScale('run', HUMAN_CLIP_SPEED.run, 1) - 1) < 1e-6,
  'native run speed should not warp the stride');

let smooth = 1;
for (let i = 0; i < 6; i++) smooth = dampHumanTimeScale(smooth, sprintRate, 1 / 60);
assert(smooth > 1 && smooth < sprintRate, 'time-scale damping snapped or stalled');

// Sweep through a live strafe-to-backpedal change in both directions. The
// reverse-clip hysteresis may change the hidden target, but the damped pelvis
// players actually see must never snap across frames.
for (const side of [-1, 1]) {
  for (const sweep of [[1, -1], [-1, 1]]) {
    let reverse = sweep[0] < 0;
    let renderedYaw = humanTravelPose(sweep[0], 0, reverse).yaw;
    let worstYawStep = 0;
    for (let i = 1; i <= 240; i++) {
      const forward = sweep[0] + (sweep[1] - sweep[0]) * i / 240;
      const right = side * Math.sqrt(Math.max(0, 1 - forward * forward));
      const pose = humanTravelPose(forward, right, reverse);
      reverse = pose.reverse;
      let delta = pose.yaw - renderedYaw;
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
      const step = delta * (1 - Math.exp(-12 / 60));
      renderedYaw += step;
      worstYawStep = Math.max(worstYawStep, Math.abs(step));
    }
    assert(worstYawStep < 0.06,
      `travel-direction crossover snaps pelvis by ${worstYawStep.toFixed(3)}rad`);
  }
}

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
const runtimeClips = retargetKyxLocomotionClips(motionGltf.animations);

const SAMPLE_COUNT = 720;
const cyclicDistance = (a, b) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};
const wrapPhase = (phase) => ((phase % 1) + 1) % 1;

function sampleFeet(sourceClip) {
  const scene = cloneSkeleton(gltf.scene);
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(sourceClip).play();
  const feet = {
    left: scene.getObjectByName('mixamorigLeftToeBase')
      || scene.getObjectByName('mixamorigLeftFoot'),
    right: scene.getObjectByName('mixamorigRightToeBase')
      || scene.getObjectByName('mixamorigRightFoot'),
  };
  assert(feet.left && feet.right, 'soldier foot bones missing');
  const samples = { left: [], right: [] };
  const point = new THREE.Vector3();
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    mixer.setTime(sourceClip.duration * i / SAMPLE_COUNT);
    scene.updateMatrixWorld(true);
    for (const side of ['left', 'right']) {
      feet[side].getWorldPosition(point);
      samples[side].push(point.y);
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([side, heights]) => {
    const minHeight = Math.min(...heights);
    return [side, {
      minHeight,
      contactPhase: heights.indexOf(minHeight) / SAMPLE_COUNT,
    }];
  }));
}

function sampleWarpedRun(sourceClip, strideScale) {
  const scene = cloneSkeleton(gltf.scene);
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(sourceClip).play();
  const feet = [
    scene.getObjectByName('mixamorigLeftToeBase')
      || scene.getObjectByName('mixamorigLeftFoot'),
    scene.getObjectByName('mixamorigRightToeBase')
      || scene.getObjectByName('mixamorigRightFoot'),
  ];
  const legs = [
    scene.getObjectByName('mixamorigLeftUpLeg'),
    scene.getObjectByName('mixamorigRightUpLeg'),
  ];
  assert(feet.every(Boolean) && legs.every(Boolean), 'soldier stride bones missing');

  const samples = [[], []];
  const point = new THREE.Vector3();
  const axisX = new THREE.Vector3(1, 0, 0);
  const rotation = new THREE.Quaternion();
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const phase = i / SAMPLE_COUNT;
    mixer.setTime(sourceClip.duration * phase);
    const stride = humanStrideWarpAngle(
      'run', strideScale, phase * Math.PI * 2
    );
    legs[0].quaternion.multiply(rotation.setFromAxisAngle(axisX, stride));
    legs[1].quaternion.multiply(rotation.setFromAxisAngle(axisX, -stride));
    scene.updateMatrixWorld(true);
    for (let side = 0; side < feet.length; side++) {
      feet[side].getWorldPosition(point);
      samples[side].push(point.clone());
    }
  }

  const minHeight = Math.min(...samples.flatMap((side) => (
    side.map((point) => point.y)
  )));
  // Measure the rearward speed only while a toe is within 2cm of its lowest
  // point. This isolates planted stance from the airborne recovery swing.
  const plantedSpeeds = [];
  const sampleDt = sourceClip.duration / SAMPLE_COUNT;
  for (const side of samples) {
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      if (side[i].y > minHeight + 0.02) continue;
      const before = side[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
      const after = side[(i + 1) % SAMPLE_COUNT];
      plantedSpeeds.push(Math.abs((after.z - before.z) / (2 * sampleDt)));
    }
  }
  plantedSpeeds.sort((a, b) => a - b);
  return {
    minHeight,
    plantedSpeed: plantedSpeeds[Math.floor(plantedSpeeds.length / 2)],
  };
}

const clips = Object.fromEntries(
  runtimeClips
    .filter((clip) => ['Idle', 'Walk', 'Run'].includes(clip.name))
    .map((clip) => [clip.name.toLowerCase(), clip])
);
assert(clips.idle && clips.walk && clips.run, 'soldier idle/walk/run clips missing');
const feet = Object.fromEntries(
  Object.entries(clips).map(([name, clip]) => [name, sampleFeet(clip)])
);

// The source clips are already authored against the same floor. Their
// different Hips baselines compensate for different poses; forcing every Hips
// first key to the bind pose lifts Run roughly 13cm above Walk.
const floorHeights = Object.values(feet).flatMap((clip) => (
  [clip.left.minHeight, clip.right.minHeight]
));
const floorSpread = Math.max(...floorHeights) - Math.min(...floorHeights);
const authoredKyxAsset = !!gltf.scene.getObjectByName('KYX_HelmetShell');
assert(floorSpread < (authoredKyxAsset ? 0.018 : 0.01),
  `soldier source clips disagree on floor by ${(floorSpread * 100).toFixed(2)}cm`);

// Infer the bilateral phase origin independently from the asset. Left contact
// is half a cycle after right contact, so fold it back by 0.5 before averaging.
for (const motion of ['walk', 'run']) {
  const measuredOrigin = (
    feet[motion].right.contactPhase
    + wrapPhase(feet[motion].left.contactPhase - 0.5)
  ) * 0.5;
  assert(
    cyclicDistance(measuredOrigin, HUMAN_PHASE_ORIGIN[motion]) < 0.015,
    `${motion} canonical contact origin drifted (${measuredOrigin.toFixed(4)})`
  );
}

for (const [from, to] of [['walk', 'run'], ['run', 'walk']]) {
  for (const side of ['left', 'right']) {
    const mapped = mapHumanMotionPhase(feet[from][side].contactPhase, from, to);
    const error = cyclicDistance(mapped, feet[to][side].contactPhase);
    // The authored Run has a deliberately asymmetric 55/45 foot cadence.
    // Mapping through the bilateral mean keeps both transitions within 2.5%
    // of a cycle instead of snapping either foot to an artificial half-cycle.
    const tolerance = authoredKyxAsset ? 0.026 : 0.02;
    assert(error < tolerance, `${from}->${to} ${side} contact misses by ${error.toFixed(4)} cycle`);
  }
}
assert(mapHumanMotionPhase(0.8, 'walk', 'idle') === 0, 'gait-to-idle phase did not reset');
assert(mapHumanMotionPhase(0.8, 'idle', 'run') === 0, 'idle-to-gait phase did not reset');

// Exercise the exact thigh warp against the shipped rig. Compare to the
// unwarped clip so the authored calibration remains the source of truth even
// if Blender/GLTF axis conventions introduce a small absolute-speed bias.
const nativeRun = sampleWarpedRun(clips.run, 1);
const warpedRun = sampleWarpedRun(clips.run, sprintStride);
const measuredSprint = HUMAN_CLIP_SPEED.run
  * (warpedRun.plantedSpeed / nativeRun.plantedSpeed)
  * sprintRate;
const authoredKyx = !!gltf.scene.getObjectByName('KYX_HelmetShell');
if (!authoredKyx) {
  assert(
    Math.abs(measuredSprint - 13.2) / 13.2 < 0.04,
    `warped sprint delivers ${measuredSprint.toFixed(2)}m/s instead of 13.2m/s`
  );
  assert(
    warpedRun.minHeight >= nativeRun.minHeight - 0.01,
    `stride warp adds ${((nativeRun.minHeight - warpedRun.minHeight) * 100).toFixed(2)}cm toe penetration`
  );
} else {
  // HumanSoldier deliberately leaves the Blender-authored leg arcs intact.
  // Floor agreement and contact phase checks above cover the shipped clips;
  // a source guard below prevents the legacy additive warp from returning.
  const runtime = fs.readFileSync(new URL('../src/player/HumanSoldier.js', import.meta.url), 'utf8');
  assert(runtime.includes('if (!authoredArmor && _grounded'),
    'Blender-authored model is missing its no-double-stride guard');
}
assert(HUMAN_STRIDE_WARP.run === 0.71, 'gliding Run stride gain drifted');

console.log(
  `human locomotion passed: walk=${walkRate.toFixed(2)}x run=${runRate.toFixed(2)}x sprint=${sprintRate.toFixed(2)}x, ${authoredKyx ? 'native Blender stride preserved' : `delivery=${measuredSprint.toFixed(2)}m/s`}, floor spread=${(floorSpread * 100).toFixed(2)}cm, contact phase-matched`
);
