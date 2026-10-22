#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DeathFollowCamera } from '../src/core/DeathFollowCamera.js';
import { BotManager } from '../src/entities/BotManager.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { AuthClient } from '../src/net/AuthClient.js';
import { createDeathReaction, sampleDeathReaction } from '../src/sim/DeathReaction.js';
import { DEATH_BODY_DURATION, DEATH_IMPACT_TIME, PLAYER_RESPAWN_DELAY } from '../src/sim/DeathTiming.js';

assert.equal(PLAYER_RESPAWN_DELAY, 6, 'human respawn must be three seconds longer');
assert.equal(DEATH_BODY_DURATION, 4.65, 'the body view must remain for three additional seconds');
assert(PLAYER_RESPAWN_DELAY > DEATH_BODY_DURATION, 'home must appear before automatic respawn');

const arena = { id: 'death-timing', half: 80, killY: -20, noBaseFloor: false,
  spawns: [[0, 0, 0]], platforms: [], boxes: [], gravLifts: [], teleporters: [], pickups: [],
  groundHeightAt: () => 0 };
for (const isBot of [false, true]) {
  const room = new AuthRoom(arena);
  room.matchStart = Date.now();
  const id = isBot ? room.addBot('RespawnBot') : room.add(() => {}, 'RespawnHuman');
  const actor = room.players.get(id);
  room._kill(actor);
  const delayTicks = (isBot ? 3 : PLAYER_RESPAWN_DELAY) * TICK_HZ;
  assert.equal(actor.deadUntil - room.tick, delayTicks, 'death assigned the wrong authoritative delay');
  for (let i = 1; i < delayTicks; i++) {
    room.update();
    assert.equal(actor.alive, false, `${isBot ? 'bot' : 'human'} respawned early at tick ${i}`);
    assert.equal(actor.health, 0, 'dead actor regained health');
    assert(!room.events.some(event => event.e === 'respawn' && event.id === id), 'early respawn event');
  }
  room.update();
  assert.equal(actor.alive, true, 'automatic respawn missed its exact tick');
  assert.equal(actor.health, 100);
  assert.equal(room.events.filter(event => event.e === 'respawn' && event.id === id).length, 1);
  assert.equal(actor.deathReaction, null, 'respawn retained the corpse state');
}

// Killer attribution must survive an omitted event: later snapshots carry it
// for the whole death, even after the shooter has left the room.
for (const kind of ['human', 'bot', 'self', 'environment']) {
  const client = new AuthClient('unused://death-timing');
  const snapshots = [];
  const room = new AuthRoom(arena);
  room.matchStart = Date.now();
  const id = room.add(message => {
    const serialized = JSON.stringify(message);
    if (message.t === 'snapshot') snapshots.push(JSON.parse(serialized));
    client._recv(serialized);
  }, 'Victim');
  const victim = room.players.get(id);
  const killerId = kind === 'human' ? room.add(() => {}, 'Killer')
    : kind === 'bot' ? room.addBot('KillerBot') : kind === 'self' ? id : null;
  const shooter = room.players.get(killerId);
  if (shooter) {
    Object.assign(shooter.state, { px: 7, py: 0, pz: -13 });
    shooter._lastYaw = .6;
    assert.equal(shooter.state.yaw, undefined, 'fixture must keep yaw in the real authoritative heading field');
  }
  const expected = shooter && shooter !== victim
    ? { id: killerId, x: 7, y: 0, z: -13, yaw: .6 } : null;
  room._kill(victim, shooter);
  room.update(); // Events were cleared by the new tick; only metadata remains.
  assert.equal(client.events.some(event => event.e === 'kill' && event.id === id), false);
  assert.deepEqual(client.self.deathReaction.killer, expected, `${kind} attribution lost without its kill event`);
  assert.deepEqual(snapshots.at(-1).players.find(player => player.id === id).deathReaction.killer, expected);
  if (shooter && shooter !== victim) {
    shooter.state.px = 70;
    room.remove(killerId);
  }
  room.update();
  assert.deepEqual(client.self.deathReaction.killer, expected, 'death attribution mutated with shooter movement/leave');
  while (room.tick < victim.deadUntil) room.update();
  assert.equal(client.self.alive, true);
  assert.equal(client.self.deathReaction, null, 'client kept killer metadata after automatic respawn');
}

