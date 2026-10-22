import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter} from '../src/player/EvCharacter.js';
import {Avatar} from '../src/player/Avatar.js';
globalThis.ProgressEvent??=class{};
const b=fs.readFileSync('public/ev-default.glb');
installEvCharacter(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),''));
for(const fps of [30,60,144])for(const sprint of [false,true])for(const firing of [false,true]){
 const a=new Avatar(new T.Scene()),p=new T.Vector3(),last={},rates=[];
 for(let i=0;i<fps*5;i++){
  p.z-=(sprint?11.2:7.2)/fps;a.update(1/fps,{position:p,yaw:0,sprint,grounded:true,isBot:true,firing});
  for(const side of ['L','R']){
   const q=a.group.userData.bones[`Bip001_${side}_Calf`].quaternion.clone();
   if(last[side]&&i>fps)rates.push(q.angleTo(last[side])*fps / Math.max(.01,a.group.userData.animationCadence));
   last[side]=q;
  }
 }
 rates.sort((a,b)=>a-b);assert(rates.at(-1)<26,'forward knees must not snap per unit of clip time');console.log(fps,sprint,firing,{max:rates.at(-1),p99:rates[Math.floor(rates.length*.99)]});
 a.dispose();
}
