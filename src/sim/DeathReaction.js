import { deathFallProgress, DEATH_IMPACT_TIME, DEATH_SETTLE_TIME, DEATH_BODY_DURATION } from './DeathTiming.js';
export { DEATH_IMPACT_TIME, DEATH_SETTLE_TIME, DEATH_BODY_DURATION };
export const DEATH_GRAVITY = 22;

// Cosmetic fall only: no hit impulse is fed back into character physics.
export function createDeathReaction(wid, target, source, raycast) {
  let groundOffset = 0;
  if (raycast) {
    const hit = raycast(target.px, target.py + .2, target.pz, 0, -1, 0, 256);
    if (Number.isFinite(hit) && hit < 256) groundOffset = Math.min(0, .2 - hit);
  }
  return { x: 0, z: 0, speed: 0, lift: 0, distance: 0, groundOffset, fallVelocity: Math.min(0, Number.isFinite(target.vy) ? target.vy : 0), duration: DEATH_BODY_DURATION };
}

export function sampleDeathReaction(reaction, elapsed, yaw = 0) {
  const t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const fall = deathFallProgress(t);
  // Ignore legacy impulse fields too: an old snapshot must never launch a body.
  const floor = Math.min(0, Number.isFinite(reaction?.groundOffset) ? reaction.groundOffset : 0);
  const velocity = Math.min(0, Number.isFinite(reaction?.fallVelocity) ? reaction.fallVelocity : 0);
  const drop = velocity * t - .5 * DEATH_GRAVITY * t * t;
  const height = Math.max(0, -floor) + .65;
  const impactTime = Math.max(DEATH_IMPACT_TIME,
    (velocity + Math.sqrt(velocity * velocity + 2 * DEATH_GRAVITY * height)) / DEATH_GRAVITY);
  return { x: 0, y: Math.max(floor, drop), z: 0, air: Math.max(floor, drop), drop, floorOffset: floor,
    pitch: Math.PI / 2 * fall, roll: 0, fall, impactTime,
    poseTime: Math.min(t, DEATH_SETTLE_TIME),
    settled: t >= Math.max(DEATH_SETTLE_TIME, impactTime), done: t >= DEATH_BODY_DURATION };
}
