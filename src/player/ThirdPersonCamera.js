// Keep the local body large enough to read during combat without changing its
// physical stature (which must stay aligned with the capsule, eyes, and feet).
export const TPS_DEFAULT_DISTANCE = 1.95;
export const TPS_MAX_DISTANCE = 5.5;
export const TPS_ZOOM_STEP = 0.7;
export const TPS_WALL_CLEARANCE = 0.55;
// Far enough over the firing shoulder that the weapon/forearms remain readable
// instead of stacking behind the torso in the normal rear gameplay view.
export const TPS_SHOULDER_OFFSET = 0.55;
export const TPS_CAMERA_HEIGHT = 1.52;

// EV-style combat framing: the camera sits over the right shoulder and looks
// parallel to the player's aim instead of looking back at the body's centre.
// That places the soldier left of the reticle and keeps the firing lane clear.
export function setThirdPersonDesired(out, position, yaw, pitch, distance) {
  const d = Number.isFinite(distance) ? distance : TPS_DEFAULT_DISTANCE;
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  const downLook = Math.max(0, pitch);
  const horizontal = d * (1 - Math.sin(downLook * 0.5) * 0.22);
  out.set(
    position.x + sinY * horizontal + cosY * TPS_SHOULDER_OFFSET,
    position.y + TPS_CAMERA_HEIGHT + Math.sin(downLook * 0.5) * d * 0.42,
    position.z + cosY * horizontal - sinY * TPS_SHOULDER_OFFSET,
  );
  return out;
}

// Find the first wall between the shoulder pivot and the desired camera. The
// point-inside-box pass is essential: one-sided map meshes do not report an
// outward ray when the desired shoulder camera has already crossed a wall.
export function findThirdPersonObstruction(raycaster, world, target, desired, scratch) {
  const direction = scratch.copy(desired).sub(target);
  const desiredDistance = direction.length();
  if (desiredDistance <= 1e-5) return null;

  raycaster.set(target, direction.normalize());
  raycaster.near = 0.05;
  raycaster.far = desiredDistance;
  let nearest = raycaster.intersectObjects(world.raycastMeshes || [], true)[0] || null;
  const boxHit = world.raycastBoxHit?.(raycaster.ray, desiredDistance);
  if (boxHit && (!nearest || boxHit.distance < nearest.distance)) nearest = boxHit;

  for (const collider of world.colliders || []) {
    const box = collider?.box;
    if (!box?.containsPoint(desired)) continue;
    raycaster.set(desired, scratch.copy(target).sub(desired).normalize());
    const exit = raycaster.ray.intersectBox(box, scratch);
    if (!exit) continue;
    const fromTarget = desiredDistance - desired.distanceTo(exit);
    if (fromTarget > 0.05 && (!nearest || fromTarget < nearest.distance)) {
      nearest = { distance: fromTarget, point: exit.clone() };
    }
  }
  return nearest;
}

// Player-controlled third person is disabled. Keep the old framing helpers for
// the floating spectator/QA cameras, but every gameplay wheel input resolves
// to first person so weapon scrolling cannot accidentally change POV.
export function nextThirdPersonDistance(current, wheelDelta) {
  void current;
  void wheelDelta;
  return 0;
}

export function safeThirdPersonObstructionDistance(hitDistance) {
  return Math.max(0.35, hitDistance - TPS_WALL_CLEARANCE);
}
