export function chooseBotFiringStep({
  x, y, z, targetX, targetY, targetZ,
  forward = 0, strafe = 1, groundHeightAt, raycast,
  killY = -25, probeDistance = 2.2
}) {
  const valid = [x, y, z, targetX, targetY, targetZ, killY, probeDistance]
    .every(Number.isFinite)
  if (!valid) return { forward: 0, strafe: 0 }

  const clean = value => Number.isFinite(value)
    ? Math.max(-1, Math.min(1, value)) : 0
  const original = { forward: clean(forward), strafe: clean(strafe) }
  if (typeof groundHeightAt !== 'function' || typeof raycast !== 'function') return original

  const tx = targetX - x
  const tz = targetZ - z
  const targetPlaneLength = Math.hypot(tx, tz)
  if (!(targetPlaneLength > 0) || !(probeDistance > 0)) return { forward: 0, strafe: 0 }
  const fx = tx / targetPlaneLength
  const fz = tz / targetPlaneLength
  const rx = -fz
  const rz = fx

  const clear = (ox, oy, oz, dx, dy, dz, far, required) => {
    const hit = raycast(ox, oy, oz, dx, dy, dz, far);
    return hit === Infinity || (Number.isFinite(hit) && hit >= required);
  };
  const safe = (wantedForward, wantedStrafe) => {
    let dx = wantedForward * fx + wantedStrafe * rx;
    let dz = wantedForward * fz + wantedStrafe * rz;
    const amount = Math.hypot(dx, dz);
    if (amount < .001) return true;
    dx /= amount; dz /= amount;
    const travel = Math.min(3, Math.max(.5, probeDistance)), segment = travel / 3;
    let px = x, pz = z, floor = y;
    for (let sample = 1; sample <= 3; sample++) {
      const nx = x + dx * segment * sample, nz = z + dz * segment * sample;
      const nextFloor = groundHeightAt(nx, nz, floor, floor - .65);
      if (!Number.isFinite(nextFloor) || nextFloor <= killY || Math.abs(nextFloor - floor) > .65) return false;
      if (!clear(px, Math.max(floor, nextFloor) + .85, pz, dx, 0, dz, segment + .4, segment + .3)) return false;
      px = nx; pz = nz; floor = nextFloor;
    }
    const lx = targetX - px, ly = targetY - (floor + 1.5), lz = targetZ - pz;
    const length = Math.hypot(lx, ly, lz);
    return length < .5 || clear(px, floor + 1.5, pz, lx / length, ly / length, lz / length, length, length - .45);
  };

  if (safe(original.forward, original.strafe)) return original
  const mirrored = { forward: original.forward, strafe: -original.strafe }
  if (mirrored.strafe !== 0 && safe(mirrored.forward, mirrored.strafe)) return mirrored
  const backward = { forward: -0.5, strafe: 0 }
  if (safe(backward.forward, backward.strafe)) return backward
  return { forward: 0, strafe: 0 }
}
