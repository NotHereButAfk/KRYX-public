import assert from 'node:assert/strict';
import { createState, step, makeInput, DT } from '../src/sim/MoveSim.js';
import { Player } from '../src/player/Player.js';
import { SLIDE_LAUNCH_SPEED, SLIDE_DURATION, SLIDE_RECOVERY, WALK_SPEED, SPRINT_MULT } from '../src/sim/MovementConfig.js';

const world = {half:100,killY:-25,boxes:[],platforms:[],gravLifts:[],teleporters:[]};
const sprintSpeed = WALK_SPEED * SPRINT_MULT;
const ready = () => ({...createState(),vz:-sprintSpeed});
const command = extra => makeInput({mz:1,sprint:true,crouch:true,...extra});
const begin = s => step(s,command({crouchJust:true}),world);
assert.equal(begin(createState()).slide,0,'standing crouch must not launch');
assert.equal(begin({...ready(),onGround:0,py:2}).slide,0,'slide must start on the ground');
let s=begin(ready());
assert(s.slide && -s.vz>sprintSpeed && -s.vz<SLIDE_LAUNCH_SPEED,'slide must begin with a modest burst');
let previous=-s.vz,ticks=1;
while(s.slide && ticks<30){
  s=step(s,command(),world);ticks++;
  assert(-s.vz<=previous+1e-5,'slide gained speed without a new launch');
  assert(-s.vz>=WALK_SPEED*.55-1e-5,'slide braked to a full stop');
  previous=-s.vz;
}
assert.equal(ticks,Math.round(SLIDE_DURATION/DT),'slide duration changed between controllers');
assert.equal(s.slideCD,SLIDE_RECOVERY,'finished slide must enter recovery');
assert(s.pz<-5.5 && s.pz>-7,'slide must cover a useful but controlled distance');
assert.equal(s.crouch,1,'holding crouch must finish low');
const held=step({...s,vz:-sprintSpeed},command(),world);
assert.equal(held.slide,0,'held key must not chain another slide');
assert.equal(begin({...s,vz:-sprintSpeed}).slide,0,'fresh press during recovery must not add another boost');
assert.equal(begin({...s,vz:-sprintSpeed,slideCD:0,crouch:0}).slide,1,'fresh press after recovery must work');

// Direction starts with actual travel, not the crosshair, and can only bend slowly.
let diagonal=begin({...ready(),vx:sprintSpeed/Math.sqrt(2),vz:-sprintSpeed/Math.sqrt(2)});
assert(Math.abs(diagonal.vx+diagonal.vz)<.4,'slide snapped a diagonal approach to camera-forward');
let turn=begin(ready());
for(let i=0;i<10;i++)turn=step(turn,command({mx:1}),world);
const angle=Math.atan2(turn.vx,-turn.vz);
assert(angle>0.05 && angle<0.23,'steering must be noticeable and rate-limited');
const beforeReverse={...turn};
turn=step(turn,command({mz:-1}),world);
assert(turn.vz<0 && Math.abs(Math.atan2(turn.vx,-turn.vz)-Math.atan2(beforeReverse.vx,-beforeReverse.vz))<1e-5,
  'reverse input cannot instantly reverse a slide');

const sliding=begin(ready());
const jumped=step(sliding,command({jumpJust:true}),world);
assert(!jumped.slide && !jumped.onGround && jumped.vy>12,'Space must jump out of a slide');
assert.equal(jumped.slideCD,SLIDE_RECOVERY);
assert(jumped.vz<0 && Math.abs(jumped.vz)>8,'slide jump must retain forward momentum');
const airborne=step({...sliding,onGround:0,py:2},command(),world);
assert(!airborne.slide,'leaving a ledge must release the ground-slide override');

