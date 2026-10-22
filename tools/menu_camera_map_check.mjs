import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { parseEvMap, buildEvMapScene } from '../src/world/EvMapLoader.js';
import { MAP_CATALOG } from '../src/world/MapRegistry.js';
import { boundedOctreeRayIntersect } from '../src/world/BoundedOctreeRay.js';
import { makeSpectatorClearance, menuDollyShots } from '../src/core/SpectatorTour.js';

// Use shipped collision, including Rook overhangs and Gypsum's height changes.
// Synthetic empty-space routes alone cannot expose those problems.
for (const id of ['daytime-rook', 'depot', 'gypsum', 'evasion']) {
  const definition = MAP_CATALOG.find(map => map.id === id);
  const bytes = readFileSync(new URL(`../public/maps/${definition.fileName}`, import.meta.url));
  const scene = buildEvMapScene(parseEvMap(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), [], definition);
  const octree = new Octree().fromGraphNode(scene.colliderRoot);
  let probes = 0;
  const clear = makeSpectatorClearance({ raycastCollisionDistance(ray, far) {
    probes++;
    return boundedOctreeRayIntersect(octree, ray, far)?.distance ?? far;
  } });
  const start = performance.now();
  const shots = menuDollyShots(scene.spectatorRoutes, clear);
  const planningMs = performance.now() - start, planningProbes = probes;
  assert(shots.length > 0, `${id}: no safe establishing shots`);
  let minRise = Infinity, maxRise = 0;
  for (const shot of shots) {
    const original = scene.spectatorRoutes.flat().find(node => Math.hypot(node.p.x - shot[0].p.x, node.p.z - shot[0].p.z) < 1e-6);
    assert(original, 'camera must originate above a known arena viewpoint');
    const rise = shot[0].p.y - original.p.y;
    minRise = Math.min(minRise, rise); maxRise = Math.max(maxRise, rise);
    assert(rise >= 2 - 1e-6 && rise <= 8 + 1e-6, `${id}: camera height outside the intended range (${rise})`);
    const curve = new THREE.CatmullRomCurve3(shot.map(n => n.p), false, 'centripetal', 0.5);
    const count = Math.ceil(curve.getLength() / .2);
    let previous = curve.getPointAt(0);
    for (let i = 1; i <= count; i++) {
      const point = curve.getPointAt(i / count);
      assert(clear(previous, point), `${id}: camera's curved route clips geometry`);
      previous = point;
    }
    const last = shot.at(-1);
    const ahead = last.p.clone().addScaledVector(last.t.clone().sub(last.p).setY(0).normalize(), 6);
    assert(clear(last.p, ahead), `${id}: camera ends looking directly into a wall`);
  }
  console.log(`${id}: ${shots.length} safe shots, rise ${minRise.toFixed(1)}–${maxRise.toFixed(1)}m, ${planningMs.toFixed(1)}ms planning / ${planningProbes} bounded probes`);
}
