import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { BOT_DIFFICULTIES } from '../src/entities/BotCombat.js';
import { predictBotTarget } from '../src/entities/BotSkill.js';
import { Bot } from '../src/entities/Bot.js';
import { BotManager } from '../src/entities/BotManager.js';
import { installEvCharacter } from '../src/player/EvCharacter.js';
import { disposeModel } from '../src/core/ModelResources.js';

const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const arena = { id: 'tracking-proof', half: 100, killY: -20, noBaseFloor: false,
  spawns: [[0, 0, 0]], platforms: [], boxes: [], pickups: [], gravLifts: [], teleporters: [],
  groundHeightAt: () => 0 };
const room = new AuthRoom(arena, { now: 0 });
const observer = room.players.get(room.addBot('Observer'));
const target = room.players.get(room.add(() => {}, 'Target'));
Object.assign(observer.state, { px: 0, py: 0, pz: 0 });
Object.assign(target.state, { px: 0, py: 0, pz: -12 });
observer.invulnerableUntil = target.invulnerableUntil = 0;
observer._botNextScanTick = 0;
observer._botAimYaw = 0;
const drive = (tick, rescan = true) => {
  room.tick = tick;
  observer.fireReq = null;
  if (rescan) observer._botNextLosTick = 0;
  return room._driveBot(observer);
};

drive(0);
assert.equal(observer._botObservation.targetId, target.id);
assert.equal(observer._botObservation.vx, 0);
target.state.px = .5;
drive(2);
near(observer._botObservation.vx, 5);
near(predictBotTarget(observer._botObservation, 3 / TICK_HZ).x, .75);
const captured = structuredClone(observer._botObservation);
target.state.px = 25;
observer._botNextLosTick = 20;
drive(3, false);
assert.deepEqual(observer._botObservation, captured, 'cached vision read a live target position');

// A failed visual check must freeze memory and block firing, including stance.
room.smokes.push({ x: 0, y: 1.55, z: -6, r: 4, until: 100 });
target.state.px = .5;
target.state.crouch = 1;
drive(4);
assert.equal(observer._botLosCache, false);
assert.equal(observer.fireReq, null);
assert.deepEqual(observer._botObservation, captured);
assert.equal(observer._botAimHeight, 1.05, 'hidden crouch leaked into aim');
assert.deepEqual(predictBotTarget(observer._botObservation, 10, false), { x: .5, y: 0, z: -12 });

room.smokes.length = 0;
target.state.px = 1;
drive(6);
assert.equal(observer._botObservation.vx, 0, 'reacquisition retained pre-cover velocity');
assert.equal(observer._botAimHeight, .65, 'visible crouch was not sampled');
target.state.px = 1.5;
drive(8);
near(observer._botObservation.vx, 5);
target.state.px = 8;
drive(10);
assert.equal(observer._botObservation.vx, 0, 'teleport was treated as sustained velocity');

const replacement = room.players.get(room.add(() => {}, 'Replacement'));
replacement.invulnerableUntil = 0;
Object.assign(replacement.state, { px: 0, py: 0, pz: -3 });
observer._botNextScanTick = 0;
drive(12);
assert.equal(observer._botTargetId, replacement.id);
assert.equal(observer._botObservation.targetId, replacement.id);
assert.equal(observer._botObservation.vx, 0, 'target switch inherited velocity');
room._resetBotAI(observer);
assert.equal(observer._botObservation, null, 'respawn retained target tracking');
assert.equal(observer._botAimHeight, 1.05);

for (const [lower, higher] of [['easy', 'normal'], ['normal', 'hard']]) {
  const a = BOT_DIFFICULTIES[lower], b = BOT_DIFFICULTIES[higher];
  assert(b.aimTurnSpeed > a.aimTurnSpeed, `${higher} turns slower than ${lower}`);
  assert(b.reactionMin < a.reactionMin && b.reactionMax < a.reactionMax);
  assert(b.aimErrorScale < a.aimErrorScale && b.aimErrorScale > 0);
  assert(b.scanInterval <= a.scanInterval && b.losInterval <= a.losInterval);
  assert(b.decisionInterval <= a.decisionInterval);
}
console.log('Authoritative tracking: observed velocity, bounded prediction, cover freeze, stance, target switch, teleport and respawn passed.');

globalThis.ProgressEvent ??= class { constructor(_type, data) { Object.assign(this, data); } };
const bytes = fs.readFileSync(new URL('../public/ev-default.glb', import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
let blocked = false;
const rays = [];
const world = { arenaHalf: 100, killY: -20, groundHeightAt: () => 0,
  resolveCollisions() {}, raycastCollisionDistance: (ray, far) => {
    rays.push({ direction: ray.direction.clone(), far });
    return blocked ? 0 : far;
  } };
const local = new Bot(world, new THREE.Vector3());
const camera = new THREE.PerspectiveCamera();
const player = { id: 'local-target', position: new THREE.Vector3(0, 0, -12), isDead: false };
try {
  blocked = true;
  assert.equal(local.hasLineOfSight(player, world), false, 'fresh bot saw through cover using an empty sighting');
  assert(rays.at(-1)?.direction.z < -.9, 'visibility ray did not point at the candidate');
  blocked = false;
  local.update(.1, player, camera, () => {}, world);
  player.position.x = .5;
  local._losT = 0;
  local.update(.1, player, camera, () => {}, world);
  near(local._observation.vx, 5);
  const observed = { ...local._observation };
  const remembered = local._lastSeenPos.clone();
  player.position.x = 4;
  local._losT = 1;
  local.update(.01, player, camera, () => {}, world);
  assert.deepEqual(local._observation, observed);
  assert(local._lastSeenPos.equals(remembered), 'offline cached vision read live coordinates');
  blocked = true;
  local._losT = 0;
  local.update(.1, player, camera, () => {}, world);
  assert.equal(local._losCache, false);
  assert.deepEqual(local._observation, observed, 'offline hidden target replaced sighting');

  // Real manager handoff: damage from a new opponent behind the bot must retain
  // its reaction/last-seen knowledge, even though ordinary acquisition uses FOV.
  blocked = false;
  local.respawnAt(new THREE.Vector3());
  player.position.set(0, 0, -12);
  const manager = new BotManager(world, new THREE.Scene());
  manager.bots = [local];
  manager.update(.05, player, camera, () => {}, world);
  const attacker = { id: 'rear-attacker', position: new THREE.Vector3(0, 0, 12), isDead: false };
  assert.equal(local.canNotice(attacker, world), false, 'rear attacker fixture is inside ordinary FOV');
  local.takeDamage(1, attacker);
  manager.update(.05, player, camera, () => {}, world);
  assert.equal(local._targetEntity, attacker);
  assert.equal(local._provoked, true, 'new retaliation target lost provocation');
  assert.equal(local._lastSeenValid, true, 'new retaliation target lost remembered position');
  assert.equal(local._observation?.targetId, attacker.id, 'visible rear attacker was not sampled during retaliation');
  local.respawnAt(new THREE.Vector3());
  assert.equal(local._observation, null);
  assert.equal(local._perceptionTime, 0);
} finally {
  disposeModel(local.mesh);
}
console.log('Offline real-rig tracking: candidate LOS, cached/hidden sightings, rear-attacker retaliation and respawn passed.');
