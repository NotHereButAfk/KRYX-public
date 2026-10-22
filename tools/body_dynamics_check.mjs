import assert from 'node:assert/strict';
import {createBodyDynamics} from '../src/player/BodyDynamics.js';
function run(hz){const d=createBodyDynamics();let peaks={pitch:0,roll:0,drop:0};for(let i=0;i<hz*4;i++){const t=i/hz,v=t<.3?0:t<1?6:t<1.5?-4:0;const p=d.step({vx:0,vz:-v,yaw:0,grounded:!(t>=2&&t<2.5),vy:t>=2&&t<2.5?-8:0},1/hz);for(const k of Object.keys(peaks))peaks[k]=Math.max(peaks[k],Math.abs(p[k]));}return {peaks,value:{...d.value}};}
const a=run(30),b=run(144);assert(a.peaks.pitch>.015);assert(a.peaks.drop>.005);assert(a.peaks.drop<.04);assert(Math.abs(a.peaks.pitch-b.peaks.pitch)<.01);assert(Math.abs(a.peaks.drop-b.peaks.drop)<.008);assert(Math.abs(a.value.pitch)<.001);
const d=createBodyDynamics();for(let i=0;i<15;i++)d.step({vx:6,vz:0,yaw:0,grounded:true},1/60);assert(d.value.roll>0);assert(d.value.roll<.041);
for(let i=0;i<120;i++)d.step({vx:6,vz:0,yaw:0,grounded:true},1/60);assert(Math.abs(d.value.roll)<.001,'steady movement must not hold a sideways tilt');
d.reset();assert.deepEqual(d.value,{pitch:0,roll:0,twist:0,drop:0});
for(let i=0;i<60;i++)d.step({vx:0,vz:0,yaw:i*.02,grounded:true},1/60);assert.equal(d.value.roll,0);assert.equal(d.value.pitch,0);assert(d.value.twist<0);
d.step({vx:99,vz:99,yaw:0,grounded:true},1);assert.deepEqual(d.value,{pitch:0,roll:0,twist:0,drop:0});
console.log('Body dynamics: acceleration, braking, lateral settling, turning, landing, reset and 30/144Hz checks passed.');
