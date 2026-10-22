import * as THREE from 'three';

// Three's stock Octree ray query follows an infinite ray and de-duplicates its
// triangle list with Array#indexOf. On a large imported arena, a short LOS or
// bullet probe that misses nearby cover can therefore walk most of the map.
// Restrict traversal to octants reached inside the requested segment and use a
// Set for duplicate triangles.
const _boxPoint = new THREE.Vector3();
const _trianglePoint = new THREE.Vector3();

export function boundedOctreeRayIntersect(octree, ray, maxDistance = Infinity, minDistance = 0.015) {
  if (!octree || !ray) return false;
  if (!Number.isFinite(maxDistance)) return octree.rayIntersect(ray);

  const limit = Math.max(0, maxDistance);
  const seen = new Set();
  let nearestDistance = limit;
  let nearestTriangle = null;
  let nearestPosition = null;

  const testTriangles = (triangles) => {
    for (const triangle of triangles) {
      if (seen.has(triangle)) continue;
      seen.add(triangle);
      const point = ray.intersectTriangle(
        triangle.a, triangle.b, triangle.c, true, _trianglePoint,
      );
      if (!point) continue;
      const distance = point.distanceTo(ray.origin);
      // LOS queries skip self-contact; swept projectiles must include it or a
      // slow rebound can cross the entire remaining gap without seeing a floor.
      if (distance < minDistance || distance > nearestDistance) continue;
      nearestDistance = distance;
      nearestTriangle = triangle;
      nearestPosition = point.clone();
    }
  };

  const visit = (node) => {
    for (const child of node.subTrees || []) {
      const inside = child.box?.containsPoint(ray.origin);
      const boxHit = child.box && ray.intersectBox(child.box, _boxPoint);
      if (!inside && (!boxHit || boxHit.distanceTo(ray.origin) > nearestDistance)) continue;
      if (child.triangles?.length) testTriangles(child.triangles);
      else visit(child);
    }
  };

  if (octree.triangles?.length) testTriangles(octree.triangles);
  visit(octree);

  return nearestTriangle ? {
    distance: nearestDistance,
    triangle: nearestTriangle,
    position: nearestPosition,
  } : false;
}
