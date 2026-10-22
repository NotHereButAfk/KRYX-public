// Shared by the authoritative simulation and client presentation.
export const DEATH_FALL_DURATION = 0.82;
export const DEATH_IMPACT_TIME = 0.68;
export const DEATH_SETTLE_TIME = 1.2;
export const DEATH_BODY_DURATION = 1.65;

export function deathFallProgress(elapsed) {
  // Brief loss of balance before the body falls, without an initial pose snap.
  const phase = Math.max(0, Math.min(1, (elapsed - 0.04) / (DEATH_FALL_DURATION - 0.04)));
  return phase * phase * (3 - 2 * phase);
}
