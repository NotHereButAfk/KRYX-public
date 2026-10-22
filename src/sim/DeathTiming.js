// Shared by the authoritative simulation and client presentation.
export const DEATH_FALL_DURATION = 0.46;
export const DEATH_IMPACT_TIME = 0.42;
export const DEATH_SETTLE_TIME = 0.68;
export const DEATH_BODY_DURATION = 4.65;
export const PLAYER_RESPAWN_DELAY = 6;

export function deathFallProgress(elapsed) {
  // Gravity accelerates the collapse right through contact. An ease-out curve
  // made the body hang in the air just before it reached the floor.
  const phase = Math.max(0, Math.min(1, elapsed / DEATH_FALL_DURATION));
  return phase * phase;
}
