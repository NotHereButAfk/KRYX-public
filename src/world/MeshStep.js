import { Ray, Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
const normal = new Vector3(), lift = new Vector3(), raised = new Capsule();
// A low lip touches the capsule before its centre ground ray reaches the top.
// Only grounded movers may use this leading-foot probe.
export function tryMeshStep(octree, capsule, hit, dx, dz) {
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-7 || hit.normal.x * dx + hit.normal.z * dz >= -1e-6) return false;
  const footY = capsule.start.y - capsule.radius;
  const reach = capsule.radius + .025;
  ray.origin.set(capsule.start.x + dx / distance * reach, footY + .61, capsule.start.z + dz / distance * reach);
  ray.direction.set(0, -1, 0);
  const top = octree.rayIntersect(ray);
  if (!top) return false;
  const rise = top.position.y - footY;
  if (rise < .025 || rise > .55 || top.triangle.getNormal(normal).y < .65) return false;
  ray.origin.set(capsule.end.x, capsule.end.y + capsule.radius, capsule.end.z);
  ray.direction.set(0, 1, 0);
  const ceiling = octree.rayIntersect(ray);
  if (ceiling && ceiling.distance <= rise + .005) return false;
  raised.copy(capsule);
  raised.translate(lift.set(0, rise + .003, 0));
  const obstruction = octree.capsuleIntersect(raised);
  if (obstruction && obstruction.depth > .002) return false;
  capsule.copy(raised);
  return true;
}
