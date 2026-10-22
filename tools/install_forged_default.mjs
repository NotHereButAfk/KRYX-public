import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class {constructor(type,data){Object.assign(this,{type},data);}};
function read(path){const b=fs.readFileSync(path),len=b.readUInt32LE(12);return {j:JSON.parse(b.subarray(20,20+len)),bin:b.subarray(28+len),bytes:b};}
const old=read('art/player-skins/rig-source.glb'),skin=read('public/assets/player-skins/default_vanguard.glb'),j=old.j,s=skin.j;
const original=await new GLTFLoader().parseAsync(old.bytes.buffer.slice(old.bytes.byteOffset,old.bytes.byteOffset+old.bytes.byteLength),'');
const mixer=new THREE.AnimationMixer(original.scene);mixer.clipAction(original.animations[0]).play();mixer.update(0);original.scene.updateMatrixWorld(true);
const bounds=new THREE.Box3();original.scene.traverse(o=>{if(o.isSkinnedMesh)bounds.union(new THREE.Box3().setFromObject(o,true));});
Object.assign(j.scenes[j.scene||0],{extras:{rigBounds:{height:bounds.max.y-bounds.min.y,minY:bounds.min.y},design:'Forged Vanguard / Blender authored armor / published animation rig'}});
const bv=j.bufferViews.length,ac=j.accessors.length,mt=j.materials.length;
for(const v of s.bufferViews) j.bufferViews.push({...v,buffer:0,byteOffset:(v.byteOffset||0)+old.bin.length});
for(const a of s.accessors){if(a.sparse)throw Error('Sparse accessor needs explicit remapping');j.accessors.push({...a,...(a.bufferView!=null?{bufferView:a.bufferView+bv}:{})});}
j.materials.push(...s.materials);
const mi=j.meshes.length;
for(const m of s.meshes)j.meshes.push({...m,primitives:m.primitives.map(p=>({...p,attributes:Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,v+ac])),indices:p.indices+ac,material:p.material+mt}))});
const names=new Map(j.nodes.map((n,i)=>[n.name,i]));
const si=j.skins.length;
for(const sk of s.skins)j.skins.push({...sk,inverseBindMatrices:sk.inverseBindMatrices+ac,joints:sk.joints.map(id=>{const n=names.get(s.nodes[id].name);if(n==null)throw Error('Unknown bone '+s.nodes[id].name);return n;})});
const armor=j.nodes.find(n=>n.name==='EV.IO Default - Armor');armor.mesh=mi;armor.skin=si;
const body=j.nodes.find(n=>n.name==='EV.IO Default - Body');delete body.mesh;delete body.skin;
const bin=Buffer.concat([old.bin,skin.bin]);j.buffers=[{byteLength:bin.length}];
let json=Buffer.from(JSON.stringify(j));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync('public/ev-default.glb',Buffer.concat([header,json,bh,bin]));
console.log('Installed Blender armor while preserving all published animation buffers and joint nodes.');
