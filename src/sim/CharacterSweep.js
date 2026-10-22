// Fast movement can cross an entire narrow stair tread in one frame/tick.
// Collision must sample the route often enough to see each walkable top,
// otherwise the capsule meets the next vertical riser and appears stuck.
export const MAX_CHARACTER_SWEEP_DISTANCE = 0.18;
export const MAX_CHARACTER_SWEEP_SEGMENTS = 16;

export function characterSweepSegments(
  dx,
  dz,
  maxDistance = MAX_CHARACTER_SWEEP_DISTANCE,
  maxSegments = MAX_CHARACTER_SWEEP_SEGMENTS,
) {
  const distance = Math.hypot(Number(dx) || 0, Number(dz) || 0);
  const spacing = Math.max(0.04, Number(maxDistance) || MAX_CHARACTER_SWEEP_DISTANCE);
  const cap = Math.max(1, Math.trunc(maxSegments) || MAX_CHARACTER_SWEEP_SEGMENTS);
  return Math.min(cap, Math.max(1, Math.ceil(distance / spacing)));
}
