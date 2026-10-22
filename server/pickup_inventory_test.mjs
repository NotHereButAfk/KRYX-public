import assert from 'node:assert/strict';
import { AuthRoom } from './authroom.mjs';
import { MATCH_PICKUP_WEAPON_IDS } from '../src/weapons/weaponDefs.js';
import {PickupSystem} from '../src/world/PickupSystem.js';
import {Group,Vector3} from 'three';
const room = new AuthRoom(undefined, { targetPopulation: 0, lootSeed: 1 });
const messages = [];
const id = room.add(message => messages.push(message), 'PickupInventoryProbe');
const player = room.players.get(id);
const pad = room.lootPads[0];
let seq = 0;
function collect(gunId) {
  Object.assign(pad, { active: true, lootType: 'weapon', gunId });
  Object.assign(player.state, { px: pad.x, py: pad.y, pz: pad.z });
  return room.onPickup(id, { padId: pad.padId, seq: ++seq });
}
for (const gun of MATCH_PICKUP_WEAPON_IDS) assert(collect(gun), `cannot collect ${gun}`);
assert.equal(player.matchWeapons.size, MATCH_PICKUP_WEAPON_IDS.length);
const first = MATCH_PICKUP_WEAPON_IDS[0];
const expected = { mag: 0, reserve: player.ammo[first].mag + player.ammo[first].reserve };
const active = player.wid;
player.ammo[first].mag = 0;
player.ammo[first].reserve = 0;
assert(collect(first));
assert.deepEqual(player.ammo[first], expected);
assert.equal(player.wid, active, 'duplicate pickup switched active weapon');
assert.equal(player.matchWeapons.size, MATCH_PICKUP_WEAPON_IDS.length);
assert(!collect('m4'), 'starting main weapon accepted as map-only pickup');
room.update();
const snapshot = messages.findLast(message => message.t === 'snapshot');
assert.deepEqual(snapshot.you.matchWeapons, MATCH_PICKUP_WEAPON_IDS);
assert.deepEqual(snapshot.you.weaponAmmo[first], expected, 'stacked ammo missing from inventory snapshot');
room._resetLifeInventory(player);
assert.equal(player.matchWeapons.size, 0);
assert.deepEqual(Object.keys(player.ammo), ['m4']);
console.log('Pickup inventory passed: all distinct weapons retained, duplicates stack reserves, death clears pickups');

// A predicted client enters the pad before its queued movement reaches server.
for (const delay of [1, 3, 6]) {
  room._resetLifeInventory(player);
  Object.assign(pad, {active:true,lootType:'weapon',gunId:'rpg'});
  Object.assign(player.state,{px:pad.x+3,py:pad.y,pz:pad.z,vx:0,vz:0});
  assert.equal(room.onPickup(id,{padId:pad.padId,seq:++seq}),false);
  assert(player.pendingPickup);
  for(let tick=1;tick<=delay;tick++) {
    if(tick===delay) player.state.px=pad.x;
    room.update();
  }
  assert(player.matchWeapons.has('rpg'),`early pickup lost after ${delay*50}ms`);
  assert(!pad.active && !player.pendingPickup);
}
room._resetLifeInventory(player);
pad.active=true;
Object.assign(player.state,{px:pad.x+3,py:pad.y,pz:pad.z,vx:0,vz:0});
room.onPickup(id,{padId:pad.padId,seq:++seq});
for(let i=0;i<7;i++)room.update();
player.state.px=pad.x;room.update();
assert(player.matchWeapons.has('rpg'),'walking onto pad must collect even after a request expires');
room._resetLifeInventory(player); pad.active=true;
player.state.px=pad.x+30;
room.onPickup(id,{padId:pad.padId,seq:++seq});
assert(!player.pendingPickup,'remote request queued');
player.state.px=pad.x+3;
room.onPickup(id,{padId:pad.padId,seq:++seq});
room._resetLifeInventory(player);
assert(!player.pendingPickup,'pending request survived death/reset');
console.log('Pickup timing passed: early requests survive 50/150/300ms; expiry, distance and life reset remain enforced.');
for(const hz of [30,60,144]) {
  let requests=0;
  const system=Object.create(PickupSystem.prototype);
  Object.assign(system,{_authoritative:true,_onPickupRequest:()=>requests++, _pickups:[{
    type:'loot',lootType:'weapon',gunId:'rpg',padId:0,active:true,
    mesh:new Group(),_animT:0,_requestCooldown:0,
  }]});
  const runner={position:new Vector3(-2.5,0,0),isDead:false};
  for(let frame=0;frame<hz/2;frame++) {
    runner.position.x+=14/hz;
    system.update(1/hz,runner,{loadout:[],state:new Map()},null);
  }
  assert(requests>=2&&requests<=4,`${hz}Hz sprint pass sent ${requests} requests; must retry before leaving the pad`);
}
console.log('Pickup client passed: one sprint pass retries at 30/60/144Hz without granting unconfirmed loot.');
// Online roster changes must move unchanged pads and remove stale local pads.
const synced=Object.create(PickupSystem.prototype);
const stale=new Group(), existing=new Group();
Object.assign(synced,{_authoritative:true,scene:new Group(),_pickups:[
 {type:'ammo',mesh:stale},
 {type:'loot',padId:7,lootType:'weapon',gunId:'rpg',color:1,mesh:existing},
],_disposeMesh(){},_replaceLoot(p,next){Object.assign(p,next,{mesh:new Group()});p.mesh.position.copy(next.position);}});
synced.syncLootPads([{padId:7,lootType:'weapon',gunId:'rpg',color:1,x:10,y:2,z:5,active:false},
 {padId:8,lootType:'weapon',gunId:'uzi',color:2,x:20,y:3,z:6,active:true}]);
assert.equal(synced._pickups.length,2);
assert.deepEqual(existing.position.toArray(),[10,2,5]);
assert.equal(existing.visible,false);
assert.equal(synced._pickups[1].padId,8);
console.log('Pickup roster passed: new pads, corrected positions, stale removal and confirmed visibility.');
