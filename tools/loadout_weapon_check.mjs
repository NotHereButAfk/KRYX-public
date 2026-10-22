#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  MAIN_WEAPON_IDS,
  MATCH_PICKUP_WEAPON_IDS,
  isMainWeaponId,
  isMatchPickupWeaponId,
} from '../src/weapons/weaponDefs.js';
import { AUTHORED_WEAPON_BY_KIND, randomLootSpecs } from '../src/world/PickupLayout.js';
import { MAX_PICKUP_SHIELD, SHIELD_PER_STACK } from '../src/core/ShieldConfig.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { PLAYER_RESPAWN_DELAY } from '../src/sim/DeathTiming.js';
import { WeaponSystem } from '../src/weapons/WeaponSystem.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { HUD } from '../src/ui/HUD.js';

// Run the actual switch, then the HUD reconciliation: removal must update the
// visible inventory even when prediction removed it before a server snapshot.
for (const id of MATCH_PICKUP_WEAPON_IDS) {
  const ws = Object.create(WeaponSystem.prototype);
  ws.allWeapons = WEAPONS;
  ws.loadout = ['m4', id, 'sword'].map(id => WEAPONS.find(w => w.id === id));
  ws.state = new Map(ws.loadout.map(w => [w.id, {magAmmo: 0, reserveAmmo: 0}]));
  ws.currentIndex = 1;
  ws.mapGunId = id;
  ws.fireTimer = 0;
  ws._setActiveModel = () => {};
  ws.audio = {playWeaponSwitch() {}};
  let builds = 0;
  const hud = {
    buildWeaponSlots(slots, index) {
      builds++;
      this._renderedWeaponSlots = slots;
      this.visibleIds = slots.map(s => s.id);
      this.activeIndex = index;
    },
    setActiveSlot(index) {this.activeIndex = index;},
  };
  HUD.prototype.syncWeaponSlots.call(hud, ws.getHudInfo());
  assert(hud.visibleIds.includes(id), 'empty gun remains while equipped');
  ws.switchTo(2);
  HUD.prototype.syncWeaponSlots.call(hud, ws.getHudInfo());
  assert.deepEqual(hud.visibleIds, ['m4', 'sword'], 'discarded icon must disappear');
  assert.equal(ws.currentDef.id, 'sword');
  assert.equal(hud.activeIndex, 1);
  assert(ws.pendingEmptyDiscards.has(id));
  HUD.prototype.syncWeaponSlots.call(hud, ws.getHudInfo());
  assert.equal(builds, 2, 'unchanged frames must not rebuild thumbnails');
}

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
};
const { GUNS, Loadout } = await import('../src/core/Loadout.js');

assert.deepEqual(
  GUNS.map((weapon) => weapon.id).sort(),
  [...MAIN_WEAPON_IDS].sort(),
);
for (const id of MAIN_WEAPON_IDS) {
  Loadout.setGun(id);
  assert.equal(Loadout.getGun(), id, `${id} must be a permanent loadout choice`);
  assert.equal(isMainWeaponId(id), true);
  assert.equal(isMatchPickupWeaponId(id), false);
}
for (const id of MATCH_PICKUP_WEAPON_IDS) {
  Loadout.setGun(id);
  assert.equal(Loadout.getGun(), 'm4', `${id} must not persist as spawn equipment`);
  assert.equal(isMainWeaponId(id), false);
  assert.equal(isMatchPickupWeaponId(id), true);
}
for (const spec of AUTHORED_WEAPON_BY_KIND.values()) {
  assert.equal(isMatchPickupWeaponId(spec.id), true, `${spec.id} pad must grant a pickup-only gun`);
}

const rolled = randomLootSpecs([
  { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 },
  { x: 16, y: 0, z: 0 }, { x: 24, y: 0, z: 0 },
], 12345);
assert.ok(rolled.some((drop) => drop.lootType === 'shield'), 'a full pad generation must include a shield');
assert.ok(rolled.some((drop) => drop.lootType === 'weapon'), 'a full pad generation must include a weapon');
for (const drop of rolled.filter((entry) => entry.lootType === 'weapon')) {
  assert.equal(isMatchPickupWeaponId(drop.gunId), true, `${drop.gunId} must be pickup-only`);
}

const arena = {
  id: 'loadout-proof', name: 'Loadout Proof', region: 'test', half: 60,
  killY: -25, noBaseFloor: false, platforms: [], boxes: [],
  gravLifts: [], teleporters: [], spawns: [[20, 0, 20]],
  pickups: [
    { type: 'weapon', x: 0, y: 0, z: 0, markerKind: 8388608 },
    { type: 'weapon', x: 8, y: 0, z: 0, markerKind: 524288 },
  ],
};
const room = new AuthRoom(arena, { lootSeed: 7, shieldsEnabled: true });
const playerId = room.add(() => {}, 'Loadout Probe');
const player = room.players.get(playerId);

room.onInput(playerId, { seq: 1, wid: 'rpg' });
room.update();
assert.equal(player.wid, 'm4', 'server must reject a pickup gun requested away from its pad');

room.onInput(playerId, { seq: 2, wid: 'battlerifle' });
room.update();
assert.equal(player.wid, 'battlerifle', 'server must accept any of the five main guns');
assert.equal(player.mainWid, 'battlerifle', 'server must remember the selected main gun across death');

