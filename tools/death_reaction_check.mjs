import assert from 'node:assert/strict';
import {createDeathReaction,sampleDeathReaction} from '../src/sim/DeathReaction.js';
for(const weapon of ['m4','levershotgun','rpg','concussion']) {
 const r=createDeathReaction(weapon,{px:0,py:5,pz:0},{x:3,y:5,z:0},()=>5.2);
 assert.equal(r.speed,0);assert.equal(r.lift,0);
 for(const fps of [30,60,144]) for(let i=0;i<fps*2;i++) {
  const p=sampleDeathReaction(r,i/fps);
  assert.equal(p.x,0);assert.equal(p.z,0);
  assert(p.air<=0 && p.air>=-5);
 }
 assert.equal(sampleDeathReaction(r,2).air,-5);
}
const legacy={speed:20,lift:10,distance:10,x:1,z:1};
assert.equal(sampleDeathReaction(legacy,.3).x,0);
assert.equal(sampleDeathReaction(legacy,.3).air,0);
assert.equal(sampleDeathReaction(null,1).pitch,Math.PI/2);
console.log('Death falls pass: no launch, drift, bounce or floor penetration; legacy snapshots ignored.');
