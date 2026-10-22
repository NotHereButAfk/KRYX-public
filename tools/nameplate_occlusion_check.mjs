#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isNameplateOccluded } from '../src/ui/NameplateOcclusion.js';

const origin = new THREE.Vector3(0, 1.7, 0);
const target = new THREE.Vector3(0, 2, -12);
const raycaster = new THREE.Raycaster();
const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 0.5), new THREE.MeshBasicMaterial());
wall.position.set(0, 2, -6);
wall.updateMatrixWorld(true);

const world = { raycastMeshes: [wall], raycastBoxHit: () => null };
assert.equal(isNameplateOccluded(world, origin, target, raycaster), true,
  'a wall between camera and player must hide the DOM nameplate');
wall.position.x = 10;
wall.updateMatrixWorld(true);
assert.equal(isNameplateOccluded(world, origin, target, raycaster), false,
  'off-axis geometry must not hide a visible player');

const box = new THREE.Box3(new THREE.Vector3(-2, 0, -7), new THREE.Vector3(2, 4, -5));
const boxWorld = {
  raycastMeshes: [],
  raycastBoxHit: (ray, far) => {
    const point = ray.intersectBox(box, new THREE.Vector3());
    if (!point) return null;
    const distance = ray.origin.distanceTo(point);
    return distance <= far ? { point, distance } : null;
  },
};
assert.equal(isNameplateOccluded(boxWorld, origin, target, raycaster), true,
  'box-only collision must also occlude nameplates');

console.log('nameplate occlusion passed: mesh and box walls hide labels, clear sightlines show them');

let obstruction = 4;
const indexedWorld = { _mapOctree: {}, raycastCollisionDistance: (_ray, far) => Math.min(obstruction, far),
  get raycastMeshes() { throw new Error('indexed nameplate checked render meshes'); } };
assert.equal(isNameplateOccluded(indexedWorld, origin, target, raycaster), true);
obstruction = Infinity;
assert.equal(isNameplateOccluded(indexedWorld, origin, target, raycaster), false);
console.log('Indexed nameplates avoid render-mesh scans and retain occlusion.');
