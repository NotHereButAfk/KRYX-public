import assert from 'node:assert/strict';
import * as THREE from 'three';
import {groundDeathBody} from '../src/player/DeathBody.js';
const root=new THREE.Group(), bone=new THREE.Bone();
const geometry=new THREE.BoxGeometry(.6,1.8,.4);
const count=geometry.attributes.position.count;
geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));root.add(mesh);
bone.rotation.z=.3;
let calls=0;const original=mesh.getVertexPosition;
mesh.getVertexPosition=function(...args){calls++;return original.apply(this,args);};
let key={};
for(let i=0;i<60;i++){
 root.rotation.set(i*.025,i*.04,.15);root.position.set(2,-4,3);
 root.scale.set(1,1.1,.9);
 groundDeathBody(root,2,.3,key);
 root.updateMatrixWorld(true);mesh.skeleton.update();
 let bottom=Infinity;const v=new THREE.Vector3();
 for(let j=0;j<count;j++){original.call(mesh,j,v).applyMatrix4(mesh.matrixWorld);bottom=Math.min(bottom,v.y);}
 assert(Math.abs(bottom-2.3)<1e-5,`cached floor error ${bottom}`);
}
assert.equal(calls,count,'frozen body was reskinned every frame');
bone.rotation.x=.8;key={};groundDeathBody(root,2,0,key);
assert.equal(calls,count*2,'new death must invalidate frozen pose');
groundDeathBody(root,2);assert.equal(calls,count*3,'animated deaths must retain exact dynamic skinning');
console.log('Frozen death support: exact floor contact through 60 rotations, one skinning pass, new-pose invalidation.');
