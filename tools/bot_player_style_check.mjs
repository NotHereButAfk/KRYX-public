import assert from 'node:assert/strict';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { choosePlayerLikeBotMove } from '../src/entities/BotCombat.js';
import { WALK_SPEED } from '../src/sim/MovementConfig.js';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter } from '../src/player/EvCharacter.js';
import { Bot } from '../src/entities/Bot.js';
import { disposeModel } from '../src/core/ModelResources.js';

// Open-lane movement follows the selected side, without clock-driven reversals.
for (const hz of [20, 30, 60, 144]) {
  let moves = 0, transitions = 0, lastSide = 0;
  for (let frame = 0; frame < hz * 12; frame++) {
    const m = choosePlayerLikeBotMove({ id: 4, elapsed: frame / hz, strafeSide: 1 });
    const moving = !!(m.forward || m.strafe);
    moves += Number(moving);
    const side = Math.sign(m.strafe);
    if (lastSide && side !== lastSide) transitions++;
    lastSide = side;
  }
  assert.equal(moves, hz * 12, 'clear combat lanes must not insert stationary aiming beats');
  assert.equal(transitions, 0, 'a clock-driven beat reversed the chosen sidestep');
}
const close = choosePlayerLikeBotMove({ id: 1, elapsed: .8, distance: 3 });
assert(close.forward < 0, 'crowded bot must make room');
const inRange = choosePlayerLikeBotMove({ elapsed: .8, distance: 30 });
assert.equal(inRange.forward, 0, 'visible in-range opponents must not cause a forward rush');
assert(inRange.strafe !== 0 && !inRange.sprint);
const outsideRange = choosePlayerLikeBotMove({ elapsed: .8, distance: 90, range: 80 });
assert(outsideRange.forward > 0 && outsideRange.strafe !== 0 && !outsideRange.sprint);
assert(choosePlayerLikeBotMove({ elapsed: .8, reloading: true }).forward < 0);
assert(Math.abs(choosePlayerLikeBotMove({ elapsed: .8, reacting: true }).strafe) <= 1);
assert.equal(choosePlayerLikeBotMove({ elapsed: .8, hasLineOfSight: false }).strafe, 0);
assert.deepEqual(choosePlayerLikeBotMove({ id: 1, elapsed: .8, strafeSide: 1 }),
  choosePlayerLikeBotMove({ id: 2, elapsed: 12, strafeSide: 1 }),
  'identity or elapsed time overrode the chosen steering side');
assert.notDeepEqual(choosePlayerLikeBotMove({ strafeSide: 1 }),
  choosePlayerLikeBotMove({ strafeSide: -1 }), 'steering cannot change the retained side');

const arena = { id: 'player-style', half: 80, killY: -20,
  noBaseFloor: false, spawns: [[0, 0, 0]], platforms: [], boxes: [],
  gravLifts: [], teleporters: [], pickups: [], groundHeightAt: () => 0,
  raycast: (_x, _y, _z, _dx, _dy, _dz, far) => far };
