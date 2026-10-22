#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { sampleDeathReaction } from '../src/sim/DeathReaction.js';
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
const dependencies = { THREE, sampleDeathReaction, DEATH_BODY_DURATION, DEATH_IMPACT_TIME,
  RESPAWN_DELAY: localDelay, performance: clock };
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
    _dropLifePickups() {}, _resetLoadoutHud() {},
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

console.log('Death timing passed: 6s human / 3s bot authority, 4.65s body view, monotonic clock, no death text/countdown, one impact and clean home reset.');
