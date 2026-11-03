import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseHumanBotMove, nextBotFire } from '../src/entities/BotEngagement.js';

const move = (overrides = {}) => chooseHumanBotMove({
  id: 'bot-a', elapsed: 0, distance: 36, range: 60, reacting: false, strafeSide: 1,
  hasLineOfSight: true, reloading: false, ...overrides
});

const finiteMove = (value) => {
  for (const key of ['forward', 'strafe']) assert.equal(Number.isFinite(value[key]), true);
};

test('visible targets use stable human movement policies', () => {
  const inRange = move();
  assert.notEqual(inRange.strafe, 0);
  assert.equal(inRange.forward, 0);
  assert.equal(inRange.sprint, false);

  const far = move({ distance: 65 });
  assert.equal(far.forward > 0, true);
  assert.notEqual(far.strafe, 0);
  assert.equal(far.sprint, false);

  assert.equal(move({ distance: 3 }).mode, 'retreat');
  assert.equal(move({ reloading: true }).mode, 'retreat');
  assert.notEqual(move({ reacting: true }).mode, 'fire');
});

test('hidden targets chase or hold without invalid vectors', () => {
  const chase = move({ distance: 20, hasLineOfSight: false });
  assert.equal(chase.mode, 'chase');
  assert.equal(chase.sprint, true);

  assert.equal(move({ distance: 0.5, hasLineOfSight: false }).mode, 'hold');
  for (const id of ['bot-a', 'bot-b', 'bot-c']) {
    for (let frame = 0; frame < 60 * 8; frame++) {
      const step = move({ id, elapsed: frame / 60, distance: 40 });
      finiteMove(step); assert.notEqual(step.strafe, 0, 'fixed aiming cycle stopped visible combat movement');
      assert.equal(step.sprint, false);
    }
  }
});

test('chosen lateral direction persists until steering explicitly changes it', () => {
  for (const strafeSide of [-1, 1]) {
    const first = move({ strafeSide });
    assert.equal(Math.sign(first.strafe), strafeSide);
    for (const id of ['bot-a', 'bot-b', 'bot-c']) {
      for (const elapsed of [0, .75, 1.6, 5, 20, 120]) {
        assert.deepEqual(move({ id, elapsed, strafeSide }), first,
          'identity or a timer changed movement without a steering decision');
      }
    }
  }
  assert.notEqual(Math.sign(move({ strafeSide: -1 }).strafe),
    Math.sign(move({ strafeSide: 1 }).strafe), 'an explicit side change was ignored');
});

test('movement inputs remain bounded for invalid numbers', () => {
  const result = move({ distance: NaN, range: NaN, elapsed: NaN, strafeSide: NaN });
  finiteMove(result);
  assert.ok(Math.abs(result.forward) <= 1 && Math.abs(result.strafe) <= 1);
});

for (const automatic of [false, true]) {
  test((automatic ? 'automatic' : 'semi-automatic') + ' weapons retain native cadence at every distance', () => {
    for (const distance of [3, 50, 110, 160]) {
      let remaining = 50;
      for (let shot = 0; shot < 60; shot++) {
        const result = nextBotFire(remaining, { distance, range: 150, automatic,
          random: () => assert.fail('native cadence must not roll random pauses') });
        assert.equal(result.delayScale, 1, 'bot cadence differs from the weapon cadence');
        assert.equal(result.burstPause, false, 'an artificial burst pause returned');
        assert(Number.isFinite(result.shotsRemaining) && result.shotsRemaining >= 0);
        remaining = result.shotsRemaining;
      }
    }
  });
}

test('legacy burst counters cannot impose pauses after their final round', () => {
  for (const remaining of [0, 1, 2, 7]) {
    const result = nextBotFire(remaining, { distance: 110, range: 150 });
    assert.equal(result.delayScale, 1);
    assert.equal(result.burstPause, false);
  }
});
