import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GrenadeSystem } from '../src/weapons/GrenadeSystem.js';
import { createAbilityGrenade, createGrenadeTrail, updateGrenadeTrail, createSmokeCloud,
  updateSmokeCloud, createImpulseWave, updateImpulseWave, disposeAbilityObject } from '../src/effects/AbilityGrenadeEffects.js';

const scene=new THREE.Scene();
let contacts=0,damage=0;
const system=new GrenadeSystem(scene,{playAt:(_point,fn)=>fn(),playShellCasing:()=>contacts++});
const idleObjects=scene.children.length;
system.onExplode=()=>damage++;
system.onSelfDamage=()=>damage++;
const point=new THREE.Vector3(0,1,0);

// Each throwable is recognizable but shares immutable buffers. Removing one
// must not invalidate a simultaneously visible grenade of the same type.
const a=createAbilityGrenade('frag'),b=createAbilityGrenade('frag');
assert.equal(a.getObjectByName('Grenade body').geometry,b.getObjectByName('Grenade body').geometry);
assert.equal(a.getObjectByName('Grenade body').material,b.getObjectByName('Grenade body').material);
let sharedDisposed=0,glowDisposed=0;
a.getObjectByName('Grenade body').geometry.addEventListener('dispose',()=>sharedDisposed++);
a.getObjectByName('Grenade body').material.addEventListener('dispose',()=>sharedDisposed++);
a.userData.abilityVisual.glow.addEventListener('dispose',()=>glowDisposed++);
disposeAbilityObject(scene,a);
assert.equal(sharedDisposed,0,'removing a grenade destroyed cached geometry/material');
assert.equal(glowDisposed,1,'instance glow must be released exactly once');
disposeAbilityObject(scene,b);

const trail=createGrenadeTrail(scene,point,'smoke');
for(let i=0;i<30;i++) { point.x+=2;updateGrenadeTrail(trail,point,20,.05); }
for(let i=0;i<trail.positions.length;i+=3) assert(Math.hypot(trail.positions[i]-point.x,trail.positions[i+1]-point.y,trail.positions[i+2]-point.z)<=1.30001,'grenade trace grew into a long laser');
updateGrenadeTrail(trail,point,0,.05);
assert.equal(trail.line.material.opacity,0,'settled canister retains a floating trace');
disposeAbilityObject(scene,trail.line);

system.syncBombs([{id:'bomb',x:0,y:.08,z:0,remaining:3}]);
const ring=system.bombMeshes.get('bomb').getObjectByName('Fuse countdown');
assert.equal(ring.geometry.drawRange.count,192);
system.syncBombs([{id:'bomb',x:0,y:.08,z:0,remaining:1.5}]);
assert.equal(ring.geometry.drawRange.count,96,'half fuse must show half a ring');
system.syncBombs([{id:'bomb',x:0,y:.08,z:0,remaining:1.5}]);
assert.equal(ring.geometry.drawRange.count,96,'duplicate snapshot advanced fuse again');
system.syncBombs([]);

// Server smoke is a five-metre volume active for eight seconds. The former
// random visual spilled outside it and lingered for a ninth second.
const smoke=createSmokeCloud(new THREE.Vector3());
assert.equal(smoke.radius,5);assert.equal(smoke.life,8);
updateSmokeCloud(smoke,.45);
assert.equal(smoke.mesh.scale.x,1);
for(const lobe of smoke.mesh.children) assert(lobe.position.length()+lobe.scale.x<=5.001,'smoke art exceeds blocking volume');
assert(smoke.material.opacity>.7);
assert.equal(updateSmokeCloud(smoke,7.2),false);
assert(smoke.material.opacity>0 && smoke.material.opacity<.76,'smoke expiry must fade');
assert.equal(updateSmokeCloud(smoke,.35),true);
assert.equal(smoke.material.opacity,0);
disposeAbilityObject(scene,smoke.mesh);

const wave=createImpulseWave(new THREE.Vector3());
updateImpulseWave(wave,.24);assert(wave.mesh.scale.x>4 && wave.mesh.scale.x<6);
assert.equal(updateImpulseWave(wave,.24),true);
assert.equal(wave.mesh.scale.x,6);assert.equal(wave.ring.material.opacity,0);
disposeAbilityObject(scene,wave.mesh);

// Simulate replicated throws bouncing and simultaneous ability spam. The
// presentation must not apply extra damage, leak GPU objects, or add lights.
for(let cycle=0;cycle<40;cycle++) {
  const grenade={id:`frag-${cycle}`,kind:'frag',x:0,y:1,z:0,vx:0,vy:-8,vz:1,remaining:2};
  system.syncProjectiles([grenade]);
  system.update(.2,null);
  system.syncProjectiles([{...grenade,vy:4,remaining:1.8}]);
  system.syncProjectiles([]);
  system.showAuthoritativeSmoke(new THREE.Vector3());
  system.showImpulse(new THREE.Vector3());
  system.syncBombs([{id:'bomb',x:0,y:0,z:0,remaining:2}]);
  system.reset();
  assert.equal(scene.children.length,idleObjects,'reset retained an ability object');
}
assert(contacts>0,'replicated grenade rebounds need contact feedback');
assert.equal(damage,0,'authoritative visual effects duplicated damage');
assert.equal(sharedDisposed,0,'reset disposed shared resources');
assert.equal(scene.children.filter(o=>o.isLight).length,idleObjects,'ability effect added dynamic lights');
console.log('Ability effects passed: shared resource ownership, bounded flight trails, server fuse countdown, smoke radius/lifetime, impulse radius, contact feedback and repeated cleanup');
