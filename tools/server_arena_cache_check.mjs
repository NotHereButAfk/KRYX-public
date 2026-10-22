import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.readFileSync;
let mapReads = 0;
fs.readFileSync = function(path, ...args) {
  if (String(path).endsWith('.evmap')) mapReads++;
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();
try {
  const { IMPORTED_ARENAS } = await import('../server/rookarena.mjs');
  assert.equal(mapReads, 0, 'importing the registry must not allocate every collision map');
  assert(IMPORTED_ARENAS.every(arena => arena.id && arena.name));
  assert.equal(mapReads, 0, 'listing maps must remain lightweight');
  const first = IMPORTED_ARENAS[0];
  const spawn = first.spawns[0];
  const ground = first.groundHeightAt;
  const height = ground(spawn[0], spawn[2], spawn[1], spawn[1]);
  assert.equal(mapReads, 1);
  first.spawns; first.raycast;
  assert.equal(mapReads, 1, 'active-map lookups must reuse collision data');
  for (const arena of IMPORTED_ARENAS.slice(1, 4)) assert(arena.spawns.length);
  assert.equal(mapReads, 4);
  assert.equal(ground(spawn[0], spawn[2], spawn[1], spawn[1]), height,
    'evicting the cache must not invalidate an active simulation callback');
  assert(first.spawns.length);
  assert.equal(mapReads, 5, 'old arenas must be evicted from the bounded cache');
  console.log('Arena cache passed: lazy loading, reuse, eviction and active collision safety.');
} finally {
  fs.readFileSync = original;
  syncBuiltinESMExports();
}
