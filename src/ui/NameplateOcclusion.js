import * as THREE from 'three';

const intersectionsByRaycaster = new WeakMap();

// DOM labels do not participate in the depth buffer, so explicitly test the
// camera-to-head segment against both rendered map meshes and box-only
// collision. Returns true only when geometry is closer than the player.
export function isNameplateOccluded(world, cameraPosition, target, raycaster) {
  if (!world || !cameraPosition || !target || !raycaster) return false;
  const direction = raycaster.ray.direction.subVectors(target, cameraPosition);
  const distance = direction.length();
  if (distance < 0.1) return false;
  direction.multiplyScalar(1 / distance);
  raycaster.set(cameraPosition, direction);
  raycaster.near = 0.08;
  raycaster.far = Math.max(0.08, distance - 0.22);

  // Imported arenas already have a spatial collision index. Avoid visiting
  // every render triangle for every visible opponent ten times per second.
  if (world._mapOctree && world.raycastCollisionDistance) {
    return world.raycastCollisionDistance(raycaster.ray, raycaster.far) < raycaster.far;
  }

  // A box blocker already settles visibility; do not also scan render meshes.
  const boxHit = world.raycastBoxHit?.(raycaster.ray, raycaster.far);
  if (boxHit && boxHit.distance < distance - 0.22) return true;
  const meshes = world.raycastMeshes || [];
  if (meshes.length) {
    let intersections = intersectionsByRaycaster.get(raycaster);
    if (!intersections) {
      intersections = [];
      intersectionsByRaycaster.set(raycaster, intersections);
    }
    intersections.length = 0;
    raycaster.intersectObjects(meshes, true, intersections);
    const blocked = intersections.length > 0 && intersections[0].distance < distance - 0.22;
    // Do not keep map objects alive after a map change through the scratch array.
    intersections.length = 0;
    return blocked;
  }
  return false;
}

