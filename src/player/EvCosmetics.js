import * as THREE from 'three';
import { disposeModel } from '../core/ModelResources.js';
import { createAuthoredSkinSlot } from './AuthoredSkins.js';

export function setupEvCosmetics(group, model, bones) {
  const materials = [], originals = new Map(), nativeMeshes = [];
  model.traverse((o) => {
    // The rifle has similarly named orange/gray materials. Only the skinned
    // character receives armor finishes; weapon finishes remain independent.
    if (!o.isSkinnedMesh) return;
    nativeMeshes.push(o);
    const m = o.material;
    m.userData.armorRole = /Undersuit/.test(m.name) ? 'under'
      : /orange/.test(m.name) ? 'plate' : /gray/.test(m.name) ? 'trim' : 'accent';
    materials.push(m);
    originals.set(m, { color: m.color.clone(), emissive: m.emissive.clone(),
      emissiveIntensity: m.emissiveIntensity, roughness: m.roughness, metalness: m.metalness });
  });
  const applyAuthored = createAuthoredSkinSlot(group, model, bones, nativeMeshes, materials);
  let theme = null, helmetMount = null;
  function apply(skin, finish) {
    finish ||= skin?.model ? skin : null;
    applyAuthored(finish);
    if (!helmetMount) {
      group.updateWorldMatrix(true, true);
      const head = group.worldToLocal(bones.Bip001_Head.getWorldPosition(new THREE.Vector3()));
      helmetMount = bones.Bip001_Head.matrixWorld.clone().invert().multiply(group.matrixWorld)
        .multiply(new THREE.Matrix4().makeTranslation(head.x, head.y, head.z));
    }
    if (theme) { disposeModel(theme); theme = null; }
    for (const m of materials) {
      const base = originals.get(m);
      m.color.copy(base.color); m.emissive.copy(base.emissive);
      m.emissiveIntensity = base.emissiveIntensity;
      m.roughness = base.roughness; m.metalness = base.metalness;
      const active = finish || (skin?.id !== 'default' && skin);
      if (!active) continue;
      if (active.monochrome) {
        m.color.set(/under/.test(m.userData.armorRole) ? active.secondary : active.primary);
        if (m.userData.armorRole === 'trim') m.color.set(0xb0b0b0);
        if (m.userData.armorRole === 'accent') m.color.set(0xd4d4d4);
        m.emissive.set(0x777777); m.emissiveIntensity = Math.min(base.emissiveIntensity, .15);
        continue;
      }
      const role = m.userData.armorRole;
      const primary = new THREE.Color(active.primary);
      if (role === 'plate') m.color.copy(primary).multiplyScalar(finish ? 0.92 : 1);
      if (role === 'trim') m.color.copy(primary).lerp(new THREE.Color(0xe8edf2), 0.58);
      if (role === 'under') m.color.set(active.secondary).lerp(new THREE.Color(0x4b5766), 0.42);
      if (finish) {
        m.roughness = finish.roughness; m.metalness = finish.metalness;
        if (role === 'accent') {
          m.color.set(finish.emissive ?? finish.primary); m.emissive.copy(m.color);
          m.emissiveIntensity = finish.emissiveIntensity ?? 0.52;
        }
      }
    }
    if (!finish?.theme) return;
    // Keep the initial helmet mount in bone space, including when a finish is
    // changed during an animation. Source bone axes are not assumed.
    theme = new THREE.Group(); theme.name = `EV helmet theme - ${finish.theme}`;
    bones.Bip001_Head.add(theme);
    theme.applyMatrix4(helmetMount);
    const plate = new THREE.MeshStandardMaterial({ color: finish.primary, roughness: finish.roughness, metalness: finish.metalness });
    const glow = new THREE.MeshStandardMaterial({ color: finish.emissive, emissive: finish.emissive, emissiveIntensity: finish.emissiveIntensity });
    function add(geometry, x, y, z, material = plate, tilt = 0) {
      const part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z);
      part.rotation.z = tilt; part.castShadow = true; theme.add(part);
    }
    if (finish.theme === 'ears' || finish.theme === 'horns') for (const s of [-1, 1]) {
      const ears = finish.theme === 'ears';
      add(new THREE.ConeGeometry(ears ? 0.055 : 0.035, 0.18, 4), s * 0.10, 0.29, 0, plate, -s * 0.25);
      if (ears) add(new THREE.ConeGeometry(0.025, 0.12, 4), s * 0.10, 0.29, -0.025, glow, -s * 0.25);
    }
    if (finish.theme === 'crown') for (const s of [-1, 0, 1]) {
      add(new THREE.BoxGeometry(0.027, s ? 0.13 : 0.18, 0.07), s * 0.075, 0.28, 0);
    }
    if (finish.theme === 'bone') {
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.034, 0.10, 0.035), s * 0.065, 0.02, -0.16);
      add(new THREE.BoxGeometry(0.12, 0.035, 0.035), 0, -0.035, -0.16);
    }
    if (!theme.children.some((o) => o.material === glow)) glow.dispose();
  }
  return { apply, materials, primary: materials.find((m) => m.userData.armorRole === 'plate') };
}
