import assert from 'node:assert/strict';
import {applyMouseLook} from '../src/core/MouseLook.js';
import {InputManager,requestPointerLockSafely} from '../src/core/InputManager.js';
const player=()=>({yaw:0,pitch:0,baseFov:75,camera:{fov:75},sensitivityMult:1});
for(const fps of [30,60,144,240]){
 const p=player();for(let i=0;i<fps;i++)applyMouseLook(p,{mouseDX:400/fps,mouseDY:80/fps});
 assert(Math.abs(p.yaw+0.96)<1e-12);assert(Math.abs(p.pitch+0.192)<1e-12);
}
const p=player();applyMouseLook(p,{mouseDX:10,mouseDY:0});assert(Math.abs(p.yaw+.024)<1e-12);
const stoppedYaw=p.yaw;applyMouseLook(p,{mouseDX:0,mouseDY:0});assert.equal(p.yaw,stoppedYaw,'no smoothing tail after stopping');
for(const fov of [28,50,65,75,81]){const p=player();p.camera.fov=fov;applyMouseLook(p,{mouseDX:10,mouseDY:0});const scale=Math.min(1,Math.tan(fov*Math.PI/360)/Math.tan(75*Math.PI/360));assert(Math.abs(p.yaw+.024*scale)<1e-12);}
p.invertY=true;applyMouseLook(p,{mouseDX:NaN,mouseDY:1e6});assert.equal(p.pitch,Math.PI/2-.05);assert(Number.isFinite(p.yaw));
let calls=[],errors=0;requestPointerLockSafely({requestPointerLock(options){calls.push(options);return options?Promise.reject(Object.assign(Error(),{name:'NotSupportedError'})):Promise.resolve();}},()=>errors++);
await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,[{unadjustedMovement:true},undefined]);assert.equal(errors,0);
calls=[];requestPointerLockSafely({requestPointerLock(options){calls.push(options);return Promise.reject(Object.assign(Error(),{name:'NotAllowedError'}));}},()=>errors++);
await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,1);assert.equal(errors,1);
let legacy;assert.equal(requestPointerLockSafely({requestPointerLock(options){legacy=options;}}),true);assert.equal(legacy.unadjustedMovement,true);
globalThis.window=new EventTarget();window.matchMedia=()=>({matches:false});globalThis.document=new EventTarget();document.pointerLockElement=null;
const canvas=new EventTarget(),input=new InputManager(canvas);document.pointerLockElement=canvas;input.mouseDX=999;input._onPointerLockChange();assert.equal(input.mouseDX,0);
input._onMouseMove({movementX:.25,movementY:-.5});input._onMouseMove({movementX:.75,movementY:-.5});assert.equal(input.mouseDX,1);assert.equal(input.mouseDY,-1);
input.endFrame();assert.equal(input.mouseDX,0);input._onMouseMove({movementX:NaN,movementY:Infinity});assert.equal(input.mouseDX,0);
input._onMouseMove({movementX:30,movementY:20});window.dispatchEvent(new Event('blur'));assert.equal(input.mouseDX,0);assert.equal(input.mouseDY,0);
document.pointerLockElement=null;input._onPointerLockChange();input._onMouseMove({movementX:10,movementY:10});assert.equal(input.mouseDX,0);input.dispose();
console.log('Mouse input passed: 30–240 FPS turn parity, fractional deltas, immediate stop, zoom scaling, raw input fallback, focus/lock reset.');
