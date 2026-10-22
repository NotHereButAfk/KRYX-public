import assert from 'node:assert/strict';
import {createDeathReaction,sampleDeathReaction,DEATH_SETTLE_TIME,DEATH_BODY_DURATION} from '../src/sim/DeathReaction.js';
const unobstructed=(ox,oy,oz,dx,dy,dz,far)=>dy<0?oy:far;
for(const weapon of ['m4','levershotgun','rpg','concussion']) {
 const r=createDeathReaction(weapon,{px:0,py:0,pz:0},{x:-3,y:0,z:0},unobstructed,()=>0);
 const explosive=['rpg','concussion'].includes(weapon),distance=explosive?4.5:3;
 assert(Math.abs(r.distance-distance)<1e-10);
 assert(r.lift*r.lift/44<.41,'launch lift should stay modest');
 for(const fps of [30,60,144]) {
  let previous=0;
  for(let i=0;i<fps*2;i++) {
   const p=sampleDeathReaction(r,i/fps);
   assert(p.x>=previous-1e-10 && p.x<=distance+1e-10,'horizontal launch must approach its bounded endpoint');
   assert.equal(p.z,0); assert(p.air>=0 && p.air<.41,'launch apex exceeded limit');
   previous=p.x;
  }
 }
 assert.equal(sampleDeathReaction(r,2).air,0);
 assert(sampleDeathReaction(r,2).settled);
 assert(Math.abs(sampleDeathReaction(r,2).x-distance)<1e-10);
}
const target={px:0,py:0,pz:0}, source={x:-5,z:0};
const wall=(ox,oy,oz,dx,dy,dz,far)=>dx>0?Math.min(far,(3.5-ox)/dx):unobstructed(ox,oy,oz,dx,dy,dz,far);
const clipped=createDeathReaction('rpg',target,source,wall,()=>0);
assert(Math.abs(clipped.distance-2.35)<1e-9,'fallen-body clearance must stop before the wall');
for(let t=0;t<2;t+=.007)assert(sampleDeathReaction(clipped,t).x+1.15<=3.5+1e-9);
const ledge=createDeathReaction('rpg',target,source,unobstructed,x=>x<1.5?0:-5);
assert(ledge.distance<1.5,'launch must stop before a sharp ledge');
const voidEdge=createDeathReaction('m4',target,source,unobstructed,x=>x<1.5?0:-Infinity);
assert(voidEdge.distance<1.5,'launch must not leave the map');
const slope=createDeathReaction('m4',target,source,unobstructed,x=>-.2*x);
for(let t=0;t<1;t+=.01) {
 const p=sampleDeathReaction(slope,t);
 assert(Math.abs(p.floorOffset+.2*p.x)<1e-9,'floor must follow the actual map along the launch');
}
const ceiling=createDeathReaction('m4',target,source,(x,y,z,dx,dy,dz,far)=>dy>0?.1:unobstructed(x,y,z,dx,dy,dz,far),()=>0);
assert(ceiling.lift*ceiling.lift/44<=.020001,'low ceiling should remove unsafe lift');
for(const source of [null,{x:0,z:0}]) {
 const r=createDeathReaction('m4',target,source,unobstructed,()=>0);
 assert.equal(sampleDeathReaction(r,.3).x,0);
 assert.equal(sampleDeathReaction(r,.3).air,0);
}
const legacy={speed:20,lift:10,distance:10,x:1,z:1};
assert.equal(sampleDeathReaction(legacy,.3).x,0);
assert.equal(sampleDeathReaction(legacy,.3).air,0);
assert.equal(sampleDeathReaction(null,1).pitch,Math.PI/2);
console.log('Controlled death launch: direction, bounded distance/lift, wall clearance, real floor, void/ledge stops, ceiling clearance, deterministic 30/60/144Hz.');

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
