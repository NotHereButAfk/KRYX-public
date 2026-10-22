#!/usr/bin/env node
import assert from 'node:assert/strict';
import './imported_maps_check.mjs';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AuthRoom } from '../server/authroom.mjs';
import { IMPORTED_ARENAS } from '../server/rookarena.mjs';
import { createState } from '../src/sim/MoveSim.js';
import {
  IMPORTED_MAPS,
  getImportedMap,
  nextImportedMapId,
} from '../src/world/MapRegistry.js';

const gameSource = await readFile(new URL('../src/core/Game.js', import.meta.url), 'utf8');
assert.match(
  gameSource,
  /async _restartOnNextMap\(\)[\s\S]*?nextImportedMapId\(this\.world\.currentMapId\)/,
  'completed local games must advance through the imported-map rotation',
);
assert.match(
  gameSource,
  /async _activateMap\(mapId(?:,\s*[^)]*)?\)[\s\S]*?_showMapLoading\([^;]+autoHide:\s*false[\s\S]*?await this\.world\.loadMap\(mapId\)[\s\S]*?await this\._finishMapLoading\(\)/,
  'between-game map loading must be readiness-bound and readable',
);

// TextureLoader expects a browser image. The rotation gate validates geometry,
// collision, teardown, and authority, so a tiny immediately-loaded image is
// enough to decode the real embedded-map materials under Node.
const noop = () => {};
const ctx2d = new Proxy({}, {
  get: (_target, key) => (key === 'canvas' ? {}
    : key === 'createLinearGradient' || key === 'createRadialGradient'
      ? () => ({ addColorStop: noop })
      : key === 'getImageData'
        ? () => ({ data: new Uint8ClampedArray(4) })
        : noop),
  set: () => true,
});
const fakeImage = () => {
  const image = {
    width: 4,
    height: 4,
    complete: true,
    addEventListener(kind, fn) { if (kind === 'load') image._onload = fn; },
    removeEventListener() {},
    set src(_value) { queueMicrotask(() => image._onload?.({ target: image })); },
    get src() { return ''; },
  };
  return image;
};
globalThis.document = {
  createElement: (tag) => (tag === 'img' ? fakeImage()
    : { width: 0, height: 0, getContext: () => ctx2d, style: {} }),
  createElementNS: (_ns, tag) => (tag === 'img' ? fakeImage()
    : { width: 0, height: 0, getContext: () => ctx2d, style: {} }),
  getElementById: () => null,
};

const publicDir = new URL('../public/', import.meta.url);
globalThis.fetch = async (url) => {
  const relative = String(url).replace(/^\//, '');
  const bytes = await readFile(new URL(relative, publicDir));
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  };
};

for (const retired of ['daytime-rook', 'winter-graveyard', 'depot']) {
  assert.ok(!IMPORTED_MAPS.some(map => map.id === retired), retired + ' excluded from client rotation');
  assert.ok(!IMPORTED_ARENAS.some(arena => arena.id === retired), retired + ' excluded from server rotation');
}
assert.ok(IMPORTED_MAPS.length >= 2, 'rotation needs at least two imported maps');
assert.equal(
  new Set(IMPORTED_MAPS.map((map) => map.id)).size,
  IMPORTED_MAPS.length,
  'map IDs must be unique',
);
for (const map of IMPORTED_MAPS) {
  const asset = fileURLToPath(new URL(`../public/maps/${map.fileName}`, import.meta.url));
  assert.ok(existsSync(asset), `${map.id} registry entry has no shipped .evmap`);
  assert.match(map.fileName, /\.evmap$/i, `${map.id} is not backed by an imported map binary`);
  assert.equal(getImportedMap(map.id), map);
  assert.notEqual(
    nextImportedMapId(map.id),
    map.id,
    'next round must select a different imported map',
  );
}
let cycled = IMPORTED_MAPS[0].id;
for (let i = 0; i < IMPORTED_MAPS.length; i++) cycled = nextImportedMapId(cycled);
assert.equal(cycled, IMPORTED_MAPS[0].id, 'rotation must wrap after every imported map');

// Exercise the real client loader for three complete laps. Counts must be
// identical every time a map returns and only the current map may stay parented.
const { World } = await import('../src/world/World.js');
const world = new World(IMPORTED_MAPS[0].id);
await world.ready;
const baselines = new Map();
let previousRoot = null;

for (let lap = 0; lap < 3; lap++) {
  for (const definition of IMPORTED_MAPS) {
    const loaded = await world.loadMap(definition.id);
    assert.equal(world.currentMapId, definition.id);
    assert.equal(loaded.definition.id, definition.id);
    assert.ok(world._mapOctree, `${definition.id} has no collision octree`);
    assert.ok(world.spawnPoints.length >= 4, `${definition.id} has too few player spawns`);
    assert.ok(world.weaponSpawnPoints.length >= 1, `${definition.id} has no authored weapon markers`);
    assert.equal(world._mapRoot.parent, world.scene, `${definition.id} root is detached`);
    if (previousRoot && previousRoot !== world._mapRoot) {
      assert.equal(previousRoot.parent, null, 'outgoing map root remained in the scene');
    }

    let meshes = 0;
    world._mapRoot.traverse((object) => { if (object.isMesh) meshes++; });
    const snapshot = {
      meshes,
      spawns: world.spawnPoints.length,
      weapons: world.weaponSpawnPoints.length,
      raycast: world.raycastMeshes.length,
    };
    if (!baselines.has(definition.id)) baselines.set(definition.id, snapshot);
    else assert.deepEqual(snapshot, baselines.get(definition.id), `${definition.id} leaked across laps`);
    if (lap === 0) {
      const spawn = world.spawnPoints[0];
      const groundRay = new THREE.Ray(
        spawn.clone().add(new THREE.Vector3(0, 1.2, 0)),
        new THREE.Vector3(0, -1, 0),
      );
      const surface = world.raycastCollisionHit(groundRay, 4);
      assert.ok(surface && surface.normal.y > 0.35,
        `${definition.id} collision ray missed the authored spawn floor`);
      const embedded = spawn.clone();
      embedded.y = surface.point.y - 0.08;
      const contact = {
        grounded: false, normalY: -1, depth: 0, verticalCorrection: 0,
      };
      world.resolveCollisions(embedded, 0.5, contact);
      assert.equal(contact.grounded, true,
        `${definition.id} capsule pushout did not report floor contact`);
      assert.ok(embedded.y >= surface.point.y - 0.02,
        `${definition.id} capsule remained buried below the spawn floor`);
    }
    previousRoot = world._mapRoot;
  }
}

