import assert from 'node:assert/strict';
import {RemoteFootsteps} from '../src/core/RemoteFootsteps.js';
function steps(fps,sprint=false){
 const f=new RemoteFootsteps();let count=0;
 for(let i=0;i<=fps*4;i++)if(f.update({x:0,y:0,z:-i/fps*(sprint?11.2:7.2),grounded:true,alive:true,sprint},1/fps))count++;
 return count;
}
for(const sprint of [false,true]){
 const counts=[30,60,144].map(fps=>steps(fps,sprint));
 assert(Math.max(...counts)-Math.min(...counts)<=1,'render rate changed footstep cadence');
 assert(counts[0]>10 && counts[0]<22);
}
const f=new RemoteFootsteps(),state={x:0,y:0,z:0,grounded:true,alive:true};
assert.equal(f.update(state,.05),null);
for(let i=0;i<100;i++)assert.equal(f.update(state,.05),null,'idle played a step');
state.x=40;assert.equal(f.update(state,.05),null,'teleport played a step');
state.grounded=false;state.vy=-15;assert.equal(f.update(state,.05),null);
state.grounded=true;state.vy=0;assert.equal(f.update(state,.05),'hard-land');
assert.equal(f.update(state,.05),null,'landing repeated');
for(const flag of ['sliding','inaudible','dead']){
 const f=new RemoteFootsteps();
 for(let i=0;i<100;i++)assert.equal(f.update({...state,x:i*.3,sliding:flag==='sliding',alive:flag!=='dead'},.05,flag!=='inaudible'),null);
}
console.log('Remote footsteps: cadence at 30/60/144Hz, no idle/teleport/air/death/slide noise, single landing and distance culling pass.');
