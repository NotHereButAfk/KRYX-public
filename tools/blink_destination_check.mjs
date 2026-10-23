import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { blinkDestination, createState, makeInput, step } from '../src/sim/MoveSim.js';
import { PLAYER_EYE_HEIGHT } from '../src/sim/MovementConfig.js';

const world=(overrides={})=>({half:50,boxes:[],platforms:[],gravLifts:[],teleporters:[],...overrides});
const near=(actual,expected,message,tolerance=2e-5)=>assert(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected}`);
const s=createState();
const open=world();
const out={};
assert.equal(blinkDestination(s,0,0,open,out),out,'preview should reuse its output object');
assert.deepEqual(out,{x:0,z:-22,y:0,distance:22});
assert.equal(s.pz,0,'preview mutated the player');
near(blinkDestination(s,Math.PI/2,0,open).x,-22,'yaw must use forward minus Z');
const upward=blinkDestination(s,0,Math.PI/6,open);
near(upward.y,11,'positive pitch aims upward');
near(upward.z,-22*Math.cos(Math.PI/6),'pitched horizontal range');
near(upward.distance,22,'distance must include vertical travel');
const downward=blinkDestination(createState(0,10,0),0,-Math.PI/6,open);
assert.equal(downward.y,0,'destination feet must not fall below the arena floor');
near(downward.distance,Math.hypot(downward.z,10),'clamped distance must describe actual travel');

const wall={min:[-10,0,-6],max:[10,8,-5]};
near(blinkDestination(s,0,0,world({boxes:[wall]})).z,-4.1,'AABB wall clearance');
let rayCall;
const meshWorld=world({raycast:(...args)=>{rayCall=args;return 4;}});
near(blinkDestination(s,.2,.3,meshWorld).distance,3.1,'mesh collider must stop blink');
near(rayCall[1],PLAYER_EYE_HEIGHT,'mesh ray must start at authoritative eye height');
near(Math.hypot(...rayCall.slice(3,6)),1,'mesh direction must be normalized');
assert.equal(rayCall[6],22);
near(blinkDestination(s,0,0,world({boxes:[wall],raycast:()=>8})).z,-4.1,'nearer box beats mesh');
near(blinkDestination(s,0,0,world({boxes:[wall],raycast:()=>3})).z,-2.1,'nearer mesh beats box');
assert.equal(blinkDestination(s,0,0,world({raycast:()=>Infinity})).distance,22);
assert.equal(blinkDestination(s,0,0,world({raycast:()=>-1})).distance,22);

// Regressions: the old slab solver skipped the first ten centimetres, while
// the old preview could claim a destination beyond the arena's movement inset.
const closeWall=world({boxes:[{min:[-2,-1,-1],max:[2,4,-.05]}]});
assert.equal(blinkDestination(s,0,0,closeWall).distance,0,'close wall must not permit a full-range blink through it');
assert.equal(blinkDestination(s,0,0,world({boxes:[{min:[-1,0,-1],max:[1,4,1]}]})).distance,0,'starting inside a collider must block');
assert.equal(blinkDestination(s,0,0,world({raycast:()=>.05})).distance,0,'near mesh face must not be crossed by minimum travel');
for(const [x,z,yaw] of [[45,0,-Math.PI/2],[-45,0,Math.PI/2],[0,45,Math.PI],[0,-45,0]]) {
  const state=createState(x,0,z),input=makeInput({yaw,teleJust:1});
  const target=blinkDestination(state,input.yaw,input.pitch,open);
  near(target.distance,3.8,'preview must stop at arena boundary');
  const actual=step(state,input,open);
  near(actual.px,target.x,'confirmed boundary X');near(actual.pz,target.z,'confirmed boundary Z');
}

// Load the real preview class without its browser-only CSS import. All JS and
// Three.js geometry run unmodified; a small marker stub replaces DOM layout.
const previewURL=new URL('../src/core/BlinkPreview.js',import.meta.url);
let source=readFileSync(previewURL,'utf8');
source=source.replace("'three'",JSON.stringify(import.meta.resolve('three')))
  .replace("'../sim/MoveSim.js'",JSON.stringify(new URL('../src/sim/MoveSim.js',import.meta.url).href))
  .replace("'../sim/MovementConfig.js'",JSON.stringify(new URL('../src/sim/MovementConfig.js',import.meta.url).href))
  .replace("import '../ui/teleport.css';",'');
const { BlinkPreview }=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const status={textContent:''},marker={dataset:{},querySelector:()=>status};
const preview=new BlinkPreview(new THREE.Scene(),marker);
const player={position:new THREE.Vector3(),yaw:0,pitch:0,camera:new THREE.PerspectiveCamera()};
assert(preview.measure(player,{}, {sim:s,simWorld:open}));
preview.update(1/60,true);
assert.equal(marker.dataset.valid,'true');assert.equal(status.textContent,'BLINK · 22 m');
near(preview.group.position.z,-22,'destination outline position');
assert.equal(preview.measure(player,{}, {sim:s,simWorld:closeWall}),false);
preview.update(1/60,true);
assert.equal(status.textContent,'PATH BLOCKED');assert.equal(marker.dataset.valid,'false');
const boundary=createState(48.7,0,0);player.position.set(48.7,0,0);player.yaw=-Math.PI/2;
assert.equal(preview.measure(player,{}, {sim:boundary,simWorld:open}),false,'sub-metre boundary blink must be invalid');

for(const [state,yaw,pitch,geometry] of [
  [s,0,0,open],[s,.4,.3,open],[s,0,0,world({boxes:[wall]})],
  [s,0,0,world({raycast:()=>4})],
  [s,1.3,0,world({boxes:[{min:[-30,0,-6],max:[30,8,-5]}]})],
]) {
  const input=makeInput({yaw,pitch,teleJust:1});
  player.position.set(state.px,state.py,state.pz);player.yaw=input.yaw;player.pitch=input.pitch;
  preview.measure(player,{}, {sim:state,simWorld:geometry});
  const actual=step(state,input,geometry);
  near(actual.px,preview.target.x,'preview vs confirmed X');near(actual.pz,preview.target.z,'preview vs confirmed Z');
  // The sim applies one gravity tick after the blink; ground support removes
  // it on flat terrain. The preview represents the instant destination.
  near(actual.py,Math.max(0,preview.target.y-.05),'preview vs confirmed height');
}

player.position.set(0,0,0);player.camera.position.set(0,PLAYER_EYE_HEIGHT,0);player.camera.updateMatrixWorld();
assert(preview.measure(player,{raycastCollisionHit:()=>({distance:5})},null));
near(preview.target.z,-4.1,'offline fallback wall hit');
assert.equal(preview.measure(player,{raycastCollisionHit:()=>({distance:.1})},null),false,'offline fallback close obstacle');
preview.hide();assert.equal(preview.group.visible,false);preview.dispose();
console.log('Blink destination passed: box/mesh precedence, close-wall and boundary blocking, pitch, displayed validity/distance, actual movement parity and preview cleanup.');
