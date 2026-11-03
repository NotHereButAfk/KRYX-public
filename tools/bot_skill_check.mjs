import assert from "node:assert/strict";
import { observeBotTarget, predictBotTarget, chooseSkilledBotMove } from "../src/entities/BotSkill.js";

const pos = (x, y = 0, z = 0) => ({ x, y, z });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

let sample = observeBotTarget(null, pos(0), 0, "a");
const input = pos(1);
const before = structuredClone(input);
sample = observeBotTarget(sample, input, 0.1, "a");
assert.deepEqual(input, before);
near(sample.vx, 10);
assert.equal(sample.targetId, "a");
assert.equal(sample.time, 0.1);
near(predictBotTarget(sample, 1).x, 2.2);
near(predictBotTarget(sample, .1).x, 1);
near(predictBotTarget(sample, .15).x, 1.5);
near(predictBotTarget({ ...sample, vx: 18 }, 1).x, 2.5);
assert.deepEqual(predictBotTarget(sample, 1, false), { x: 1, y: 0, z: 0 });
assert.equal(predictBotTarget(null, 1), null);

let zero = observeBotTarget(sample, pos(2), 0.1, "a");
assert.deepEqual({ vx: zero.vx, vy: zero.vy, vz: zero.vz }, { vx: 0, vy: 0, vz: 0 });
let changed = observeBotTarget(sample, pos(2), 0.2, "b");
assert.deepEqual({ vx: changed.vx, vy: changed.vy, vz: changed.vz }, { vx: 0, vy: 0, vz: 0 });
let gap = observeBotTarget(sample, pos(2), 0.5, "a");
assert.deepEqual({ vx: gap.vx, vy: gap.vy, vz: gap.vz }, { vx: 0, vy: 0, vz: 0 });
let teleport = observeBotTarget(sample, pos(10), 0.2, "a");
assert.deepEqual({ vx: teleport.vx, vy: teleport.vy, vz: teleport.vz }, { vx: 0, vy: 0, vz: 0 });

const move = (elapsed, options = {}) => chooseSkilledBotMove({ id: 7, elapsed, distance: 12, strafeSide: 1, ...options });
const reacting = move(0, { reacting: true });
assert.equal(reacting.forward, 0, 'reaction must not rush an in-range target');
assert.ok(Math.abs(reacting.strafe) > 0 && Math.abs(reacting.strafe) <= 1,
  'reaction should retain controlled lateral footwork');
assert.equal(reacting.sprint, false);
assert.equal(move(0, { hasLineOfSight: false }).mode, "chase");
const approaching = move(0, { distance: 15, range: 10 });
assert.ok(approaching.forward > 0 && approaching.strafe !== 0,
  'visible out-of-range opponents require an advancing sidestep');
assert.equal(approaching.sprint, false);
assert.equal(move(0, { distance: 15, range: 30 }).mode, "sidestep");

for (const hz of [20, 30, 60, 144]) {
  let moving = 0;
  for (let i = 0; i < hz * 20; i++) {
    const m = move(i / hz);
    if (m.forward !== 0 || m.strafe !== 0) moving++;
  }
  const ratio = moving / (hz * 20);
  assert.equal(ratio, 1, `${hz}Hz combat inserted a forced aiming stop`);
}

let pauses = 0;
let switches = 0;
let previous = null;
for (let i = 0; i < 600; i++) {
  const m = move(i / 60);
  if (m.forward === 0 && m.strafe === 0) pauses++;
  if (previous && Math.sign(m.strafe) !== Math.sign(previous.strafe)) switches++;
  previous = m;
}
assert.equal(pauses, 0, 'in-range footwork must remain continuous');
assert.equal(switches, 0, 'elapsed time silently reversed the chosen strafe side');
assert.ok(move(10, { strafeSide: -1 }).strafe < 0, 'a new steering choice was ignored');
assert.ok(move(10, { strafeSide: 1 }).strafe > 0, 'the retained steering side was ignored');

let retreat = false;
for (let i = 0; i < 180; i++) {
  const m = chooseSkilledBotMove({ id: 3, elapsed: i / 60, distance: 12, reloading: true });
  if (m.forward !== 0 || m.strafe !== 0) {
    assert.ok(m.forward < 0 && m.strafe !== 0);
    assert.notEqual(m.sprint, true);
    retreat = true;
  }
}
assert.ok(retreat);

console.log("BotSkill regression checks passed");
