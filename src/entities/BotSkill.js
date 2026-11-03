import { chooseHumanBotMove } from './BotEngagement.js';
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

const coords = (value) => ({
  x: finite(value?.x),
  y: finite(value?.y),
  z: finite(value?.z)
});

export function observeBotTarget(previous, position, seconds, targetId) {
  const point = coords(position);
  const time = finite(seconds);
  let vx = 0;
  let vy = 0;
  let vz = 0;
  const dt = time - finite(previous?.time, NaN);
  if (previous && Object.is(previous.targetId, targetId) && dt > 0 && dt <= 0.25) {
    const prior = coords(previous);
    const dx = point.x - prior.x;
    const dy = point.y - prior.y;
    const dz = point.z - prior.z;
    const speed = Math.hypot(dx, dy, dz) / dt;
    if (speed <= 18) {
      vx = dx / dt;
      vy = dy / dt;
      vz = dz / dt;
    }
  }
  return { ...point, vx, vy, vz, time, targetId };
}

export function predictBotTarget(sample, seconds, visible = true) {
  if (!sample) return null;
  const point = coords(sample);
  if (!visible) return point;
  // Both timestamps use the same clock. Predict only the age of the sample,
  // never the absolute match duration or a projectile travel time.
  const duration = Math.min(0.12, Math.max(0, finite(seconds) - finite(sample.time)));
  let dx = finite(sample.vx) * duration;
  let dy = finite(sample.vy) * duration;
  let dz = finite(sample.vz) * duration;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > 1.5) {
    const scale = 1.5 / distance;
    dx *= scale;
    dy *= scale;
    dz *= scale;
  }
  return { x: point.x + dx, y: point.y + dy, z: point.z + dz };
}

// Preserve the shared entry point while keeping combat decisions separate
// from visual target sampling and prediction.
export const chooseSkilledBotMove = chooseHumanBotMove;