// Execute the real Game methods without constructing WebGL, DOM or network
// services. A fake monotonic clock proves throttled rendering cannot shorten
// the death view, extend its deadline, or reveal a countdown/death message.
const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
const delayExpression = gameSource.match(/^const RESPAWN_DELAY = ([^;]+);/m)?.[1];
assert(delayExpression, 'local respawn configuration missing');
const localDelay = Function('PLAYER_RESPAWN_DELAY', `return ${delayExpression}`)(PLAYER_RESPAWN_DELAY);
assert.equal(localDelay, PLAYER_RESPAWN_DELAY, 'offline and online respawn delays diverged');

let now = 1000;
const clock = { now: () => now };
const dependencies = { THREE, DeathFollowCamera, createDeathReaction, sampleDeathReaction, DEATH_BODY_DURATION, DEATH_IMPACT_TIME,
  RESPAWN_DELAY: localDelay, performance: clock, triggerAction() {} };
function gameMethod(name) {
  const method = gameSource.match(new RegExp(`^  ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}`, 'm'))?.[0];
  assert(method, `Game.${name} missing`);
  return Function(...Object.keys(dependencies), `return function ${method.trim()}`)(...Object.values(dependencies));
}
function fakeGame() {
  const calls = { home: 0, hideHome: 0, deathSound: 0, impact: 0, hiddenOverlay: 0 };
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, .1, 300);
  camera.position.set(0, 1.7, 0);
  const unexpectedMessage = () => assert.fail('death showed a message or countdown');
  const game = { calls, deaths: 0, matchStats: { currentStreak: 0 }, _isDM: true,
    _isSurvival: false, _deathSide: 1, _deathCameraBasePos: new THREE.Vector3(),
    _dropLifePickups() {}, _resetLoadoutHud() {}, _spectatorPlayers() { return []; },
    player: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), camera,
      yaw: 0, baseFov: 70, setMaxShield() {} },
    world: { groundHeightAt: () => 0, raycastCollisionDistance: (_, length) => length },
    hud: { hideRespawn: () => calls.hiddenOverlay++, showRespawn: unexpectedMessage,
      addKillFeed: unexpectedMessage, showToast: unexpectedMessage },
    audio: { playDeath: () => calls.deathSound++, playAt: (_, play) => play(),
      playBodyImpact: () => calls.impact++ },
    menu: { centerPlay: { style: {} }, showMain: () => calls.home++, hideMain: () => calls.hideHome++ },
    weaponSystem: { resetMotionState() {} },
  };
  for (const name of ['_onPlayerDeath', '_onAuthoritativeDeath', '_beginDeathAnimation',
    '_applyDeathCamera', '_resetDeathAnimation', '_onAuthoritativeRespawn']) game[name] = gameMethod(name);
  return game;
}

for (const authoritative of [false, true]) {
  now = 1000;
  const game = fakeGame();
  if (authoritative) game._onAuthoritativeDeath({ deaths: 1 });
  else game._onPlayerDeath();
  assert.equal(game._respawnRemaining, PLAYER_RESPAWN_DELAY);
  assert.equal(game._respawnDeadline, authoritative ? 0 : now + PLAYER_RESPAWN_DELAY * 1000);
  for (const seconds of [0, 3, DEATH_BODY_DURATION - .001]) {
    now = 1000 + seconds * 1000;
    game._applyDeathCamera(1 / 60);
    assert.equal(game.calls.home, 0, 'home hid the body before the extended view elapsed');
    assert(Math.abs(game._deathAnimT - seconds) < 1e-9, 'death camera depends on clamped frame delta');
  }
  for (const seconds of [DEATH_BODY_DURATION, 5.2, PLAYER_RESPAWN_DELAY - .001]) {
    now = 1000 + seconds * 1000;
    game._applyDeathCamera(1 / 60);
    assert.equal(game.calls.home, 1, 'home should open once while awaiting automatic respawn');
    assert(game.player.camera.position.y > 0, 'extended death camera followed the unbounded fall below the ground');
  }
  assert.equal(game.calls.deathSound, 1);
  assert.equal(game.calls.impact, 1, 'extended view replayed the body impact');
  game._onAuthoritativeRespawn({ deaths: 1, maxShield: 0 });
  assert.equal(game._deathHomeShown, false);
  assert.equal(game.calls.hideHome, 1);
  assert.equal(game._respawnRemaining, 0);
  assert.equal(game._respawnDeadline, 0);
}

