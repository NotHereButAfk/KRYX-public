import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BulletImpactEffects } from '../src/effects/BulletImpactEffects.js';
import { WeaponSystem } from '../src/weapons/WeaponSystem.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';

const camera = new THREE.PerspectiveCamera();
const from = new THREE.Vector3(0, 0, 0);
const end = new THREE.Vector3(0, 0, -5);
const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.1), new THREE.MeshBasicMaterial());
wall.position.z = -5.05;
wall.updateMatrixWorld(true);
const collider = new THREE.Box3(new THREE.Vector3(-2, -2, -5.1), new THREE.Vector3(2, 2, -5));
let probes = 0;
const world = {
  _mapRoot: new THREE.Group(),
  raycastMeshes: [wall],
  raycastBoxHit: () => null,
  raycastCollisionHit(ray, far) {
    probes++;
    assert(far <= 0.080501, 'impact probe traverses more than the endpoint segment');
    const point = ray.intersectBox(collider, new THREE.Vector3());
    if (!point) return null;
    const distance = point.distanceTo(ray.origin);
    return distance <= far ? { point, distance, normal: new THREE.Vector3(0, 0, 1) } : null;
  },
};

const scene = new THREE.Scene();
const effects = new BulletImpactEffects(scene);
assert.equal(effects.mesh, null, 'idle effect allocated render resources');
assert.equal(effects.showEndpoint(world, from, new THREE.Vector3(0, 0, -4.98), camera), false,
  'a player/air endpoint just in front of a wall produced an impact behind it');
assert.equal(effects.showEndpoint(world, from, new THREE.Vector3(0, 0, -8), camera), false,
  'a missed endpoint searched back through the shot path for a wall');
assert.equal(effects.mesh, null, 'unconfirmed endpoint allocated render resources');
const countBeforeFar = probes;
assert.equal(effects.showEndpoint(world, from, new THREE.Vector3(0, 0, -50), camera), false);
assert.equal(probes, countBeforeFar, 'distant effects still query collision geometry');
assert.equal(effects.showEndpoint(world, from, end, camera), true);
assert.equal(scene.children.length, 1);
assert.equal(effects.mesh.count, 96, 'pool capacity changed unexpectedly');
assert.equal(effects._active, 7, 'one impact should emit one mark, four dust motes and two sparks');
assert.equal(effects.mesh.userData.noHit, true);
assert.equal(effects.mesh.material.depthWrite, false);
const intersections = [];
effects.mesh.raycast(null, intersections);
assert.equal(intersections.length, 0, 'cosmetic impacts participate in shot collision');
const transform = new THREE.Matrix4();
effects.mesh.getMatrixAt(0, transform);
const position = new THREE.Vector3().setFromMatrixPosition(transform);
assert(Math.abs(position.z + 4.993) < 1e-5, 'bullet mark is not offset just above the confirmed face');

const mesh = effects.mesh;
const geometry = mesh.geometry;
const material = mesh.material;
const matrices = mesh.instanceMatrix.array;
const alpha = geometry.attributes.impactAlpha.array;
for (let shot = 0; shot < 300; shot++) effects.showEndpoint(world, from, end, camera);
assert.equal(effects.mesh, mesh);
assert.equal(mesh.geometry, geometry);
assert.equal(mesh.material, material);
assert.equal(mesh.instanceMatrix.array, matrices);
assert.equal(geometry.attributes.impactAlpha.array, alpha);
assert.equal(scene.children.length, 1, 'sustained fire adds render objects');
assert.equal(effects._active, 96, 'pool must recycle at its cap');
const countBeforeUpdate = probes;
for (let frame = 0; frame < 60; frame++) effects.update(1 / 60, camera);
assert.equal(probes, countBeforeUpdate, 'effect animation casts per-frame rays');
assert.equal(effects._active, 24, 'particles must expire within one second');
effects.update(7, camera);
assert.equal(effects._active, 0);
assert.equal(mesh.visible, false);

