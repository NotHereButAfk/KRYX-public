// Shared, continuous overhand slash. Blade forward is -Z; the cutting edge is -X.
export const SWORD_EDGE_ROLL = Math.PI / 2;
export function swordSwingPose(phase = 1) {
  const keys = [
    [0, 0, 0, 0, 0],
    [.20, .20, .02, .07, .035],
    [.52, -2.08, -.10, -.16, -.12],
    [.66, -2.08, -.10, -.16, -.12],
    [1, 0, 0, 0, 0],
  ];
  const p = Math.max(0, Math.min(1, phase));
  const i = Math.max(1, keys.findIndex(k => k[0] >= p));
  const a = keys[i - 1], b = keys[i];
  let t = (p - a[0]) / (b[0] - a[0]); t = t * t * (3 - 2 * t);
  const v = a.slice(1).map((x,j) => x + (b[j+1]-x)*t);
  return {pitch: v[0], x: v[1], y: v[2], z: v[3]};
}
