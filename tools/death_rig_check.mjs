import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter} from '../src/player/EvCharacter.js';
import {Avatar} from '../src/player/Avatar.js';
import {createDeathReaction,DEATH_BODY_DURATION} from '../src/sim/DeathReaction.js';
globalThis.ProgressEvent ??= class {constructor(type,data){Object.assign(this,{type},data);}};
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
const vertex=new THREE.Vector3();
const finalPoses=new Map();
for(const hz of [30,60,144]) for(const isBot of [false,true]) for(const side of [-1,1]) for(const yaw of [0,1.2,-2.4]) {
 const avatar=new Avatar(new THREE.Scene()), g=avatar.group; avatar._deathSide=-side;
 const altitude=isBot?5:0;
 const state={position:new THREE.Vector3(2,3+altitude,3),yaw,alive:true,grounded:true,speed:5,sprint:true};
 for(let i=0;i<hz;i++)avatar.update(1/hz,state);
 const bones=Object.values(g.userData.bones), before=bones.map(b=>b.quaternion.clone());
 const initialHip=g.userData.bones.Bip001_Pelvis.getWorldPosition(new THREE.Vector3()).y;
 const reaction={...createDeathReaction('m4',{px:2,py:state.position.y,pz:3},null,undefined,()=>3),floorY:3};
 let supported=0,worstFloorError=0,previousHip=initialHip,largestRise=0;
 for(let i=1;i<=Math.ceil(1.5*hz);i++) {
  const t=i/hz;avatar.update(1/hz,{...state,alive:false,isBot,deathReaction:reaction});
  assert(bones.every(b=>b.quaternion.toArray().every(Number.isFinite)),'invalid death transform');
  if(t>.4)assert(bones.some((b,j)=>b.quaternion.angleTo(before[j])>.15),'limbs stayed frozen');
  g.updateMatrixWorld(true);let bottom=Infinity;
  g.traverseVisible(m=>{if(!m.isMesh||!m.geometry?.attributes.position)return;if(m.isSkinnedMesh)m.skeleton.update();
   for(let v=0;v<m.geometry.attributes.position.count;v++)bottom=Math.min(bottom,m.getVertexPosition(v,vertex).applyMatrix4(m.matrixWorld).y);});
  const hip=bones.find(b=>b.name==='Bip001_Pelvis').getWorldPosition(vertex).y;
  largestRise=Math.max(largestRise,hip-previousHip);previousHip=hip;
  assert(hip<=initialHip+.025,'corpse lifted before falling');
  assert(bottom>=2.99,`body penetrated floor: ${bottom}`);
  if(bottom>3.04 && altitude>0) {
   const expectedHip=state.position.y+g.userData.deathAnchorY*g.scale.y-11*t*t;
   assert(Math.abs(hip-expectedHip)<.015,`airborne body hovered off gravity trajectory: ${hip} vs ${expectedHip}`);
  }
  if(t>1) {
   worstFloorError=Math.max(worstFloorError,Math.abs(bottom-3));
   assert(Math.abs(bottom-3)<.01,`settled body hovered: ${bottom}`);supported++;
  }
 }
 const pose=bones.flatMap(b=>[...b.position,...b.quaternion]);
 // The side is cosmetic instance parity, so compare both sides independently.
 const key=[side,yaw,isBot].join(','), finalPose=finalPoses.get(key);
 if(finalPose)assert(pose.every((v,i)=>Math.abs(v-finalPose[i])<1e-6),'rest pose depends on refresh rate');
 finalPoses.set(key,pose);
 const resting=g.position.clone();avatar.update(0,{...state,alive:false,isBot,deathReaction:reaction});
 assert(g.position.distanceTo(resting)<1e-7,'cached resting body drifts');
 avatar.update(DEATH_BODY_DURATION,{...state,alive:false,isBot,deathReaction:reaction});assert(!g.visible,'corpse never retires');
 avatar.update(1/hz,state);assert(g.visible&&g.userData.activeAnimation!=='Death','respawn leaves death pose');
 console.log(`Death rig ${hz}Hz bot=${isBot} side=${side} yaw=${yaw}: ${supported} grounded frames, floor error ${worstFloorError.toFixed(4)}m, gravity drop from ${altitude}m, released limbs, stable rest, clean respawn`);
 avatar.dispose();
}