const tunnel={...world,boxes:[{min:[-5,1.25,-100],max:[5,3,100]}]};
let low=sliding;
for(let i=0;i<22;i++)low=step(low,command({crouch:false}),tunnel);
assert(low.crouch && low.py>=0,'finished slide must not stand through a low ceiling');
assert.equal(step(low,command({jumpJust:true}),tunnel).vy,0,'jump cannot force standing into a low ceiling');
let roofProbes=0;
const importedRoof={...world,raycast(x,y,z,dx,dy,dz,far){
  roofProbes++;
  assert.equal(dx,0);assert.equal(dy,1);assert.equal(dz,0);
  return y<1.25 && y+far>1.25?1.25-y:far;
}};
let meshLow=sliding;
for(let i=0;i<22;i++)meshLow=step(meshLow,command({crouch:false}),importedRoof);
assert(meshLow.crouch && roofProbes>0,'mesh-only ceiling must keep the completed slide low');
assert.equal(step(meshLow,command({jumpJust:true}),importedRoof).vy,0,'slide jump penetrated an imported roof');
const openRoof={...world,raycast:(x,y,z,dx,dy,dz,far)=>far};
const stood=step(meshLow,makeInput(),openRoof);
assert(!stood.crouch,'leaving the imported roof must allow standing again');
roofProbes=0;let walking=createState();
for(let i=0;i<20;i++)walking=step(walking,makeInput({mz:1}),importedRoof);
assert.equal(roofProbes,0,'ordinary walking must not acquire per-tick headroom probes');
const wall={...world,boxes:[{min:[-5,0,-3.1],max:[5,4,-3]}]};
let blocked=sliding;
for(let i=0;i<22;i++)blocked=step(blocked,command(),wall);
assert(blocked.pz>=-2.55001,'slide tunneled through a thin wall');

const localWorld={groundHeightAt:()=>0,resolveCollisions:()=>{}};
const input=(first,jump=false)=>({mouseDX:0,mouseDY:0,isDown:k=>['KeyW','ShiftLeft','KeyC'].includes(k),
  consumeJustPressed:k=>(first&&k==='KeyC')||(jump&&k==='Space')});
const local=()=>{const p=new Player(16/9);p.position.set(0,0,0);p.velocity.set(0,0,-sprintSpeed);p.yaw=0;return p;};
const p=local();let predicted=ready();
for(let i=0;i<18;i++){
  p.update(DT,input(i===0),localWorld);
  predicted=step(predicted,command({crouchJust:i===0}),world);
  assert(Math.abs(p.position.z-predicted.pz)<.0001,'local slide differs from fixed-tick authority');
  assert.equal(p.isSliding,!!predicted.slide,'local/authority slide exit differs');
}
const distances=[];
for(const hz of [30,60,144]){
  const player=local();
  for(let i=0;i<Math.round(hz*.9);i++)player.update(1/hz,input(i===0),localWorld);
  distances.push(-player.position.z);
  const jumper=local();jumper.update(1/hz,input(true),localWorld);jumper.update(1/hz,input(false,true),localWorld);
  assert(!jumper.isSliding && jumper.velocity.y>12,'offline slide jump failed');
  const underRoof=local();underRoof.update(1/hz,input(true),localWorld);
  for(let i=0;i<hz;i++)underRoof.update(1/hz,{...input(false),isDown:()=>false},
    {...localWorld,raycastCollisionDistance:()=>.2});
  assert(underRoof.isCrouching,'offline controller stood under a low ceiling');
  underRoof.update(1/hz,input(false,true),{...localWorld,raycastCollisionDistance:()=>.2});
  assert(underRoof.isCrouching && underRoof.velocity.y===0,'offline slide/crouch jump penetrated a low ceiling');
}
assert(Math.max(...distances)-Math.min(...distances)<.2,'slide distance varies excessively by frame rate');
// Full-state equality covers recovery and direction, not only the legacy hash fields.
const replay=()=>{let state=ready();return Array.from({length:40},(_,i)=>{state=step(state,command({crouchJust:i===0,mx:i>2?1:0,jumpJust:i===12}),world);return state;});};
assert.deepEqual(replay(),replay(),'same input must reproduce every slide state field');
console.log('Slide movement passed: controlled launch/deceleration, direction/steering, jump, recovery, ledge/ceiling/wall, local/server parity, 30/60/144Hz.');
