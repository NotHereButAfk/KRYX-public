import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeModel } from '../core/ModelResources.js';
import { configureLegendaryEffect, updateLegendaryEffect } from '../weapons/LegendaryEffects.js';

const templates = new Map(), pending = new Map();
export function installAuthoredSkin(id, gltf) {
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (o.isMesh) o.geometry.userData.shared = true; });
  templates.set(id, gltf.scene);
}
export function preloadAuthoredSkin(finish) {
  if (isCrazyGames()) return Promise.resolve(null);
  if (!finish?.model) return Promise.resolve(null);
  if (templates.has(finish.id)) return Promise.resolve(templates.get(finish.id));
  if (!pending.has(finish.id)) {
    pending.set(finish.id, new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(finish.model).then(gltf => {
      installAuthoredSkin(finish.id, gltf);
      return templates.get(finish.id);
    }).finally(() => pending.delete(finish.id)));
  }
  return pending.get(finish.id);
}

// Blender exports the same bind skeleton as the published character. Rebind
// the authored surfaces to that instance's bones: no second mixer or rig.
export function mountAuthoredSkin(template, model, bones, finish = null) {
  const root = new THREE.Group(); root.name = 'Blender authored armor';
  template.traverse(source => {
    if (!source.isSkinnedMesh) return;
    const mapped = source.skeleton.bones.map(b => bones[b.name]);
    if (mapped.some(b => !b)) throw new Error('Authored armor does not match the published skeleton');
    const material = Array.isArray(source.material) ? source.material.map(m => m.clone()) : source.material.clone();
    const mesh = new THREE.SkinnedMesh(source.geometry, material);
    if (finish?.rarity === 'legendary') {
      const mats = [].concat(material);
      mats.forEach(m => configureLegendaryEffect(m, finish));
      mesh.onBeforeRender = () => mats.forEach(m => updateLegendaryEffect(m, performance.now() / 1000));
    }
    mesh.name = source.name;
    mesh.applyMatrix4(source.matrixWorld);
    mesh.bind(new THREE.Skeleton(mapped, source.skeleton.boneInverses.map(m => m.clone())), source.bindMatrix.clone());
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  });
  if (!root.children.length) throw new Error('Authored armor has no skinned surfaces');
  model.add(root);
  return root;
}

export function createAuthoredSkinSlot(group, model, bones, nativeMeshes, materials) {
  let revision = 0, current = null, disposed = false;
  // Every owner releases the native materials during teardown, even when its
  // meshes are hidden. Late network loads must never repopulate a dead avatar.
  materials[0]?.addEventListener('dispose', () => { disposed = true; revision++; current?.traverse(o => o.skeleton?.dispose()); });
  return function apply(finish) {
    const token = ++revision;
    if (current) {
      current.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const i = materials.indexOf(m); if (i >= 0) materials.splice(i, 1);
        }
        o.skeleton?.dispose();
      });
      disposeModel(current); current = null;
    }
    nativeMeshes.forEach(o => { o.visible = true; });
    group.userData.authoredSkinId = null;
    const ready = !finish?.model ? Promise.resolve(false) : preloadAuthoredSkin(finish).then(template => {
      if (disposed || token !== revision) return false;
      current = mountAuthoredSkin(template, model, bones, finish);
      nativeMeshes.forEach(o => { o.visible = false; });
      current.traverse(o => { if (o.isMesh) materials.push(...(Array.isArray(o.material) ? o.material : [o.material])); });
      group.userData.authoredSkinId = finish.id;
      return true;
    }).catch(error => { console.warn('[Player skin]', error.message); return false; });
    group.userData.skinReady = ready;
    return ready;
  };
}