const weaponPad = room.lootPads[0];
Object.assign(weaponPad, { lootType: 'weapon', gunId: 'rpg', active: true });
assert.equal(room.onPickup(playerId, { seq: 1, padId: weaponPad.padId }), false,
  'server must reject a pickup requested away from its pad');
Object.assign(player.state, { px: weaponPad.x, py: weaponPad.y, pz: weaponPad.z });
assert.equal(room.onPickup(playerId, { seq: 2, padId: weaponPad.padId }), true,
  'server must accept a random weapon at the authoritative pad');
assert.equal(player.wid, 'rpg', 'collected weapon must equip immediately');
assert.equal(player.matchWeapons.has('rpg'), true);
assert.equal(weaponPad.active, false, 'collected pad must hide for every player');
assert.equal(room.onPickup(playerId, { seq: 2, padId: weaponPad.padId }), false,
  'replayed pickup request must be ignored');

const shieldPad = room.lootPads[1];
Object.assign(shieldPad, { lootType: 'shield', gunId: undefined, active: true });
Object.assign(player.state, { px: shieldPad.x, py: shieldPad.y, pz: shieldPad.z });
assert.equal(room.onPickup(playerId, { seq: 3, padId: shieldPad.padId }), true);
assert.equal(player.shield, SHIELD_PER_STACK, 'first shield pickup must create real shield');
assert.equal(player.maxShield, SHIELD_PER_STACK);
for (let stack = 1; stack < 8; stack++) {
  shieldPad.active = true;
  room.onPickup(playerId, { seq: 3 + stack, padId: shieldPad.padId });
}
assert.equal(player.shield, MAX_PICKUP_SHIELD, 'shield pickups must stack up to the configured cap');
assert.equal(player.maxShield, MAX_PICKUP_SHIELD);

player.invulnerableUntil = 0;
room._kill(player);
for (let i = 0; i < PLAYER_RESPAWN_DELAY * TICK_HZ; i++) room.update();
assert.equal(player.alive, true, 'loadout check must reach the actual human respawn');
assert.equal(player.wid, 'battlerifle', 'respawn must retain the chosen main gun');
assert.equal(player.matchWeapons.size, 0, 'respawn must clear server pickup grants');
assert.equal(player.shield, 0, 'respawn must clear stacked shield pickups');
assert.equal(player.maxShield, 0, 'respawn must clear shield capacity from the previous life');

console.log(`ok  loot/loadout: ${MAIN_WEAPON_IDS.length} main guns; ${MATCH_PICKUP_WEAPON_IDS.length} random pickup guns; ${MAX_PICKUP_SHIELD} max shield`);

// Unlimited reserves never bypass magazines or timed reloads.
for (const id of MAIN_WEAPON_IDS) {
  player.wid=id;
  const ammo=room._weaponState(player,id);
  ammo.mag=0;ammo.reserve=0;
  for(let cycle=0;cycle<3;cycle++) {
    assert.equal(room._startReload(player,id),true);
    room._finishReload(player);
    assert.equal(ammo.mag,0,'reload cannot finish before its timer');
    room.tick=player.reloadUntil;
    room._finishReload(player);
    assert(ammo.mag>0,'main gun reloads with an empty reserve');
    assert.equal(ammo.reserve,0);
    ammo.mag=0;
  }
}
player.wid='rpg';room._weaponState(player,'rpg').mag=0;room._weaponState(player,'rpg').reserve=0;
assert.equal(room._startReload(player,'rpg'),false,'pickup launchers retain finite reserves');
console.log('Unlimited main reserves passed: all five guns, repeated reloads, timers, finite pickup weapons.');

const ffa=new AuthRoom(arena,{lootSeed:7});const ffaId=ffa.add(()=>{},'FFA');
for(let generation=0;generation<50;generation++){
  assert(ffa.lootPads.every(p=>p.lootType!=='shield'),'FFA initial/rotated drops cannot include shields');
  for(const pad of ffa.lootPads)ffa._rerollLootPad(pad);
  assert(ffa.lootPads.every(p=>p.lootType!=='shield'),'FFA respawns cannot include shields');
  ffa._resetLootPads();
}
const fp=ffa.players.get(ffaId),forged=ffa.lootPads[0];Object.assign(fp.state,{px:forged.x,py:forged.y,pz:forged.z});forged.lootType='shield';
assert.equal(ffa.onPickup(ffaId,{seq:1,padId:forged.padId}),false);assert.equal(fp.shield,0);
const {SurvivalRoom}=await import('../server/survivalroom.mjs');const survival=new SurvivalRoom(arena,{botConfig:{maximumBots:0},lootSeed:7});
assert(survival.lootPads.some(p=>p.lootType==='shield'),'Survival retains shield drops');
const sp=survival.players.get(survival.add(()=>{},'Survivor'));sp.invulnerableUntil=0;sp.shield=50;sp.maxShield=50;
const enemy=survival.players.get(survival.addBot('Enemy'));enemy.survivalEnemy=true;
survival._damage(sp,enemy,30,false);assert.equal(sp.shield,20);assert.equal(sp.health,100);
survival._damage(sp,enemy,40,false);assert.equal(sp.shield,0);assert.equal(sp.health,80);
console.log('Mode shields passed: no FFA shields across rotations/respawns, forged pickup rejected, Survival shield-first damage.');
