import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {WeaponSystem} from '../src/weapons/WeaponSystem.js';
// Exercise the actual menu-safe effect tick without constructing viewmodels.
for (const fps of [30,60,144]) {
 const ws=Object.create(WeaponSystem.prototype); ws.scene=new THREE.Scene(); ws.tracers=[];
 const calls={};
 for(const key of ['_updateRockets','_updateThrownKnives','_updateExplosions','_updateShells','_updateMuzzleSmoke','_updateAnimeSparkles','_updateFireEmbers']) ws[key]=(dt)=>{calls[key]=(calls[key]||0)+dt;};
 const muzzle=new THREE.Object3D();
 ws._spawnTracer(new THREE.Vector3(),new THREE.Vector3(0,0,-60),{},muzzle);
 muzzle.position.set(1,2,-3); // Final rendered recoil pose is applied after firing.
 ws._flashTimer=.03; ws._flashFresh=true;
 ws.flashLight={intensity:8};
 const flash=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({opacity:.92}));
 const flashMount=new THREE.Group(); flashMount.add(flash); ws._flashMeshes=[flash];
 ws.updateEffects(1/fps,{},{});
 assert.equal(flash.material.opacity,.92,'a fresh muzzle flash vanished before its first render');
 assert.equal(flash.parent,flashMount,'a fresh muzzle flash detached before its first render');
 assert.equal(ws.tracers[0].travelled,0,'first rendered tracer frame must begin at the muzzle');
 assert.deepEqual(ws.tracers[0].from.toArray(),muzzle.position.toArray(),'tracer started at the previous-frame muzzle pose');
 assert.ok(ws.tracers[0].mesh.scale.z>0,'muzzle segment must be visible on its first frame');
 muzzle.position.set(7,8,9);
 ws.updateEffects(1/fps,{},{});
 assert.deepEqual(ws.tracers[0].from.toArray(),[1,2,-3],'fired bullet must not follow the gun');
 assert.ok(ws.tracers[0].travelled>0,'menu tracer did not travel');
 const tr=ws.tracers[0];
 assert.ok(Math.abs(tr.mesh.scale.z-tr.trailLength)<.001,'bullet stretches into a beam at low frame rates');
 assert.ok(tr.mesh.scale.z<=1.1501,'ballistic bullet/wake is too long');
 const colors=tr.mesh.geometry.getAttribute('color');
 assert.equal(colors.itemSize,4,'bullet wake needs independently fading vertex alpha');
 let solid=0, faded=0;
 for(let i=0;i<colors.count;i++) {
   assert.ok(colors.getX(i)>colors.getZ(i),'ballistic bullets must be warm, not blue');
   if(colors.getW(i)>.99)solid++; else if(colors.getW(i)<.01)faded++;
 }
 assert.ok(solid>0&&faded>0,'bullet needs a solid head and fading tail');
 for(let i=2;i<fps;i++) ws.updateEffects(1/fps,{},{});
 assert.equal(ws.tracers.length,0,'menu leaves expired tracers alive');
 assert.equal(ws.scene.children.length,0,'expired tracer leaks into scene');
 assert.equal(flash.parent,null,'expired muzzle flash remains attached');
 for(const dt of Object.values(calls)) assert.ok(Math.abs(dt-1)<1e-6);
}
const game=readFileSync(new URL('../src/core/Game.js',import.meta.url),'utf8');
assert.match(game,/weaponSystem\.update\(dt, gameplayInput[^;]+;\s*} else {\s*this\.weaponSystem\.updateEffects/,'blocked input branch must still tick world effects');
console.log('Menu effects: tracers travel and expire; rockets, explosions, shells and particles advance at 30/60/144 Hz.');

assert.match(game,/else if \(menuOpen && !this\._playerDowned && !dead\) \{\s*this\.weaponSystem\.update\(dt, gameplayInput, this\.world, this\._activeManager, this\.player, false\)/, 'menu must advance weapon presentation with controls disabled');
