import fs from 'node:fs';import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
globalThis.ProgressEvent ??= class {};
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.()})}readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:application/octet-stream;base64,'+Buffer.from(v).toString('base64');this.onloadend?.()})}};
const bytes=fs.readFileSync('public/ev-default.glb');const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');const root=gltf.scene;
const mixer=new THREE.AnimationMixer(root);mixer.clipAction(gltf.animations[0]).play();mixer.update(0);root.updateMatrixWorld(true);root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update()});
const box=new THREE.Box3();root.traverse(o=>{if(o.isSkinnedMesh)box.union(new THREE.Box3().setFromObject(o,true))});
const {STATURE}=await import('../src/player/Proportions.js');const scale=STATURE/(root.userData.rigBounds?.height??(box.max.y-box.min.y));const result=new THREE.Group();result.name='EV character first-person arms';result.userData.source='ev-default.glb';
for(const [side,code,dir]of [['Right','R',1],['Left','L',-1]]){
 const hand=root.getObjectByName(`Bip001_${code}_Hand`),fore=root.getObjectByName(`Bip001_${code}_Forearm`);if(!hand||!fore)throw Error('Missing arm bones');
 const wrist=hand.getWorldPosition(new THREE.Vector3()),elbow=fore.getWorldPosition(new THREE.Vector3());
 const rotation=new THREE.Quaternion().setFromUnitVectors(elbow.clone().sub(wrist).normalize(),new THREE.Vector3(dir*.22,-.60,.77).normalize());
 const arm=new THREE.Group();arm.name=`KYX_ViewArm_${side}`;arm.userData.sourceCharacter='ev-default';result.add(arm);let meshes=0;
 root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;const g=mesh.geometry,p=g.attributes.position,si=g.attributes.skinIndex,sw=g.attributes.skinWeight,idx=g.index;
  const boneNames=mesh.skeleton.bones.map(b=>b.name);const vertices=[];
  for(let i=0;i<p.count;i++){let aw=0,hw=0;for(let k=0;k<4;k++){const name=boneNames[si.getComponent(i,k)],w=sw.getComponent(i,k);if(new RegExp(`Bip001_${code}_(UpperArm|Forearm|Hand|Finger)`).test(name))aw+=w;if(new RegExp(`Bip001_${code}_(Hand|Finger)`).test(name))hw+=w;}const v=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).sub(wrist).multiplyScalar(scale).applyQuaternion(rotation);vertices.push({v,aw,hw})}
  for(const part of ['Hand','UpperSleeve']){const positions=[];for(let i=0;i<(idx?.count??p.count);i+=3){const tri=[0,1,2].map(k=>vertices[idx?idx.getX(i+k):i+k]);if(tri.some(v=>v.aw<.55))continue;const isHand=tri.reduce((t,v)=>t+v.hw,0)/3>.5;if(isHand!==(part==='Hand'))continue;for(const {v}of tri)positions.push(v.x,v.y,v.z)}if(!positions.length)continue;
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();const material=mesh.material.clone();material.userData.evArmMaterial=true;
  const out=new THREE.Mesh(geo,material);out.name=`KYX_View${side}_${part}`;out.userData.sourceCharacter='ev-default';arm.add(out);meshes++;}
 });console.log(side,meshes,'meshes');
}
const glb=await new GLTFExporter().parseAsync(result,{binary:true});fs.writeFileSync('public/ev-view-arms.glb',Buffer.from(glb));console.log('Baked current EV character arms',glb.byteLength);
