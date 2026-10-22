import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  TPS_DEFAULT_DISTANCE,
  TPS_MAX_DISTANCE,
  TPS_SHOULDER_OFFSET,
  nextThirdPersonDistance,
  safeThirdPersonObstructionDistance,
  setThirdPersonDesired,
  findThirdPersonObstruction,
} from '../src/player/ThirdPersonCamera.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const [distance, wheel] of [[0, 1], [TPS_DEFAULT_DISTANCE, -1],
  [TPS_DEFAULT_DISTANCE, 1], [TPS_MAX_DISTANCE, 1], [4.4, -1], [3.2, 0]]) {
  assert(nextThirdPersonDistance(distance, wheel) === 0,
    `player camera must stay first-person (${distance}, ${wheel})`);
}
const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
assert(/player\._camDist = 0;[\s\S]*?weaponMount\.visible = !dead/.test(gameSource),
  'gameplay frame does not recover stale POV state and restore the held gun');
assert(Math.abs(safeThirdPersonObstructionDistance(2) - 1.45) < 1e-9,
  'wall collision must keep the camera near plane clear of the surface');
assert(safeThirdPersonObstructionDistance(0.6) === 0.35,
  'wall collision must preserve a stable minimum camera distance');

const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.02, 300);
const player = new THREE.Vector3(0, 0, 0);
setThirdPersonDesired(camera.position, player, 0, 0, TPS_DEFAULT_DISTANCE);
camera.rotation.order = 'YXZ';
camera.rotation.set(0, 0, 0);
camera.updateMatrixWorld(true);
const feet = new THREE.Vector3(0, 0.05, 0).project(camera);
const head = new THREE.Vector3(0, 1.78, 0).project(camera);
const chest = new THREE.Vector3(0, 1.25, 0).project(camera);
const bodyFrame = Math.abs(head.y - feet.y) * 0.5;
assert(Math.abs(camera.position.x - TPS_SHOULDER_OFFSET) < 1e-9,
  'camera must sit over the right shoulder at zero yaw');
assert(chest.x < -0.10,
  `player must stay left of the reticle (projected chest x=${chest.x.toFixed(3)})`);
assert(bodyFrame >= 0.46 && bodyFrame <= 0.60,
  `default TPS frame must fill 46-60% of screen height (got ${(bodyFrame * 100).toFixed(1)}%)`);

const pivot = new THREE.Vector3(0, 1.25, 0);
const desired = new THREE.Vector3();
setThirdPersonDesired(desired, player, 0, 0, TPS_DEFAULT_DISTANCE);
const wall = new THREE.Box3(
  new THREE.Vector3(-1, -1, 1.8),
  new THREE.Vector3(1, 3, 2.4),
);
const obstruction = findThirdPersonObstruction(
  new THREE.Raycaster(),
  { raycastMeshes: [], colliders: [{ box: wall }], raycastBoxHit: () => null },
  pivot,
  desired,
  new THREE.Vector3(),
);
assert(obstruction && obstruction.distance < TPS_DEFAULT_DISTANCE,
  'camera embedded in a one-sided wall must be pulled back in front of it');

console.log(
  `first-person lock and spectator framing passed — shoulder=${TPS_SHOULDER_OFFSET.toFixed(2)}m, `
  + `body=${(bodyFrame * 100).toFixed(1)}%, safe frame ${TPS_DEFAULT_DISTANCE.toFixed(2)}-${TPS_MAX_DISTANCE.toFixed(1)}m`,
);
