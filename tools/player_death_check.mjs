#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  DEATH_FALL_DURATION,
  deathCameraPose,
  deathFallProgress,
} from '../src/player/DeathAnimation.js';

const samples = [30, 60, 144].map((hz) => {
  let elapsed = 0;
  while (elapsed < DEATH_FALL_DURATION) elapsed = Math.min(DEATH_FALL_DURATION, elapsed + 1 / hz);
  return { hz, fall: deathFallProgress(elapsed), pose: deathCameraPose(elapsed, -1) };
});

for (const sample of samples) {
  assert.equal(sample.fall, 1, `death fall did not finish at ${sample.hz}Hz`);
  assert.equal(sample.pose.drop, 1.05, `camera drop changed at ${sample.hz}Hz`);
  assert.equal(sample.pose.roll, -0.78, `camera roll changed at ${sample.hz}Hz`);
}
const early = deathCameraPose(0.18, 1);
const late = deathCameraPose(0.54, 1);
assert.ok(early.fall > 0 && early.fall < late.fall && late.fall < 1, 'death fall is not monotonic');
assert.ok(late.drop > early.drop && late.roll > early.roll, 'camera does not collapse through the fall');
console.log('player death fall passed: shared 0.72s avatar/body/camera pose at 30/60/144Hz');
