import { WALK_SPEED, SLIDE_DURATION, SLIDE_MIN_SPEED, SLIDE_STEER_RATE } from './MovementConfig.js';

export function canStartSlide(vx, vz, grounded, sliding, recovery, pressed) {
  return !!pressed && !!grounded && !sliding && recovery <= 0
    && Math.hypot(vx, vz) >= SLIDE_MIN_SPEED;
}

// Shared by the frame-driven offline controller and the fixed-tick authority.
// The saved direction vector's length is the launch speed. Input can bend it
// gradually, but camera rotation alone cannot reverse the slide or add speed.
export function advanceSlide(time, dx, dz, wishX, wishZ, crouching, dt, out = {}) {
  const length = Math.hypot(dx, dz);
  const wishLength = Math.hypot(wishX, wishZ);
  if (length > 0 && wishLength > 0) {
    const dot = (dx * wishX + dz * wishZ) / (length * wishLength);
    if (dot > 0) {
      const angle = Math.atan2(dx * wishZ - dz * wishX, dx * wishX + dz * wishZ);
      const turn = Math.max(-SLIDE_STEER_RATE * dt, Math.min(SLIDE_STEER_RATE * dt, angle));
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const nextX = dx * cos - dz * sin;
      dz = dx * sin + dz * cos; dx = nextX;
    }
  }
  out.time = time - dt > 1e-9 ? time - dt : 0;
  out.dx = dx; out.dz = dz;
  const tailSpeed = WALK_SPEED * (crouching ? 0.55 : 1);
  const remaining = out.time / SLIDE_DURATION;
  const speed = tailSpeed + (length - tailSpeed) * remaining * remaining;
  out.vx = length > 0 ? dx / length * speed : 0;
  out.vz = length > 0 ? dz / length * speed : 0;
  return out;
}
