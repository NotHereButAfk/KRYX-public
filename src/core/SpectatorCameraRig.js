import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_TURN = THREE.MathUtils.degToRad(12);
const MAX_ACCELERATION = THREE.MathUtils.degToRad(16);
const MAX_PITCH = THREE.MathUtils.degToRad(35);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

/** A level, motorised dolly head. It never reads player input or bot motion. */
export class SpectatorCameraRig {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.previousTarget = new THREE.Vector3();
    this.sample = new THREE.Vector3();
    this.candidate = new THREE.Vector3();
    this.clearSegment = null;
    this.raycast = null;
    this.wallRay = new THREE.Ray();
    this.wallDirection = new THREE.Vector3();
    this.wallProbeTime = 0;
    this.targetFov = 60;
    this.yaw = this.pitch = this.yawSpeed = this.pitchSpeed = 0;
    this.ready = false;
  }

  _target(position, focus) {
    this.direction.subVectors(focus, position);
    const horizontal = Math.hypot(this.direction.x, this.direction.z);
    return horizontal > 0.01;
  }

  reset(position, focus) {
    this.position.copy(position);
    this.previousTarget.copy(position);
    this.velocity.set(0, 0, 0);
    if (this._target(position, focus)) {
      this.yaw = Math.atan2(-this.direction.x, -this.direction.z);
      this.pitch = THREE.MathUtils.clamp(Math.atan2(this.direction.y, Math.hypot(this.direction.x, this.direction.z)), -MAX_PITCH, MAX_PITCH);
    }
    this.yawSpeed = this.pitchSpeed = 0;
    this.wallProbeTime = 0;
    this.targetFov = this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.ready = true;
    this._apply();
  }

  update(position, focus, frameDelta) {
    if (!this.ready) return this.reset(position, focus);
    const dt = THREE.MathUtils.clamp(frameDelta, 0, 1 / 30);
    // A critically damped translation spring gives the flight momentum without
    // overshoot. Sample the moving target in small steps for consistent 30–144Hz motion.
    const steps = Math.max(1, Math.ceil(dt * 120));
    const h = dt / steps, frequency = 5, decay = Math.exp(-frequency * h);
    this.candidate.copy(this.position);
    for (let i = 1; i <= steps; i++) {
      this.sample.copy(this.previousTarget).lerp(position, i / steps);
      for (const axis of ['x', 'y', 'z']) {
        const offset = this.candidate[axis] - this.sample[axis];
        const impulse = this.velocity[axis] + frequency * offset;
        this.candidate[axis] = this.sample[axis] + (offset + impulse * h) * decay;
        this.velocity[axis] = (this.velocity[axis] - frequency * impulse * h) * decay;
      }
    }
    // Lagging behind a bend must never put the camera through its inside wall.
    if (this.clearSegment && !this.clearSegment(this.candidate, position)) {
      this.candidate.copy(position);
      this.velocity.set(0, 0, 0);
    }
    this.position.copy(this.candidate);
    this.previousTarget.copy(position);
    if (this._target(this.position, focus)) {
      const yaw = Math.atan2(-this.direction.x, -this.direction.z);
      const pitch = THREE.MathUtils.clamp(Math.atan2(this.direction.y, Math.hypot(this.direction.x, this.direction.z)), -MAX_PITCH, MAX_PITCH);
      // Critically damped angular motion with explicit rate/acceleration limits.
      // Smoothing a look-at point alone can still whip the view when it passes
      // close to the camera, even if the point moves only a few centimetres.
      this.yawSpeed = this._speed(this.yawSpeed, wrap(yaw - this.yaw), dt);
      this.pitchSpeed = this._speed(this.pitchSpeed, pitch - this.pitch, dt);
      this.yaw = wrap(this.yaw + this.yawSpeed * dt);
      this.pitch += this.pitchSpeed * dt;
    }
    this._apply();
    // Fixed lens: passing architecture supplies the perspective change.
  }

  _speed(current, error, dt) {
    const acceleration = THREE.MathUtils.clamp(4 * error - 4 * current, -MAX_ACCELERATION, MAX_ACCELERATION);
    return THREE.MathUtils.clamp(current + acceleration * dt, -MAX_TURN, MAX_TURN);
  }

  _apply() {
    this.camera.position.copy(this.position);
    this.camera.up.copy(UP);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
