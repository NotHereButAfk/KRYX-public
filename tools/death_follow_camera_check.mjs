#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeathFollowCamera } from '../src/core/DeathFollowCamera.js';

const clear = (_ray, distance) => distance;
const killer = { id: 42, x: 5, y: 0, z: -10, yaw: .2 };
const other = { id: 7, x: 80, y: 0, z: 60, yaw: -1, alive: true, ready: true };
const finite = camera => [...camera.position.toArray(), ...camera.quaternion.toArray()].every(Number.isFinite);

for (const isBot of [false, true]) {
  const follow = new DeathFollowCamera();
  assert.equal(follow.begin(killer), true);
  assert.equal(follow.update(1 / 60, [other], clear), true);
  assert.equal(follow.seenTarget, false, 'unrelated player was treated as the killer');
  assert(finite(follow.camera), 'missing first interpolation buffer corrupted the camera');
  const target = { ...killer, x: 6, alive: true, ready: true, isBot };
  follow.update(1 / 60, [other, target], clear);
  assert.equal(follow.seenTarget, true, 'late first buffer did not bind the actual killer');
  assert.equal(follow.lastTarget.x, 6);
  target.x = 9;
  follow.update(1 / 60, [target, other], clear);
  assert.equal(follow.lastTarget.x, 9, 'living killer movement was not followed');
  for (const loss of ['death', 'leave']) {
    const camera = new DeathFollowCamera();
    camera.begin(killer);
    camera.update(1 / 60, [target], clear);
    camera.update(1 / 60, loss === 'death' ? [{ ...target, alive: false }] : [other], clear);
    assert.equal(camera.targetLost, true, `killer ${loss} did not latch the final location`);
    camera.update(1 / 60, [{ ...target, x: 80 }, other], clear);
    assert.equal(camera.lastTarget.x, 9, 'camera jumped to the killer respawn');
    assert.equal(camera.killerId, killer.id, 'camera selected a different player');
    assert(finite(camera.camera));
  }
  follow.clear();
  assert.equal(follow.active, false);
  assert.equal(follow.update(1 / 60, [target], clear), false, 'respawn left follow active');
  assert.equal(follow.killerId, null);
  assert.equal(follow.lastTarget, null);
  assert.equal(follow.begin({ ...other, id: 'new-killer' }), true);
  follow.update(1 / 60, [], clear);
  assert.equal(follow.seenTarget, false, 'next death retained the previous target state');
  assert(follow.camera.position.distanceTo(new THREE.Vector3(other.x, other.y + 1.3, other.z)) < 5);
}

for (const invalid of [null, {}, { ...killer, id: null }, { ...killer, id: '' },
  { ...killer, id: NaN }, { ...killer, x: NaN }, { ...killer, z: Infinity }]) {
  const follow = new DeathFollowCamera();
  assert.equal(follow.begin(invalid), false, 'invalid attribution activated death following');
  assert.equal(follow.active, false);
  assert.equal(follow.update(1 / 60, [other], clear), false);
}
for (const unavailable of [{ alive: false }, { ready: false }]) {
  const follow = new DeathFollowCamera();
  follow.begin(killer);
  follow.update(1 / 60, [{ ...killer, ...unavailable }], clear);
  assert.equal(follow.targetLost, true, 'dead or spectating killer must not bind on its next respawn');
  follow.update(1 / 60, [{ ...killer, x: 90, alive: true }], clear);
  assert.equal(follow.lastTarget.x, killer.x);
  follow.update(NaN, [{ ...killer, x: NaN }], clear);
  assert(finite(follow.camera), 'invalid frame data corrupted the held view');
}

const positions = [];
for (const hz of [30, 60, 144]) {
  const follow = new DeathFollowCamera();
  follow.begin(killer);
  follow.update(1 / hz, [{ ...killer, alive: true }], clear);
  const previous = new THREE.Quaternion();
  let maxAngularSpeed = 0;
  for (let i = 1; i <= hz * 2; i++) {
    const time = i / hz;
    previous.copy(follow.camera.quaternion);
    follow.update(1 / hz, [{ ...killer, x: killer.x + time * 3,
      y: Math.sin(time * 30) * .06, yaw: killer.yaw + Math.sin(time * 30) * .3,
      alive: true }], clear);
    maxAngularSpeed = Math.max(maxAngularSpeed, previous.angleTo(follow.camera.quaternion) * hz);
  }
  assert(maxAngularSpeed < 1, 'death follow amplified normal movement or aim jitter');
  positions.push(follow.camera.position.clone());
  follow.update(1 / hz, [{ ...killer, x: killer.x + 6, alive: true }], (_ray, distance) => Math.min(distance, 1.2));
  assert(follow.camera.position.distanceTo(follow.rig.focus) <= 1.2, 'death follow crossed a wall');
}
for (const position of positions) assert(position.distanceTo(positions[1]) < .15,
  'death follow depends on rendering frame rate');
console.log('Death follow passed: exact human/bot killer, delayed interpolation, death/leave latch, clean reset, invalid metadata, wall clearance and 30/60/144Hz stability.');
