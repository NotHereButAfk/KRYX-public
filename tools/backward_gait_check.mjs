import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter} from '../src/player/EvCharacter.js';
import {Avatar} from '../src/player/Avatar.js';
globalThis.ProgressEvent??=class{};
const b=fs.readFileSync('public/ev-default.glb');
installEvCharacter(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),''));
for(const fps of [30,60,144]){
 const a=new Avatar(new T.Scene()),p=new T.Vector3(),last={},rates=[];
 for(let i=0;i<fps*5;i++){
  p.z+=3.6/fps;a.update(1/fps,{position:p,yaw:0,sprint:false,grounded:true,isBot:true});
  for(const side of ['L','R']){
   const q=a.group.userData.bones[`Bip001_${side}_Calf`].quaternion.clone();
   if(last[side]&&i>fps)rates.push(q.angleTo(last[side])*fps);
   last[side]=q;
  }
 }
 rates.sort((a,b)=>a-b);assert(rates.at(-1)<26,'backward calves must not snap between IK poses');console.log(fps,{max:rates.at(-1),p99:rates[Math.floor(rates.length*.99)]});
 a.dispose();
}
