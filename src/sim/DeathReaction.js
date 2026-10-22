// Cosmetic fall only: dead bodies receive no hit impulse or ragdoll physics.
export function createDeathReaction(wid, target, source, raycast) {
  let groundOffset = 0;
  if (raycast) {
    const hit = raycast(target.px, target.py + .2, target.pz, 0, -1, 0, 256);
    if (Number.isFinite(hit) && hit < 256) groundOffset = Math.min(0, .2 - hit);
  }
  return { x: 0, z: 0, speed: 0, lift: 0, distance: 0, groundOffset, duration: 1.3 };
}

export function sampleDeathReaction(reaction, elapsed, yaw = 0) {
  const t = Math.max(0, elapsed);
  const progress = Math.min(1, t / .85);
  const fall = progress * progress * (3 - 2 * progress);
  // Ignore legacy impulse fields too, so older snapshots cannot launch bodies.
  const floor = Math.min(0, reaction?.groundOffset ?? 0);
  const air = floor * fall;
  return { x: 0, y: air, z: 0, air, pitch: Math.PI / 2 * fall,
    roll: 0, fall, done: t >= 1.3 };
}
