import assert from 'node:assert/strict';
import { RESULTS_MS } from '../src/sim/MatchFlow.js';
import { PLAYER_RESPAWN_DELAY } from '../src/sim/DeathTiming.js';
import { AuthRoom, TICK_HZ } from './authroom.mjs';
import { IMPORTED_ARENAS } from './rookarena.mjs';
import { createState } from '../src/sim/MoveSim.js';
import { blastDamage } from '../src/sim/BlastDamage.js';
import { playableKillY } from '../src/world/PlayableBounds.js';
import { AuthClient } from '../src/net/AuthClient.js';
import { TeamRoom } from './teamroom.mjs';
import { SurvivalRoom } from './survivalroom.mjs';

const arena = { id: 'regression', name: 'Regression', half: 100, killY: -18,
  platforms: [], boxes: [], spawns: [[0, 0, 0], [15, 0, 0]], pickups: [],
  gravLifts: [], teleporters: [] };
const add = (room, name, readiness = false) => room.players.get(room.add(() => {}, name, readiness));
const ready = (room, player, override = {}) => room.onReady(player.id,
  { mapId: room.arena.id, matchStart: room.matchStart, ...override });

// Fast/slow clients, timeout, disconnect, late join, stale and repeated ACKs.
const room = new AuthRoom(arena);
const fast = add(room, 'Fast', true), slow = add(room, 'Slow', true);
ready(room, fast);
room._advanceRoundGate(room._readyDeadline - 1);
assert(room._roundWaiting && !room._canSimulate(fast));
room.onInput(fast.id, { seq: 1, mx: 1 });
room.onAbility(fast.id, { seq: 1, kind: 'frag' });
room.onFire(fast.id, { seq: 1, wid: 'm4' });
assert.equal(fast.queue.length, 0); assert(!fast.fireReq && !fast.abilityReq);
assert.equal(ready(room, slow, { matchStart: room.matchStart - 1 }), false);
room._advanceRoundGate(room._readyDeadline);
assert(!room._roundWaiting && room._canSimulate(fast) && !room._canSimulate(slow));
room._damage(slow, fast, 100, false); assert.equal(slow.health, 100);
ready(room, slow); assert(room._canSimulate(slow));
const protection = slow.invulnerableUntil;
room.tick += 5; ready(room, slow); assert.equal(slow.invulnerableUntil, protection);
const late = add(room, 'Late', true);
assert(!room._roundWaiting, 'mid-round joins must not pause everyone');
assert(!room._canSimulate(late));
room._beginRoundGate(); ready(room, fast); ready(room, slow); ready(room, late);
room._advanceRoundGate(room._readyDeadline - 9999);
assert(!room._roundWaiting, 'all-ready releases immediately');
room._beginRoundGate(); ready(room, fast); ready(room, slow); room.remove(late.id);
room._advanceRoundGate(room._readyDeadline - 9999);
assert(!room._roundWaiting, 'disconnected loaders cannot block the round');
const previousStart = room.matchStart, end = previousStart + room.matchDurationMs;
const frozenPosition = { ...fast.state };
room._rotateMatch(end);
assert(room._postMatchUntil === end + RESULTS_MS && room.matchStart === previousStart);
assert.deepEqual(fast.state, frozenPosition, 'round end moved the player');
room._advanceRoundGate(end + RESULTS_MS - 1);
assert(room._roundWaiting && !room._canSimulate(fast));
assert.equal(room._rotateMatch(end + RESULTS_MS - 1), false);
assert.equal(room._rotateMatch(end + RESULTS_MS), true);
assert(room._roundWaiting && fast.mapReady === false);
assert.equal(ready(room, fast, { matchStart: previousStart }), false);
ready(room, fast); ready(room, slow);
room._advanceRoundGate(end + RESULTS_MS + 1);
assert(!room._roundWaiting, 'ready players start after results and map decoding');

// Client prediction is also frozen; queued movement cannot leak into release.
const client = new AuthClient('unused');
client.connected = true; client.sim = createState(); client.simWorld = { ...arena, noBaseFloor: false };
client.roundGate = { waiting: true }; client.ws = { send() { assert.fail('sent input before release'); } };
client.sendInput({ mx: 1 }); assert.equal(client.pending.length, 0); assert.equal(client.sim.px, 0);

