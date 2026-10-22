import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let template = null;
let loading = false;
const callbacks = [];

export function preloadViewmodelArms(onLoad) {
  if (isCrazyGames()) { onLoad?.(false); return; }
  if (template) { onLoad?.(true); return; }
  // Contract/unit tests instantiate WeaponSystem in Node, where a site-root URL
  // has no origin. Keep the procedural fallback there; browsers perform the
  // real asset swap as soon as the compact arm bake arrives.
  if (typeof window === 'undefined') { onLoad?.(false); return; }
  if (onLoad) callbacks.push(onLoad);
  if (loading) return;
  loading = true;
  new GLTFLoader().load('/ev-view-arms.glb?v=underhand-gloves-5', (gltf) => {
    template = gltf.scene;
    loading = false;
    callbacks.splice(0).forEach((cb) => cb(true));
  }, undefined, (error) => {
    console.warn('[ViewmodelArms] load failed:', error?.message);
    loading = false;
    callbacks.splice(0).forEach((cb) => cb(false));
  });
}

function cloneMaterial(material) {
  const clone = material.clone();
  clone.userData.authoredColor = material.color.getHex();
  clone.userData.authoredEmissive = material.emissive?.getHex() ?? 0;
  clone.userData.authoredIntensity = material.emissiveIntensity ?? 0;
  clone.depthTest = true; clone.depthWrite = true;
  return clone;
}

// The third-person bake ends at the shoulder. In the closer first-person
// camera that open end can enter the frame. Continue only the proximal sleeve
// toward the off-screen shoulder, leaving the glove and forearm grip intact.
// Apply the same continuous deformation to sleeve and armour so their seams
// stay together. Clone geometry: the cached template also serves other arms.
function continueUpperArm(mesh, side, playerArm = false) {
  if (/_Hand$/i.test(mesh.name)) return;
  const geometry = mesh.geometry.clone();
  const positions = geometry.getAttribute('position');
  const direction = side === 'Left' ? -1 : 1;
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i);
    const t = THREE.MathUtils.clamp((z - 0.18) / 0.25, 0, 1);
    const blend = t * t * (3 - 2 * t);
    positions.setXYZ(i,
      positions.getX(i) + direction * 0.12 * blend,
      positions.getY(i) - (playerArm ? 0.42 : 0.20) * blend,
      z + (playerArm ? 0.12 : 0.30) * blend);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.geometry = geometry;
}

/**
 * Clone one arm baked from the same EV character mesh shown to other players.
 * Its origin is the wrist and its fingers already use the authored armed idle
 * pose. WeaponSystem measures the closed palm before seating it on a grip.
 */
export function buildViewmodelArm(side, sourceTemplate = template) {
  const source = sourceTemplate?.getObjectByName(`KYX_ViewArm_${side}`);
  if (!source) return null;
  const root = source.clone(true);
  root.traverse((object) => {
    if (!object.isMesh) return;
    continueUpperArm(object, side, source.userData.sourceCharacter === 'ev-default');
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => cloneMaterial(material));
    } else {
      object.material = cloneMaterial(object.material);
    }
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = false;
    object.userData.sourceMaterial = Array.isArray(object.material)
      ? object.material[0]?.name || '' : object.material?.name || '';
  });
  return root;
}

// The hand must roll with the handguard while the elbow still points toward
// the left shoulder. Blend that wrist rotation through the existing sleeve;
// rotating only the rigid glove would split its junction with the cuff.
export function rigSupportWrist(arm, model) {
  const elbow = new THREE.Bone();
  const wrist = new THREE.Bone();
  elbow.name = 'viewmodel_elbow_anchor'; wrist.name = 'viewmodel_support_wrist';
  arm.add(elbow); elbow.add(wrist);
  arm.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton([elbow, wrist]);
  const meshes = [];
  model.traverse(o => { if (o.isMesh) meshes.push(o); });
  const point = new THREE.Vector3();
  for (const source of meshes) {
    const geometry = source.geometry.clone();
    const positions = geometry.getAttribute('position');
    const indices = new Uint16Array(positions.count * 4);
    const weights = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld);
      arm.worldToLocal(point);
      const weight = source.userData.viewmodelPart === 'glove' ? 1
        : 1 - THREE.MathUtils.smoothstep(point.length(), .08, .20);
      indices.set([0, 1, 0, 0], i * 4);
      weights.set([1 - weight, weight, 0, 0], i * 4);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, source.material);
    mesh.name = source.name; mesh.userData = { ...source.userData };
    mesh.position.copy(source.position); mesh.quaternion.copy(source.quaternion); mesh.scale.copy(source.scale);
    mesh.frustumCulled = false;
    source.parent.add(mesh); mesh.updateWorldMatrix(true, false);
    mesh.bind(skeleton, mesh.matrixWorld);
    source.removeFromParent();
    if (source.userData.viewmodelPart !== 'glove') source.geometry.dispose();
  }
  arm.userData.supportWrist = wrist;
}

export function tintViewmodelArm(root, { plate, sleeve, glove, accent, authored = false }) {
  if (!root) return;
  const colors = {
    // PreviewCharacter has already resolved the actual rendered body colours.
    // Do not shade them again here or the local hands diverge from the skin
    // other players see.
    plate: new THREE.Color(plate),
    sleeve: new THREE.Color(sleeve),
    glove: new THREE.Color(glove),
    accent: new THREE.Color(accent),
  };
  root.traverse((object) => {
    if (!object.isMesh) return;
    const name = `${object.name} ${object.userData.sourceMaterial || ''}`;
    const role = object.userData.viewmodelPart || (/Hand/i.test(object.name) ? 'glove'
      : /Orange|Insert/i.test(name) ? 'accent'
        : /Armor|Guard|Pauldron/i.test(name) ? 'plate'
          : 'sleeve');
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (authored && material.userData.authoredColor !== undefined) {
        material.color.setHex(material.userData.authoredColor);
        material.emissive?.setHex(material.userData.authoredEmissive ?? 0);
        material.emissiveIntensity = material.userData.authoredIntensity ?? 0;
        continue;
      }
      if (material.userData.evArmMaterial) {
        const name = material.name;
        material.color.copy(/Undersuit/.test(name) ? colors.sleeve : /orange/.test(name) ? colors.plate : /gray/.test(name) ? new THREE.Color(plate).multiplyScalar(1 / .92).lerp(new THREE.Color(0xe8edf2), .58) : colors.accent);
        material.emissive?.setHex(/accents/.test(name) ? accent : 0);
        material.emissiveIntensity = /accents/.test(name) ? .52 : 0;
        continue;
      }
      material.color.copy(colors[role]);
      if (material.emissive) {
        material.emissive.copy(role === 'accent' ? colors.accent : new THREE.Color(0x000000));
        material.emissiveIntensity = role === 'accent' ? 0.05 : 0;
      }
      material.needsUpdate = true;
    }
  });
}
