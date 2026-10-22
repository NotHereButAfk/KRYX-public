import assert from 'node:assert/strict';
import { IMPORTED_MAPS } from '../src/world/MapRegistry.js';

const REQUIRED = [
  'sky', 'ground', 'hemisphereIntensity',
  'sun', 'sunIntensity', 'rim', 'rimIntensity',
];

assert.ok(IMPORTED_MAPS.length > 1, 'lighting parity needs multiple map profiles');

for (const map of IMPORTED_MAPS) {
  assert.ok(map.lighting, `${map.id} is missing a lighting profile`);
  for (const key of REQUIRED) {
    assert.equal(typeof map.lighting[key], 'number', `${map.id}.${key} must be numeric`);
  }
  assert.ok(Object.isFrozen(map.lighting), `${map.id} lighting must be immutable`);
}

const signatures = new Set(IMPORTED_MAPS.map((map) => JSON.stringify(map.lighting)));
assert.equal(signatures.size, IMPORTED_MAPS.length, 'each map needs a distinct atmosphere');

console.log(`map lighting: ${IMPORTED_MAPS.length} distinct profiles verified`);
