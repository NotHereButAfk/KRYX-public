import * as THREE from 'three';
const vertex = new THREE.Vector3();
const inverse = new THREE.Matrix4();
const local = new THREE.Matrix4();
const frozenBodies = new WeakMap();
const supportGeometry = new WeakMap();
const supportDirections = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) supportDirections.push([x, y, z]);
}
// Keep the silhouette extremes of each bone's weighted region. Body support
// needs the outer surface, not every interior/duplicated triangle vertex.
// Prepared while the model loads; every clone shares the same index set.
function supportIndices(geometry) {
  if (supportGeometry.has(geometry)) return supportGeometry.get(geometry);
  const positions = geometry.attributes.position, indices = geometry.attributes.skinIndex;
  const weights = geometry.attributes.skinWeight, regions = new Map();
  for (let i = 0; i < positions.count; i++) {
    let joint = 0;
    if (indices && weights) {
      let best = -1;
      for (let c = 0; c < 4; c++) if (weights.array[i * 4 + c] > best) {
        best = weights.array[i * 4 + c]; joint = indices.array[i * 4 + c];
      }
    }
    let region = regions.get(joint);
    if (!region) regions.set(joint, region = supportDirections.map(() => ({ dot: -Infinity, index: i })));
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    for (let d = 0; d < supportDirections.length; d++) {
      const direction = supportDirections[d], dot = x * direction[0] + y * direction[1] + z * direction[2];
      if (dot > region[d].dot) { region[d].dot = dot; region[d].index = i; }
    }
  }
  const selected = new Uint32Array([...new Set([...regions.values()].flatMap(r => r.map(v => v.index)))]);
  supportGeometry.set(geometry, selected);
  return selected;
}
export function prepareDeathBody(group) {
  group.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position) supportIndices(mesh.geometry); });
}
// Frozen bot poses only need skinning once per death. Keep exact support
// vertices in body-local space so tumbling still rests on the real mesh.
export function groundDeathBody(group, floorY, air = 0, frozenPose = null, useSupportHull = false) {
  group.updateMatrixWorld(true);
  let bottom = Infinity;
  let cached = frozenPose && frozenBodies.get(group);
  if (frozenPose && (cached?.key !== frozenPose || cached?.useSupportHull !== useSupportHull)) {
    const points = [];
    inverse.copy(group.matrixWorld).invert();
    group.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      if (mesh.isSkinnedMesh) mesh.skeleton.update();
      local.multiplyMatrices(inverse, mesh.matrixWorld);
      const selected = useSupportHull ? supportIndices(mesh.geometry) : null;
      const count = selected ? selected.length : mesh.geometry.attributes.position.count;
      for (let i = 0; i < count; i++) {
        mesh.getVertexPosition(selected ? selected[i] : i, vertex).applyMatrix4(local);
        points.push(vertex.x, vertex.y, vertex.z);
      }
    });
    cached = {key: frozenPose, useSupportHull, points: new Float32Array(points)};
    frozenBodies.set(group, cached);
  }
  if (frozenPose) {
    const p = cached.points, m = group.matrixWorld.elements;
    for (let i = 0; i < p.length; i += 3) {
      bottom = Math.min(bottom, m[1]*p[i] + m[5]*p[i+1] + m[9]*p[i+2] + m[13]);
    }
  } else {
    frozenBodies.delete(group);
    group.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      if (mesh.isSkinnedMesh) mesh.skeleton.update();
      const positions = mesh.geometry.attributes.position;
      const selected = useSupportHull ? supportIndices(mesh.geometry) : null;
      const count = selected ? selected.length : positions.count;
      for (let i = 0; i < count; i++) {
        mesh.getVertexPosition(selected ? selected[i] : i, vertex).applyMatrix4(mesh.matrixWorld);
        bottom = Math.min(bottom, vertex.y);
      }
    });
  }
  // A half-centimetre skin margin covers the tiny interpolation between
  // selected silhouette vertices; settled poses cache that same support.
  if (Number.isFinite(bottom)) group.position.y += floorY + air - bottom
    + (useSupportHull ? .005 : 0);
}
