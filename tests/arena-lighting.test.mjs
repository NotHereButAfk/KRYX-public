import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArenaLighting } from '../src/world/ArenaLighting.js';
import { IMPORTED_MAPS } from '../src/world/MapRegistry.js';

const mesh = (material = new THREE.MeshLambertMaterial()) => new THREE.Mesh(new THREE.BoxGeometry(), material);
const renderer = () => ({ shadowMap: { autoUpdate: true } });

test('each arena fits all eight shifted bounds corners within the sun frustum', () => {
  const scene = new THREE.Scene(), rig = new ArenaLighting(scene);
  const bounds = new THREE.Box3(new THREE.Vector3(170, -4, -123), new THREE.Vector3(229, 38, -41));
  for (const map of IMPORTED_MAPS) {
    rig.apply(map, bounds);
    scene.updateMatrixWorld(true);
    rig.sun.shadow.updateMatrices(rig.sun);
    const camera = rig.sun.shadow.camera;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1, `${map.id}: ${p.toArray()}`);
    }
    assert.ok(rig.sun.position.y > rig.sun.target.position.y, 'sun remains above every shifted arena');
    assert.ok(rig.hemisphere.intensity > 0, 'shaded spaces retain sky fill');
  }
  rig.dispose();
});

test('quality changes resize or release shadow targets, same-quality preserves cache', () => {
  const rig = new ArenaLighting(new THREE.Scene()), r = renderer();
  rig.setQuality('medium', r);
  assert.equal(r.shadowMap.enabled, true);
  assert.equal(rig.sun.shadow.mapSize.x, 1024);
  assert.equal(rig.sun.shadow.autoUpdate, false);
  assert.equal(r.shadowMap.autoUpdate, true);
  rig.sun.shadow.needsUpdate = false;
  rig.setQuality('medium', r);
  assert.equal(rig.sun.shadow.needsUpdate, false);
  let released = 0;
  rig.sun.shadow.map = { dispose() { released++; } };
  rig.sun.shadow.mapPass = { dispose() { released++; } };
  rig.setQuality('high', r);
  assert.equal(released, 2);
  assert.equal(rig.sun.shadow.mapSize.x, 2048);
  assert.equal(rig.sun.shadow.needsUpdate, true);
  rig.sun.shadow.map = { dispose() { released++; } };
  rig.setQuality('low', r);
  assert.equal(released, 3);
  assert.equal(r.shadowMap.enabled, false);
  assert.equal(rig.sun.castShadow, false);
  assert.equal(rig.sun.shadow.map, null);
  rig.setQuality('medium', r);
  assert.equal(rig.sun.shadow.needsUpdate, true);
  rig.dispose();
});

test('architecture cache skips hidden groups, glass and moving actors; finally restores actors', () => {
  const scene = new THREE.Scene(), rig = new ArenaLighting(scene), root = new THREE.Group();
  const wall = mesh(), hidden = new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 });
  const mixed = mesh([wall.material, hidden]);
  const glass = mesh(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 }));
  const actor = mesh(); actor.castShadow = true;
  root.add(wall, mixed, glass); scene.add(root, actor);
  const geometry = wall.geometry, material = wall.material;
  rig.setupMap(root); rig.setQuality('medium', renderer());
  assert.equal(wall.castShadow, true); assert.equal(mixed.castShadow, true); assert.equal(glass.castShadow, false);
  assert.throws(() => { rig.prepareFrame(); try {
    assert.equal(actor.castShadow, false); assert.equal(wall.castShadow, true);
    assert.equal(rig.sun.castShadow, true, 'filter must never disable the shadow light itself');
    throw Error('render failed');
  } finally { rig.restoreFrame(); } }, /render failed/);
  assert.equal(actor.castShadow, true);
  rig.sun.shadow.needsUpdate = false; rig.prepareFrame();
  assert.equal(actor.castShadow, true, 'cached frames leave all gameplay flags untouched');
  assert.equal(wall.geometry, geometry); assert.equal(wall.material, material); assert.equal(glass.material.opacity, 0.4);
  scene.remove(root); rig.setupMap(new THREE.Group());
  assert.equal(rig.sun.shadow.needsUpdate, true, 'map changes invalidate the shadow cache');
  rig.dispose();
});

test('rig disposal releases only owned resources', () => {
  const scene = new THREE.Scene(), unrelated = mesh(); scene.add(unrelated);
  const rig = new ArenaLighting(scene); let geometry = 0, material = 0, unrelatedDisposals = 0;
  rig.sky.geometry.addEventListener('dispose', () => geometry++);
  rig.sky.material.addEventListener('dispose', () => material++);
  unrelated.material.addEventListener('dispose', () => unrelatedDisposals++);
  rig.dispose();
  assert.equal(geometry, 1); assert.equal(material, 1); assert.equal(unrelatedDisposals, 0);
  assert.deepEqual(scene.children, [unrelated]);
});
