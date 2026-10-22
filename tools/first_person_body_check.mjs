import assert from 'node:assert/strict';
import {createBodyDynamics} from '../src/player/BodyDynamics.js';
import {firstPersonBodyPose} from '../src/player/FirstPersonBody.js';
const zero={pitch:0,roll:0,twist:0,drop:0};
assert(Object.values(firstPersonBodyPose(zero,0,0)).every(v=>v===0));
const d=createBodyDynamics();for(let i=0;i<12;i++)d.step({vx:6,vz:-6,yaw:0,grounded:true},1/60);
const moving=firstPersonBodyPose(d.value,.6,1);
assert(Math.abs(moving.z)>.001 && Math.abs(moving.roll)>.001);
assert(Object.values(firstPersonBodyPose(d.value,.6,1,0)).every(v=>v===0),'ADS/reduced motion must suppress body offsets');
for(let i=0;i<180;i++)d.step({vx:0,vz:0,yaw:0,grounded:true},1/60);
assert(Object.values(firstPersonBodyPose(d.value,0,0)).every(v=>Math.abs(v)<.0001),'release/ESC must settle');
for(let p=0;p<6.3;p+=.1){const v=firstPersonBodyPose({pitch:.065,roll:.04,twist:.025,drop:-.02},p,1);assert(Math.abs(v.x)<.035&&Math.abs(v.z)<.032&&Math.abs(v.y)<.03&&Math.abs(v.roll)<.04);}
console.log('First-person body: weight shift, bounded shoulder stride, ADS/reduced motion, and stop recovery passed.');

const walk=firstPersonBodyPose(zero,Math.PI/2,1,1,0),run=firstPersonBodyPose(zero,Math.PI/2,1,1,1);
assert(Math.abs(run.x)>Math.abs(walk.x)*1.4 && Math.abs(run.roll)>Math.abs(walk.roll)*1.4);
assert(Object.values(firstPersonBodyPose(zero,1,0,1,1)).every(v=>v===0));
assert(Object.values(firstPersonBodyPose(zero,1,1,0,1)).every(v=>v===0));
