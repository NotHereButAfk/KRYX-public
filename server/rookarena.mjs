import { tryMeshStep } from '../src/world/MeshStep.js';
// Server-side collision for every shipped imported map. The browser and
// authoritative server both parse the exact same .evmap binaries, so rotation
// can never put a client on geometry the server does not know about.

import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvMapScene, parseEvMap } from '../src/world/EvMapLoader.js';
import { boundedOctreeRayIntersect } from '../src/world/BoundedOctreeRay.js';
import { IMPORTED_MAPS, MAP_CATALOG } from '../src/world/MapRegistry.js';
import { DT } from '../src/sim/MoveSim.js';
import { playableKillY, constrainPlayablePosition } from '../src/world/PlayableBounds.js';
import { characterSweepSegments } from '../src/sim/CharacterSweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function q(value) { return Math.round(value * 1e6) / 1e6; }

function loadArena(definition) {
  const candidates = [
    resolve(HERE, `../dist/maps/${definition.fileName}`),
    resolve(HERE, `../public/maps/${definition.fileName}`),
  ];
  if (process.env.KYX_BAKE_NAVIGATION === '1') candidates.reverse();
  const mapPath = candidates.find((candidate) => existsSync(candidate));
  if (!mapPath) throw new Error(`${definition.name} is missing; checked: ${candidates.join(', ')}`);

  const bytes = readFileSync(mapPath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const scene = buildEvMapScene(parseEvMap(buffer), [], definition);
  const navigationPath = resolve(HERE, 'navigation', definition.id + '.json');
  let navigation = null;
  if (process.env.KYX_BAKE_NAVIGATION !== '1' && existsSync(navigationPath)) {
    navigation = JSON.parse(readFileSync(navigationPath, 'utf8'));
    if (navigation.mapHash !== createHash('sha256').update(bytes).digest('hex')) {
      throw new Error(definition.id + ': navigation must be rebaked for the current map');
    }
  }
  const octree = new Octree().fromGraphNode(scene.colliderRoot);
  const capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.45);
  const groundRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3());
  const normal = new THREE.Vector3();
  const collisionPush = new THREE.Vector3();

  function groundHeightAt(x, z, prevY, newY) {
    const stepUp = 0.55;
    const grace = 0.06;
    groundRay.origin.set(x, Math.max(prevY, newY) + stepUp + grace, z);
    const hit = octree.rayIntersect(groundRay);
    if (!hit) return -Infinity;
    hit.triangle.getNormal(normal);
    const top = hit.position.y;
    const crossed = prevY >= top - grace && newY <= top + grace;
    const stepping = newY <= top + stepUp && newY >= top - 0.8;
    return normal.y > 0.35 && (crossed || stepping) ? top : -Infinity;
  }

  function resolveState(previous, state, tuning = {}) {
    const height = (state.crouch || state.slide) ? 1.0 : 1.7;
    const dx = state.px - previous.px;
    const dy = state.py - previous.py;
    const dz = state.pz - previous.pz;
    const distance = Math.hypot(dx, dz);
    const segments = distance < 2 ? characterSweepSegments(Math.hypot(dx, dy), dz) : 1;
    let stepX = dx / segments;
    let stepY = dy / segments;
    let stepZ = dz / segments;
    state.px = previous.px;
    state.py = previous.py;
    state.pz = previous.pz;

    let supported = !!previous.onGround;
    for (let segment = 0; segment < segments; segment++) {
      const canStep = supported && state.vy <= .001 && distance < 2;
      const previousY = state.py;
      state.px += stepX;
      state.py += stepY;
      state.pz += stepZ;
      const groundY = groundHeightAt(state.px, state.pz, previousY, state.py);
      if (state.py <= groundY + (supported ? (tuning.snapDown ?? .3) : .05) && state.vy <= 0.001) {
        state.py = q(groundY);
        state.vy = 0;
        state.onGround = 1;
        state.nX = 0; state.nY = 1; state.nZ = 0;
      }

      supported = state.vy <= .001 && state.py <= groundY + .05;
      state.onGround = supported ? 1 : 0;
      capsule.radius = 0.45;
      capsule.start.set(state.px, state.py + capsule.radius, state.pz);
      capsule.end.set(state.px, state.py + Math.max(capsule.radius, height - capsule.radius), state.pz);
      for (let i = 0; i < 3; i++) {
        const hit = octree.capsuleIntersect(capsule);
        if (!hit) break;
        if (i === 0 && canStep && tryMeshStep(octree, capsule, hit, stepX, stepZ)) {
          supported = true; state.onGround = 1; state.vy = 0;
          state.nX = 0; state.nY = 1; state.nZ = 0;
          continue;
        }
        capsule.translate(collisionPush.copy(hit.normal).multiplyScalar(hit.depth));
        const rising = state.vy > .001;
        const into = state.vx * hit.normal.x + state.vy * hit.normal.y + state.vz * hit.normal.z;
        if (into < 0) {
          state.vx = q(state.vx - hit.normal.x * into);
          state.vy = q(state.vy - hit.normal.y * into);
          state.vz = q(state.vz - hit.normal.z * into);
        }
        if (hit.normal.y > 0.35 && !rising) {
          supported = true;
          state.onGround = 1;
          // Ramp projection must not become a jump impulse on the next tick.
          state.vy = 0;
          state.nX = q(hit.normal.x); state.nY = q(hit.normal.y); state.nZ = q(hit.normal.z);
        }
      }
      state.px = q(capsule.start.x);
      state.py = q(capsule.start.y - capsule.radius);
      state.pz = q(capsule.start.z);
      stepX = Math.sign(dx) * Math.min(Math.abs(dx), Math.max(0, state.vx * Math.sign(dx) * DT)) / segments;
      stepY = state.vy * DT / segments;
      stepZ = Math.sign(dz) * Math.min(Math.abs(dz), Math.max(0, state.vz * Math.sign(dz) * DT)) / segments;
    }
    collisionPush.set(state.px, state.py, state.pz);
    const blocked = constrainPlayablePosition(collisionPush, definition.playableBounds, .45, height);
    state.px = q(collisionPush.x); state.py = q(collisionPush.y); state.pz = q(collisionPush.z);
    if (blocked & 1) state.vx = 0;
    if (blocked & 2) state.vz = 0;
    if (blocked & 4) state.vy = Math.min(0, state.vy);
    if (state.onGround) {
      state.safeTicks = Math.min(3, (previous.safeTicks || 0) + 1);
      if (state.safeTicks >= 3) {
        state.safeX = state.px; state.safeY = state.py; state.safeZ = state.pz;
      }
    }
    return state;
  }

  function raycastHit(ox, oy, oz, dx, dy, dz, maxT) {
    ray.origin.set(ox, oy, oz);
    ray.direction.set(dx, dy, dz).normalize();
    const hit = boundedOctreeRayIntersect(octree, ray, maxT, 0);
    if (!hit || hit.distance > maxT) return null;
    hit.triangle.getNormal(normal);
    if (normal.dot(ray.direction) > 0) normal.negate();
    return { distance: hit.distance, nx: normal.x, ny: normal.y, nz: normal.z };
  }

  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    ray.origin.set(ox, oy, oz);
    ray.direction.set(dx, dy, dz).normalize();
    const hit = boundedOctreeRayIntersect(octree, ray, maxT);
    return hit && hit.distance > 0.00001 && hit.distance < maxT ? hit.distance : maxT;
  }

  const spawns = scene.spawnPoints.map((point) => [point.x, point.y, point.z]);
  const maxXZ = Math.max(
    Math.abs(scene.bounds.min.x), Math.abs(scene.bounds.max.x),
    Math.abs(scene.bounds.min.z), Math.abs(scene.bounds.max.z),
  );

  return {
    id: definition.id,
    botMaxDrop: definition.botMaxDrop ?? 4,
    playableBounds: definition.playableBounds || null,
    navigation,
    patrolPoints: navigation?.landmarks.map(i => navigation.points[i]),
    name: definition.name,
    region: definition.region,
    half: Math.ceil(maxXZ + 4),
    killY: playableKillY(scene.spawnPoints),
    noBaseFloor: true,
    platforms: [], boxes: [], gravLifts: [], teleporters: [],
    spawns,
    callouts: spawns.map(([x, , z], index) => ({ name: `Spawn ${index + 1}`, x, z })),
    pickups: scene.weaponSpawnPoints.map((point) => ({
      type: 'weapon', x: point.x, y: point.y, z: point.z, markerKind: point.markerKind,
    })),
    resolveState,
    groundHeightAt,
    raycast, raycastHit,
  };
}

