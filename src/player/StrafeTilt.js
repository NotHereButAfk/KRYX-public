// Cosmetic camera roll; never changes aim yaw/pitch or movement direction.
export function strafeTilt(previous, lateralSpeed, dt, enabled=true) {
  const target=enabled?-Math.max(-1,Math.min(1,lateralSpeed/7))*.028:0;
  return previous+(target-previous)*(1-Math.exp(-12*Math.max(0,dt)));
}
