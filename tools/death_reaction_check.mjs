import * as THREE from 'three';
import {groundDeathBody} from '../src/player/DeathBody.js';
import assert from 'node:assert/strict';
import {createDeathReaction, sampleDeathReaction} from '../src/sim/DeathReaction.js';
import {AuthRoom} from '../server/authroom.mjs';
import {TeamRoom} from '../server/teamroom.mjs';
import {SurvivalRoom} from '../server/survivalroom.mjs';
const target={px:0,py:0,pz:0}, source={x:0,z:3};
const rifle=createDeathReaction('m4',target,source);
const shotgun=createDeathReaction('levershotgun',target,source);
const rocket=createDeathReaction('rpg',target,source);
assert(shotgun.speed > rifle.speed*4 && rocket.lift > shotgun.lift);
assert(sampleDeathReaction(shotgun,.3).z < -2 && sampleDeathReaction(shotgun,.3).y > .2);
assert.equal(sampleDeathReaction(shotgun,2).done,true);
assert(sampleDeathReaction(shotgun,2).y === .32);
for(const hz of [30,60,144]) {
  let t=0;while(t<1.65)t=Math.min(1.65,t+1/hz);
  assert.deepEqual(sampleDeathReaction(shotgun,t),sampleDeathReaction(shotgun,1.65));
}
const stopped=createDeathReaction('rpg',target,source,()=>.75);
assert(sampleDeathReaction(stopped,.6).z >= -.201,'body went through nearby wall');
assert.equal(createDeathReaction('void',target,null).speed,0);
// A frozen network position in midair must never become a corpse's floor.
const airborne = createDeathReaction('levershotgun',{px:0,py:5,pz:0},source,
  (ox,oy,oz,dx,dy,dz,max)=>dy === -1 ? oy : max);
assert.equal(airborne.groundOffset,-5);
assert(sampleDeathReaction(airborne,1).air<0,'corpse stayed at death height');
assert.equal(sampleDeathReaction(airborne,2).air,-5,'corpse did not settle on ground');
for(const hz of [30,60,144]) {
  let t=0;while(t<2)t=Math.min(2,t+1/hz);
  assert.equal(sampleDeathReaction(airborne,t).air,-5);
}
const voidFall=createDeathReaction('m4',{px:0,py:5,pz:0},source,
  (ox,oy,oz,dx,dy,dz,max)=>max);
assert(sampleDeathReaction(voidFall,2).air < sampleDeathReaction(voidFall,1).air,
  'no ground must keep falling rather than stop at an invisible plane');
const arena={id:'death-proof',half:100,platforms:[],boxes:[],spawns:[[0,0,0],[0,0,10]],pickups:[],gravLifts:[],teleporters:[]};
for(const Room of [AuthRoom,TeamRoom,SurvivalRoom]) {
  const messages=[], room=new Room(arena);
  const p=room.players.get(room.add(m=>messages.push(m),'Victim'));
  Object.assign(p.state,target);p.health=1;p.shield=0;p.invulnerableUntil=0;
  p.wid='m4';
  // Self blast still carries its actual weapon and blast centre in every mode.
  room._blast({x:0,y:.5,z:1,wid:'rpg'},p,8,200);
  assert.equal(p.alive,false,Room.name);
  assert.equal(p.deathReaction.speed,createDeathReaction('rpg',target,{x:0,y:.5,z:1}).speed,Room.name+' lost blast context');
  assert(p.deathReaction.z<0,'body must travel away from explosion');
  assert.equal(room.events.find(e=>e.e==='kill').wid,'rpg','kill weapon changed to equipped rifle');
  room._driveBot=()=>{}; AuthRoom.prototype.update.call(room);
  const snap=messages.findLast(m=>m.t==='snapshot');
  assert(snap, Room.name + ' missing snapshot'); {assert.deepEqual(snap.you.deathReaction,p.deathReaction);assert.deepEqual(snap.players.find(x=>x.id===p.id).deathReaction,p.deathReaction);}
}
console.log('Death reactions passed: shotgun launch, radial blasts, wall clearance, frame independence, and all server modes retain weapon/source.');

const body = new THREE.Group();
const mesh = new THREE.Mesh(new THREE.BoxGeometry(.6,1.8,.4));
mesh.position.y=.9; body.add(mesh);
for (const yaw of [0,1,2]) {
  body.rotation.set(1.4,yaw,.3);body.position.set(0,-3,0);
  groundDeathBody(body,2,.6);body.updateMatrixWorld(true);
  assert(Math.abs(new THREE.Box3().setFromObject(body,true).min.y-2.6)<1e-5,'death body sunk below its landing plane');
  groundDeathBody(body,5,sampleDeathReaction(airborne,2).air);
  body.updateMatrixWorld(true);
  assert(Math.abs(new THREE.Box3().setFromObject(body,true).min.y)<1e-5,
    'posed corpse must reach the actual floor below its frozen death snapshot');
}

const closeBlast=createDeathReaction('rpg',target,{x:0,y:0,z:1});
const farBlast=createDeathReaction('rpg',target,{x:0,y:0,z:8});
assert(closeBlast.speed>farBlast.speed && closeBlast.lift>farBlast.lift);
const contact=(shotgun.lift+Math.sqrt(shotgun.lift**2))/18;
assert(sampleDeathReaction(shotgun,contact+.06).air>0);
assert.equal(sampleDeathReaction(shotgun,contact+.3).air,0);

const {tumbleGrenade}=await import('../src/weapons/GrenadeTumble.js');
function tumble(hz){const mesh=new THREE.Object3D();for(let i=0;i<hz;i++)tumbleGrenade(mesh,4,2,-3,1/hz);for(let i=0;i<hz;i++)tumbleGrenade(mesh,0,0,0,1/hz);return mesh;}
const slow=tumble(30),fast=tumble(144);
assert(Math.abs(slow.rotation.x-fast.rotation.x)<1e-8);
assert(Math.abs(slow.rotation.z-fast.rotation.z)<1e-8);
assert(Math.abs(slow.userData.tumble.x)<1e-6);
