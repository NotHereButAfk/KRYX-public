import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter} from '../src/player/EvCharacter.js';
import {Avatar} from '../src/player/Avatar.js';
import {createDeathReaction,sampleDeathReaction} from '../src/sim/DeathReaction.js';
globalThis.ProgressEvent ??= class {constructor(type,data){Object.assign(this,{type},data);}};
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
const point=new THREE.Vector3(),hip=new THREE.Vector3();
for(const yaw of [0,1.2,-2.4]) for(const airborne of [false,true]) {
 const origin=new THREE.Vector3(2,airborne?6:3,3), wallX=4.8;
 const state={position:origin,yaw,alive:true,grounded:true,speed:5,sprint:true};
 const ray=(x,y,z,dx,dy,dz,far)=>dx>0?Math.min(far,(wallX-x)/dx):far;
 const reaction=createDeathReaction('rpg',{px:origin.x,py:origin.y,pz:origin.z},{x:-5,z:3},ray,()=>3);
 const avatar=new Avatar(new THREE.Scene()),g=avatar.group;
 for(let i=0;i<45;i++)avatar.update(1/60,state);
 let furthest=-Infinity,lowest=Infinity;
 for(let i=1;i<=24;i++) {
  const t=i/20,sample=sampleDeathReaction(reaction,t);
  avatar.update(.05,{...state,alive:false,deathReaction:reaction});
  g.updateMatrixWorld(true);
  g.userData.deathAnchor.getWorldPosition(hip);
  assert(Math.abs(hip.x-(origin.x+sample.x))<1e-6,'pelvis left the swept collision path');
  assert(Math.abs(hip.z-origin.z)<1e-6,'pelvis drifted sideways while rotating');
  g.traverseVisible(mesh=>{
   if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
   if(mesh.isSkinnedMesh)mesh.skeleton.update();
   for(let j=0;j<mesh.geometry.attributes.position.count;j++) {
    mesh.getVertexPosition(j,point).applyMatrix4(mesh.matrixWorld);
    lowest=Math.min(lowest,point.y);furthest=Math.max(furthest,point.x);
   }
  });
  assert(lowest>=2.99,'launched body penetrated actual floor');
  assert(furthest<=wallX+.01,`launched body penetrated wall: ${furthest}`);
 }
 const rest=g.position.clone();avatar.update(.5,{...state,alive:false,deathReaction:reaction});
 assert(g.position.distanceTo(rest)<1e-6,'settled launch drifted');
 avatar.update(.01,state);assert(g.visible&&g.userData.activeAnimation!=='Death');
 console.log(`Launch mesh yaw=${yaw}, altitude=${airborne?3:0}: pelvis follows bounded path, floor=${lowest.toFixed(3)}, wall clearance=${(wallX-furthest).toFixed(3)}, stable rest and respawn`);
 avatar.dispose();
}
