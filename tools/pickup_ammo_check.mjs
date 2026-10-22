import assert from 'node:assert/strict';
import {PickupSystem} from '../src/world/PickupSystem.js';
import {AuthRoom} from '../server/authroom.mjs';
import {WeaponSystem} from '../src/weapons/WeaponSystem.js';
import {WEAPONS, MATCH_PICKUP_WEAPON_IDS} from '../src/weapons/weaponDefs.js';
for(const id of MATCH_PICKUP_WEAPON_IDS) {
 const def=WEAPONS.find(w=>w.id===id);
 const pad={padId:1,lootType:'weapon',gunId:id,active:true,x:0,y:0,z:0};
 const room={tick:1,lootPads:[pad],events:[],_canSimulate:()=>true,_discardEmptyAfterSwitch:AuthRoom.prototype._discardEmptyAfterSwitch,_weaponState:AuthRoom.prototype._weaponState};
 const p={id:1,alive:true,state:{px:0,py:0,pz:0},matchWeapons:new Set(),ammo:{},wid:'m4'};
 assert(AuthRoom.prototype._tryPickup.call(room,p,1));
 const ammo=p.ammo[id],supply=ammo.mag+ammo.reserve;
 pad.active=true;assert(AuthRoom.prototype._tryPickup.call(room,p,1));
 assert.equal(ammo.mag+ammo.reserve,2*supply,'second full pickup doubles the total supply');
 ammo.mag=0;ammo.reserve=3;p.reloadWid=id;p.reloadUntil=99;
 for(let n=1;n<=2;n++){pad.active=true;assert(AuthRoom.prototype._tryPickup.call(room,p,1));assert.equal(ammo.reserve,3+n*supply);assert.equal(ammo.mag,0);assert.equal(p.reloadUntil,99);}
 assert.equal(AuthRoom.prototype._tryPickup.call(room,p,1),false);
 ammo.mag=0;ammo.reserve=0;
 room._discardEmptyAfterSwitch(p,id);
 assert(p.matchWeapons.has(id),'empty current gun removed before switching');
 room._discardEmptyAfterSwitch(p,'sword');p.wid='sword';
 assert(!AuthRoom.prototype._canEquipWeapon.call(room,p,id),'discarded gun still equipable');
 pad.active=true;assert(AuthRoom.prototype._tryPickup.call(room,p,1));
 assert.equal(p.ammo[id].mag+p.ammo[id].reserve,supply,'recollected gun needs fresh ammo');
 const state={magAmmo:0,reserveAmmo:3,isReloading:true,reloadTimer:1};
 const local={allWeapons:WEAPONS,_mainGunId:'m4',loadout:[WEAPONS.find(w=>w.id==='m4'),def],state:new Map([[id,state]]),currentIndex:0,_rebuildKeyMap(){},_setActiveModel(){throw Error('duplicate switched weapon');}};
 WeaponSystem.prototype.addMapGun.call(local,id);
 assert.equal(state.reserveAmmo,3+def.magSize+def.reserveMax);
 assert.equal(state.magAmmo,0);assert(state.isReloading);assert.equal(state.reloadTimer,1);
 assert.equal(local.loadout.filter(w=>w.id===id).length,1);
}
console.log('Duplicate pickup ammo passed for every pickup gun: cumulative reserves, preserved magazine/reload, no duplicate slot or replay refill.');


// Exercise the proximity detector, not only the ammo helper: full ammo must
// still send an authoritative request and collect offline weapon pickups.
for (const id of MATCH_PICKUP_WEAPON_IDS) {
 const def=WEAPONS.find(w=>w.id===id);
 for(const authoritative of [false,true]) {
  const ammo={magAmmo:def.magSize,reserveAmmo:def.reserveMax*3};
  const mesh={position:{x:0,y:0,z:0},rotation:{y:0},visible:true};
  const pad={type:'loot',lootType:'weapon',gunId:id,padId:1,active:true,mesh,_animT:0,_requestCooldown:0};
  let requests=0,collections=0;
  const pickups={_pickups:[pad],_authoritative:authoritative,_collect:PickupSystem.prototype._collect,_onPickupRequest(){requests++;}};
  const weapons={loadout:[def],state:new Map([[id,ammo]]),addMapGun(){collections++;ammo.reserveAmmo+=def.magSize+def.reserveMax;return def;}};
  PickupSystem.prototype.update.call(pickups,.016,{position:{x:0,y:0,z:0},isDead:false},weapons,null);
  assert.equal(authoritative?requests:collections,1,'full duplicate must pass proximity collection');
  if(!authoritative) assert.equal(ammo.reserveAmmo,def.reserveMax*3+def.magSize+def.reserveMax);
  pad.active=false;PickupSystem.prototype.update.call(pickups,.016,{position:{x:0,y:0,z:0},isDead:false},weapons,null);
  assert.equal(authoritative?requests:collections,1,'inactive pad cannot grant ammo again');
 }
}
console.log('Full-ammo duplicate proximity pickup passed online/offline for every pickup weapon.');
