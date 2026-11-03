const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const hash = (value) => {
  const text = String(value);
  let result = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  result += result << 13;
  result ^= result >>> 7;
  result += result << 3;
  result ^= result >>> 17;
  result += result << 5;
  return result >>> 0;
};

const unit = (value) => (hash(value) >>> 0) / 4294967296;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function chooseHumanBotMove({
  id = 0,
  elapsed = 0,
  distance = 12,
  range = 60,
  reacting = false,
  hasLineOfSight = true,
  reloading = false,
  strafeSide,
} = {}) {
  const targetDistance = Math.max(0, finite(distance, 12));
  const targetRange = Math.max(8, finite(range, 60));
  // Keep an intent until the world or threat changes it. Elapsed match time
  // must never make every bot stop, reverse or resume firing on a schedule.
  const side = strafeSide ? Math.sign(strafeSide) : (unit(`${id}:side`) < .5 ? -1 : 1);
  const lateral = side * (reacting ? .55 : 1);
  const closeLimit = Math.max(6, Math.min(12, targetRange * 0.2));

  if (!hasLineOfSight) {
    if (targetDistance <= 1.2) {
      return { forward: 0, strafe: 0, mode: "hold", sprint: false };
    }
    return { forward: 1, strafe: 0, mode: "chase", sprint: true };
  }

  if (reloading || targetDistance < closeLimit) {
    return { forward: -0.65, strafe: lateral, mode: "retreat", sprint: false };
  }
  if (targetDistance <= targetRange * 0.9) {
    return { forward: 0, strafe: lateral, mode: "sidestep", sprint: false };
  }
  return {
    forward: reacting ? 0.35 : 0.5,
    strafe: lateral,
    mode: "close",
    sprint: false,
  };
}

// Compatibility for consumers that track a burst count. Native weapon cadence
// is the only firing clock; no bot-only pauses are inserted at any distance.
export function nextBotFire(shotsRemaining) {
  return { shotsRemaining: Math.max(0, finite(shotsRemaining, 0) - 1), delayScale: 1, burstPause: false };
}
