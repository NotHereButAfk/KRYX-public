import assert from 'node:assert/strict';
import { updateWeaponSprintBlock, sprintRequested } from '../src/core/GameplayInput.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { WALK_SPEED, SPRINT_MULT, FIRE_SPRINT_RECOVERY } from '../src/sim/MovementConfig.js';
import { AuthRoom } from '../server/authroom.mjs';

const arena = { id: 'sprint-fire-proof', half: 100, platforms: [], boxes: [],
  spawns: [[0, 0, 0]], pickups: [], gravLifts: [], teleporters: [] };
for (const weapon of WEAPONS) {
  const gun = weapon.kind !== 'melee';
  for (const fps of [30, 60, 144]) {
    for (const key of ['ShiftLeft', 'ShiftRight', 'mobile']) {
      const input = { mouseDown: true, isMobile: key === 'mobile', isDown: k => k === key };
      const player = { isSprinting: true };
      updateWeaponSprintBlock(player, input, weapon.id, 1 / fps);
      assert.equal(sprintRequested(input, 1, player.weaponSprintBlocked), !gun, `${weapon.id}: ${key}`);
      if (gun) assert.equal(player.isSprinting, false, 'trigger must immediately leave sprint');
      for (let frame = 0; frame < fps; frame++) updateWeaponSprintBlock(player, input, weapon.id, 1 / fps);
      assert.equal(player.weaponSprintBlocked, gun, 'held trigger stays in walking stance');
      input.mouseDown = false;
      for (let frame = 0; frame <= Math.ceil(FIRE_SPRINT_RECOVERY * fps); frame++) {
        updateWeaponSprintBlock(player, input, weapon.id, 1 / fps);
      }
      assert.equal(sprintRequested(input, 1, player.weaponSprintBlocked), true, 'sprint can resume after recovery');
    }
  }

  // A client still claiming sprint on the firing tick cannot keep sprint speed.
  for (const fireFirst of [false, true]) {
    const room = new AuthRoom(arena, { targetPopulation: 1 });
    room._rotateMatch = () => false;
    const id = room.add(() => {}, 'Shooter');
    const p = room.players.get(id);
    p.wid = weapon.id;
    p.matchWeapons.add(weapon.id);
    const input = seq => room.onInput(id, { seq, wid: weapon.id, mz: 1, sprint: true, yaw: 0, pitch: 0 });
    input(1); room.update();
    assert.ok(Math.abs(Math.hypot(p.state.vx, p.state.vz) - WALK_SPEED * SPRINT_MULT) < .002);
    const before = room._weaponState(p, weapon.id).mag;
    const fire = () => room.onFire(id, { seq: 1, wid: weapon.id, yaw: 0, pitch: 0 });
    if (fireFirst) fire();
    input(2);
    if (!fireFirst) fire();
    room.update();
    assert.equal(p._lastSprint, !gun, `${weapon.id}: same-tick sprint flag`);
    assert.ok(Math.abs(Math.hypot(p.state.vx, p.state.vz) - WALK_SPEED * (gun ? 1 : SPRINT_MULT)) < .002,
      `${weapon.id}: shots must run at walking speed`);
    if (gun) assert.ok(p.mag < before, `${weapon.id}: cancelling sprint must not swallow the shot`);
    for (let seq = 3; seq <= 8; seq++) {
      input(seq); room.update();
      assert.equal(p._lastSprint, !gun, `${weapon.id}: queued sprint during recovery`);
    }
    for (let seq = 9; seq <= 12; seq++) { input(seq); room.update(); }
    assert.equal(p._lastSprint, true, `${weapon.id}: recovery must not latch sprint off`);
  }
}
const player = {};
updateWeaponSprintBlock(player, { mouseDown: true }, 'm4', .016);
updateWeaponSprintBlock(player, { mouseDown: true }, 'sword', .016);
assert.equal(player.weaponSprintBlocked, false, 'sword attacks preserve melee movement');
player.isDead = true;
updateWeaponSprintBlock(player, { mouseDown: true }, 'm4', .016);
assert.equal(player.weaponSprintBlocked, false, 'death clears firing recovery');
console.log('Sprint/fire passed: every firearm cancels sprint before movement and still fires; walking, recovery, melee, mobile and packet order verified.');

// Holding aim must lower sprint before simulation for every pickup firearm.
for (const id of ['m4', 'concussion', 'rpg', 'levershotgun']) {
  const p = {isSprinting:true,isDead:false};
  const aim = {mouseDown:false,rightMouseDown:true,isDown:()=>true};
  updateWeaponSprintBlock(p,aim,id,1/60);
  assert(p.weaponSprintBlocked && !p.isSprinting, id+' aim must interrupt sprint');
  assert(!sprintRequested(aim,1,p.weaponSprintBlocked),id+' aim must suppress movement sprint');
}
