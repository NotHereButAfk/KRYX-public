import assert from 'node:assert/strict';
import {networkMotionFeedback} from '../src/player/NetworkMotionFeedback.js';
function simulate(hz){const p={position:{x:0,z:0},yaw:0,onGround:true,bobTime:0};networkMotionFeedback(p,1/hz);for(let i=0;i<hz;i++){p.position.x+=7/hz;networkMotionFeedback(p,1/hz);}return p;}
const a=simulate(30),b=simulate(144);assert(a.bobTime>10);assert(Math.abs(a.bobTime-b.bobTime)<1e-9);assert(a._strafeTilt<-.02);
let phase=a.bobTime;for(let i=0;i<120;i++)networkMotionFeedback(a,1/60,false);assert.equal(a.bobTime,phase);assert(Math.abs(a._strafeTilt)<1e-6);
a.position.x+=100;networkMotionFeedback(a,1/60);assert.equal(a.bobTime,phase);
a.onGround=false;a.position.x+=.1;networkMotionFeedback(a,1/60);assert.equal(a.bobTime,phase);
a.reduceMotion=true;assert.equal(networkMotionFeedback(a,1/60),0);
console.log('Multiplayer feedback: actual travel advances gait, tilt survives, FPS parity, menu stop, teleport and air exclusions passed.');
