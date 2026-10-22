// Every playable body in this project is authored facing local -Z. Camera yaw
// already describes that axis, while a yaw calculated from a world movement
// vector describes +Z and therefore needs a half-turn.
//
// Keep these conversions centralized. The rigged soldier was once special-
// cased as +Z in the player paths but as -Z in the bot path, which made the
// same forward animation look like backpedalling depending on who owned it.

export function cameraYawToBodyYaw(cameraYaw = 0) {
  return cameraYaw;
}

export function directionToBodyYaw(dx, dz) {
  return Math.atan2(dx, dz) + Math.PI;
}

export function turnBodyYaw(current = 0, target = 0, dt = 0, maxRate = 3.2) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeTarget = Number.isFinite(target) ? target : safeCurrent;
  let delta = safeTarget - safeCurrent;
  delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2)
    % (Math.PI * 2) - Math.PI;
  const maxStep = Math.max(0, maxRate) * Math.max(0, dt);
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  const yaw = safeCurrent + step;
  return ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2)
    % (Math.PI * 2) - Math.PI;
}

export function bodyForwardAtYaw(yaw = 0) {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}

// Project resolved world travel into the body's actual visible frame. Use the
// smoothed body yaw (not a newly received target yaw) or a turning avatar can
// plant a sideways stride for several frames while its mesh catches up.
export function movementInBodySpace(dx = 0, dz = 0, bodyYaw = 0) {
  const length = Math.hypot(dx, dz);
  if (length < 1e-8) return { forward: 1, right: 0 };
  const sin = Math.sin(bodyYaw), cos = Math.cos(bodyYaw);
  return {
    forward: (dx * -sin + dz * -cos) / length,
    right: (dx * cos + dz * -sin) / length,
  };
}
