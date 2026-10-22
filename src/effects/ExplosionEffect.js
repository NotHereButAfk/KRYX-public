import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const LIGHTS = new WeakMap();

// Keep the scene's light count constant: adding/removing a light during a blast
// recompiles every lit map/player shader. Zero intensity keeps idle slots dark.
export function prepareExplosionLights(scene) {
  if (!LIGHTS.has(scene)) {
    const lights = Array.from({ length: 2 }, () => {
      const light = new THREE.PointLight(0xff8a32, 0, 16, 2);
      scene.add(light);
      return { light, busy: false };
    });
    LIGHTS.set(scene, lights);
  }
  return LIGHTS.get(scene);
}

const GEOMETRY = {
  flash: new THREE.SphereGeometry(0.48, 12, 8),
  fire: new THREE.IcosahedronGeometry(0.7, 2),
  smoke: new THREE.IcosahedronGeometry(0.9, 1),
  shockwave: new THREE.RingGeometry(0.34, 0.5, 36),
  blast: new THREE.SphereGeometry(0.62, 10, 7),
};
for (const geometry of Object.values(GEOMETRY)) geometry.userData.shared = true;

function material(color, opacity = 1, blending = THREE.AdditiveBlending) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending, side: THREE.DoubleSide, forceSinglePass: true,
  });
}

function seededDirection(i, count, out) {
  const y = ((i + 0.5) / count) * 1.55 - 0.28;
  const angle = i * 2.399963229728653;
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  return out.set(Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal).normalize();
}

/** Build one lightweight, multi-layer explosion shared by rockets and frags. */
export function spawnExplosion(scene, point, radius = 5, kind = 'rocket') {
  const scale = Math.max(0.65, radius / 5);
  const root = new THREE.Group();
  root.position.copy(point);
  // Keep the hottest part above the contact plane instead of burying half the
  // burst inside floors or platforms.
  root.position.y += 0.16;
  root.userData.explosionKind = kind;

  const flash = new THREE.Mesh(GEOMETRY.flash, material(0xfff4bd));
  const fire = new THREE.Mesh(GEOMETRY.fire, material(kind === 'frag' ? 0xff5a12 : 0xff931f, 0.98));
  const smoke = new THREE.Mesh(GEOMETRY.smoke, material(0x332b29, 0.67, THREE.NormalBlending));
  const shockwave = new THREE.Mesh(GEOMETRY.shockwave, material(0xffd17c, 0.88));
  shockwave.rotation.x = -Math.PI / 2;
  const blast = new THREE.Mesh(GEOMETRY.blast, material(0xff7c18, 0.44));
  root.add(smoke, blast, fire, flash, shockwave);

  const count = kind === 'frag' ? 38 : 48;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const direction = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    seededDirection(i, count, direction);
    positions[i * 3 + 1] = 0.05;
    const speed = scale * (4.8 + (i % 7) * 0.52);
    velocities[i * 3] = direction.x * speed;
    velocities[i * 3 + 1] = Math.max(1.4, direction.y * speed + 2.5);
    velocities[i * 3 + 2] = direction.z * speed;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: kind === 'frag' ? 0xffb13b : 0xffd06a,
    size: 0.085 * scale, sizeAttenuation: true, transparent: true,
    opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  root.add(sparks);

  const lightSlot = prepareExplosionLights(scene).find(slot => !slot.busy);
  const light = lightSlot?.light;
  if (light) {
    lightSlot.busy = true;
    light.color.setHex(0xff8a32);
    light.intensity = kind === 'frag' ? 18 : 24;
    light.distance = radius * 3.2;
    light.position.copy(point).addScaledVector(UP, 0.25);
  }
  if (kind === 'energy') {
    flash.material.color.setHex(0xf1ffd0);
    fire.material.color.setHex(0xb6ff32);
    blast.material.color.setHex(0x70efcb);
    shockwave.material.color.setHex(0xd6ff80);
    sparks.material.color.setHex(0xc5ff62);
    light?.color.setHex(0xb6ff32);
    smoke.visible = false;
  }
  scene.add(root);
  return { root, light, lightSlot, flash, blast, fire, smoke, shockwave, sparks, velocities, t: 0,
    life: kind === 'frag' ? 1.25 : 1.4, radius, kind };
}

export function updateExplosion(effect, dt) {
  effect.t += dt;
  const p = Math.min(1, effect.t / effect.life);
  const burst = 1 - Math.pow(1 - Math.min(1, p * 2.7), 3);
  // The bright fireball should read all the way across the damage footprint,
  // not as a small spark at the middle of a large invisible splash sphere.
  const radiusScale = Math.max(0.01, effect.radius / 5) * 1.18;
  effect.flash.scale.setScalar(radiusScale * (0.5 + burst * 4.4));
  effect.flash.material.opacity = Math.max(0, 1 - p * 6);
  effect.blast.scale.setScalar(radiusScale * (0.4 + burst * 4.8));
  effect.blast.material.opacity = Math.max(0, 0.46 * (1 - p * 2.6));
  effect.fire.scale.setScalar(radiusScale * (0.35 + burst * 3.1));
  effect.fire.rotation.y += dt * 3.2;
  effect.fire.rotation.z -= dt * 2.1;
  effect.fire.material.opacity = Math.max(0, 0.95 * (1 - p * 1.75));
  effect.smoke.scale.set(radiusScale * (0.5 + p * 3.9), radiusScale * (0.45 + p * 2.8), radiusScale * (0.5 + p * 3.9));
  effect.smoke.position.y = p * 0.65 * radiusScale;
  effect.smoke.rotation.y -= dt * 0.8;
  effect.smoke.material.opacity = 0.56 * Math.sin(Math.PI * Math.min(1, p * 1.08));
  effect.shockwave.scale.setScalar(radiusScale * (0.6 + burst * 10.5));
  effect.shockwave.material.opacity = Math.max(0, 0.72 * (1 - p * 2.2));
  if (effect.light) effect.light.intensity = (effect.kind === 'frag' ? 18 : 24) * Math.max(0, 1 - p * 4.5);

  for (const part of [effect.flash, effect.blast, effect.fire, effect.shockwave]) {
    part.visible = part.material.opacity > 0.005;
  }
  const positions = effect.sparks.geometry.attributes.position.array;
  for (let i = 0; i < positions.length / 3; i++) {
    const j = i * 3;
    effect.velocities[j + 1] -= 10.5 * dt;
    positions[j] += effect.velocities[j] * dt;
    positions[j + 1] += effect.velocities[j + 1] * dt;
    positions[j + 2] += effect.velocities[j + 2] * dt;
  }
  effect.sparks.geometry.attributes.position.needsUpdate = true;
  effect.sparks.material.opacity = Math.max(0, 1 - p * 1.25);
  return p >= 1;
}

export function disposeExplosion(scene, effect) {
  scene.remove(effect.root);
  if (effect.lightSlot) {
    effect.light.intensity = 0;
    effect.lightSlot.busy = false;
  }
  effect.root.traverse((object) => {
    if (!object.isMesh && !object.isPoints) return;
    if (!object.geometry?.userData.shared) object.geometry?.dispose();
    object.material?.dispose();
  });
}
