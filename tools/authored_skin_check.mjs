import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { ARMOR_SKINS } from '../src/player/ArmorSkins.js';
import { disposeModel } from '../src/core/ModelResources.js';
globalThis.ProgressEvent ??= class {constructor(type,data){Object.assign(this,{type},data);}};
async function load(path){const b=fs.readFileSync(new URL('../public'+path,import.meta.url));return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
installEvCharacter(await load('/ev-default.glb'));
for(const skin of ARMOR_SKINS.filter(s=>s.model)) {
  installAuthoredSkin(skin.id,await load(skin.model));
  const player=buildEvCharacter(null,skin);
  assert(await player.userData.skinReady, 'authored model must load');
  assert.equal(player.userData.authoredSkinId,skin.id);
  for(const state of [{speed:0,grounded:true},{speed:7.425,grounded:true},{speed:11.1375,sprint:true,grounded:true},{speed:5,grounded:false,vy:5},{speed:0,grounded:true,crouch:1}]) {
    for(let i=0;i<60;i++){player.userData.setLocomotion(state.speed,state.grounded,state.sprint);player.userData.setActionState(state);player.userData.mixer.update(1/60);}
    player.updateMatrixWorld(true);
    const armor=player.getObjectByName('Blender authored armor');
    const box=new THREE.Box3().setFromObject(armor,true);const size=box.getSize(new THREE.Vector3());
    assert(size.x<3 && size.y<3 && size.z<3 && size.y>.6,`${skin.id} invalid deformed bounds ${size.toArray()}`);
    armor.traverse(o=>{if(o.isSkinnedMesh) {assert(o.skeleton.bones.every(b=>Object.values(player.userData.bones).includes(b)));assert(o.geometry.userData.shared);}});
  }
  const native=[];player.traverse(o=>{if(o.isSkinnedMesh && !o.parent.name.includes('authored'))native.push(o);});
  player.userData.applyFinish(null,null);await player.userData.skinReady;
  assert.equal(player.getObjectByName('Blender authored armor'),undefined,'unequipping must remove custom geometry');
  assert(native.every(o=>o.visible),'unequipping must restore original character');
  player.userData.applyFinish(null,skin);player.userData.applyFinish(null,null);await Promise.resolve();await Promise.resolve();
  assert.equal(player.userData.authoredSkinId,null,'stale load must not replace newer equip');
  player.userData.applyFinish(null,skin);disposeModel(player);await player.userData.skinReady;
  assert.equal(player.getObjectByName('Blender authored armor'),undefined,'late load must not populate a disposed character');
  console.log('Authored skin passed:',skin.id);
}
