export const DEATH_FALL_DURATION = 0.82;
export const DEATH_IMPACT_TIME = 0.68;
export const DEATH_SETTLE_TIME = 1.2;
export const DEATH_BODY_DURATION = 1.65;

export function deathFallProgress(elapsed) {
  // A short loss of balance, then gravity carries the body backwards. Ease-in
  // avoids the old instant rigid tumble on the very first death frame.
  const phase = Math.max(0, Math.min(1, (elapsed - 0.04) / (DEATH_FALL_DURATION - 0.04)));
  return phase * phase * (3 - 2 * phase);
}

// Presentation only; collision and respawn remain authoritative.
export function deathCameraPose(elapsed, side = 1) {
  const fall = deathFallProgress(elapsed);
  const sign = side < 0 ? -1 : 1;
  return { fall, drop: 1.05 * fall, roll: sign * 0.78 * fall, pitch: 0.18 * fall };
}