// Two live modes plus one upcoming arena fit without retaining every map's
// collision octree for the lifetime of the server. Active simulation callbacks
// retain their arena safely even when its cache entry is evicted.
const arenaCache = new Map();
function cachedArena(definition) {
  let arena = arenaCache.get(definition.id);
  if (arena) arenaCache.delete(definition.id);
  else arena = loadArena(definition);
  arenaCache.set(definition.id, arena);
  while (arenaCache.size > 3) arenaCache.delete(arenaCache.keys().next().value);
  return arena;
}
function deferredArena(definition) {
  const descriptor = { id: definition.id, name: definition.name, region: definition.region };
  for (const key of ['botMaxDrop', 'playableBounds', 'navigation', 'patrolPoints', 'half', 'killY',
    'noBaseFloor', 'platforms', 'boxes', 'gravLifts', 'teleporters', 'spawns',
    'callouts', 'pickups', 'resolveState', 'groundHeightAt', 'raycast', 'raycastHit']) {
    Object.defineProperty(descriptor, key, { enumerable: true, get: () => cachedArena(definition)[key] });
  }
  return Object.freeze(descriptor);
}
const catalogArenas = MAP_CATALOG.map(deferredArena);
export const IMPORTED_ARENAS = Object.freeze(catalogArenas.filter(
  arena => IMPORTED_MAPS.some(map => map.id === arena.id),
));
export const ROOK = catalogArenas.find((arena) => arena.id === 'daytime-rook');

export function getServerArena(id) {
  return catalogArenas.find((arena) => arena.id === id) || IMPORTED_ARENAS[0];
}
