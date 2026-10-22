import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STAMINA_MAX, WALK_SPEED, SPRINT_MULT } from '../src/sim/MovementConfig.js';
import {
  BOT_DASH,
  BOT_TACTICS,
  BOT_RETALIATION_AIM_SCALE,
  BOT_DIFFICULTIES,
  BOT_STATES,
  advanceBotMagazine,
  advanceBurst,
  botAimErrorMeters,
  botArenaDetectionDistance,
  botDashBonusSpeed,
  botLoadoutForId,
  botSeparationVector,
  combatTargetScore,
  chooseCombatSteering,
  chooseReachableRoamPoint,
  getBotDifficulty,
  isBotDashLaneSafe,
  isInsideBotFov,
  smoothBotAim,
} from '../src/entities/BotCombat.js';
import { BotManager } from '../src/entities/BotManager.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';

assert.ok(BOT_DIFFICULTIES.easy.reactionMin > BOT_DIFFICULTIES.hard.reactionMin);
assert.ok(BOT_DIFFICULTIES.easy.aimErrorScale > BOT_DIFFICULTIES.hard.aimErrorScale);
assert.ok(BOT_DIFFICULTIES.easy.detectionDistance < BOT_DIFFICULTIES.hard.detectionDistance);
assert.ok(BOT_DIFFICULTIES.easy.movementSpeed < BOT_DIFFICULTIES.hard.movementSpeed);
assert.equal(getBotDifficulty('missing'), BOT_DIFFICULTIES.normal);
assert.ok(botArenaDetectionDistance(BOT_TACTICS.detectRadius) > BOT_TACTICS.detectRadius,
  'bot opponents do not receive enough arena awareness to find each other');
assert.ok(botArenaDetectionDistance(100) <= 82,
  'bot opponent awareness grew beyond its performance/safety cap');
assert.equal(isInsideBotFov(0, 0, -10, 90), true);
assert.equal(isInsideBotFov(0, 0, 10, 90), false);
assert.ok(Math.abs(smoothBotAim(0, Math.PI, 4, 0.05)) < Math.PI,
  'aim smoothing must turn toward a target without snapping');
const wrappedTurn = smoothBotAim(-3, 3, 4, 0.05) + 3;
assert(wrappedTurn < 0 && wrappedTurn > -0.1, 'bot took the long turn across the angle boundary');
console.log('ok   difficulty presets change reaction, accuracy, movement decisions, detection and aim speed');

let roamSeed = 17;
const reachableRoam = chooseReachableRoamPoint({
  x: 0, y: 0, z: 0, half: 60, killY: -20,
  random: () => ((roamSeed = (roamSeed * 16807) % 2147483647) - 1) / 2147483646,
  groundHeightAt: () => 0,
  raycast: (_ox, _oy, _oz, _dx, _dy, _dz, far) => far,
});
assert.ok(reachableRoam && Math.hypot(reachableRoam[0], reachableRoam[2]) >= 8,
  'roam planner did not choose a meaningful running lane');
const blockedRoam = chooseReachableRoamPoint({
  x: 0, y: 0, z: 0, half: 60, killY: -20,
  groundHeightAt: () => 0,
  raycast: () => 0.5,
});
assert.equal(blockedRoam, null, 'roam planner selected a lane through a wall');
console.log('ok   roaming selects long walkable lanes and rejects wall-blocked targets');

assert.ok(botDashBonusSpeed(BOT_DASH.duration) > botDashBonusSpeed(0.05),
  'dash burst does not ease down from its initial acceleration');
assert.equal(isBotDashLaneSafe({
  x: 0, y: 0, z: 0, dx: 1, dz: 0,
  groundHeightAt: () => 0,
  raycast: (_ox, _oy, _oz, _dx, _dy, _dz, far) => far,
}), true, 'clear grounded lane rejected a bot dash');
assert.equal(isBotDashLaneSafe({
  x: 0, y: 0, z: 0, dx: 1, dz: 0,
  groundHeightAt: () => 0,
  raycast: () => 1,
}), false, 'wall-blocked lane allowed a bot dash');
assert.equal(isBotDashLaneSafe({
  x: 0, y: 0, z: 0, dx: 1, dz: 0,
  groundHeightAt: (x) => x > 3 ? -100 : 0,
  raycast: (_ox, _oy, _oz, _dx, _dy, _dz, far) => far,
}), false, 'unsupported lane allowed a bot dash over an edge');
console.log('ok   bot dashes accelerate on clear lanes and reject walls and ledges');

