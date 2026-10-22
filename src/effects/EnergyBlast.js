import * as THREE from 'three';

/** A luminous bolt, with its long axis along +Y for network projectile aiming. */
export function createEnergyBlast() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xf1ffd0 }));
  core.scale.y = 2.7;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xb6ff32, transparent: true, opacity: 0.36,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.y = 3.8;
  group.add(core, halo);
  return group;
}
