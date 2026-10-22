import { WALK_SPEED, SPRINT_MULT } from '../sim/MovementConfig.js';

// Movement widens the spread smoothly with speed; standing accuracy is unchanged.
// Use resolved speed, never a client-supplied sprint/accuracy bonus.
export function shotSpread(weapon, bloom = 0, aim = 0, speed = 0) {
  if (weapon.kind === 'melee') return 0;
  const min = weapon.spreadMin ?? weapon.spread ?? 0;
  const max = weapon.spreadMax ?? weapon.spread ?? min;
  const base = Math.max(min, Math.min(max, bloom));
  const moving = 0.030 * Math.min(1, Math.max(0, (speed - 0.2) / (WALK_SPEED - 0.2))) ** 2
    + 0.015 * Math.max(0, Math.min(1, (speed - WALK_SPEED) / (WALK_SPEED * (SPRINT_MULT - 1))));
  return base * (1 + ((weapon.zoomSpreadMod ?? 0.45) - 1) * Math.max(0, Math.min(1, aim))) + moving;
}

// Perturb in the aim plane so the cone is identical at every yaw/pitch.
export function spreadDirection(yaw, pitch, horizontal, vertical) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const x = -sy * cp + cy * horizontal + sy * sp * vertical;
  const y = sp + cp * vertical;
  const z = -cy * cp - sy * horizontal + cy * sp * vertical;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}