// Self damage works even during enemy spawn protection and absorbs shield first.
const explosions = new AuthRoom(arena);
const owner = add(explosions, 'Owner'); owner.state = createState(0, 0, 0);
owner.invulnerableUntil = 100000; owner.shield = 30;
explosions._explodeFrag({ by: owner.id, x: 0, y: .09, z: 0, kind: 'timebomb' });
assert.equal(owner.shield, 0); assert.equal(owner.health, 50);
assert.equal(owner.kills, 0); assert.equal(owner.score, 0);
assert.equal(explosions.events.find(e => e.e === 'explosion').r, 9);
for (const Room of [TeamRoom, SurvivalRoom]) {
  const r = new Room(arena), p = add(r, 'Self blast');
  p.state = createState(); p.invulnerableUntil = 100000;
  r._explodeFrag({ by: p.id, x: 0, y: .09, z: 0 });
  assert.equal(p.alive, false, `${Room.name}: point-blank frag must kill its owner, including during spawn protection`);
  assert.equal(p.damageDealt || 0, 0, 'self damage must not farm damage stats');
}

const openRay = (...args) => args.at(-1);
const standing = createState(0, 0, 0);
assert.equal(blastDamage({ x: 0, y: .09, z: 0 }, standing, 9, 80, .25, openRay), 80);
assert.equal(blastDamage({ x: 20, y: 0, z: 0 }, standing, 9, 80, .25, openRay), 0);
assert.equal(blastDamage({ x: 3, y: .1, z: 0 }, standing, 9, 80, .25, () => .8), 0,
  'solid cover must still stop blast damage');
assert(blastDamage({ x: 3, y: .1, z: 0 }, standing, 9, 80, .25,
  (_x, _y, _z, _dx, dy, _dz, far) => dy < .15 ? far : .8) > 0,
  'exposed legs must be hit even when the chest is occluded');

// Real requests produce moving grenades; standing on the landing spot hurts.
const grenades = new AuthRoom(arena);
const thrower = add(grenades, 'Thrower'); thrower.state = createState(0, 0, 0);
thrower.invulnerableUntil = 100000;
grenades.onAbility(thrower.id, { seq: 1, kind: 'frag', yaw: 0, pitch: -Math.PI / 2 });
grenades.update(); assert.equal(grenades.projectiles.length, 1);
assert(grenades.projectiles[0].vy < 0);
let blast;
for (let i = 0; i < 53; i++) {
  grenades.update(); blast ||= grenades.events.find(e => e.e === 'explosion');
}
assert(blast && Math.abs(blast.z) < .01 && blast.y >= .07);
assert(thrower.health < 100, 'grenade at own feet caused no self damage');
assert.equal(thrower.abilities.frag, 1);

// Rockets damage on impact, not when fired. Direct and splash use one event.
const rockets = new AuthRoom(arena);
const shooter = add(rockets, 'Rocket'), target = add(rockets, 'Target');
shooter.state = createState(0, 0, 0); target.state = createState(0, 0, -6);
target.invulnerableUntil = 0; shooter.matchWeapons.add('rpg'); shooter.wid = 'rpg';
rockets.onFire(shooter.id, { seq: 1, wid: 'rpg', yaw: 0, pitch: 0 });
rockets.update(); assert.equal(target.health, 100); assert.equal(rockets.projectiles.length, 1);
let rocketBlast;
for (let i = 0; i < 8; i++) { rockets.update(); rocketBlast ||= rockets.events.find(e => e.e === 'explosion'); }
assert(target.health < 100 && rocketBlast); assert.equal(rocketBlast.r, 9);
assert(rocketBlast.z > -6 && rocketBlast.z < -4);

// Every real map kills a falling player before decorative foundations or the
// former -100 sentinel can strand them. Normal death/respawn handles recovery.
for (const actualArena of IMPORTED_ARENAS) {
  const r = new AuthRoom(actualArena), p = add(r, 'Faller');
  assert.equal(actualArena.killY, playableKillY(actualArena.spawns));
  // Imported arenas can have playable floors below world Y=-30.
  const lowestSpawn = Math.min(...actualArena.spawns.map(spawn => spawn[1]));
  assert(Number.isFinite(actualArena.killY));
  assert(lowestSpawn > actualArena.killY && lowestSpawn - actualArena.killY <= 20);
  const spawn = actualArena.spawns[0];
  p.state = createState(...spawn); p.state.py = actualArena.killY - 1;
  r.update(); assert.equal(p.alive, false); assert.equal(p.deaths, 1);
  assert(r.events.some(e => e.e === 'kill' && e.wid === 'void'));
  for (let i = 0; i < TICK_HZ * PLAYER_RESPAWN_DELAY; i++) r.update();
  assert(p.alive && p.state.py > actualArena.killY);
}
console.log('Gameplay regression passed: synchronized readiness/10s cap/late joins, no stale ACKs, protected loaders, self blast/shields/cover, server projectile impacts and real-map void respawns');
