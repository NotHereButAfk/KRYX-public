import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildViewmodelArm } from '../src/player/ViewmodelArms.js';
import { Vector3 } from 'three';

const bytes = await readFile(new URL('../public/ev-view-arms.glb', import.meta.url));
const { scene } = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
for (const side of ['Left', 'Right']) {
  const source = scene.getObjectByName(`KYX_ViewArm_${side}`);
  const hand = source.getObjectByName(`KYX_View${side}_Hand`);
  hand.geometry.computeBoundingBox();
  const palmCenter = hand.geometry.boundingBox.getCenter(new Vector3());
  const wristAnchor = side === 'Left'
    ? new Vector3(.02469817,.01357908,-.05306750)
    : new Vector3(-.02770274,.08765392,-.05004015);
  assert(palmCenter.distanceTo(wristAnchor) < .0001,
    `${side}: Blender glove axes displaced the original palm-to-wrist anchor`);
  const { thumbContact, fingerContact, palmContact, wristContact } = hand.userData;
  assert(thumbContact && fingerContact && palmContact && wristContact, 'missing authored grip landmarks');
  const direction = side === 'Left' ? 1 : -1;
  assert((fingerContact[0] - thumbContact[0]) * direction > .08,
    `${side}: thumb and fingers are mirrored onto the wrong hand`);
  assert(palmContact[1] < thumbContact[1] && palmContact[1] < fingerContact[1],
    `${side}: palm must support the handguard from below`);
  assert(wristContact[2] > palmContact[2] + .08, `${side}: wrist must lead toward the body`);
  const before = new Map();
  source.traverse(mesh => {
    if (mesh.isMesh) before.set(mesh.name, Array.from(mesh.geometry.attributes.position.array));
  });
  const arm = buildViewmodelArm(side, scene);
  let moved = 0;
  arm.traverse(mesh => {
    if (!mesh.isMesh) return;
    const original = before.get(mesh.name);
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const offset = i * 3;
      const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
      assert(point.every(Number.isFinite), `${side}: invalid arm vertex`);
      if (/_Hand$/.test(mesh.name) || original[offset + 2] <= 0.18) {
        assert.deepEqual(point, original.slice(offset, offset + 3), `${side}: grip region moved`);
      } else if (point[2] > original[offset + 2]) moved++;
    }
  });
  assert.equal(source.userData.sourceCharacter, 'ev-default');
  assert(moved > 0, 'Upper sleeve must continue toward the offscreen shoulder');
  source.traverse(mesh => {
    if (mesh.isMesh) assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),
      before.get(mesh.name), `${side}: shared template mutated`);
  });
}
console.log('Authored arm continuity passed: upper sleeve extended; glove, wrist and shared template unchanged');
