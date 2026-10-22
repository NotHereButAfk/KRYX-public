import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LandingEffect} from '../src/effects/LandingEffect.js';
for (const fps of [30,60,144]) {
 const scene=new THREE.Scene(), fx=new LandingEffect(scene);
 const state={position:new THREE.Vector3(1,0,3), grounded:true, alive:true,vy:0};
 fx.update(1/fps,state);assert.equal(scene.children.length,0,'spawn emitted landing dust');
 fx.update(1/fps,{...state,grounded:false,vy:-10});fx.update(1/fps,state);
 assert(fx.mesh.visible);const anchor=fx.mesh.position.clone();
 state.position.x=10;fx.update(1/fps,state);assert(fx.mesh.position.equals(anchor),'landing follows moving actor');
 for(let i=0;i<fps;i++)fx.update(1/fps,state);assert(!fx.mesh.visible);
 fx.update(1/fps,{...state,grounded:false,vy:-10});fx.update(1/fps,state);
 assert.equal(scene.children.length,1,'landing allocates unbounded meshes');
 fx.dispose();assert.equal(scene.children.length,0,'landing leaks across map teardown');
}
console.log('Landing cues pass at 30/60/144Hz: no spawn puff, world anchored, bounded lifetime and disposal.');
