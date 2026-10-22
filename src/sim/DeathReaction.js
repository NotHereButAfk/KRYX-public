import { deathFallProgress, DEATH_IMPACT_TIME, DEATH_SETTLE_TIME, DEATH_BODY_DURATION } from './DeathTiming.js';
export { DEATH_IMPACT_TIME, DEATH_SETTLE_TIME, DEATH_BODY_DURATION };
export const DEATH_GRAVITY = 22;
export const DEATH_LAUNCH_RADIUS = 1.15;
const EXPLOSIVE_WEAPONS = new Set(['rpg', 'concussion', 'frag', 'grenade', 'fuelrod', 'ghammer']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

// A short cosmetic launch never moves the authoritative hitbox. Collision and
// floor samples are solved once at death and shared by all clients.
export function createDeathReaction(wid, target, source, raycast, groundHeightAt) {
  const px = finite(target?.px), py = finite(target?.py), pz = finite(target?.pz);
  const floorAt = (x, z) => {
    if (groundHeightAt) {
      const floor = groundHeightAt(x, z, py + .55, py - 256);
      return Number.isFinite(floor) ? floor : null;
    }
    if (raycast) {
      const hit = raycast(x, py + .55, z, 0, -1, 0, 256);
      return Number.isFinite(hit) && hit < 256 ? py + .55 - hit : null;
    }
    return py;
  };
  const floorY = Math.min(py, floorAt(px, pz) ?? py);
  const groundOffset = floorY - py;
  const reaction = { x: 0, z: 0, speed: 0, lift: 0, distance: 0, groundOffset, floorY,
    fallVelocity: Math.min(0, finite(target?.vy)), duration: DEATH_BODY_DURATION };
  const sx = source?.x ?? source?.px, sz = source?.z ?? source?.pz;
  if (wid === 'void' || !Number.isFinite(sx) || !Number.isFinite(sz)) return reaction;
  const length = Math.hypot(px - sx, pz - sz);
  if (length < .001) return reaction;
  const x = (px - sx) / length, z = (pz - sz) / length;
  const explosive = EXPLOSIVE_WEAPONS.has(wid);
  let distance = explosive ? 4.5 : 3;
  let lift = explosive ? 4.2 : 3.4;
  if (raycast) {
    // Reserve space for relaxed limbs rather than only the standing hitbox.
    const heights = [...new Set([floorY + .2, floorY + .8, floorY + 1.65,
      py + .2, py + .9, py + 1.8, py + 2.25])];
    for (const y of heights) for (const side of [-1.05, -.52, 0, .52, 1.05]) {
      const hit = raycast(px - z * side, y, pz + x * side, x, 0, z, distance + DEATH_LAUNCH_RADIUS);
      if (Number.isFinite(hit)) distance = Math.min(distance, Math.max(0, hit - DEATH_LAUNCH_RADIUS));
    }
    // No lift into a low ceiling. The skeleton becomes shorter as it falls.
    const headroom = raycast(px, py + 1.85, pz, 0, 1, 0, .65);
    if (Number.isFinite(headroom) && headroom < .65) {
      lift = Math.min(lift, Math.sqrt(2 * DEATH_GRAVITY * Math.max(0, headroom - .08)));
    }
  }
  const groundPath = [[0, groundOffset]];
  const steps = Math.max(1, Math.ceil(distance / .2));
  const wanted = distance;
  let lastFloor = floorY;
  for (let i = 1; i <= steps; i++) {
    const travel = wanted * i / steps;
    const floor = floorAt(px + x * travel, pz + z * travel);
    // Stop before a void or sharp ledge instead of inventing a support ramp
    // or teleporting a landed body down onto another storey.
    if (floor === null || Math.abs(floor - lastFloor) > .45) {
      distance = wanted * (i - 1) / steps;
      break;
    }
    groundPath.push([travel, floor - py]);
    lastFloor = floor;
  }
  const travelTime = explosive ? .95 : .75;
  return { ...reaction, launchVersion: 1, x, z, distance, lift,
    speed: distance * 2 / travelTime, travelTime, groundPath };
}

export function sampleDeathReaction(reaction, elapsed, yaw = 0) {
  const t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const fall = deathFallProgress(t);
  const launch = reaction?.launchVersion === 1;
  const length = Math.hypot(finite(reaction?.x), finite(reaction?.z));
  const distance = launch && length > .001 ? clamp(finite(reaction.distance), 0, 4.5) : 0;
  const travelTime = clamp(finite(reaction?.travelTime, .75), .4, 1.1);
  const u = clamp(t / travelTime, 0, 1);
  const travel = distance * (2 * u - u * u);
  let floor = Math.min(0, finite(reaction?.groundOffset));
  if (launch && Array.isArray(reaction.groundPath)) {
    for (let i = 0; i < reaction.groundPath.length; i++) {
      const [at, height] = reaction.groundPath[i];
      if (!Number.isFinite(at) || !Number.isFinite(height)) continue;
      if (at >= travel) {
        const previous = reaction.groundPath[Math.max(0, i - 1)];
        const span = at - previous[0];
        floor = span > 0 ? previous[1] + (height - previous[1]) * clamp((travel - previous[0]) / span, 0, 1) : height;
        break;
      }
      floor = height;
    }
  }
  const velocity = Math.min(0, finite(reaction?.fallVelocity)) + (launch ? clamp(finite(reaction.lift), 0, 4.2) : 0);
  const drop = velocity * t - .5 * DEATH_GRAVITY * t * t;
  const height = Math.max(0, -floor) + .65;
  const impactTime = Math.max(DEATH_IMPACT_TIME,
    (velocity + Math.sqrt(velocity * velocity + 2 * DEATH_GRAVITY * height)) / DEATH_GRAVITY);
  return { x: length > .001 ? finite(reaction?.x) / length * travel : 0,
    z: length > .001 ? finite(reaction?.z) / length * travel : 0,
    y: Math.max(floor, drop), air: Math.max(floor, drop), drop, floorOffset: floor,
    centered: launch, pitch: Math.PI / 2 * fall, roll: 0, fall, impactTime,
    poseTime: Math.min(t, DEATH_SETTLE_TIME),
    settled: t >= Math.max(DEATH_SETTLE_TIME, impactTime, distance > 0 ? travelTime : 0), done: t >= DEATH_BODY_DURATION };
}
