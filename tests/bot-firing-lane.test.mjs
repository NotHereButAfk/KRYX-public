import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotFiringStep } from '../src/entities/BotFiringLane.js';

const base = { x: 0, y: 0, z: 0, targetX: 0, targetY: 1.05, targetZ: -30,
  forward: 0, strafe: 1, killY: -10, probeDistance: 2.2 };

function choose(overrides = {}) {
  return chooseBotFiringStep({
    ...base,
    groundHeightAt: () => 0,
    raycast: (_ox, _oy, _oz, _dx, _dy, _dz, far) => far,
    ...overrides,
  });
}

test('chooses a continuous firing lane without stepping into walls or voids', () => {
  assert.deepEqual(choose(), { forward: 0, strafe: 1 });

  const wallOrigins = [];
  const wallResult = choose({
    raycast: (ox, oy, oz, dx, dy, dz, far) => {
      if (ox > 1 && dz < 0 && far > 10) {
        wallOrigins.push(ox);
        return 1;
      }
      return far;
    },
    forward: 1,
    strafe: 1,
  });
  assert.ok(wallOrigins.length > 0);
  assert.deepEqual(wallResult, { forward: 1, strafe: -1 });

  const voidResult = choose({
    groundHeightAt: (x) => (x > 0 ? -Infinity : 0),
    forward: 1,
    strafe: 1,
  });
  assert.deepEqual(voidResult, { forward: 1, strafe: -1 });

  let rayCalls = 0;
  const blockedResult = choose({
    groundHeightAt: (x) => (Math.abs(x) > 0 ? -Infinity : 0),
    raycast: (_ox, _oy, _oz, _dx, _dy, dz, far) => {
      rayCalls += 1;
      return dz > 0 ? 0 : far;
    },
    forward: 1,
    strafe: 1,
  });
  assert.deepEqual(blockedResult, { forward: 0, strafe: 0 });
  assert.ok(rayCalls <= 3 * 4);

  assert.deepEqual(choose({ x: NaN }), { forward: 0, strafe: 0 });
  assert.deepEqual(choose({ targetZ: Infinity }), { forward: 0, strafe: 0 });
});

test('real ray directions are normalized and a first-sample drop is rejected', () => {
  let rays = 0;
  assert.deepEqual(choose({raycast: (_x,_y,_z,dx,dy,dz,far) => {
    rays++; assert(Math.abs(Math.hypot(dx,dy,dz)-1) < 1e-9);
    assert(far > 0); return far;
  }}), {forward:0,strafe:1});
  assert.equal(rays, 4);
  assert.deepEqual(choose({groundHeightAt: () => -1}), {forward:0,strafe:0});
  assert.deepEqual(choose({raycast: () => NaN}), {forward:0,strafe:0});
});
