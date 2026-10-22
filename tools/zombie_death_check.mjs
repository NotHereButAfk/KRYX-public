import {
  applyZombieDeathCrumple,
  ZOMBIE_DEATH_SECONDS,
} from '../src/entities/Zombie.js';

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const BASE_SPINE = 0.18;
const BASE_HEAD = -0.06;
const EPS = 1e-12;

function simulate(refreshHz) {
  const rig = {
    spineGroup: { rotation: { x: BASE_SPINE } },
    headGroup: { rotation: { x: BASE_HEAD } },
  };
  const dt = 1 / refreshHz;
  let elapsed = 0;
  let prevSpine = BASE_SPINE;
  let prevHead = BASE_HEAD;

  while (elapsed < ZOMBIE_DEATH_SECONDS) {
    elapsed += dt;
    const p = Math.min(1, elapsed / ZOMBIE_DEATH_SECONDS);
    applyZombieDeathCrumple(rig, BASE_SPINE, BASE_HEAD, p * p);

    assert(rig.spineGroup.rotation.x >= prevSpine - EPS,
      `${refreshHz}Hz spine reversed during the crumple`);
    assert(rig.headGroup.rotation.x >= prevHead - EPS,
      `${refreshHz}Hz head reversed during the crumple`);
    assert(rig.spineGroup.rotation.x <= BASE_SPINE + 0.4 + EPS,
      `${refreshHz}Hz spine accumulated past its authored limit`);
    assert(rig.headGroup.rotation.x <= BASE_HEAD + 0.3 + EPS,
      `${refreshHz}Hz head accumulated past its authored limit`);

    prevSpine = rig.spineGroup.rotation.x;
    prevHead = rig.headGroup.rotation.x;
  }
  return {
    spine: rig.spineGroup.rotation.x,
    head: rig.headGroup.rotation.x,
  };
}

const results = [30, 60, 144].map((hz) => ({ hz, ...simulate(hz) }));
for (const result of results) {
  assert(Math.abs(result.spine - (BASE_SPINE + 0.4)) < EPS,
    `${result.hz}Hz spine did not end on the authored pose`);
  assert(Math.abs(result.head - (BASE_HEAD + 0.3)) < EPS,
    `${result.hz}Hz head did not end on the authored pose`);
}

assert(results.every((r) =>
  Math.abs(r.spine - results[0].spine) < EPS &&
  Math.abs(r.head - results[0].head) < EPS),
'zombie death pose changes with refresh rate');

console.log(
  `zombie death crumple passed at ${results.map((r) => `${r.hz}Hz`).join('/')} ` +
  '(spine +0.40rad, head +0.30rad)'
);