// Instrument one real swap and prove every outgoing GPU resource is disposed.
const outgoingRoots = [world._mapRoot, world._mapColliderRoot];
const outgoingGeometries = new Set();
const outgoingMaterials = new Set();
for (const root of outgoingRoots) {
  root.traverse((object) => {
    if (object.geometry) outgoingGeometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material) outgoingMaterials.add(material);
  });
}
const disposedGeometries = new Set();
const disposedMaterials = new Set();
const geometryDispose = THREE.BufferGeometry.prototype.dispose;
const materialDispose = THREE.Material.prototype.dispose;
THREE.BufferGeometry.prototype.dispose = function (...args) {
  disposedGeometries.add(this);
  return geometryDispose.apply(this, args);
};
THREE.Material.prototype.dispose = function (...args) {
  disposedMaterials.add(this);
  return materialDispose.apply(this, args);
};
try {
  await world.loadMap(nextImportedMapId(world.currentMapId));
} finally {
  THREE.BufferGeometry.prototype.dispose = geometryDispose;
  THREE.Material.prototype.dispose = materialDispose;
}
for (const geometry of outgoingGeometries) {
  assert.ok(disposedGeometries.has(geometry), 'outgoing map geometry was not disposed');
}
for (const material of outgoingMaterials) {
  assert.ok(disposedMaterials.has(material), 'outgoing map material was not disposed');
}

// Match authority owns rotation online: it advances the collision arena,
// resets the scoreboard, and tells every client which binary to load.
const sent = [];
const room = new AuthRoom(IMPORTED_ARENAS);
const firstMap = room.arena.id;
const firstPlayer = room.add((message) => sent.push(message), 'RotationTest');
const player = room.players.get(firstPlayer);
player.kills = 7;
player.deaths = 3;
player.score = 700;
room.matchStart = Date.now() - room.matchDurationMs - 1;
room.update();

assert.equal(room.arena.id, firstMap, 'map changed before the final standings');
assert.equal(player.kills, 7, 'finished scores reset during standings');
const frozenState = { ...player.state };
for (let i = 0; i < 20; i++) room.update();
assert.deepEqual(player.state, frozenState, 'player moved during standings');
assert.equal(player.score, 700);
assert.ok(sent.findLast(message => message.t === 'snapshot').postMatch);
// Advance the intermission deadline without making this test sleep ten seconds.
room._postMatchUntil = Date.now() - 1;
room.update();

assert.notEqual(room.arena.id, firstMap, 'authoritative match end did not rotate the map');
assert.equal(player.kills, 0);
assert.equal(player.deaths, 0);
assert.equal(player.score, 0);
assert.ok(player.alive);
assert.ok(room.events.some((event) => event.e === 'map' && event.id === room.arena.id));
const snapshot = sent.findLast((message) => message.t === 'snapshot');
assert.equal(snapshot.mapId, room.arena.id);
assert.equal(snapshot.arena.id, room.arena.id, 'rotation snapshot lacks new collision metadata');

// Losing the exact rotation packet must not leave a client with the new map id
// and old collision. The complete payload is repeated for a five-second grace
// window, which also covers browsers that temporarily apply backpressure.
sent.length = 0;
for (let i = 0; i < 100; i++) room.update();
const graceSnapshots = sent.filter((message) => message.t === 'snapshot');
assert.equal(graceSnapshots.length, 100);
assert.ok(graceSnapshots.every((message) => message.mapId === room.arena.id));
assert.ok(graceSnapshots.every((message) => message.arena?.id === room.arena.id),
  'rotation metadata was not repeated through the packet-loss grace window');

// Every authoritative spawn must begin on collision and survive several
// simulation ticks without a void recovery.
for (const arena of IMPORTED_ARENAS) {
  for (const spawn of arena.spawns) {
    const state = createState(spawn[0], spawn[1], spawn[2]);
    const resolved = arena.resolveState({ ...state }, { ...state });
    assert.equal(resolved.onGround, 1, `${arena.id} has an airborne/void spawn ${spawn}`);
    assert.ok(resolved.py > arena.killY, `${arena.id} spawn is below its kill plane ${spawn}`);
  }
  const botRoom = new AuthRoom(arena, { targetPopulation: 8 });
  let voidDeaths = 0;
  for (let tick = 0; tick < 500; tick++) {
    botRoom.update();
    voidDeaths += botRoom.events.filter((event) => event.e === 'kill' && event.wid === 'void').length;
  }
  assert.equal(voidDeaths, 0, `${arena.id} bots walked off the map during navigation soak`);
}

console.log(
  `all map-rotation checks passed: ${IMPORTED_MAPS.map((map) => map.name).join(' -> ')}`
    + ` -> ${IMPORTED_MAPS[0].name}`,
);
