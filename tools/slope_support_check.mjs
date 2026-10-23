import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
import {resolveMeshContact} from '../src/world/MeshStep.js';
import {IMPORTED_ARENAS} from '../server/rookarena.mjs';
import {createState, step, makeInput} from '../src/sim/MoveSim.js';
const arena = IMPORTED_ARENAS.find(a => a.id === 'fractal');
for (const [x,y,z] of [[-76,32.096766,-48],[-60,7.996630,-60],[-52,5.998144,-60],[-52,7.996255,-8]]) {
 let state = createState(x,y,z);
 for (let tick=0;tick<200;tick++) state=arena.resolveState(state,step(state,makeInput(),arena));
 assert(Math.hypot(state.px-x,state.pz-z)<.002, 'stationary character slid down ramp');
 assert.equal(state.onGround,1);
 assert.equal(state.vx,0);assert.equal(state.vz,0);
 const moving=arena.resolveState(state,step(state,makeInput({mz:1}),arena));
 assert(Math.hypot(moving.px-state.px,moving.pz-state.pz)>.1,'support pinned movement');
 const jumping=arena.resolveState(state,step(state,makeInput({jumpJust:true}),arena));
 assert(jumping.py>state.py+.2 && jumping.vy>0,'support cancelled jump');
}
const capsule=new Capsule(new Vector3(0,.45,0),new Vector3(0,1.25,0),.45);
const push=new Vector3(), hit={normal:new Vector3(.6,.8,0),depth:.1};
assert(resolveMeshContact(capsule,hit,push,true));assert.equal(push.x,0);assert.equal(push.y,.125);
assert(!resolveMeshContact(capsule,hit,push,false));assert(push.x>0,'airborne contacts lost normal collision');
assert(!resolveMeshContact(capsule,{normal:new Vector3(1,0,0),depth:.1},push,true));assert.equal(push.x,.1);
console.log('Slope support: 10s stationary holds on four imported ramps, movement, jumps, airborne and wall contacts pass.');
