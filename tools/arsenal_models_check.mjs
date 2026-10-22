import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { buildArsenalWeapon, ARSENAL_MODEL_IDS } from '../src/weapons/ArsenalModels.js';
import { buildWeaponModel } from '../src/weapons/WeaponModels.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
import { disposeModel } from '../src/core/ModelResources.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this,{type},data); } };
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
assert.deepEqual([...ARSENAL_MODEL_IDS].sort(),WEAPONS.map(w=>w.id).sort(),'every live weapon has a rebuilt model');
let worstGrip=0,worstSupport=0,maxDraws=0;
for(const def of WEAPONS) {
  const built=buildWeaponModel(def),other=buildArsenalWeapon(def);
  assert.equal(built.group.userData.designRevision,2,`${def.id} still selects an old model`);
  let draws=0,triangles=0;
  built.group.traverse(o=>{
    if(!o.isMesh)return;
    draws++;
    const geometry=o.geometry;
    triangles+=geometry.attributes.position.count/3;
    for(const attribute of ['position','normal','uv'])assert([...geometry.attributes[attribute].array].every(Number.isFinite),`${def.id}: invalid ${attribute}`);
    assert(geometry.userData.shared,'cached geometry must survive instance teardown');
    const peer=other.group.getObjectByName(o.name);
    assert.equal(peer.geometry,geometry,'instances share immutable mesh buffers');
    assert.notEqual(peer.material,o.material,'skin material is isolated per instance');
  });
  assert(draws<=6,`${def.id}: too many render batches (${draws})`);
  assert(triangles<12000,`${def.id}: excessive mesh complexity`);
  maxDraws=Math.max(maxDraws,draws);
  let disposed=0;
  built.group.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>disposed++);});
  disposeModel(other.group);assert.equal(disposed,0,'preview disposal invalidated live geometry');
  if(def.kind==='melee')continue;
  const character=buildEvCharacter(),ud=character.userData;
  ud.attachWeapon(built.group);
  assert(built.group.parent,`${def.id}: native rifle hid the rebuilt model`);
  for(const [speed,crouch,pitch,reload] of [[0,0,0,0],[2,0,.4,0],[5,0,-.4,0],[1,1,.2,0],[0,0,0,.45]]) {
    ud.setLocomotion(speed,true,speed>3);
    ud.setActionState({crouch,reload});ud.setAim(pitch);
    for(let i=0;i<30;i++) {
      ud.mixer.update(1/60);character.updateMatrixWorld(true);
      const pose=weaponHandPose(built.group);
      const target=new THREE.Vector3(...pose.trigger).applyMatrix4(built.group.matrixWorld);
      const wrist=ud.bones.Bip001_R_Hand.getWorldPosition(new THREE.Vector3());
      worstGrip=Math.max(worstGrip,wrist.distanceTo(target));
      assert(wrist.distanceTo(target)<.005,`${def.id}: firing wrist left the grip`);
      if(pose.supportVisible!==false && reload===0) {
        target.fromArray(pose.support).applyMatrix4(built.group.matrixWorld);
        const gap=ud.bones.Bip001_L_Hand.getWorldPosition(wrist).distanceTo(target);
        worstSupport=Math.max(worstSupport,gap);
        assert(gap<.035,`${def.id}: support wrist misses the handguard by ${(gap*100).toFixed(1)}cm`);
      }
    }
  }
  ud.triggerFire();ud.mixer.update(1/60);character.updateMatrixWorld(true);
  const flash=character.getObjectByName('BIND_BULLET').children.find(o=>o.isMesh && o.userData.noHit);
  assert(flash?.visible,`${def.id}: remote muzzle flash is hidden`);
  const flashPosition=flash.getWorldPosition(new THREE.Vector3());
  assert(flashPosition.distanceTo(built.muzzle.getWorldPosition(new THREE.Vector3()))<.001,`${def.id}: muzzle flash is detached from the barrel`);
  disposeModel(character);
}
console.log(`rebuilt arsenal passed: 10 models, max ${maxDraws} render batches, live EV rig grip ${(worstGrip*100).toFixed(2)}cm/support ${(worstSupport*100).toFixed(2)}cm; shared geometry and isolated skins`);
