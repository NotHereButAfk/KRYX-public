import {updateWeaponSprintBlock} from '../src/core/GameplayInput.js';
import assert from 'node:assert/strict';
import {Player} from '../src/player/Player.js';
import {WALK_SPEED,SPRINT_MULT} from '../src/sim/MovementConfig.js';
import {createState,step,makeInput} from '../src/sim/MoveSim.js';
const world={groundHeightAt:()=>0,resolveCollisions:()=>{}};
assert.equal(WALK_SPEED,7.2,'shared approved walking speed');
assert.equal(WALK_SPEED*SPRINT_MULT,11.2,'shared approved sprint cap');
let jumper=createState(), apex=0;
for(let i=0;i<40;i++) {
 jumper=step(jumper,makeInput({jumpJust:i===0}),{half:100,platforms:[],boxes:[],gravLifts:[],teleporters:[]});
 apex=Math.max(apex,jumper.py);
}
assert(apex>5.2 && apex<5.8,`higher jump apex out of range: ${apex}`);
function run(fps,{sprint=false,diagonal=false,sideways=false,blocked=false,airborne=false}={}){
 const p=new Player(16/9);p.position.set(0,airborne?100:0,0);p.onGround=!airborne;
 let steps=0;p.audio={playFootstep:()=>steps++};
 const input={mouseDX:0,mouseDY:0,isDown:k=>(!sideways&&k==='KeyW')||((diagonal||sideways)&&k==='KeyD')||(sprint&&k==='ShiftLeft'),consumeJustPressed:()=>false};
 const w=blocked?{...world,resolveCollisions:position=>{position.x=position.z=0;}}:world;
 for(let i=0;i<fps*2;i++)p.update(1/fps,input,w);
 return {distance:Math.hypot(p.position.x,p.position.z),steps,bob:p._bobWeight||0};
}
for(const fps of [30,60,144]){
 for(const sprint of [false,true])for(const diagonal of [false,true])for(const sideways of [false,true]){
  const r=run(fps,{sprint,diagonal,sideways});
  assert(Math.abs(r.distance-WALK_SPEED*(sprint?SPRINT_MULT:1)*2)<.01,'speed or diagonal normalization differs');
  const expectedSteps=Math.floor(r.distance/(sprint?2.35:2));
  assert(Math.abs(r.steps-expectedSteps)<=1,`footsteps do not track travel: ${r.steps} vs ${expectedSteps}`);
 }
 assert.equal(run(fps,{blocked:true}).steps,0,'wall pushing produces footsteps');
 assert.equal(run(fps,{airborne:true}).steps,0,'airborne movement produces footsteps');
 assert.equal(run(fps,{blocked:true}).bob,0,'wall pushing produces camera bob');
}
console.log('Movement presentation: travel speeds, diagonal parity and resolved-distance footsteps pass at 30/60/144Hz.');

for(const fps of [30,60,144]) {
 const p=new Player(16/9);p.position.set(0,0,0);p.onGround=true;
 const input={mouseDown:true,mouseDX:0,mouseDY:0,isDown:k=>['KeyW','ShiftLeft'].includes(k),consumeJustPressed:()=>false};
 for(let i=0;i<fps;i++){updateWeaponSprintBlock(p,input,'magnum',1/fps);p.update(1/fps,input,world);}
 assert(!p.isSprinting && Math.abs(Math.hypot(p.velocity.x,p.velocity.z)-WALK_SPEED)<.01,'Hand Cannon fire must cancel sprint');
 input.mouseDown=false;
 for(let i=0;i<Math.ceil(fps*.5);i++){updateWeaponSprintBlock(p,input,'magnum',1/fps);p.update(1/fps,input,world);}
 assert(p.isSprinting,'sprint should resume after recoil recovery');
 input.mouseDown=true;updateWeaponSprintBlock(p,input,'m4',1/fps);p.update(1/fps,input,world);
 assert(!p.isSprinting && Math.abs(Math.hypot(p.velocity.x,p.velocity.z)-WALK_SPEED)<.01, 'rifle firing must also cancel sprint');
}
console.log('Firearm fire cancels sprint and resumes after recovery at 30/60/144Hz.');

// Authoritative lateral movement uses the same pace and stamina as forward.
for(const sprint of [false,true])for(const mx of [-1,1]){
 const arena={half:100,platforms:[],boxes:[],gravLifts:[],teleporters:[]};
 let f=createState(),s=createState();
 for(let i=0;i<30;i++){f=step(f,makeInput({mz:1,sprint}),arena);s=step(s,makeInput({mx,sprint}),arena);}
 assert(Math.abs(Math.abs(s.px)-Math.abs(f.pz))<.001,'strafe and forward distance differ');
 assert.equal(s.stamina,f.stamina,'sideways running must drain normal stamina');
}
console.log('Walking/running strafe matches forward speed and stamina on client and server.');

for(const fps of [30,60,144])for(const diagonal of [false,true]){
 const p=new Player(16/9);p.position.set(0,0,0);p.onGround=true;
 const input={mouseDX:0,mouseDY:0,isDown:k=>k==='KeyS'||k==='ShiftLeft'||(diagonal&&k==='KeyD'),consumeJustPressed:()=>false};
 for(let i=0;i<fps;i++)p.update(1/fps,input,world);
 assert(Math.abs(Math.hypot(p.position.x,p.position.z)-WALK_SPEED*.5)<.01,'backward player movement must be half walking speed');
 const arena={half:100,platforms:[],boxes:[],gravLifts:[],teleporters:[]};let s=createState();
 for(let i=0;i<20;i++)s=step(s,makeInput({mz:-1,mx:diagonal?1:0,sprint:true}),arena);
 assert(Math.abs(Math.hypot(s.px,s.pz)-WALK_SPEED*.5)<.01,'authority must use half walking speed backwards');
}
console.log('PASS half-speed backpedal on client and authority, including diagonals and held sprint.');