for (const authoritative of [false, true]) {
  now = 1000;
  const game = fakeGame();
  const killer = { id: 42, x: 12, y: 0, z: -16, yaw: .4 };
  const target = { ...killer, alive: true, ready: true };
  const bot = { id: killer.id, position: new THREE.Vector3(killer.x, killer.y, killer.z), yaw: killer.yaw, alive: true };
  game.botManager = { bots: [bot] };
  game._spectating = false;
  game._spectateMenu = false;
  game._followId = 'existing-spectator-target';
  game._playerSpectatorRig = { untouched: true };
  game.menuCamera = new THREE.PerspectiveCamera(60);
  game.menuCamera.position.set(40, 10, 30);
  game.menuCamera.rotation.set(.1, .2, .3);
  const spectatorPosition = game.menuCamera.position.clone();
  const spectatorRotation = game.menuCamera.quaternion.clone();
  if (authoritative) {
    game._authNet = { renderedRemotes: [target], client: { you: 11 },
      setSpectating: () => assert.fail('death camera changed server spectator membership') };
    game._onAuthoritativeDeath({ deaths: 1, deathReaction: { killer } });
  } else game._onPlayerDeath(bot.position, bot);
  assert.equal(game._deathFollow.killerId, killer.id, 'Game did not pass authoritative/local attacker attribution');
  now = 1799;
  game._applyDeathCamera(1 / 60);
  assert.equal(game._deathFollow.cameraReady, false, 'killer follow started before the brief body view');
  now = 1800;
  game._applyDeathCamera(1 / 60);
  assert.equal(game._deathFollow.cameraReady, true, 'killer follow did not start after .8 seconds');
  assert.notEqual(game.player.camera, game._deathFollow.camera, 'death follow reused the reconciled player camera');
  assert(game.player.camera.position.equals(game._deathFollow.camera.position), 'Game did not copy the private follow position');
  assert(game.player.camera.quaternion.equals(game._deathFollow.camera.quaternion), 'Game did not copy the private follow orientation');
  target.x += .2;
  bot.position.x += .2;
  // Network reconciliation writes the first-person pose every frame. The
  // independent follow rig must retain its own smoothing history across this.
  game.player.camera.position.set(-100, -100, -100);
  game.player.camera.quaternion.identity();
  now += 1000 / 60;
  game._applyDeathCamera(1 / 60);
  assert(game.player.camera.position.equals(game._deathFollow.camera.position));
  assert(game.player.camera.quaternion.equals(game._deathFollow.camera.quaternion));
  assert.equal(game._spectating, false);
  assert.equal(game._spectateMenu, false);
  assert.equal(game._followId, 'existing-spectator-target');
  assert.deepEqual(game._playerSpectatorRig, { untouched: true });
  assert(game.menuCamera.position.equals(spectatorPosition), 'death following moved the normal spectator camera');
  assert(game.menuCamera.quaternion.equals(spectatorRotation));
  game._onAuthoritativeRespawn({ deaths: 1, maxShield: 0 });
  assert.equal(game._deathFollow.active, false, 'automatic respawn retained killer following');
  assert.equal(game._deathFollow.killerId, null);
  assert.equal(game._deathFollow.lastTarget, null);
  assert.equal(game._deathFollow.cameraReady, false);
}

// Exercise the actual offline BotManager closure, Game callback wrapper and
// fatal-damage method together. Losing the third argument at either wrapper
// silently removes the killer camera even if _onPlayerDeath itself is correct.
{
  now = 1000;
  const game = fakeGame();
  game._onPlayerDamaged = gameMethod('_onPlayerDamaged');
  const damageCallback = gameSource.match(/this\._damageCallback = ([^\n]+);/)?.[1];
  assert(damageCallback, 'shared player damage callback missing');
  game._damageCallback = Function(`return ${damageCallback}`).call(game);
  game.player.takeDamage = () => { game.player.isDead = true; return true; };
  game.audio.playHurt = () => {};
  game.hud.flashDamage = () => {};
  game.hud.showDamageFrom = () => {};
  const bot = { id: 84, position: new THREE.Vector3(5, 0, -7), yaw: .9,
    alive: true, canNotice: () => true,
    update(_dt, _target, _camera, onDamage) { onDamage(100, this.position); } };
  const manager = new BotManager(null, game.world);
  manager.bots = [bot];
  manager.update(1 / 60, game.player, game.player.camera, game._damageCallback, game.world);
  assert.equal(game.player.isDead, true);
  assert.equal(game._deathFollow.active, true, 'offline fatal damage lost the attacker along its callback chain');
  assert.equal(game._deathFollow.killerId, bot.id);
  assert.deepEqual(game._deathReaction.killer,
    { id: bot.id, x: 5, y: 0, z: -7, yaw: .9 });
}

console.log('Death timing passed: 6s human / 3s bot authority, persistent killer metadata, .8s killer-follow handoff, 4.65s view, monotonic clock, silent UI, isolated spectator state and clean respawn.');
