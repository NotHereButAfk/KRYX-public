import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildEvMapScene, parseEvMap } from '../src/world/EvMapLoader.js';
import { authoredWeaponSpecs } from '../src/world/PickupLayout.js';

const EXPECTED_SHA256 = '038d9709dfa9f3066f1c580f39f8bf181974a80a09f26b54692c99999b1d7a45';
const bytes = await readFile(new URL('../public/maps/RookLit_0.evmap', import.meta.url));
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, EXPECTED_SHA256, 'RookLit_0.evmap does not match the official node-755 download');

const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const map = parseEvMap(buffer);
assert.equal(map.bytesRead, map.byteLength, 'decoder did not consume the complete .evmap file');
assert.equal(map.geometries.length, 43);
assert.equal(map.materials.length, 23);
assert.equal(map.textures.length, 4);
assert.equal(map.playerSpawns.filter((spawn) => spawn.enabled).length, 15);
assert.deepEqual(
  map.markers.map((marker) => marker.kind),
  [524288, 8388608, 1048576, 2097152],
  'Rook authored weapon-marker kinds changed',
);
const scene = buildEvMapScene(map);
// Pads must sit above a surface, not at the original floating display height.
for (const point of scene.weaponSpawnPoints) {
  const material=scene.raycastMeshes[0].material, side=material.side;
  material.side=THREE.DoubleSide;
  const ray=new THREE.Raycaster(point.clone(),new THREE.Vector3(0,-1,0),0,0.1);
  const hit=ray.intersectObjects(scene.raycastMeshes,false)[0];
  material.side=side;
  assert.ok(hit && Math.abs(hit.distance-0.04)<0.005,'pickup pad must clear the surface by 4cm');
}

assert.deepEqual(
  scene.weaponSpawnPoints.map((point) => [
    Number(point.x.toFixed(2)),
    Number(point.y.toFixed(2)),
    Number(point.z.toFixed(2)),
    point.markerKind,
  ]),
  [
    [-40, 17.04, 64, 524288],
    [-0.5, 16.54, -0.75, 8388608],
    [100, 16.54, 24.02, 1048576],
    [-28.5, 9.04, -46, 2097152],
  ],
  'Rook authored weapon spawns were not grounded in game coordinates',
);
assert.deepEqual(
  authoredWeaponSpecs(scene.weaponSpawnPoints)
    .map((spec) => [
      spec.id,
      Number(spec.position.x.toFixed(2)),
      Number(spec.position.y.toFixed(2)),
      Number(spec.position.z.toFixed(2)),
    ]),
  [
    ['uzi', -40, 17.04, 64],
    ['rpg', -0.5, 16.54, -0.75],
    ['levershotgun', 100, 16.54, 24.02],
    ['concussion', -28.5, 9.04, -46],
  ],
  'power weapons were not placed on Rook authored markers',
);

console.log(
  `ok   Daytime Rook ${bytes.length.toLocaleString()} bytes, `
  + `${map.geometries.length} geometries, ${map.materials.length} materials, `
  + `${map.playerSpawns.length} spawns`,
);

const WINTER_SHA256 = 'd400c49458f0f54bdb4d6c5aa0d0e0aae6c6aa0d3e49b12a15cca0aa3f5f181a';
const winterBytes = await readFile(new URL('../public/maps/XmasGraveyard_1.evmap', import.meta.url));
assert.equal(
  createHash('sha256').update(winterBytes).digest('hex'),
  WINTER_SHA256,
  'XmasGraveyard_1.evmap does not match the official node-644 download',
);
const winterBuffer = winterBytes.buffer.slice(
  winterBytes.byteOffset,
  winterBytes.byteOffset + winterBytes.byteLength,
);
const winter = parseEvMap(winterBuffer);
assert.equal(winter.bytesRead, winter.byteLength, 'Winter decoder did not consume the complete .evmap file');
assert.equal(winter.geometries.length, 65);
assert.equal(winter.textures.length, 10);
assert.equal(winter.playerSpawns.filter((spawn) => spawn.enabled).length, 6);
assert.equal(winter.markers.length, 4);
console.log(
  `ok   Winter-Graveyard ${winterBytes.length.toLocaleString()} bytes, `
  + `${winter.geometries.length} geometries, ${winter.materials.length} materials, `
  + `${winter.playerSpawns.length} spawns`,
);
