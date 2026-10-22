import assert from 'node:assert/strict';
import { Player } from '../src/player/Player.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { HEALTH_REGEN_DELAY, HEALTH_REGEN_RATE } from '../src/core/CombatConfig.js';
import { createState, isSprinting, makeInput, step } from '../src/sim/MoveSim.js';
import { PLAYER_SPRINT_SECONDS } from '../src/sim/MovementConfig.js';

const local = new Player(1);
local.takeDamage(40);
for (let i = 0; i < TICK_HZ * HEALTH_REGEN_DELAY - 1; i++) {
  local.updateHealthRegen(1 / TICK_HZ);
}
assert.equal(local.health, 60, 'local health regenerated before five damage-free seconds');
local.updateHealthRegen(1 / TICK_HZ);
assert.equal(local.health, 60 + HEALTH_REGEN_RATE / TICK_HZ,
  'local health did not start regenerating after five seconds');

const room = new AuthRoom();
const attackerId = room.add(() => {}, 'Attacker');
const targetId = room.add(() => {}, 'Target');
const attacker = room.players.get(attackerId);
const target = room.players.get(targetId);
target.invulnerableUntil = 0;
room._damage(target, attacker, 40, false);
for (let i = 0; i < TICK_HZ * HEALTH_REGEN_DELAY - 1; i++) room.update();
assert.equal(target.health, 60, 'authoritative health regenerated before five damage-free seconds');
room.update();
assert.equal(target.health, 60 + HEALTH_REGEN_RATE / TICK_HZ,
  'authoritative health did not start regenerating after five seconds');

room._damage(target, attacker, 5, false);
room.update();
assert.equal(target.health, 55.5, 'new damage did not reset the authoritative regen delay');

const flatWorld = { half: 100, killY: -20, platforms: [], boxes: [], gravLifts: [], teleporters: [] };
const sprintInput = makeInput({ mz: 1, sprint: true });
let sprintState = createState();
let sprintTicks = 0;
while (isSprinting(sprintState, sprintInput) && sprintTicks < 1000) {
  sprintState = step(sprintState, sprintInput, flatWorld);
  sprintTicks++;
}
assert.equal(PLAYER_SPRINT_SECONDS, 10.5, 'player did not receive the requested three extra sprint seconds');
assert.ok(Math.abs(sprintTicks / TICK_HZ - PLAYER_SPRINT_SECONDS) <= 1 / TICK_HZ,
  `actual sprint duration ${sprintTicks / TICK_HZ}s does not match ${PLAYER_SPRINT_SECONDS}s`);

console.log(`regen/stamina passed: ${HEALTH_REGEN_DELAY}s health delay, ${HEALTH_REGEN_RATE} HP/s, ${PLAYER_SPRINT_SECONDS}s sprint`);