const personalSpace = botSeparationVector({
  x: 0, z: 0, id: 1,
  neighbors: [{ id: 2, isBot: true, alive: true, position: { x: 1, z: 0 } }],
});
assert.ok(personalSpace.x < -0.95 && Math.abs(personalSpace.z) < 0.05,
  'personal-space steering did not push away from a nearby bot');
assert.ok(personalSpace.strength > 0.5,
  'personal-space steering was too weak to split a close bot cluster');
console.log('ok   nearby bots receive stable personal-space steering');

const cases = [
  {
    name: 'ranged closes from outside its orbit',
    input: { distance: BOT_TACTICS.rangedOrbitDistance + 4, hasLineOfSight: true },
    check: (s) => s.mode === 'close' && s.forward > 0 && s.strafe !== 0,
  },
  {
    name: 'ranged circles while it has a useful firing lane',
    input: { distance: 9, hasLineOfSight: true, strafeSign: -1 },
    check: (s) => s.mode === 'orbit' && Math.abs(s.forward) < 0.2
      && s.strafe < -0.6 && s.strafe > -0.8,
  },
  {
    name: 'ranged creates room when crowded',
    input: { distance: 3, hasLineOfSight: true },
    check: (s) => s.mode === 'retreat' && s.forward < 0 && s.strafe > 0,
  },
  {
    name: 'lost target is pursued rather than shot through cover',
    input: { distance: 8, hasLineOfSight: false },
    check: (s) => s.mode === 'pursue' && s.forward === 1,
  },
  {
    name: 'melee keeps closing instead of orbiting at rifle range',
    input: { distance: 8, hasLineOfSight: true, melee: true },
    check: (s) => s.mode === 'rush' && s.forward === 1,
  },
];

for (const c of cases) {
  const steering = chooseCombatSteering(c.input);
  assert.ok(c.check(steering), `${c.name}: ${JSON.stringify(steering)}`);
  console.log(`ok   ${c.name}`);
}

const randoms = [0, 0.5];
let ri = 0;
const continueBurst = advanceBurst(3, () => randoms[ri++ % randoms.length]);
assert.equal(continueBurst.shotsRemaining, 2);
assert.equal(continueBurst.burstPause, false);

const pauseBurst = advanceBurst(1, () => randoms[ri++ % randoms.length]);
assert.ok(pauseBurst.shotsRemaining >= 2 && pauseBurst.shotsRemaining <= 4);
assert.equal(pauseBurst.burstPause, true);
assert.ok(pauseBurst.delayScale > continueBurst.delayScale);
console.log('ok   ranged fire uses short bursts with a readable pause');

const lobbyLoadouts = Array.from({ length: 8 }, (_, i) => botLoadoutForId(i + 1));
assert.equal(lobbyLoadouts.filter(Boolean).length, 7, 'eight-slot lobby should contain one blade bot');
assert.deepEqual(lobbyLoadouts.slice(0, 5).map((w) => w?.id || 'sword'),
  ['m4', 'battlerifle', 'plasmarifle', 'uzi', 'sword']);
assert.ok(lobbyLoadouts.filter(Boolean).every((w) =>
  w.magSize > 0 && w.reloadTime > 0 && w.damage > 0 && w.range > 0));
console.log('ok   full lobby receives varied weapons with finite magazines and reloads');

const rifleRole = botLoadoutForId(1);
let magazine = { ammo: rifleRole.magSize, reloadRemaining: 0 };
for (let i = 0; i < rifleRole.magSize; i++) {
  magazine = advanceBotMagazine(magazine.ammo, magazine.reloadRemaining, 0, rifleRole, true);
}
assert.equal(magazine.ammo, 0);
assert.equal(magazine.reloadRemaining, rifleRole.reloadTime, 'empty bot magazine did not start reload');
magazine = advanceBotMagazine(magazine.ammo, magazine.reloadRemaining, rifleRole.reloadTime - 0.01, rifleRole);
assert.equal(magazine.ammo, 0, 'bot magazine refilled before reload completed');
magazine = advanceBotMagazine(magazine.ammo, magazine.reloadRemaining, 0.02, rifleRole);
assert.equal(magazine.ammo, rifleRole.magSize, 'bot magazine did not refill after reload');
assert.equal(magazine.reloadRemaining, 0);
console.log('ok   finite bot magazines block fire until weapon-specific reload completes');

