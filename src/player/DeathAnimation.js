import { deathFallProgress } from '../sim/DeathTiming.js';
export { DEATH_FALL_DURATION, DEATH_IMPACT_TIME, DEATH_SETTLE_TIME, DEATH_BODY_DURATION, deathFallProgress } from '../sim/DeathTiming.js';

// Presentation only; collision and respawn remain authoritative.
export function deathCameraPose(elapsed, side = 1) {
  const fall = deathFallProgress(elapsed);
  const sign = side < 0 ? -1 : 1;
  return { fall, drop: 1.05 * fall, roll: sign * 0.78 * fall, pitch: 0.18 * fall };
}
