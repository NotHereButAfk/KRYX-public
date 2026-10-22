import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter,buildEvCharacter} from '../src/player/EvCharacter.js';
import {disposeModel} from '../src/core/ModelResources.js';
globalThis.ProgressEvent??=class{};
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
const cycles=i=>[4,5,10].includes(i)?2:1;
for(const hz of [30,60,144]){
 const body=buildEvCharacter(),u=body.userData;
 for(let frame=0;frame<hz*6;frame++){
  const time=frame/hz,speed=time<1?1:time<2?9:time<3?14:time<4?9:time<5?2:0;
  body.position.z-=speed/hz;
  u.setLocomotion(speed,true,speed>9,0,1,0,speed/hz);
  u.setActionState({firing:time>1.3&&time<3.3?1:0});
  u.mixer.update(1/hz);
  if(time>2.7&&time<3) assert(u.runLean<-.13,'running leans the torso forward');
  if(time>4.7) assert(Math.abs(u.runLean)<.001,'walking and idle return upright');
  const active=[1,2,4,5,9,10].filter(i=>u.animationActions[i].getEffectiveWeight()>.02);
  for(const i of active)for(const j of active){
   const phase=k=>(u.animationActions[k].time/u.animationActions[k].getClip().duration*cycles(k))%1;
   const delta=Math.abs(phase(i)-phase(j));
   assert(Math.min(delta,1-delta)<.015,`${hz}Hz at ${time.toFixed(3)}s: blended leg cycles ${i}/${j} drift by ${delta.toFixed(3)} of a stride`);
  }
 }
 disposeModel(body);
}
console.log('PASS shared footfall phase through walking, sprinting, firing, slowing and stopping at 30/60/144Hz.');

// The old preview Walk motion is now the run rate; walking is 20% slower.
for(const firing of [0,1]){
 const body=buildEvCharacter(),u=body.userData,rates=[];
 for(const sprint of [false,true]){
  for(let i=0;i<90;i++){
   u.setLocomotion(sprint?11.2:7.2,true,sprint,0,1,0,(sprint?11.2:7.2)/60);
   u.setActionState({firing});u.mixer.update(1/60);
  }
  rates.push(u.animationCadence);
 }
 assert(Math.abs(rates[0]/rates[1]-.8)<1e-6,'walking animation must be slower than running');
 disposeModel(body);
}
console.log('PASS separate walking/running playback rates, including while firing.');
