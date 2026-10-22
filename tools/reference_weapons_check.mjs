import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildReferenceWeapon } from '../src/weapons/ReferenceWeapons.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
for (const id of ['magnum','battlerifle','energyshotgun','plasmarifle','uzi','levershotgun','concussion','rpg']) {
 const def=WEAPONS.find(w=>w.id===id),{group,muzzle}=buildReferenceWeapon(def);
 group.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3());
 // The long-barrel Hand Cannon is 49 cm muzzle-to-grip, including its swept heel.
 assert(size.z > (id==='magnum'?.3:id==='battlerifle'||id==='plasmarifle'||id==='levershotgun'?.85:.6) && size.z < (id==='magnum'?.53:1.05),'reference model physical length');
 assert(Math.abs(muzzle.position.z-bounds.min.z)<.02,'muzzle must remain at barrel tip');
 for(const side of ['trigger','support']) {
  const p=new THREE.Vector3(...weaponHandPose(group)[side]);let distance=Infinity;
  group.traverse(o=>{if(o.isMesh)distance=Math.min(distance,new THREE.Box3().setFromObject(o).distanceToPoint(p));});
  assert(distance<.035,`${id} ${side} hand must touch the actual model`);
 }
 const second=buildReferenceWeapon(def).group;assert.notEqual(group.children[0].material,second.children[0].material,'skins cannot recolor another player');
}
console.log('reference weapons passed: physical scale, muzzle alignment, both hand contacts, isolated materials');