assert.ok(botAimErrorMeters(20, 1.15) < 0.8, '20m bot scatter is still too inaccurate');
assert.ok(botAimErrorMeters(40, 1.15) < 1.25, '40m bot scatter is still too inaccurate');
assert.ok(botAimErrorMeters(20, 0.8) > 0.4, 'bots became perfect aim-locks');
const returnFireScatter = botAimErrorMeters(20, BOT_DIFFICULTIES.normal.aimErrorScale * BOT_RETALIATION_AIM_SCALE);
assert.ok(returnFireScatter > 0.8 && returnFireScatter < 1.1,
  'return fire should pressure exposed players without becoming an aim lock');
console.log('ok   bot aim is lethal but retains real world-space scatter');

const player = {
  position: new THREE.Vector3(100, 0, 0),
  health: 100,
  isDead: false,
};
const makeFakeBot = (x) => ({
  position: new THREE.Vector3(x, 0, 0),
  alive: true,
  isDead: false,
  _targetScanT: 0,
  health: 100,
  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) this.alive = false;
    return !this.alive;
  },
  update(_dt, target, _camera, attack) {
    this.observedTarget = target;
    if (this.shouldFire) attack(10, this.position);
  },
});
const nearBot = makeFakeBot(0);
const otherBot = makeFakeBot(5);
nearBot.shouldFire = true;
nearBot._provoked = true;
nearBot._targetEntity = otherBot;
const manager = new BotManager(null, null);
manager.bots = [nearBot, otherBot];
manager.update(0.1, player, null, (damage) => { player.health -= damage; }, null);
assert.equal(nearBot._targetEntity, otherBot, 'nearby bot should be selected');
assert.equal(otherBot.health, 90, 'bot should damage another bot');
assert.equal(player.health, 100, 'damage must go to the selected opponent');
console.log('ok   arena bots select and damage nearby opponents');

const pressureBot = makeFakeBot(0);
pressureBot.id = 3;
pressureBot.shouldFire = false;
const pressureRival = makeFakeBot(8);
player.position.set(12, 0, 0);
player.health = 100;
const pressureManager = new BotManager(null, null);
pressureManager.bots = [pressureBot, pressureRival];
pressureManager.update(0.1, player, null, (damage) => { player.health -= damage; }, null);
assert.equal(pressureBot._targetEntity, pressureRival, 'nearer bot should be considered');
assert.equal(pressureRival.health, 100, 'unprovoked bot damaged another neutral bot');
assert.equal(player.health, 100, 'unprovoked bot damaged the neutral human');
player.position.set(2, 0, 0);
pressureBot._provokedByPlayer = true;
pressureBot.shouldFire = true;
pressureBot._targetEntity = null;
pressureBot._targetScanT = 0;
pressureManager.update(0.1, player, null, (damage) => { player.health -= damage; }, null);
assert.equal(pressureBot.observedTarget, player, 'provoked bot did not retaliate against the human');
assert.equal(player.health, 90, 'provoked bot could not damage the human');
console.log('ok   visible humans are eligible targets before provocation');

