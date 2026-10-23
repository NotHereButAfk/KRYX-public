import * as THREE from 'three';

const MAX_MARKS = 24;
const MAX_PARTICLES = 72;
const CAPACITY = MAX_MARKS + MAX_PARTICLES;
const MAX_DISTANCE_SQ = 42 * 42;
const PROBE_LENGTH = 0.08;
const ENDPOINT_TOLERANCE_SQ = 0.02 * 0.02;
const FORWARD = new THREE.Vector3(0, 0, 1);
const NO_RAYCAST = () => {};

// One instanced draw call, with all storage and scratch objects reused. The
// same small soft disc is a surface mark, dust mote or narrow warm spark.
export class BulletImpactEffects {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this._mapRoot = null;
    this._world = null;
    this._generation = 0;
    this._markCursor = 0;
    this._particleCursor = 0;
    this._active = 0;
    this._ray = new THREE.Ray();
    this._observer = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._tangent = new THREE.Vector3();
    this._bitangent = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
    this._cameraRotation = new THREE.Quaternion();
    this._matrix = new THREE.Matrix4();
    this._candidate = {};
    this._ages = new Float32Array(CAPACITY);
    this._lives = new Float32Array(CAPACITY);
    this._positions = new Float32Array(CAPACITY * 3);
    this._velocities = new Float32Array(CAPACITY * 3);
    this._sizes = new Float32Array(CAPACITY);
    this._spark = new Uint8Array(CAPACITY);
    this._alphas = new Float32Array(CAPACITY);
  }

  syncWorld(world) {
    if (!world) return;
    if (world !== this._world || world._mapRoot !== this._mapRoot) {
      this.clear();
      this._world = world;
      this._mapRoot = world._mapRoot;
    }
  }

  // Replicated shots carry an endpoint, not a surface normal or hit type.
  // Probe only the final eight centimetres, never through the full level or
  // past the endpoint into a wall behind a player. An air/player endpoint
  // produces no effect unless it coincides with actual world geometry.
  queueEndpoint(target, world, from, to, camera) {
    if (!target || !world?.raycastCollisionHit || !camera) return false;
    this.syncWorld(world);
    camera.getWorldPosition(this._observer);
    if (!Number.isFinite(to.x + to.y + to.z)
      || this._observer.distanceToSquared(to) > MAX_DISTANCE_SQ) return false;
    this._ray.direction.subVectors(to, from);
    const distance = this._ray.direction.length();
    if (!Number.isFinite(distance) || distance < 0.005) return false;
    this._ray.direction.multiplyScalar(1 / distance);
    const probeLength = Math.min(PROBE_LENGTH, distance);
    this._ray.origin.copy(to).addScaledVector(this._ray.direction, -probeLength);
    const hit = world.raycastCollisionHit(this._ray, probeLength + 0.0005);
    if (!hit?.point || !hit.normal || !Number.isFinite(hit.distance)
      || hit.distance < 0 || hit.distance > probeLength + 0.0005
      || !Number.isFinite(hit.point.x + hit.point.y + hit.point.z)
      || hit.point.distanceToSquared(to) > ENDPOINT_TOLERANCE_SQ) return false;
    this._normal.copy(hit.normal);
    const normalLength = this._normal.lengthSq();
    if (!Number.isFinite(normalLength) || normalLength < 0.5) return false;
    this._normal.normalize();
    if (this._normal.dot(this._ray.direction) > 0) this._normal.negate();
    target.impactX = hit.point.x;
    target.impactY = hit.point.y;
    target.impactZ = hit.point.z;
    target.impactNX = this._normal.x;
    target.impactNY = this._normal.y;
    target.impactNZ = this._normal.z;
    target.impactGeneration = this._generation;
    target.impactPending = true;
    return true;
  }

  showEndpoint(world, from, to, camera) {
    if (!this.queueEndpoint(this._candidate, world, from, to, camera)) return false;
    return this.showQueued(this._candidate, camera);
  }

  _ensurePool() {
    if (this.mesh) return;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('impactAlpha', new THREE.InstancedBufferAttribute(this._alphas, 1)
      .setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        attribute float impactAlpha;
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vAlpha = impactAlpha;
          vColor = instanceColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float radial = length(vUv - 0.5);
          float alpha = vAlpha * (1.0 - smoothstep(0.12, 0.5, radial));
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(vColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.name = 'World bullet impacts';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3)
      .setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.raycast = NO_RAYCAST;
    mesh.userData.noHit = true;
    this._matrix.makeScale(0, 0, 0);
    for (let i = 0; i < CAPACITY; i++) mesh.setMatrixAt(i, this._matrix);
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  showQueued(target, camera) {
    if (!target?.impactPending) return false;
    target.impactPending = false;
    if (target.impactGeneration !== this._generation || !camera) return false;
    this._point.set(target.impactX, target.impactY, target.impactZ);
    camera.getWorldPosition(this._observer);
    if (this._observer.distanceToSquared(this._point) > MAX_DISTANCE_SQ) return false;
    this._ensurePool();
    camera.getWorldQuaternion(this._cameraRotation);
    this._normal.set(target.impactNX, target.impactNY, target.impactNZ);
    this._point.addScaledVector(this._normal, 0.007);
    this._rotation.setFromUnitVectors(FORWARD, this._normal);
    const mark = this._markCursor;
    this._markCursor = (mark + 1) % MAX_MARKS;
    this._activate(mark, 6 + Math.random(), 0.055 + Math.random() * 0.025, 0.52);
    this._scale.setScalar(this._sizes[mark]);
    this._matrix.compose(this._point, this._rotation, this._scale);
    this.mesh.setMatrixAt(mark, this._matrix);
    this.mesh.instanceColor.setXYZ(mark, 0.035, 0.031, 0.026);

    this._tangent.set(Math.abs(this._normal.y) < 0.9 ? 0 : 1,
      Math.abs(this._normal.y) < 0.9 ? 1 : 0, 0).cross(this._normal).normalize();
    this._bitangent.crossVectors(this._normal, this._tangent);
    for (let p = 0; p < 6; p++) {
      const slot = MAX_MARKS + this._particleCursor;
      this._particleCursor = (this._particleCursor + 1) % MAX_PARTICLES;
      const spark = p >= 4;
      this._spark[slot] = spark ? 1 : 0;
      this._activate(slot, spark ? 0.10 + Math.random() * 0.10 : 0.24 + Math.random() * 0.18,
        spark ? 0.018 : 0.045 + Math.random() * 0.04, spark ? 0.8 : 0.24);
      const offset = slot * 3;
      const outward = spark ? 1.2 + Math.random() : 0.25 + Math.random() * 0.35;
      const tangent = (Math.random() - 0.5) * (spark ? 2.5 : 0.8);
      const bitangent = (Math.random() - 0.5) * (spark ? 2.5 : 0.8);
      this._velocities[offset] = this._normal.x * outward + this._tangent.x * tangent + this._bitangent.x * bitangent;
      this._velocities[offset + 1] = this._normal.y * outward + this._tangent.y * tangent + this._bitangent.y * bitangent;
      this._velocities[offset + 2] = this._normal.z * outward + this._tangent.z * tangent + this._bitangent.z * bitangent;
      this.mesh.instanceColor.setXYZ(slot, spark ? 1 : 0.38, spark ? 0.55 : 0.35, spark ? 0.18 : 0.29);
      this._setParticleMatrix(slot);
    }
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.geometry.attributes.impactAlpha.needsUpdate = true;
    return true;
  }

  _activate(slot, life, size, alpha) {
    if (this._lives[slot] === 0) this._active++;
    this._ages[slot] = 0;
    this._lives[slot] = life;
    this._sizes[slot] = size;
    this._alphas[slot] = alpha;
    const offset = slot * 3;
    this._positions[offset] = this._point.x;
    this._positions[offset + 1] = this._point.y;
    this._positions[offset + 2] = this._point.z;
  }

  _setParticleMatrix(slot) {
    const offset = slot * 3;
    this._point.fromArray(this._positions, offset);
    const size = this._sizes[slot] * (this._spark[slot] ? 1 : 1 + this._ages[slot] * 2.2);
    this._scale.set(size, size * (this._spark[slot] ? 2.8 : 1), size);
    this._matrix.compose(this._point, this._cameraRotation, this._scale);
    this.mesh.setMatrixAt(slot, this._matrix);
  }

  update(dt, camera) {
    if (!this.mesh || this._active === 0 || !camera || !(dt > 0)) return;
    camera.getWorldQuaternion(this._cameraRotation);
    const drag = Math.exp(-5 * dt);
    const travel = (1 - drag) / 5;
    let matricesChanged = false;
    for (let slot = 0; slot < CAPACITY; slot++) {
      const life = this._lives[slot];
      if (!life) continue;
      const age = this._ages[slot] += dt;
      if (age >= life) {
        this._lives[slot] = 0;
        this._alphas[slot] = 0;
        this._active--;
        continue;
      }
      if (slot < MAX_MARKS) {
        this._alphas[slot] = 0.52 * Math.min(1, (life - age) / 1.2);
        continue;
      }
      const spark = this._spark[slot];
      this._alphas[slot] = (spark ? 0.8 : 0.24) * (1 - age / life) ** 2;
      const offset = slot * 3;
      const gravity = spark ? 7 : 1.2;
      this._positions[offset] += this._velocities[offset] * travel;
      this._positions[offset + 1] += this._velocities[offset + 1] * travel - gravity / 5 * (dt - travel);
      this._positions[offset + 2] += this._velocities[offset + 2] * travel;
      this._velocities[offset] *= drag;
      this._velocities[offset + 1] = this._velocities[offset + 1] * drag - gravity * travel;
      this._velocities[offset + 2] *= drag;
      this._setParticleMatrix(slot);
      matricesChanged = true;
    }
    this.mesh.visible = this._active > 0;
    if (matricesChanged) this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.impactAlpha.needsUpdate = true;
  }

  clear() {
    this._generation++;
    this._active = 0;
    this._markCursor = 0;
    this._particleCursor = 0;
    this._lives.fill(0);
    this._alphas.fill(0);
    if (this.mesh) {
      this.mesh.visible = false;
      this.mesh.geometry.attributes.impactAlpha.needsUpdate = true;
    }
  }

  dispose() {
    this.clear();
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    this._world = null;
    this._mapRoot = null;
  }
}
