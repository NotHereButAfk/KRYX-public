import assert from 'node:assert/strict';
import {strafeTilt} from '../src/player/StrafeTilt.js';
function run(hz,speed){let v=0;for(let i=0;i<hz;i++)v=strafeTilt(v,speed,1/hz);return v;}
assert(run(60,7)<0 && run(60,-7)>0);
assert(Math.abs(run(30,7)-run(144,7))<1e-10);
assert(Math.abs(run(60,100))<=.028);
let v=run(60,7);for(let i=0;i<60;i++)v=strafeTilt(v,0,1/60);assert(Math.abs(v)<1e-6);
assert(strafeTilt(0,7,.1,false)===0);
console.log('Strafe tilt: left/right, bounded angle, FPS parity, release and reduced motion passed.');
