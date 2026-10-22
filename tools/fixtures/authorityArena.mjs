// Synthetic geometry used only by the headless authority load/soak harnesses.
// It is not a playable map and is intentionally kept outside src/public so it
// cannot enter the shipped imported-map rotation.
export const AUTHORITY_TEST_ARENA = {
  name: 'Authority harness fixture',
  half: 40,
  killY: -25,
  platforms: [
    { minX: -3, maxX: 3, minZ: 6, maxZ: 20, y0: 3.5, y1: 0, axis: 'z' },
    { minX: -3, maxX: 3, minZ: -20, maxZ: -6, y0: 0, y1: 3.5, axis: 'z' },
    { minX: -8, maxX: 8, minZ: -6, maxZ: 6, y0: 3.5, y1: 3.5, axis: 'z' },
    { minX: -14, maxX: -8, minZ: -10, maxZ: -4, y0: 0.3, y1: 0.3, axis: 'z' },
    { minX: -20, maxX: -14, minZ: -10, maxZ: -4, y0: 0.6, y1: 0.6, axis: 'z' },
  ],
  boxes: [
    { min: [-26, 0, -2], max: [-14, 3, 2] },
    { min: [14, 0, -2], max: [26, 3, 2] },
    { min: [8, 1.25, 8], max: [20, 4, 12] },
    { min: [-12, 0, 12], max: [-8, 2.2, 16] },
    { min: [8, 0, -16], max: [12, 2.2, -12] },
  ],
  gravLifts: [],
  teleporters: [],
  spawns: [[-30, 0, -30], [30, 0, 30], [-30, 0, 30], [30, 0, -30]],
  callouts: [
    { name: 'Center', x: 0, z: 0 },
    { name: 'North Ramp', x: 0, z: 13 },
    { name: 'South Ramp', x: 0, z: -13 },
    { name: 'East Route', x: 14, z: 10 },
    { name: 'West Route', x: -14, z: -7 },
    { name: 'West Wall', x: -20, z: 0 },
    { name: 'East Wall', x: 20, z: 0 },
  ],
  pickups: [],
};
