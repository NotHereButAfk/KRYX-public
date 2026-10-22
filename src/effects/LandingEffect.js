import * as THREE from 'three';

// A bounded, world-anchored landing cue. It never participates in raycasts.
export class LandingEffect {
  constructor(scene) { this.scene = scene; this.age = 1; this.airborne = false; this.fallSpeed = 0; }
  update(dt, state) {
    const grounded = state.grounded == null ? true : !!state.grounded;
    if (state.alive === false) { this.airborne = false; this.fallSpeed = 0; }
    else if (!grounded) { this.airborne = true; this.fallSpeed = Math.max(this.fallSpeed, -(state.vy || 0)); }
    else if (this.airborne) {
      if (this.fallSpeed > 2) this.spawn(state.position, this.fallSpeed);
      this.airborne = false; this.fallSpeed = 0;
    }
    this.age += Math.max(0, dt);
    if (!this.mesh) return;
    const progress = Math.min(1, this.age / 0.32);
    this.mesh.visible = progress < 1;
    this.mesh.scale.setScalar(0.45 + progress * this.strength);
    this.mesh.material.opacity = (1 - progress) ** 2 * 0.24;
  }
  spawn(position, speed) {
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.65, 1, 20),
        new THREE.MeshBasicMaterial({color: 0xc3c1bb, transparent: true, depthWrite: false, side: THREE.DoubleSide}));
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.raycast = () => {};
      this.mesh.userData.noHit = true;
      this.scene.add(this.mesh);
    }
    this.mesh.position.copy(position); this.mesh.position.y += 0.025;
    this.strength = THREE.MathUtils.clamp(speed / 12, 0.4, 1);
    this.age = 0;
  }
  dispose() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
    this.mesh = null; this.age = 1; this.airborne = false; this.fallSpeed = 0;
  }
}
