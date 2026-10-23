import assert from 'node:assert/strict';
import {createState,step,makeInput} from '../src/sim/MoveSim.js';
import {IMPORTED_ARENAS} from '../server/rookarena.mjs';
// Fractal pickup decks have a 25cm lip that used to stop a walking capsule.
const fractal = IMPORTED_ARENAS.find(arena => arena.id === 'fractal');
for (const index of [0, 1, 2, 3, 4, 5]) {
 const pad = fractal.pickups[index];
 const floor = pad.y - .5419995;
 const yaw = [0,0,3,0,2,1][index] * Math.PI / 2;
 let state = createState(pad.x + Math.sin(yaw)*10, floor, pad.z + Math.cos(yaw)*10), nearest = Infinity;
 for (let tick = 0; tick < 40; tick++) {
  state = fractal.resolveState(state, step(state, makeInput({mz:1,yaw}), fractal));
  nearest = Math.min(nearest, Math.hypot(state.px-pad.x,state.pz-pad.z));
 }
 assert.ok(nearest < 1.4, 'Walking cannot reach Fractal pickup ' + index + ': ' + nearest);
}
console.log('All six Fractal pickup platforms are reachable without jumping.');

import * as THREE from 'three';
import {Octree} from 'three/addons/math/Octree.js';
import {Capsule} from 'three/addons/math/Capsule.js';
import {tryMeshStep} from '../src/world/MeshStep.js';
function attempt(height, ceiling = false) {
 const root = new THREE.Group();
 const block = new THREE.Mesh(new THREE.BoxGeometry(4,height,4));
 block.position.set(0,height/2,-2);root.add(block);
 if(ceiling){const roof=new THREE.Mesh(new THREE.BoxGeometry(6,.1,6));roof.position.set(0,1.85,0);root.add(roof);}
 root.updateMatrixWorld(true);const octree=new Octree().fromGraphNode(root);
 const capsule=new Capsule(new THREE.Vector3(0,.45,.4),new THREE.Vector3(0,1.25,.4),.45);
 const hit=octree.capsuleIntersect(capsule);
 return !!hit && tryMeshStep(octree,capsule,hit,0,-.1);
}
assert.equal(attempt(.25),true,'ordinary lip should be walkable');
assert.equal(attempt(.9),false,'tall walls must remain solid');
assert.equal(attempt(.25,true),false,'low ceilings must prevent step-up');
console.log('Step-up respects wall height and headroom.');
