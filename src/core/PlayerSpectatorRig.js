import * as THREE from 'three';
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// A level chase camera: footsteps and twitch aiming never drive its rotation directly.
export class PlayerSpectatorRig {
  constructor(camera) {
    this.camera = camera;
    this.focus = new THREE.Vector3();
    this.rawFocus = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.ray = new THREE.Ray();
    this.aim = new THREE.PerspectiveCamera();
    this.ready = false;
    this.yaw = 0;
    this.yawSpeed = 0;
    this.distance = 4.5;
  }

  update(target, delta, reset, raycast) {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.rawFocus.set(target.x, target.y + 1.3, target.z);
    const snap = reset || !this.ready || this.focus.distanceToSquared(this.rawFocus) > 400;
    if (snap) {
      this.focus.copy(this.rawFocus);
      this.yaw = target.yaw;
      this.yawSpeed = 0;
      this.distance = 4.5;
      this.ready = true;
    } else {
      // Faster horizontal tracking keeps runners framed; slower height tracking
      // absorbs stair risers without attaching the camera to animated body bob.
      const horizontal = 1 - Math.exp(-12 * dt);
      this.focus.x += (this.rawFocus.x-this.focus.x)*horizontal;
      this.focus.z += (this.rawFocus.z-this.focus.z)*horizontal;
      this.focus.y += (this.rawFocus.y-this.focus.y)*(1-Math.exp(-6*dt));
      const steps = Math.max(1, Math.ceil(dt*120)), h=dt/steps;
      for(let i=0;i<steps;i++) {
        const error = wrap(target.yaw-this.yaw);
        const acceleration = THREE.MathUtils.clamp(18*error-9*this.yawSpeed,-3,3);
        this.yawSpeed = THREE.MathUtils.clamp(this.yawSpeed+acceleration*h,-1.4,1.4);
        this.yaw = wrap(this.yaw+this.yawSpeed*h);
      }
    }
    this.direction.set(Math.sin(this.yaw)*4.5, 1.4, Math.cos(this.yaw)*4.5);
    const fullDistance = this.direction.length();
    this.direction.normalize();
    this.ray.set(this.focus,this.direction);
    const hitDistance = raycast(this.ray,fullDistance);
    const safeDistance = hitDistance < fullDistance ? Math.max(0.2,hitDistance-0.25) : fullDistance;
    // Pull inward immediately for walls; ease back outward rather than pumping
    // between full zoom and close-up at doorway edges.
    this.distance = snap || safeDistance < this.distance ? safeDistance
      : THREE.MathUtils.lerp(this.distance,safeDistance,1-Math.exp(-2.5*dt));
    this.desired.copy(this.focus).addScaledVector(this.direction,this.distance);
    if(snap) this.camera.position.copy(this.desired);
    else this.camera.position.lerp(this.desired,1-Math.exp(-10*dt));
    // Recheck the actual smoothed segment so easing cannot carry us through walls.
    this.direction.subVectors(this.camera.position,this.focus);
    const actualDistance=this.direction.length();
    if(actualDistance>0.001) {
      this.direction.normalize();this.ray.set(this.focus,this.direction);
      const obstruction=raycast(this.ray,actualDistance);
      const allowed=obstruction < actualDistance ? Math.max(0.2,obstruction-0.15) : actualDistance;
      if(allowed<actualDistance) this.camera.position.copy(this.focus).addScaledVector(this.direction,allowed);
    }
    this.aim.position.copy(this.camera.position);
    this.aim.lookAt(this.focus);
    if(snap) this.camera.quaternion.copy(this.aim.quaternion);
    else this.camera.quaternion.slerp(this.aim.quaternion,1-Math.exp(-9*dt));
  }
}
