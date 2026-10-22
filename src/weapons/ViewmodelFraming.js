import * as THREE from 'three';
import { PRESENTATION_AIM_DEPTH } from './ViewmodelAim.js';

// Camera composition, independent of world weapon scale. Depth is measured
// against each model's actual muzzle-to-stock length, not its category name.
const FITS = Object.freeze({
  m4:            { depth: .90, x: .12, y: -.28, runDepth: .55 },
  magnum:        { depth: 1.05, x: .16, y: -.36, runDepth: 1.25 },
  uzi:           { depth: 1.10, x: .30, y: -.38, runDepth: .85 },
  levershotgun:  { depth: .90, x: .14, y: -.28, runDepth: .55 },
  battlerifle:   { depth: .92, x: .14, y: -.30, runDepth: .60 },
  plasmarifle:   { depth: .98, x: .14, y: -.32, runDepth: .62 },
  energyshotgun: { depth: 1.08, x: .17, y: -.38, runDepth: .70 },
  concussion:    { depth: 1.16, x: .14, y: -.28, runDepth: .63 },
  rpg:           { depth: .98, x: .16, y: -.32, runDepth: .63 },
});

export function firearmPresentationScale(def) {
  // Compact weapons retain their smaller silhouette in hip fire and ADS.
  const size = def.id === 'uzi' ? .75 : 1;
  return (def.id === 'rpg' ? 1 / 2.3 : 1) * 2.4 * size;
}

export class ViewmodelFraming {
  constructor() {
    this.models = new WeakMap();
    this.box = new THREE.Box3();
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.muzzle = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.offset = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.euler = new THREE.Euler();
  }

  resolve(id, model, camera, scale, running, target) {
    const fit = FITS[id] || FITS.m4;
    if (!model?.muzzle) return false;
    let geometry = this.models.get(model.group);
    if (!geometry) {
      model.group.updateWorldMatrix(true, true);
      // Work in the shared gun/hand parent frame, excluding animated recoil.
      this.inverse.copy(model.group.parent.matrixWorld).invert();
      const bounds = new THREE.Box3();
      model.group.traverse(mesh => {
        if (!mesh.isMesh || mesh.name === 'outline') return;
        mesh.geometry.computeBoundingBox();
        this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
        bounds.union(this.box.copy(mesh.geometry.boundingBox).applyMatrix4(this.matrix));
      });
      const muzzle = model.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
      geometry = { muzzle, length: Math.max(.20, bounds.max.z - muzzle.z) };
      this.models.set(model.group, geometry);
    }
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const narrow = THREE.MathUtils.clamp((16 / 9) / camera.aspect * .60, 1, 1.35);
    const depth = geometry.length * scale * (running ? fit.runDepth : fit.depth)
      * narrow * Math.max(1, Math.tan(THREE.MathUtils.degToRad(39)) / tan);
    const pistol = id === 'magnum';
    const x = running ? (pistol ? .18 : -.78) : fit.x;
    const y = running ? (pistol ? -.10 : -.38) : fit.y;
    this.muzzle.set(x * depth * tan * camera.aspect, y * depth * tan, -depth);
    if (running) {
      this.euler.set(pistol ? .95 : .20, pistol ? .12 : 1.08, -.12);
      this.rotation.setFromEuler(this.euler);
    } else {
      this.direction.set(0, 0, -Math.max(depth + 1, PRESENTATION_AIM_DEPTH)).sub(this.muzzle).normalize();
      this.rotation.setFromUnitVectors(this.forward, this.direction);
    }
    this.offset.copy(geometry.muzzle).multiplyScalar(scale).applyQuaternion(this.rotation);
    target.position.copy(this.muzzle).sub(this.offset);
    this.euler.setFromQuaternion(this.rotation);
    target.rotation.set(this.euler.x, this.euler.y, this.euler.z);
    return true;
  }
}


