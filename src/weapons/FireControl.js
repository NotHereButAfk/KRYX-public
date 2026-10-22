// Shared trigger/cadence rules for the rendered weapon and authoritative
// network bridge. Keeping these rules pure prevents the two firing loops from
// drifting apart when a frame arrives late.

export function advanceFireCooldown(cooldown, dt) {
  return Number.isFinite(cooldown) ? cooldown - Math.max(0, dt || 0) : 0;
}

export function wantsTriggerShot(automatic, down, wasDown) {
  return !!down && (!!automatic || !wasDown);
}

export function scheduleNextShot(cooldown, interval) {
  const cadence = Math.max(0.001, Number(interval) || 0.12);
  // Retain at most one interval of timing debt. A hitch therefore does not
  // permanently slow an automatic gun, but also cannot dump a large burst in
  // one render frame after the tab resumes.
  return Math.max(-cadence, Number(cooldown) || 0) + cadence;
}

/**
 * Whether the local player is actively moving while holding the trigger.
 *
 * Presentation only: firing cancels sprint, while walking shots remain
 * available with movement spread.
 */
export function isMovingAndFiring(player, input, minSpeed = 0.5) {
  if (!input?.mouseDown || player?.isDead === true) return false;
  const vx = Number(player?.velocity?.x) || 0;
  const vz = Number(player?.velocity?.z) || 0;
  return Math.hypot(vx, vz) >= Math.max(0, Number(minSpeed) || 0);
}