const aiArena = {
  id: 'bot-ai', name: 'Bot AI', region: 'test', half: 80, killY: -20,
  noBaseFloor: false, platforms: [], boxes: [], gravLifts: [], teleporters: [],
  spawns: [[0, 0, 0], [0, 0, -12], [8, 0, -10]],
  callouts: [{ x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: 20 }],
  groundHeightAt: () => 0,
  raycast: (_ox, _oy, _oz, _dx, _dy, _dz, far) => far,
};
const aiRoom = new AuthRoom(aiArena, { botDifficulty: 'easy' });
const humanId = aiRoom.add(() => {}, 'Human');
const botId = aiRoom.addBot('Responder');
const rivalId = aiRoom.add(() => {}, 'Rival');
const human = aiRoom.players.get(humanId);
const bot = aiRoom.players.get(botId);
const rival = aiRoom.players.get(rivalId);
Object.assign(human.state, { px: 0, py: 0, pz: -12 });
Object.assign(bot.state, { px: 0, py: 0, pz: 0 });
Object.assign(rival.state, { px: 8, py: 0, pz: -10 });
human.invulnerableUntil = bot.invulnerableUntil = rival.invulnerableUntil = 0;
for (let i = 0; i < TICK_HZ * 2; i++) aiRoom.update();
assert.equal(bot._botTargetId, human.id, 'visible human was not acquired on sight');
assert.equal(bot._botState, BOT_STATES.ENGAGE);
// Test visible retaliation independently of how far the patrol moved.
aiRoom._resetBotAI(bot);
Object.assign(bot.state, { px: 0, py: 0, pz: 0 });
bot._botAimYaw = 0;
aiRoom._damage(bot, human, 1, false);
assert.equal(bot._botTargetId, human.id, 'damage did not immediately select the attacker');
assert.equal(bot._botState, BOT_STATES.REACT);
assert.ok(bot._botReactionUntil > aiRoom.tick, 'difficulty reaction delay was skipped');
const retaliationCommand = aiRoom._driveBot(bot);
assert.equal(retaliationCommand.inp.mx, 0, 'provoked bot strafed instead of holding ground');
assert.equal(retaliationCommand.inp.mz, 0, 'provoked bot chased instead of holding ground');
assert.ok(!retaliationCommand.inp.sprint, 'provoked bot sprinted while holding ground');
assert.ok(!retaliationCommand.inp.jumpJust, 'provoked bot jumped while holding ground');
assert.equal(retaliationCommand.botDash, false, 'provoked bot dashed while holding ground');
aiRoom._damage(bot, rival, 1, false);
assert.equal(bot._botTargetId, rival.id, 'a new attacker did not force a target switch');
assert.equal(bot._botHoldGroundTargetId, rival.id, 'new attacker did not become the stationary retaliation target');
aiRoom._resetBotAI(bot);
assert.equal(bot._botState, BOT_STATES.ROAM);
assert.equal(bot._botTargetId, null);
assert.equal(bot._botHostility.size, 0, 'respawn reset retained hostility');
assert.equal(bot._botDashTicks, 0, 'respawn reset retained an active dash');
assert.equal(bot._botHoldGroundTargetId, null, 'respawn reset retained stationary retaliation');
console.log('ok   authoritative states enforce on-sight engagement, reaction delay, attacker switching, and respawn reset');

const spacingRoom = new AuthRoom(aiArena, { botDifficulty: 'normal' });
const spacingLeftId = spacingRoom.addBot('Spacing Left');
const spacingRightId = spacingRoom.addBot('Spacing Right');
const spacingLeft = spacingRoom.players.get(spacingLeftId);
const spacingRight = spacingRoom.players.get(spacingRightId);
Object.assign(spacingLeft.state, { px: -0.25, py: 0, pz: 0 });
Object.assign(spacingRight.state, { px: 0.25, py: 0, pz: 0 });
const leftMove = spacingRoom._separateBotMove(spacingLeft, 0, 1, 0);
const rightMove = spacingRoom._separateBotMove(spacingRight, 0, 1, 0);
assert.ok(leftMove[0] < -0.35 && rightMove[0] > 0.35,
  'authoritative bots did not steer to opposite sides of a cluster');
console.log('ok   authoritative bot pairs split apart instead of sharing a lane');