const room = new AuthRoom(arena);
const bot = room.players.get(room.addBot('Mover'));
const human = room.players.get(room.add(() => {}, 'Player'));
Object.assign(bot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
Object.assign(human.state, { px: 0, py: 0, pz: -12, onGround: 1 });
bot.invulnerableUntil = human.invulnerableUntil = 0;
bot._botAimYaw = 0;
room._damage(bot, human, 1, false);
let travel = 0, moving = 0, stopped = 0, shots = 0, peak = 0;
for (let tick = 0; tick < 12 * TICK_HZ; tick++) {
  human.health = 100; human.shield = 100;
  const before = [bot.state.px, bot.state.pz];
  room.update();
  const delta = Math.hypot(bot.state.px - before[0], bot.state.pz - before[1]);
  travel += delta; peak = Math.max(peak, delta * TICK_HZ);
  if (delta > .05) moving++; else stopped++;
  shots += room.events.filter(e => e.e === 'shot' && e.by === bot.id).length;
  assert.equal(bot._lastSprint, false, 'combat movement sprints while firing');
  assert.equal(bot._botDashTicks, 0, 'combat uses a free speed boost');
}
assert(travel > WALK_SPEED * 12 * .8 && travel <= WALK_SPEED * 12 + .1,
  `uncontrolled or stationary combat: ${travel}`);
assert(moving > 12 * TICK_HZ * .85 && stopped < 12 * TICK_HZ * .15,
  'clear-lane combat reintroduced periodic stationary aiming beats');
assert(peak <= WALK_SPEED + .05, `combat exceeds walking speed: ${peak}`);
assert(shots > 0, 'moving bot stopped shooting');

// A moving attacker cannot reset the bot's reaction on every hit.
bot.state.vx = 3;
room._damage(bot, human, 1, false);
assert.equal(bot.state.vx, 3, 'repeated hits pin the bot');

// A ledge can cancel/redirect the sidestep, never carry it into unsupported air.
arena.groundHeightAt = (x) => x > .2 ? -Infinity : 0;
Object.assign(bot.state, { px: 0, py: 0, pz: 0 });
const safe = room._botMoveInput(bot, { mx: 1, mz: 0, yaw: 0 });
assert(safe.mx <= 0, 'combat sidestep crosses a void');
arena.groundHeightAt = () => 0;

// Once sight is lost, do not chase the live hidden position or fire through cover.
room._botCanSee = () => false;
bot._botNextLosTick = 0;
bot._botLastSeenTick = room.tick;
bot.fireReq = null;
const remembered = {...bot._botLastSeen};
const unseen = room._driveBot(bot);
assert.equal(bot.fireReq, null, 'hidden opponents must not be fired at');
assert.deepEqual(bot._botLastSeen, remembered, 'search must use the remembered position');
room._resetBotAI(bot);
assert.equal(bot._botTargetId, null);
console.log(`Player-like bot checks passed: 12s duel, ${travel.toFixed(1)}m repositioning, ${moving} moving/${stopped} low-motion ticks, peak ${peak.toFixed(2)}m/s; reaction, cover, ledge and frame-rate checks.`);

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, data); } };
const bytes = fs.readFileSync(new URL('../public/ev-default.glb', import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
for (const hz of [30, 60, 144]) {
  const world = { arenaHalf: 80, killY: -20, groundHeightAt: () => 0,
    resolveCollisions() {}, raycastCollisionDistance: (_ray, far) => far };
  const local = new Bot(world, new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera();
  const target = { position: new THREE.Vector3(0, 0, -12), isDead: false };
  // Merely entering a clear firing lane must start the encounter.
  let moved = 0, still = 0, fired = 0;
  const triggerFire = local.mesh.userData.triggerFire;
  local.mesh.userData.triggerFire = (...args) => { fired++; triggerFire(...args); };
  for (let frame = 0; frame < hz * 6; frame++) {
    const before = local.position.clone();
    local.update(1 / hz, target, camera, () => {}, world);
    const delta = local.position.distanceTo(before);
    if (delta > .01) moved++; else still++;
    if (local._provoked) assert(delta * hz <= local.speed + .05, `offline combat exceeds sprint speed: ${delta * hz} at ${hz}Hz frame ${frame}`);
    assert.equal(local._dashT, 0);
  }
  assert(moved > hz * 5 && still < hz * .6, 'offline combat reintroduced forced aiming stops');
  // Count shots, not hits or the final magazine. An inaccurate bot may miss
  // every shot and finish reloading just before the final sample.
  assert(fired > 0, 'offline bot stopped firing');
  local.respawnAt(new THREE.Vector3());
  assert.equal(local._encounterTime, 0);
  disposeModel(local.mesh);
}
console.log('Offline real-rig bots passed at 30/60/144Hz: continuous combat footwork, live firing and respawn reset.');

// Mid-turn wall checks must not throw away a valid corridor destination.
const cornerArena = { ...arena, groundHeightAt: () => 0,
  raycast: (_x, _y, _z, dx, _dy, _dz, far) => Math.abs(dx) > .1 ? .2 : far };
const cornerRoom = new AuthRoom(cornerArena, { targetPopulation: 1 });
const cornerBot = [...cornerRoom.players.values()][0];
const destination = [0, 0, -25];
Object.assign(cornerBot, { _botRoamTarget: destination, _botRoamUntil: 1000,
  _botPatrolCheck: 1000, _botAimYaw: .65, _botNextRoamJump: Infinity });
Object.assign(cornerBot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
let recovered = 0;
cornerRoom._recoverBotPatrol = () => recovered++;
const cornerMove = cornerRoom._driveBot(cornerBot);
assert.equal(cornerMove.inp.mz, 0, 'mid-turn bot runs into a wall');
assert.equal(recovered, 0, 'mid-turn bot discarded a valid route');
assert.equal(cornerBot._botRoamTarget, destination);
assert(Math.abs(cornerBot._botAimYaw) < .65, 'turn did not converge');
console.log('Corner commitment passed: finish turning toward a clear route before replanning.');

// A visible opponent at 25m is already in rifle range: fire while strafing.
const chaseRoom = new AuthRoom(arena);
const chaser = chaseRoom.players.get(chaseRoom.addBot('Chaser'));
const runner = chaseRoom.players.get(chaseRoom.add(() => {}, 'Runner'));
chaser.invulnerableUntil = runner.invulnerableUntil = 0;
chaser._botAimYaw = 0;
chaser._botNextScanTick = 0;
let strafingShots = 0, lateralSteps = 0, closingSteps = 0;
for (let tick = 0; tick < 80; tick++) {
  Object.assign(runner.state, {px: chaser.state.px, py: 0, pz: chaser.state.pz - 25});
  runner.health = 100; runner.shield = 100;
  const z = chaser.state.pz;
  const x = chaser.state.px;
  chaseRoom.update();
  if (chaser.state.pz < z - .1) closingSteps++;
  const strafing = Math.abs(chaser.state.px - x) > .05;
  if (strafing) lateralSteps++;
  if (strafing) strafingShots += chaseRoom.events.filter(e => e.e === 'shot' && e.by === chaser.id).length;
  assert.equal(chaser._lastSprint, false, 'an in-range target caused a sprint rush');
}
assert.equal(closingSteps, 0, 'bot ran closer instead of holding useful rifle range');
assert(lateralSteps > 60, 'in-range bot failed to maintain lateral movement');
assert(strafingShots >= 8, 'bot must keep firing during actual lateral movement');
console.log('Ranged engagement passed: strafing shots=' + strafingShots + ', lateral ticks=' + lateralSteps);

// Exercise replicated facing against actual bullet segments during target turns.
const facingRoom = new AuthRoom(arena);
let facingSnapshot;
const facingHuman = facingRoom.players.get(facingRoom.add(m => {if(m.t === 'snapshot') facingSnapshot=m;}, 'Turning target'));
const facingBot = facingRoom.players.get(facingRoom.addBot('Tracking bot'));
facingHuman.invulnerableUntil = facingBot.invulnerableUntil = 0;
facingBot.wid = 'm4'; facingBot.mainWid = 'm4'; facingBot.mag = facingRoom._weaponState(facingBot,'m4').mag;
facingBot._botAimYaw = 0; facingBot._lastYaw = 0;
let alignedShots = 0;
for(let tick=0; tick<240; tick++) {
  const angle = Math.sin(tick / 35) * 1.2;
  Object.assign(facingHuman.state, {px:facingBot.state.px + Math.sin(angle)*18, py:0, pz:facingBot.state.pz-Math.cos(angle)*18});
  facingHuman.health=100; facingHuman.shield=100;
  facingRoom.update();
  const visible = facingSnapshot.players.find(p=>p.id===facingBot.id);
  for(const shot of facingRoom.events.filter(e=>e.e==='shot' && e.by===facingBot.id)) {
    const shotYaw=Math.atan2(-(shot.tx-shot.x),-(shot.tz-shot.z));
    const delta=Math.abs(Math.atan2(Math.sin(shotYaw-visible.yaw),Math.cos(shotYaw-visible.yaw)));
    assert(delta < .18, 'bullet must follow replicated body/barrel aim, not leave sideways: '+delta);
    assert.equal(visible.yaw,visible.aimYaw,'combat body and weapon aim diverged');
    alignedShots++;
  }
}
assert(alignedShots>=8,'turning scenario must exercise real fire '+JSON.stringify({alignedShots,state:facingBot._botState,alive:facingHuman.alive,wid:facingBot.wid,mag:facingBot.mag}));
console.log('Turning/strafe shot alignment passed: '+alignedShots+' shots.');