// Queued tracers cannot leave their old map's impacts behind after a rotation.
const queued = {};
assert(effects.queueEndpoint(queued, world, from, end, camera));
effects.showEndpoint(world, from, end, camera);
world._mapRoot = new THREE.Group();
effects.syncWorld(world);
assert.equal(effects._active, 0);
assert.equal(effects.showQueued(queued, camera), false, 'old map tracer emitted on the new map');
assert.equal(effects.mesh, mesh, 'map cleanup should reuse the small shared pool');
let disposed = 0;
for (const resource of [geometry, material, mesh]) resource.addEventListener('dispose', () => disposed++);
effects.dispose();
effects.dispose();
assert.equal(disposed, 3, 'geometry, material and instance buffers must dispose exactly once');
assert.equal(scene.children.length, 0);

// Exercise real WeaponSystem shot classification and tracer arrival without
// building viewmodels or changing damage, endpoints, ammo or weapon transforms.
function weaponFixture() {
  const ws = Object.create(WeaponSystem.prototype);
  const def = getWeapon('m4');
  Object.defineProperties(ws, { currentDef: { value: def }, currentState: { value: { magAmmo: 7 } } });
  ws.allWeapons = [def];
  ws.scene = new THREE.Scene();
  ws.camera = camera;
  ws.tracers = [];
  ws._bulletImpacts = new BulletImpactEffects(ws.scene);
  ws._impactWorld = world;
  ws.models = new Map([[def.id, { muzzle: new THREE.Object3D() }]]);
  ws._shotBloom = 0;
  ws.scopeT = 0;
  for (const key of ['_camPos', '_camDir', '_rightVec', '_upVec', '_muzzleWorld', '_pelletDir', '_farVec']) ws[key] = new THREE.Vector3();
  ws._raycaster = new THREE.Raycaster();
  ws._targets = [];
  for (const key of ['_updateRockets', '_updateThrownKnives', '_updateExplosions', '_updateShells', '_updateMuzzleSmoke', '_updateAnimeSparkles', '_updateFireEmbers']) ws[key] = () => {};
  return ws;
}

const ws = weaponFixture();
const player = { velocity: new THREE.Vector3() };
ws._doHitscanShot(world, [], player);
assert.equal(ws.currentState.magAmmo, 7);
assert.equal(ws.tracers.length, 1);
assert(ws.tracers[0].to.distanceTo(end) < 1e-6, 'cosmetic effect changed the shot endpoint');
assert.equal(ws.tracers[0].impactPending, true);
assert.equal(ws._bulletImpacts.mesh, null, 'local impact appeared before its visible tracer arrived');
ws.updateEffects(1 / 60, world, {});
assert.equal(ws._bulletImpacts.mesh, null, 'fresh tracer impact appeared at the muzzle');
ws.updateEffects(0.05, world, {});
assert.equal(ws._bulletImpacts._active, 7);
const beforePlayer = probes;
const botMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial());
botMesh.position.z = -3;
botMesh.userData.bot = { position: new THREE.Vector3(), mesh: { userData: {} } };
botMesh.updateMatrixWorld(true);
let damages = 0;
ws.onHitBot = () => damages++;
ws._doHitscanShot(world, [botMesh], player);
assert.equal(damages, 1, 'adding world effects changed the hit callback');
assert.equal(probes, beforePlayer, 'player hit emitted/probed a world impact');
assert.equal(ws.tracers.at(-1).impactPending, undefined);

ws.authoritative = true;
ws._doHitscanShot(world, [], player);
assert.equal(probes, beforePlayer, 'unconfirmed multiplayer prediction emitted an impact');
const beforeAuthority = ws.tracers.length;
ws.showAuthoritativeImpact('m4', from, end, world);
assert.equal(ws.tracers.length, beforeAuthority, 'own server shot duplicated its local tracer');
assert.equal(ws._bulletImpacts._active, 14);
ws.showAuthoritativeTracer('m4', from, end, world);
assert.equal(ws.tracers.at(-1).impactPending, true);
ws.clearImpactEffects();
assert.equal(ws._bulletImpacts._active, 0);
for (let i = 0; i < 60; i++) ws.updateEffects(1 / 60, world, {});
assert.equal(ws._bulletImpacts._active, 0, 'cleared pending tracer later recreated an impact');
ws.disposeImpactEffects();
assert.equal(ws.scene.children.length, 0);
wall.geometry.dispose(); wall.material.dispose();
botMesh.geometry.dispose(); botMesh.material.dispose();
console.log('Bullet impacts passed: endpoint-only confirmation, player/air rejection, tracer timing, bounded shared pool and map/disposal cleanup.');
