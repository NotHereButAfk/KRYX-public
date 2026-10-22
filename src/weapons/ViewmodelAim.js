import * as THREE from 'three';

// The viewmodel is an enlarged presentation layer, not a world-sized gun.
// A fixed camera-local convergence point keeps its projected bore aimed at the
// reticle without changing the hold when a look ray crosses a wall or ceiling.
export const PRESENTATION_AIM_DEPTH = 8;
// Lower scoped presentation by 15.6% of the viewport height.
export const ADS_SIGHT_SCREEN_Y = -0.312;

// Weapons use -Z for their normalized bore. Rotate the complete gun/hand rig
// around its muzzle so correcting aim preserves the muzzle and hand contacts.
export class ViewmodelAim {
  constructor() {
    this.muzzle = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.cameraRotation = new THREE.Quaternion();
    this.correction = new THREE.Quaternion();
    this.blended = new THREE.Quaternion();
    this.bounds = new WeakMap();
    this.surfaces = new WeakMap();
    this.partBox = new THREE.Box3();
    this.inverse = new THREE.Matrix4();
    this.matrix = new THREE.Matrix4();
    this.corner = new THREE.Vector3();
    this.sight = new THREE.Vector3();
    this.triangle = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  align(camera, mount, model, weight = 1, adsWeight = 0) {
    if (!model?.muzzle || weight <= 0) return;
    this._rotate(camera, mount, model, weight);
    // Uncanting a weapon may expose a surface at the eye plane. Move only
    // for visible clipping, then re-solve convergence at the new position.
    for (let pass = 0; pass < 3; pass++) {
      const nearest = this._nearestDepth(camera, model.group);
      const overlap = nearest + camera.near + .04;
      if (overlap <= 0 || !this.hasVisibleNearClip(camera, model.group)) break;
      mount.position.z -= overlap + .005;
      if (weight >= .999) this._rotate(camera, mount, model, 1);
      else model.group.updateWorldMatrix(true, false);
    }
    // Convergence rotates around the muzzle, which can shift an already
    // centered rear sight sideways. Solve the final ADS pose, not just its
    // pre-rotation mount position. Move the hands with the gun and re-aim
    // after each correction so the bore still meets the crosshair.
    if (model.sight && adsWeight > 0 && weight >= .999) {
      for (let pass = 0; pass < 8; pass++) {
        this.sight.copy(model.sight).applyMatrix4(model.group.matrixWorld);
        camera.worldToLocal(this.sight);
        // Keep the compact SMG in a right-shoulder hold instead of edge-on under the eye.
        const sightX = model.group.userData.weaponId === 'uzi' ? .20 * -this.sight.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect : 0;
        mount.position.x += (sightX - this.sight.x) * THREE.MathUtils.clamp(adsWeight, 0, 1);
        const sightY = ADS_SIGHT_SCREEN_Y * -this.sight.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        mount.position.y += (sightY - this.sight.y) * THREE.MathUtils.clamp(adsWeight, 0, 1);
        this._rotate(camera, mount, model, 1);
      }
    }
  }

  // Interpolated carries must stay clear of the eye without another aim solve
  // rotating them around the muzzle and changing their return path.
  ensureClearance(camera, mount, model) {
    if (!model?.group) return;
    model.group.updateWorldMatrix(true, false);
    const overlap = this._nearestDepth(camera, model.group) + camera.near + .04;
    if (overlap > 0 && this.hasVisibleNearClip(camera, model.group)) {
      mount.position.z -= overlap + .005;
      model.group.updateWorldMatrix(true, false);
    }
  }

  // A stock may continue below the screen and behind the eye, as it does in
  // a close first-person hold. Pushing the ENTIRE bounds box in front of the
  // camera made those guns shrink. Only move it when a real surface crosses
  // the visible near plane; offscreen stock and grip geometry can be cropped.
  hasVisibleNearClip(camera, group) {
    const plane = -camera.near - .04;
    if (this._nearestDepth(camera, group) < plane) return false;
    let surfaces = this.surfaces.get(group);
    if (!surfaces) {
      group.updateWorldMatrix(true, true);
      const points = [];
      this.inverse.copy(group.matrixWorld).invert();
      group.traverse(mesh => {
        if (!mesh.isMesh || mesh.name === 'outline' || mesh.renderOrder === 1001) return;
        this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
        const position = mesh.geometry.attributes.position;
        const index = mesh.geometry.index;
        const count = index ? index.count : position.count;
        for (let i = 0; i < count; i++) {
          this.corner.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(this.matrix);
          points.push(this.corner.x, this.corner.y, this.corner.z);
        }
      });
      surfaces = new Float32Array(points);
      this.surfaces.set(group, surfaces);
    }
    this.matrix.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
    const halfY = -plane * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
    const halfX = halfY * camera.aspect;
    const tri = this.triangle;
    for (let i = 0; i < surfaces.length; i += 9) {
      for (let j = 0; j < 3; j++) tri[j].fromArray(surfaces, i + j * 3).applyMatrix4(this.matrix);
      if ((tri[0].z < plane && tri[1].z < plane && tri[2].z < plane)
        || (tri[0].z >= plane && tri[1].z >= plane && tri[2].z >= plane)) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let j = 0; j < 3; j++) {
        const a = tri[j], b = tri[(j + 1) % 3];
        if ((a.z < plane) === (b.z < plane)) continue;
        const t = (plane - a.z) / (b.z - a.z);
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      if (minX <= halfX && maxX >= -halfX && minY <= halfY && maxY >= -halfY) return true;
    }
    return false;
  }

  _rotate(camera, mount, model, weight) {
    // Solve only the active weapon chain; hidden inventory guns need no
    // repeated descendant updates during the iterative ADS correction.
    model.group.updateWorldMatrix(true, false);
    model.muzzle.getWorldPosition(this.muzzle);
    camera.worldToLocal(this.muzzle);
    camera.getWorldQuaternion(this.cameraRotation).invert();
    this.forward.set(0, 0, -1).transformDirection(model.group.matrixWorld)
      .applyQuaternion(this.cameraRotation).normalize();
    const depth = Math.max(-this.muzzle.z + 1, PRESENTATION_AIM_DEPTH);
    this.target.set(0, 0, -depth).sub(this.muzzle).normalize();
    this.correction.setFromUnitVectors(this.forward, this.target);
    this.blended.identity().slerp(this.correction, THREE.MathUtils.clamp(weight, 0, 1));
    this.offset.subVectors(this.muzzle, mount.position).applyQuaternion(this.blended);
    mount.position.copy(this.muzzle).sub(this.offset);
    mount.quaternion.premultiply(this.blended);
    model.group.updateWorldMatrix(true, false);
  }

  _nearestDepth(camera, group) {
    let bounds = this.bounds.get(group);
    if (!bounds) {
      group.updateWorldMatrix(true, true);
      bounds = new THREE.Box3();
      this.inverse.copy(group.matrixWorld).invert();
      group.traverse(mesh => {
        if (!mesh.isMesh || mesh.renderOrder === 1001 || mesh.name === 'outline') return;
        mesh.geometry.computeBoundingBox();
        this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
        bounds.union(this.partBox.copy(mesh.geometry.boundingBox).applyMatrix4(this.matrix));
      });
      this.bounds.set(group, bounds);
    }
    this.matrix.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
    let nearest = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.corner.set(i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
        .applyMatrix4(this.matrix);
      nearest = Math.max(nearest, this.corner.z);
    }
    return nearest;
  }
}

