// Spawn markers describe the playable height; decorative foundations can extend
// hundreds of metres down and must never turn the void into a second arena.
export function playableKillY(spawns) {
  const heights = spawns.map(p => p.y ?? p[1]).filter(Number.isFinite);
  return heights.length ? Math.min(...heights) - 18 : -25;
}

// Capsule containment has no floor: falling into the void still causes death.
// Return blocked axes so prediction and authority discard outward momentum.
export function constrainPlayablePosition(position, bounds, radius = .45, height = 1.7) {
  if (!bounds) return 0;
  let blocked = 0;
  const x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, position.x));
  const z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, position.z));
  const y = Math.min(bounds.maxY - height, position.y);
  if (x !== position.x) blocked |= 1;
  if (z !== position.z) blocked |= 2;
  if (y !== position.y) blocked |= 4;
  position.x = x; position.y = y; position.z = z;
  return blocked;
}

export function insidePlayableBounds(point, bounds, radius = .46) {
  return !bounds || (point[0] >= bounds.minX + radius && point[0] <= bounds.maxX - radius
    && point[2] >= bounds.minZ + radius && point[2] <= bounds.maxZ - radius
    && point[1] <= bounds.maxY - 1.7);
}
