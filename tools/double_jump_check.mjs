import assert from 'node:assert/strict';
import {createState,step,makeInput,hashState} from '../src/sim/MoveSim.js';
import {AuthClient} from '../src/net/AuthClient.js';
import {Player} from '../src/player/Player.js';
import * as THREE from 'three';
const world={half:100,killY:-25,boxes:[],platforms:[],gravLifts:[],teleporters:[]};
const advance=(s,jump=false,w=world)=>step(s,makeInput({jumpJust:jump}),w);
let s=advance(createState(),true);assert(s.vy>12 && !s.airJumpUsed);
for(let i=0;i<10;i++)s=advance(s);
s=advance(s,true);assert(s.vy>12 && s.airJumpUsed===1,'second press launches again');
const second=s;for(let i=0;i<5;i++){const vy=s.vy;s=advance(s,true);assert(s.vy<vy,'spam cannot grant a third jump');}
assert.notEqual(hashState(second),hashState({...second,airJumpUsed:0}),'jump budget participates in prediction hash');
for(let i=0;i<100 && !s.onGround;i++)s=advance(s);
assert(s.onGround && !s.airJumpUsed,'landing restores air jump');
s=advance(advance(s,true),true);assert(s.airJumpUsed && s.vy>12,'next landing permits another pair');
let ledge={...createState(0,4,0),onGround:0,coyote:0};ledge=advance(ledge,true);assert.equal(ledge.airJumpUsed,1,'walking off a ledge permits one air jump');assert(advance(ledge,true).vy<ledge.vy);
let ceiling={...world,boxes:[{min:[-5,4,-5],max:[5,5,5]}]};let hit={...createState(0,2,0),onGround:0,vy:0};hit=advance(hit,true,ceiling);assert(hit.py<=2.3 && hit.airJumpUsed===1,'ceiling blocks movement without restoring jump');
for(const fps of [30,60,144]){
 const p=new Player(16/9);p.position.set(0,0,0);p.onGround=true;
 const w={groundHeightAt:()=>0,resolveCollisions:()=>{}};
 const tick=jump=>p.update(1/fps,{mouseDX:0,mouseDY:0,isDown:()=>false,consumeJustPressed:k=>k==='Space'&&jump},w);
 tick(true);for(let i=0;i<Math.floor(fps*.3);i++)tick(false);tick(true);assert(p._airJumpUsed && p.velocity.y>12);
 const vy=p.velocity.y;tick(true);assert(p.velocity.y<vy);
 for(let i=0;i<fps*3&&!p.onGround;i++)tick(false);
 assert(p.onGround&&!p._airJumpUsed,'local landing restores jump');p._airJumpUsed=true;p.respawn(new THREE.Vector3());assert(!p._airJumpUsed,'respawn restores jump');
}
console.log('Double jump passed: second impulse, third/spam denied, ledge/ceiling/landing/respawn, prediction hash, 30/60/144Hz');

const client=new AuthClient('ws://unused');client.sim=createState();client.simWorld=world;
const used={...second,x:second.px,y:second.py,z:second.pz,health:100,alive:true};
client._reconcile({tick:20,ack:0,serverTime:1000,matchStart:0,matchDurationMs:180000,you:used,players:[]});
assert.equal(client.sim.airJumpUsed,1,'server correction restores the consumed jump');
client._predict(makeInput({jumpJust:true}));assert(client.sim.vy<second.vy,'reconciliation cannot permit a third jump');
client.pending=[{seq:2,inp:makeInput({jumpJust:true})}];
client._reconcile({tick:21,ack:1,serverTime:1050,matchStart:0,matchDurationMs:180000,you:{...used,airJumpUsed:0},players:[]});
assert.equal(client.sim.airJumpUsed,1,'unacknowledged air jump consumes the budget again during replay');
console.log('Network correction and input replay preserve the double-jump budget');

client._reconcile({tick:22,ack:2,serverTime:1100,matchStart:0,matchDurationMs:180000,you:used,
 players:[{id:'jump-peer',name:'Jumper',x:0,y:2,z:0,yaw:0,vy:12,onGround:false,airJumpUsed:1,alive:true,health:100}]});
assert.equal(client.remotes.get('jump-peer').buf.at(-1).airJumpUsed,1,'remote snapshots must preserve second-jump animation state');
assert.equal(client.remoteStates().find(p=>p.id==='jump-peer').airJumpUsed,1,'rendered remote must receive the second-jump marker');
