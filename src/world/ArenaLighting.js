import * as THREE from 'three';

const colorOf = (value, fallback) => {
  if (value instanceof THREE.Color) return value.clone();
  if (typeof value === 'string' || typeof value === 'number') return new THREE.Color(value);
  return new THREE.Color(fallback);
};

export class ArenaLighting {
  constructor(scene) {
    this.scene = scene;
    this.profile = { quality: 'low' };
    this._casters = new WeakSet();
    this._suppressed = [];
    this._renderer = null;

    this.hemisphere = new THREE.HemisphereLight(0x9fb8d0, 0x241d1c, 0.6);
    this.sun = new THREE.DirectionalLight(0xffdfbd, 1);
    this.rim = new THREE.DirectionalLight(0x9ab8e8, 0.25);
    this.sun.position.set(30, 60, 20);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = false;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.18;
    this.sun.shadow.intensity = 0.72;

    const skyVertex = `varying vec3 vDirection;
      void main() {
        vDirection = position;
        // Ignore camera translation and put the sky at the far plane.
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = clip.xyww;
      }`;
    const skyFragment = `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 ground;
      uniform vec3 sunDirection; uniform vec3 sunColor; uniform float sunGlow;
      varying vec3 vDirection;
      void main() {
        float height = clamp(normalize(vDirection).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 sky = mix(ground, horizon, smoothstep(0.0, 0.42, height));
        sky = mix(sky, zenith, smoothstep(0.42, 1.0, height));
        float glow = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 20.0) * min(sunGlow, 0.3);
        gl_FragColor = vec4(sky + sunColor * glow, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          horizon: { value: new THREE.Color(0x65758a) },
          zenith: { value: new THREE.Color(0x26384f) },
          ground: { value: new THREE.Color(0x171719) },
          sunDirection: { value: new THREE.Vector3(0.3, 0.75, 0.4) },
          sunColor: { value: new THREE.Color(0xffc48f) },
          sunGlow: { value: 0.2 }
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: true
      })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.userData.noHit = true;
    scene.add(this.sky, this.hemisphere, this.sun, this.sun.target, this.rim, this.rim.target);
  }

  apply(definition = {}, bounds = new THREE.Box3(new THREE.Vector3(-100, -10, -100), new THREE.Vector3(100, 40, 100))) {
    const lighting = definition.lighting || {};
    const background = definition.background?.color ?? definition.background;
    const horizon = colorOf(background, 0x65758a);
    const zenith = horizon.clone().multiplyScalar(0.55);
    zenith.offsetHSL(0.02, 0, -0.04);
    const ground = horizon.clone().multiplyScalar(0.32);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(500, size.length() * 2);
    this.profile = { quality: this.profile.quality, horizon: horizon.clone(), zenith: zenith.clone(), ground: ground.clone() };
    this.scene.environmentIntensity = 0.4;
    this.hemisphere.color.copy(colorOf(lighting.sky, horizon));
    this.hemisphere.groundColor.copy(colorOf(lighting.ground, ground));
    this.hemisphere.intensity = Math.max(0, Number(lighting.hemisphereIntensity ?? 0.6)) * 0.65;
    this.sun.color.copy(colorOf(lighting.sun, 0xffdfbd));
    this.sun.intensity = Math.max(0, Number(lighting.sunIntensity ?? 1)) * 1.15;
    this.rim.color.copy(colorOf(lighting.rim, 0x9ab8e8));
    this.rim.intensity = Math.max(0, Number(lighting.rimIntensity ?? 0.25)) * 0.65;
    const sunDirection = new THREE.Vector3(...(lighting.sunDirection || [-0.55, 0.8, 0.45])).normalize();
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).add(sunDirection);
    this.rim.target.position.copy(center);
    this.rim.position.copy(center).add(new THREE.Vector3(-size.x, size.y, -size.z));
    this.sky.position.copy(center);
    this.sky.scale.setScalar(radius);
    this.sky.material.uniforms.horizon.value.copy(horizon);
    this.sky.material.uniforms.zenith.value.copy(zenith);
    this.sky.material.uniforms.ground.value.copy(ground);
    this.sky.material.uniforms.sunDirection.value.copy(sunDirection);
    this.sky.material.uniforms.sunColor.value.copy(this.sun.color);
    this._fitShadows(bounds);
    this._refreshShadows();
  }

  setupMap(root) {
    this._casters = new WeakSet();
    root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const visible = materials.filter((material) => material?.visible);
      if (visible.length && visible.every((material) => !material.transparent && material.opacity >= 0.99)) {
        object.castShadow = true;
        object.receiveShadow = true;
        this._casters.add(object);
      }
    });
    this._refreshShadows();
  }

  setQuality(quality = 'low', renderer) {
    const next = quality === 'high' || quality === 'medium' ? quality : 'low';
    const size = next === 'high' ? 2048 : 1024;
    const changed = this.profile.quality !== next || this.sun.shadow.mapSize.x !== size;
    this.profile.quality = next;
    this._renderer = renderer || this._renderer;
    if (this._renderer) {
      this._renderer.shadowMap.enabled = next !== 'low';
      this._renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.sun.castShadow = next !== 'low';
    if (next === 'low' || this.sun.shadow.mapSize.x !== size) {
      this._releaseShadowMap();
      this.sun.shadow.mapSize.set(size, size);
    }
    if (changed) this._refreshShadows();
    if (next === 'low') this.sun.shadow.needsUpdate = false;
  }

  // Shadow-camera layers are ignored by Three's shadow renderer. Filter once
  // per cache refresh, then restore gameplay meshes even if rendering throws.
  prepareFrame() {
    if (!this.sun.castShadow || !this.sun.shadow.needsUpdate) return;
    this.scene.traverse((object) => {
      if ((object.isMesh || object.isLine || object.isPoints) && object.castShadow && !this._casters.has(object)) {
        this._suppressed.push(object);
        object.castShadow = false;
      }
    });
  }

  restoreFrame() {
    for (const object of this._suppressed) object.castShadow = true;
    this._suppressed.length = 0;
  }

  _releaseShadowMap() {
    this.sun.shadow.map?.dispose();
    this.sun.shadow.mapPass?.dispose();
    this.sun.shadow.map = this.sun.shadow.mapPass = null;
  }

  _fitShadows(bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(1, size.length() * 0.5);
    const direction = this.sun.position.clone().sub(this.sun.target.position).normalize();
    this.sun.position.copy(center).addScaledVector(direction, radius * 2.5);
    const camera = this.sun.shadow.camera;
    camera.position.copy(this.sun.position);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const points = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    const margin = Math.max(2, radius * 0.08);
    camera.left = Math.min(...points.map((point) => point.x)) - margin;
    camera.right = Math.max(...points.map((point) => point.x)) + margin;
    camera.bottom = Math.min(...points.map((point) => point.y)) - margin;
    camera.top = Math.max(...points.map((point) => point.y)) + margin;
    camera.near = Math.max(0.1, -Math.max(...points.map((point) => point.z)) - margin);
    camera.far = Math.max(camera.near + 1, -Math.min(...points.map((point) => point.z)) + margin);
    camera.updateProjectionMatrix();
  }

  _refreshShadows() {
    if (this.profile.quality !== 'low') {
      this.sun.shadow.needsUpdate = true;
      if (this._renderer) this._renderer.shadowMap.needsUpdate = true;
    }
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.restoreFrame();
    this._releaseShadowMap();
    this.scene.remove(this.sky, this.hemisphere, this.sun, this.sun.target, this.rim, this.rim.target);
  }
}
