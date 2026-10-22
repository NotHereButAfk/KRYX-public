import assert from 'node:assert/strict';
import {createDeathReaction,sampleDeathReaction,DEATH_SETTLE_TIME,DEATH_BODY_DURATION} from '../src/sim/DeathReaction.js';
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

assert.equal(sampleDeathReaction(null,DEATH_SETTLE_TIME-.01).settled,false);
assert.equal(sampleDeathReaction(null,DEATH_SETTLE_TIME).settled,true);
assert.equal(sampleDeathReaction(null,DEATH_BODY_DURATION-.01).done,false);
assert.equal(sampleDeathReaction(null,DEATH_BODY_DURATION).done,true);
import {createHumanDeathPose,sampleHumanDeathPose} from '../src/player/HumanActionMotion.js';
for(const side of [-1,1]) {
 const at=t=>sampleHumanDeathPose(1,side,createHumanDeathPose(),t);
 const start=at(0), final=at(DEATH_SETTLE_TIME);
 assert(Object.values(start).every(v=>v===0),'death must start without snapping any limb');
 assert.deepEqual(at(10),final,'settled limbs must stop moving exactly');
 assert.notEqual(at(.44).rForeX,at(.56).rForeX,'elbow should follow through after floor contact');
 assert.notEqual(final.rCalfX,final.lCalfX,'relaxed legs should not look cloned');
 for(let i=1;i<=1200;i++) {
  const pose=at(i/1000), previous=at((i-1)/1000);
  for(const key of Object.keys(pose)) assert(Math.abs(pose[key]-previous[key])<.015,`limb discontinuity ${key}`);
 }
}
console.log('Relaxed death limbs: continuous start, independent contact follow-through, exact finite rest.');

const airborne={groundOffset:-5};
const first=sampleDeathReaction(airborne,.1),second=sampleDeathReaction(airborne,.2);
assert(Math.abs(first.drop+.11)<1e-12);
assert(Math.abs(second.drop+.44)<1e-12);
assert(second.impactTime>.7 && second.impactTime<.8,'airborne impact follows its fall distance');
assert.equal(sampleDeathReaction(airborne,4).air,-5,'camera baseline must stop at real floor');
assert(sampleDeathReaction(airborne,4).drop < -5,'solver retains freefall below contact for floor clamping');
assert(sampleDeathReaction({...airborne,fallVelocity:-6},.2).drop < second.drop,'existing downward speed continues');
