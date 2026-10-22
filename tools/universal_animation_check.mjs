import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  authoredTravelDirection,
  prepareRetargetedLocomotionClip,
} from '../src/player/UniversalAnimations.js';

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};

const path = new URL('../public/vendor/quaternius/universal-animation-library.glb', import.meta.url);
const bytes = fs.readFileSync(path);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
const names = new Set(gltf.animations.map((clip) => clip.name));
const requiredClips = [
  'Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
  'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Pistol_Idle_Loop', 'Pistol_Shoot', 'Pistol_Reload',
];
for (const name of requiredClips) {
  if (!names.has(name)) throw new Error(`animation library is missing ${name}`);
}
const bones = new Set();
gltf.scene.traverse((node) => { if (node.isBone) bones.add(node.name); });
for (const name of ['root', 'DEF-hips', 'DEF-spine003', 'DEF-head',
  'DEF-upper_armL', 'DEF-forearmL', 'DEF-upper_armR', 'DEF-forearmR',
  'DEF-thighL', 'DEF-shinL', 'DEF-footL', 'DEF-thighR', 'DEF-shinR', 'DEF-footR']) {
  if (!bones.has(name)) throw new Error(`animation library is missing bone ${name}`);
}

// The source's coordinate conversion is a quarter-turn on root. It must never
// survive retargeting onto the already-upright in-game skeleton.
const sourceRoot = gltf.animations.find((clip) => clip.name === 'Jog_Fwd_Loop')
  ?.tracks.find((track) => track.name === 'root.quaternion');
if (!sourceRoot || Math.abs(sourceRoot.values[0]) < 0.7) {
  throw new Error('animation-library root-axis fixture changed; review upright retargeting');
}
const fixture = new THREE.AnimationClip('upright-retarget', 1, [
  new THREE.QuaternionKeyframeTrack('.bones[root].quaternion', [0, 1], [
    -Math.SQRT1_2, 0, 0, Math.SQRT1_2, -Math.SQRT1_2, 0, 0, Math.SQRT1_2,
  ]),
  new THREE.QuaternionKeyframeTrack('.bones[hips].quaternion', [0, 1], [
    0, 0, 0, 1, 0.1, 0, 0, 0.995,
  ]),
  new THREE.QuaternionKeyframeTrack('.bones[thighL].quaternion', [0, 1], [
    0, 0, 0, 1, 0.2, 0, 0, 0.98,
  ]),
  new THREE.VectorKeyframeTrack('.bones[thighL].position', [0, 1], [
    0, 1, 0, 0, 0.5, 0,
  ]),
]);
prepareRetargetedLocomotionClip(fixture);
if (fixture.tracks.some((track) => track.name.includes('[root]'))) {
  throw new Error('retargeted root rotation can still lay a character on the floor');
}
if (fixture.tracks.some((track) => track.name.endsWith('.position'))) {
  throw new Error('retargeted source translation can still collapse the target skeleton');
}
if (fixture.tracks.some((track) => track.name.includes('[hips]'))) {
  throw new Error('authored upper body can still move the solved weapon shoulder');
}
if (!fixture.tracks.some((track) => track.name.includes('[thighL]'))) {
  throw new Error('retarget sanitizing removed the authored leg performance');
}

for (const sourcePath of ['../src/entities/Bot.js', '../src/player/Avatar.js', '../src/core/Game.js']) {
  const runtimeSource = fs.readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  const samplesHumanRig = /\.mixer\??\.update\s*\(dt\)[\s\S]*?\.armorTick\?\.\(dt\)/.test(runtimeSource);
  const samplesUniversalRig = /applyUniversalLocomotion\s*\(/.test(runtimeSource);
  const hasProceduralFallback = /applyWalkCycle\s*\(/.test(runtimeSource);
  if (!(samplesHumanRig || samplesUniversalRig)) {
    throw new Error(`${sourcePath} does not sample an authored character animation path`);
  }
  if (!hasProceduralFallback) {
    throw new Error(`${sourcePath} lost its safe procedural animation fallback`);
  }
}
const animatorSource = fs.readFileSync(new URL('../src/player/UniversalAnimations.js', import.meta.url), 'utf8');
if (!/const bobLimitDown = crouch > 0\.28 \? -0\.22 : -0\.035/.test(animatorSource)
    || !/_authoredBob[\s\S]*?Math\.exp\(-14 \* dt\)/.test(animatorSource)) {
  throw new Error('authored gait can move the visual root into the map or jitter it without damping');
}

const strafe = authoredTravelDirection(0, 1);
if (Math.abs(strafe.yaw + Math.PI / 2) > 1e-6 || strafe.playbackSign !== 1) {
  throw new Error('right-strafe leg plane points away from travel');
}
const retreat = authoredTravelDirection(-1, 0);
if (Math.abs(retreat.yaw) > 1e-6 || retreat.playbackSign !== -1) {
  throw new Error('backpedal does not reverse the authored stride');
}

console.log(`universal animations passed: ${gltf.animations.length} clips, ${bones.size} bones; authored jog/sprint/crouch/jump legs drive players and bots with upright root, stable weapon shoulder, directional travel, and procedural slide fallback`);
