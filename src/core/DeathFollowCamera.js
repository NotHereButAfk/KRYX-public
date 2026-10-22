import * as THREE from 'three';
import { PlayerSpectatorRig } from './PlayerSpectatorRig.js';

const clearRay = (_ray, distance) => distance;
const validPosition = target => target
  && [target.x, target.y, target.z, target.yaw].every(Number.isFinite);
const validId = id => (typeof id === 'number' && Number.isFinite(id))
  || (typeof id === 'string' && id.trim().length > 0);

// Death following owns its own camera and rig. It cannot change the normal
// spectator's target, spectator mode, or the player's automatic respawn.
export class DeathFollowCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, .05, 300);
    this.rig = new PlayerSpectatorRig(this.camera);
    this.clear();
  }

  begin(killer) {
    this.clear();
    if (!killer || !validId(killer.id) || !validPosition(killer)) return false;
    this.killerId = killer.id;
    this.lastTarget = { id: killer.id, x: killer.x, y: killer.y, z: killer.z, yaw: killer.yaw };
    this.active = true;
    return true;
  }

  clear() {
    this.active = false;
    this.killerId = null;
    this.lastTarget = null;
    this.seenTarget = false;
    this.targetLost = false;
    this.cameraReady = false;
    this.rig.ready = false;
  }

  update(delta, remotes, raycast = clearRay) {
    if (!this.active) return false;
    if (!this.targetLost) {
      const target = remotes?.find(remote => remote.id === this.killerId);
      if (target?.alive === false || target?.ready === false) {
        this.targetLost = true;
      } else if (target && target.ready !== false && validPosition(target)) {
        Object.assign(this.lastTarget, { x: target.x, y: target.y, z: target.z, yaw: target.yaw });
        this.seenTarget = true;
      } else if (!target && this.seenTarget) {
        // Once lost, hold the final view instead of jumping to another person
        // or tracking this killer's next life on the other side of the map.
        this.targetLost = true;
      }
    }
    // A missing initial interpolation buffer is normal. The death snapshot's
    // last known killer position gives the camera a finite starting view.
    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    this.rig.update(this.lastTarget, dt, !this.cameraReady,
      typeof raycast === 'function' ? raycast : clearRay);
    this.cameraReady = true;
    return true;
  }
}
