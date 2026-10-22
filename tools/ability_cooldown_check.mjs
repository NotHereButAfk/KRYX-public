import assert from 'node:assert/strict';
import {AuthRoom} from '../server/authroom.mjs';
const room=new AuthRoom();const id=room.add(()=>{},'Cooldown');const p=room.players.get(id);p.invulnerableUntil=100000;
const use=kind=>{p.abilityReq={kind,yaw:0,pitch:0};room.update();};
use('smoke');assert.equal(p.abilityCooldowns.smoke,15);assert.equal(p.abilities.smoke,1);
use('smoke');assert.equal(p.abilities.smoke,1,'cannot use same ability during cooldown');
use('flash');assert.equal(p.abilities.flash,1,'abilities cool down independently');
for(let i=0;i<295;i++)room.update();
assert(p.abilityCooldowns.smoke>0);use('smoke');assert.equal(p.abilities.smoke,1);
for(let i=0;i<4;i++)room.update();
assert.equal(p.abilityCooldowns.smoke,0);assert.equal(p.abilities.smoke,2,'charges return when ready');
use('smoke');assert.equal(p.abilityCooldowns.smoke,15);
console.log('Ability cooldown passed: 15 seconds, early reuse rejected, independent abilities, recharge.');

const arena={id:'ability-test',name:'Test',half:50,killY:-20,platforms:[],boxes:[],gravLifts:[],teleporters:[],spawns:[[0,0,0]],groundHeightAt:()=>0,raycast:(x,y,z,dx,dy,dz,far)=>far};
const test=new AuthRoom(arena);const a=test.players.get(test.add(()=>{},'Planter'));const b=test.players.get(test.add(()=>{},'Target'));
Object.assign(a.state,{px:0,py:0,pz:0,onGround:1});Object.assign(b.state,{px:2,py:0,pz:0,onGround:1});a.invulnerableUntil=b.invulnerableUntil=0;
test.onAbility(a.id,{seq:1,kind:'timebomb'});test.update();
assert.equal(test.frags.length,1);assert.equal(test.frags[0].x,0);assert.equal(test.frags[0].y,.08);assert.equal(b.health,100);
for(let i=0;i<59;i++)test.update();assert.equal(b.health,100,'bomb must wait three seconds');test.update();assert(b.health<100,'bomb damages only after fuse');
const health=b.health,shield=b.shield;Object.assign(b.state,{px:2,py:0,pz:0,vx:0,vy:0,vz:0,onGround:1});
test.onAbility(a.id,{seq:2,kind:'impulse'});test.update();assert.equal(b.health,health);assert.equal(b.shield,shield);assert(b.state.vx>0&&b.state.vy>0,'blast pushes away and up');
Object.assign(a.state,{onGround:0,py:5});a.abilityCooldowns.timebomb=0;a.abilities.timebomb=1;
test.onAbility(a.id,{seq:3,kind:'timebomb'});test.update();assert.equal(test.frags.length,0,'cannot plant a bomb in mid-air');
console.log('Bomb and blast passed: floor planting, three-second fuse, damage, airborne rejection, zero-damage knockback.');

// A wall blocks displacement as well as damage; the caster is excluded.
Object.assign(a.state,{px:0,py:0,pz:0,vx:0,vy:0,vz:0,onGround:1});Object.assign(b.state,{px:2,py:0,pz:0,vx:0,vy:0,vz:0,onGround:1});
test.simWorld.raycast=()=>.2;a.abilityCooldowns.impulse=0;a.abilities.impulse=1;
test.onAbility(a.id,{seq:4,kind:'impulse'});test.update();assert.equal(b.state.vx,0);assert.equal(b.state.vy,0);assert.equal(a.state.vx,0);
console.log('Blast LOS passed: walls block knockback, caster is not launched.');
