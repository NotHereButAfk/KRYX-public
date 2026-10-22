import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeModel } from '../core/ModelResources.js';
import { configureLegendaryEffect, updateLegendaryEffect } from './LegendaryEffects.js';

const templates = new Map(), pending = new Map(), slots = new WeakMap();
export function installAuthoredWeaponSkin(id, gltf) {
  gltf.scene.traverse(o => { if (o.isMesh) o.geometry.userData.shared = true; });
  templates.set(id, gltf.scene);
}
export function preloadAuthoredWeaponSkin(skin) {
  if (isCrazyGames()) return Promise.resolve(null);
  if (templates.has(skin.id)) return Promise.resolve(templates.get(skin.id));
  if (!pending.has(skin.id)) pending.set(skin.id, new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(skin.model + '?v=20261004-material-fit').then(gltf => {
    installAuthoredWeaponSkin(skin.id, gltf); return gltf.scene;
  }).finally(() => pending.delete(skin.id)));
  return pending.get(skin.id);
}
export function clearAuthoredWeaponSkin(group) {
  const state = slots.get(group);
  if (!state) return;
  state.revision++;
  if (state.current) disposeModel(state.current);
  state.current = null;
  state.native.forEach(o => { o.visible = true; });
  delete group.userData.authoredWeaponSkinId;
}
export function applyAuthoredWeaponSkin(group, skin) {
  if (isCrazyGames()) { clearAuthoredWeaponSkin(group); return; }
  clearAuthoredWeaponSkin(group);
  let state = slots.get(group);
  if (!state) {
    const native = []; group.traverse(o => { if (o.isMesh) native.push(o); });
    state = { native, revision: 0, current: null, disposed: false }; slots.set(group, state);
    // A queued load must not resurrect an unequipped/disposed first-person gun.
    const m = native[0]?.material;
    (Array.isArray(m) ? m[0] : m)?.addEventListener('dispose', () => { state.disposed = true; state.revision++; });
  }
  const revision = ++state.revision;
  group.userData.weaponSkinReady = preloadAuthoredWeaponSkin(skin).then(template => {
    if (state.disposed || revision !== state.revision) return false;
    const source = template.getObjectByName(`weapon_${skin.weaponId}`);
    if (!source) throw new Error('Authored weapon skin has no matching weapon root');
    const surface = source.clone(true);
    // Gameplay owns its original hand/muzzle markers. This layer owns visuals.
    const markers = []; surface.traverse(o => { if (!o.isMesh && o.name.startsWith('BIND_')) markers.push(o); });
    markers.forEach(o => o.removeFromParent());
    const exemplar = state.native[0], nativeMat = [].concat(exemplar?.material || [])[0];
    surface.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.userData.shared = true;
      const clone = m => {
        const result = m.clone(); result.userData.role = 'body';
        if (nativeMat) { result.depthTest = nativeMat.depthTest; result.depthWrite = nativeMat.depthWrite; }
        configureLegendaryEffect(result, skin); return result;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
      o.castShadow = exemplar?.castShadow ?? true; o.receiveShadow = exemplar?.receiveShadow ?? true;
      o.renderOrder = exemplar?.renderOrder || 0; if (exemplar) o.layers.mask = exemplar.layers.mask;
    });
    state.native.forEach(o => { o.visible = false; });
    group.add(surface); state.current = surface; group.userData.authoredWeaponSkinId = skin.id;
    return true;
  }).catch(error => { console.warn('[Weapon skin]', error.message); return false; });
  return group.userData.weaponSkinReady;
}
export function animateAuthoredWeaponSkin(group, skin, time) {
  if (!skin?.animated) return;
  slots.get(group)?.current?.traverse(o => {
    if (o.isMesh) for (const m of [].concat(o.material)) updateLegendaryEffect(m, time);
  });
}
