import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter} from '../src/player/EvCharacter.js';
import {Avatar} from '../src/player/Avatar.js';
globalThis.ProgressEvent??=class{};
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
for(const fps of [30,60,144])for(const distance of [0,30,55]){
 const avatar=new Avatar(new THREE.Scene()),u=avatar.group.userData;
 const position=new THREE.Vector3();let supplied=0,travelled=0,stopped=false;
 const set=u.setLocomotion;
 u.setLocomotion=(...args)=>{supplied+=args[6]||0;set(...args);};
 avatar.update(1/fps,{position,yaw:0,grounded:true,viewDistanceSq:distance**2});
 for(let i=0;i<fps*3;i++){
  // Starts, 14m/s sprint, abrupt slowdown, and wall collision. Intentionally
  // keep requested speed at 14: only visible position is authoritative here.
  const speed=i<fps?14:i<fps*2?5:0,step=speed/fps;
  position.z-=step;travelled+=step;
  avatar.update(1/fps,{position,yaw:0,speed:14,sprint:true,grounded:true,viewDistanceSq:distance**2});
  if(i>fps*2+fps/4){assert.match(u.activeAnimation,/idle/i,'wall collision must stop the leg cycle even while sprint input stays held');stopped=true;}
 }
 assert(stopped);assert(Math.abs(supplied-travelled)<1e-6,`${fps}Hz LOD ${distance}: stride lost distance ${travelled-supplied}`);
 avatar.dispose();
}
console.log('PASS live Avatar distance-driven gait at 30/60/144Hz and near/mid/far LOD; stops against walls despite sprint intent.');
for(const fps of [30,60,144])for(const isBot of [false,true])for(const baseSpeed of [3,7.2,11.2])for(const firing of [false,true])for(const [dirF,dirR] of [[1,0],[0,1],[0,-1],[-1,0],[Math.SQRT1_2,Math.SQRT1_2]]){
 const speed=baseSpeed;
 const avatar=new Avatar(new THREE.Scene()),u=avatar.group.userData,position=new THREE.Vector3(),samples=[],previous={};
 for(let i=0;i<fps*4;i++){
  position.x+=dirR*speed/fps;position.z-=dirF*speed/fps;
  avatar.update(1/fps,{position,yaw:0,sprint:baseSpeed>9,grounded:true,firing,isBot});
  for(const side of ['L','R']){
   const p=u.bones[`Bip001_${side}_Foot`].getWorldPosition(new THREE.Vector3()),last=previous[side];
   if(i>fps&&last)samples.push({height:p.y,slip:Math.hypot(p.x-last.x,p.z-last.z)*fps/speed});
   previous[side]=p;
  }
 }
 const floor=Math.min(...samples.map(p=>p.height)),planted=samples.filter(p=>p.height<floor+.035);
 const slip=planted.reduce((sum,p)=>sum+p.slip,0)/planted.length;
 assert(slip<.35,`${fps}Hz ${speed}m/s ${dirF},${dirR}: planted feet slide ${(slip*100).toFixed(1)}% of body speed`);
 avatar.dispose();
}
console.log('PASS measured world-space foot planting at walking/sprinting speeds, forward/backward/diagonal/strafe, firing and idle weapons, 30/60/144Hz.');