const roamRoom = new AuthRoom(aiArena, { targetPopulation: 1, botDifficulty: 'normal' });
const roamingBot = [...roamRoom.players.values()][0];
const roamStart = [roamingBot.state.px, roamingBot.state.pz];
let roamingAirTicks = 0;
let roamingSprintTicks = 0;
let roamingDashTicks = 0;
let roamingPeakSpeed = 0;
let roamingFurthest = 0;
for (let i = 0; i < TICK_HZ * 8; i++) {
  roamRoom.update();
  roamingFurthest = Math.max(roamingFurthest, Math.hypot(roamingBot.state.px-roamStart[0], roamingBot.state.pz-roamStart[1]));
  if (!roamingBot.state.onGround) roamingAirTicks++;
  if (roamingBot._lastSprint) roamingSprintTicks++;
  if (roamingBot._botDashTicks > 0) roamingDashTicks++;
  roamingPeakSpeed = Math.max(roamingPeakSpeed, Math.hypot(roamingBot._animVX, roamingBot._animVZ));
}
// Returning near the spawn after a patrol is not being trapped there.
assert.ok(roamingFurthest > 12,
  'single roaming bot remained trapped in its spawn area');
assert.ok(roamingAirTicks < TICK_HZ * 2, 'roaming bot bunny-hopped instead of running');
assert.ok(roamingBot.state.stamina < STAMINA_MAX, 'roaming bot must consume stamina');
assert.ok(roamingSprintTicks > TICK_HZ * 4, 'roaming bot did not sustain its run around the map');
assert.equal(roamingDashTicks, 0, 'ordinary patrol secretly boosts above player speed');
assert.ok(roamingPeakSpeed <= WALK_SPEED * SPRINT_MULT + 0.05,
  `roaming bot exceeds player sprint speed (${roamingPeakSpeed.toFixed(2)}m/s)`);
console.log(`ok   an idle authoritative bot runs beyond spawn at player speed (peak ${roamingPeakSpeed.toFixed(2)}m/s)`);

// Exercise exhaustion and recovery through the authoritative movement step.
const staminaRoom = new AuthRoom(aiArena, {targetPopulation: 1});
const staminaBot = [...staminaRoom.players.values()][0];
staminaRoom._driveBot = p => ({seq: ++p.lastInputSeq, inp: {mx:0,mz:1,yaw:0,sprint:1}, wid:p.wid});
let exhausted = false, recovered = false;
for (let i=0;i<TICK_HZ*25;i++) {
  staminaRoom.update();
  if (staminaBot._botStaminaRecovering) {
    exhausted = true;
    assert.ok(Math.hypot(staminaBot.state.vx,staminaBot.state.vz) <= WALK_SPEED+.01, 'exhausted bot must walk');
  } else if (exhausted) { recovered = true; break; }
}
assert.ok(exhausted && recovered, 'bot must exhaust stamina, recover while walking, then sprint again');
console.log('ok   bots drain player stamina and recover before sprinting again');

const loadRoom = new AuthRoom(aiArena, { targetPopulation: 8, botDifficulty: 'normal' });
const loadStarted = performance.now();
let botShots = 0;
for (let i = 0; i < 1200; i++) {
  loadRoom.update();
  botShots += loadRoom.events.filter(e => e.e === 'shot').length;
}
const averageTickMs = (performance.now() - loadStarted) / 1200;
const autonomousBotKills = [...loadRoom.players.values()].reduce((sum, bot) => sum + bot.kills, 0);
assert(botShots > 0, 'authoritative bots must fire at each other');
assert.equal(loadRoom.players.size, 4, 'arena bot cap');
assert(autonomousBotKills > 0, 'bots should earn kills against each other');
const [friendlyA, friendlyB] = [...loadRoom.players.values()];
friendlyB.alive = true; friendlyB.health = 100;
friendlyB.invulnerableUntil = 0;
loadRoom._damage(friendlyB, friendlyA, 1000, false);
assert.equal(friendlyB.health, 0, 'bot attacks must damage opponents');

assert.ok(averageTickMs < 5,
  `four-bot decisions exceeded the server budget (${averageTickMs.toFixed(2)}ms/tick)`);
assert.ok([...loadRoom.players.values()].every((entry) => entry.isBot
  && (!entry.alive || entry._botNextScanTick > loadRoom.tick - 20)),
  'bot scans are not timer-throttled');
console.log(`ok   four bots throttle scans/LOS/decisions (${averageTickMs.toFixed(3)}ms per 20Hz tick)`);
console.log(`ok   autonomous server bots fight one another (${autonomousBotKills} kills in one simulated minute)`);

console.log('\nall bot combat checks passed');
