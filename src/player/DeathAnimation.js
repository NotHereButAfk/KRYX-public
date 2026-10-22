export const DEATH_FALL_DURATION = 0.72;

export function deathFallProgress(elapsed) {
  const phase = Math.max(0, Math.min(1, elapsed / DEATH_FALL_DURATION));
  return 1 - Math.pow(1 - phase, 3);
}

// Short first-person collapse on the same clock used by visible avatars.
// Collision and respawn remain authoritative; this is presentation only.
export function deathCameraPose(elapsed, side = 1) {
  const fall = deathFallProgress(elapsed);
  const sign = side < 0 ? -1 : 1;
  return { fall, drop: 1.05 * fall, roll: sign * 0.78 * fall, pitch: 0.18 * fall };
}
