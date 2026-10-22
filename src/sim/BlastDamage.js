// Damage reaches the player's capsule, not only one point in their chest.
// Several visibility samples allow exposed legs/shoulders to be hit while
// solid cover still shields a completely occluded player.
export function blastDamage(origin, state, radius, damage, minimum, raycast) {
  const height = state.crouch || state.slide ? 1 : 1.7;
  const bodyRadius = 0.42;
  const y = Math.max(state.py + bodyRadius,
    Math.min(state.py + height - bodyRadius, origin.y));
  const distance = Math.max(0, Math.hypot(state.px - origin.x, y - origin.y,
    state.pz - origin.z) - bodyRadius);
  if (distance > radius) return 0;
  const samples = [y, state.py + 0.22, state.py + height * 0.55, state.py + height - 0.12];
  const visible = samples.some(sy => {
    const dx = state.px - origin.x, dy = sy - origin.y, dz = state.pz - origin.z;
    const length = Math.hypot(dx, dy, dz);
    return length < 0.01 || raycast(origin.x, origin.y, origin.z,
      dx / length, dy / length, dz / length, length) >= length - 0.025;
  });
  return visible ? damage * (1 - (1 - minimum) * distance / radius) : 0;
}
