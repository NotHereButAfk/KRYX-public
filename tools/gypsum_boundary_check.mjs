import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';
import { buildEvMapScene, parseEvMap } from '../src/world/EvMapLoader.js';
import { getImportedMap } from '../src/world/MapRegistry.js';
import { World } from '../src/world/World.js';
import { constrainPlayablePosition, insidePlayableBounds } from '../src/world/PlayableBounds.js';
import { IMPORTED_ARENAS } from '../server/rookarena.mjs';

const def = getImportedMap('gypsum'), bounds = def.playableBounds;
const arena = IMPORTED_ARENAS.find(a => a.id === 'gypsum');
const bytes = fs.readFileSync(new URL('../public/maps/' + def.fileName, import.meta.url));
const map = buildEvMapScene(parseEvMap(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), [], def);
const world = Object.assign(Object.create(World.prototype), {
  _mapOctree: new Octree().fromGraphNode(map.colliderRoot),
  _playerCapsule: new Capsule(), _collisionPush: new THREE.Vector3(), playableBounds: bounds,
});
for (const p of [...map.spawnPoints, ...map.weaponSpawnPoints]) {
  const copy = p.clone();
  assert.equal(constrainPlayablePosition(copy, bounds), 0, 'authored spawns and pickups remain reachable');
}
// Real outer dune was walkable before this fix, well beyond the arena.
const outsideFloor = arena.groundHeightAt(0, -40, -32.958, -32.958);
assert(Number.isFinite(outsideFloor) && outsideFloor > arena.killY, 'reproduce solid exterior above the void kill plane');
let samples = 0;
for (const height of [1, 1.7]) for (const y of [-30, -18, 0, 30, 80]) {
  for (const [x,z] of [[-100,40],[105,40],[0,-50],[0,145],[-90,-40],[110,140],[0,50]]) {
    const previous = { px:x, py:y, pz:z, vx:20, vy:12, vz:20, onGround:0, crouch:height===1, safeTicks:0 };
    const state = arena.resolveState(previous, {...previous});
    const position = new THREE.Vector3(x,y,z), contact = {};
    world.resolveCollisions(position,.45,contact,height);
    assert(Math.abs(position.x-state.px)<.00001 && Math.abs(position.y-state.py)<.00001 && Math.abs(position.z-state.pz)<.00001,'client/server boundary parity');
    assert(position.x >= bounds.minX+.45 && position.x <= bounds.maxX-.45);
    assert(position.z >= bounds.minZ+.45 && position.z <= bounds.maxZ-.45);
    assert(position.y <= bounds.maxY-height);
    samples++;
  }
}
const falling = new THREE.Vector3(0,-100,30);
constrainPlayablePosition(falling,bounds);
assert.equal(falling.y,-100,'no invisible floor may prevent void death');
const nav = arena.navigation;
assert(nav.points.every(p=>insidePlayableBounds(p,bounds)));
assert(nav.edges.every(row=>row.every(i=>i>=0&&i<nav.points.length)));
assert(nav.landmarks.every(i=>i>=0&&i<nav.points.length));
assert(nav.points.length>1000 && nav.landmarks.length>=map.spawnPoints.length,'retain useful arena routes');
assert.equal(constrainPlayablePosition(new THREE.Vector3(999,999,999),undefined),0,'other maps unchanged');
console.log(`Gypsum boundary passed: ${samples} client/server positions, exterior reproduction, authored spawns/pickups, void death, ${nav.points.length} contained navigation nodes.`);
