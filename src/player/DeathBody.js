import * as THREE from 'three';
const vertex = new THREE.Vector3();
const inverse = new THREE.Matrix4();
const local = new THREE.Matrix4();
const frozenBodies = new WeakMap();
// Frozen bot poses only need skinning once per death. Keep exact support
// vertices in body-local space so tumbling still rests on the real mesh.
export function groundDeathBody(group, floorY, air = 0, frozenPose = null) {
  group.updateMatrixWorld(true);
  let bottom = Infinity;
  let cached = frozenPose && frozenBodies.get(group);
  if (frozenPose && cached?.key !== frozenPose) {
    const points = [];
    inverse.copy(group.matrixWorld).invert();
    group.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      if (mesh.isSkinnedMesh) mesh.skeleton.update();
      local.multiplyMatrices(inverse, mesh.matrixWorld);
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, vertex).applyMatrix4(local);
        points.push(vertex.x, vertex.y, vertex.z);
      }
    });
    cached = {key: frozenPose, points: new Float32Array(points)};
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
      for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
        bottom = Math.min(bottom, vertex.y);
      }
    });
  }
  if (Number.isFinite(bottom)) group.position.y += floorY + air - bottom;
}
