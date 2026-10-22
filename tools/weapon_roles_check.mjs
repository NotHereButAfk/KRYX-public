import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';
import { WeaponSystem } from '../src/weapons/WeaponSystem.js';
import { GrenadeSystem } from '../src/weapons/GrenadeSystem.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';

for (const [id, ammo] of [['battlerifle', 36], ['battlerifle', 2], ['magnum', 6], ['energyshotgun', 80], ['plasmarifle', 6]]) {
  for (const authoritative of [false, true]) {
    const effects = { hitscan: 0, rounds: 0, projectile: 0, shells: 0, shot: 0 };
    const fixture = {
      currentDef: getWeapon(id), currentState: { magAmmo: ammo }, authoritative,
      fireTimer: 0, scopeT: 0, _shotBloom: 0, _activeSkinFor: () => null,
      audio: { playShot() {}, playShellCasing() {} },
      _doHitscanShot(_world, _bots, _player, rounds) { effects.hitscan++; effects.rounds = rounds; },
      _spawnRocket() { effects.projectile++; }, _spawnShell() { effects.shells++; },
      onShoot() { effects.shot++; }, _flash() {}, _spawnMuzzleSmoke() {}, _applyViewmodelRecoil() {},
      startReload() { this.currentState.isReloading = true; },
    };
    WeaponSystem.prototype._fire.call(fixture, {}, [], {}, {});
    const cost = id === 'battlerifle' ? Math.min(ammo, 3) : 1;
    assert.equal(fixture.currentState.magAmmo, ammo - cost);
    assert.equal(effects.shot, 1, 'one trigger must send one authoritative fire request');
    assert.equal(effects.projectile, 0,
      'network energy shots must not double-spawn a local damage projectile');
    assert.equal(effects.hitscan, 1);
    if (id === 'battlerifle') assert.equal(effects.rounds, cost);
    assert.equal(effects.shells, ['magnum', 'plasmarifle'].includes(id) ? 0 : cost);
  }
}
const scene = new THREE.Scene(), projectiles = new GrenadeSystem(scene);
projectiles.syncProjectiles([{id:'energy',kind:'rocket',wid:'plasmarifle',x:0,y:2,z:-3,vx:0,vy:0,vz:-65}]);
const bolt = projectiles.projectileMeshes.get('energy');
const size = new THREE.Box3().setFromObject(bolt).getSize(new THREE.Vector3());
assert(size.x > .4 && size.z > 1.5, 'energy shot must read as a broad luminous blast');
assert(bolt.children.some(o => o.material.blending === THREE.AdditiveBlending));
projectiles.syncProjectiles([]);
assert.equal(scene.children.filter(o => !o.isLight).length, 0, 'expired network energy visuals must be removed');
assert(scene.children.every(o => o.isLight && o.intensity === 0), 'idle explosion lights must remain dark');

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, data, {type}); } };
for (const [id, path] of Object.entries(BLENDER_ARSENAL)) {
  const bytes = fs.readFileSync(new URL(`../public${path}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  // The sniper is an authored preview asset, not an enabled gameplay pickup.
  const def = getWeapon(id) || (id === 'boltsniper' ? {id,kind:'hitscan'} : null);
  assert(def, `${id}: missing model definition`);
  const a = buildBlenderWeapon(gltf.scene, def);
  const b = buildBlenderWeapon(gltf.scene, def);
  assert(a?.muzzle && a.group.userData.authoredHandPose);
  let count = 0;
  a.group.traverse(o => {
    if (!o.isMesh) return;
    count++;
    const other = b.group.getObjectByName(o.name);
    assert.equal(o.geometry, other.geometry, 'clones must share immutable geometry');
    assert.notEqual(o.material, other.material, 'skins must not recolor another player');
    assert(o.geometry.attributes.uv && o.material.userData.role);
  });
  assert(count <= 16, 'authored guns must stay batched');
}
console.log('Weapon role client checks passed: ammo, three-bullet bursts, no duplicate energy projectiles, bolt cleanup, and independent skinnable Blender clones.');

const beamFixture = {scene:new THREE.Scene(),tracers:[]};
WeaponSystem.prototype._spawnTracer.call(beamFixture,new THREE.Vector3(),new THREE.Vector3(0,0,-40),getWeapon('plasmarifle'));
assert.equal(getWeapon('plasmarifle').kind,'hitscan');
assert.equal(beamFixture.tracers[0].laserBeam,true);
assert.equal(beamFixture.tracers[0].mesh.scale.z,40,'laser spans the entire hit distance instantly');
assert.equal(beamFixture.tracers[0].mesh.position.length(),0);
