import { applyAuthoredWeaponSkin, clearAuthoredWeaponSkin, animateAuthoredWeaponSkin } from './AuthoredWeaponSkins.js';
import { configureLegendaryEffect, updateLegendaryEffect } from './LegendaryEffects.js';
import * as THREE from 'three';
import { decalTexture } from './WeaponTextures.js';

import { WEAPON_SKINS } from '../../server/weaponskins.mjs';
import { SWORD_SKINS } from '../../server/swordskins.mjs';
export { WEAPON_SKINS, SWORD_SKINS };
export const ALL_WEAPON_SKINS = [...WEAPON_SKINS, ...SWORD_SKINS];
export const MAIN_GUN_SKIN_SETS = Object.freeze(Object.fromEntries(
  [...new Set(WEAPON_SKINS.map(s => s.weaponId))].map(id =>
    [id, Object.freeze(WEAPON_SKINS.filter(s => s.weaponId === id).map(s => s.id))]),
));

const _skinWeapon = new Map(
  ALL_WEAPON_SKINS.map(s => [s.id, s.weaponId]),
);

export function getWeaponSkinsFor(weaponId) {
  const ids = weaponId === 'sword' ? SWORD_SKINS.map(s => s.id) : MAIN_GUN_SKIN_SETS[weaponId] || [];
  return ids.map(getWeaponSkin).filter(Boolean);
}

export function getWeaponIdForSkin(skinId) {
  return _skinWeapon.get(skinId) || null;
}

export function isSkinForWeapon(weaponId, skinId) {
  return _skinWeapon.get(skinId) === weaponId;
}

const _hsl = new THREE.Color();

export function getWeaponSkin(id) {
  // Catalog is empty — no gun skins exist, so there is no default fallback.
  return ALL_WEAPON_SKINS.find((s) => s.id === id) || null;
}

/** Recolor a built gun model group using the skin's material role tags. */
export function applyWeaponSkin(group, skin) {
  if (skin?.model) { applyAuthoredWeaponSkin(group, skin); return; }
  clearAuthoredWeaponSkin(group);
  // No skin (empty catalog / cleared finish) → leave the model's build-time look.
  if (!skin) return;
  const decal = skin.decal ? decalTexture(skin.decal) : null;
  const seen = new Set();
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    if (seen.has(m)) return;
    seen.add(m);
    const role = m.userData?.role;
    if (skin.weaponId === 'sword' && (role === 'wood' || role === 'special')) {
      m.color.setHex(role === 'wood' ? skin.grip : skin.guard);
      m.needsUpdate = true;
    }
    if (role === 'body' || role === 'metal' || (role === 'energy' && skin.weaponId === 'sword')) configureLegendaryEffect(m, skin);
    if (role === 'body') {
      m.color.setHex(skin.body);
      m.metalness = skin.metalness;
      m.roughness = skin.roughness;
      m.emissive.setHex(skin.emissive ?? 0x000000);
      m.emissiveIntensity = skin.emissiveIntensity ?? 0;
      // Painted decal pattern on the main shell.
      m.map = decal || null;
      if (skin.decalEmissive && decal) {
        m.emissiveMap = decal;
        m.emissive.setHex(0xffffff); // let the pattern's own colors glow
      } else {
        m.emissiveMap = null;
      }
      m.needsUpdate = true;
    } else if (role === 'accent') {
      m.color.setHex(skin.accent);
      m.metalness = skin.metalness;
      m.roughness = Math.min(0.85, skin.roughness + 0.15);
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
      // Total-coverage wraps also paint the trim/furniture parts. Clear the map
      // otherwise, so switching back from a full wrap to a normal skin doesn't
      // leave the old artwork on the trim (materials are reused across skins).
      m.map = (skin.decalOnAccent && decal) ? decal : null;
      m.needsUpdate = true;
    } else if (role === 'energy') {
      // Sci-fi glow strips. A skin may retint the hue (e.g. a "make the light
      // a different colour" finish). Keep a near-black base so the part doesn't
      // wash out under the game's ACES tone mapping — the glow rides on the
      // emissive, exactly as the model build does. Record the build-time colours
      // once so a retint is reversible when the next skin omits energyColor.
      if (m.userData.baseEnergyColor === undefined) {
        m.userData.baseEnergyColor = m.color.getHex();
        m.userData.baseEnergyEmissive = m.emissive.getHex();
        m.userData.baseEnergyIntensity = m.emissiveIntensity;
      }
      // Rarity artwork ON the glow surfaces: epic+ decal skins paint their
      // pattern onto the energy parts — on guns that's the conduits; on the
      // Arc Blade it's the whole blade, which is what makes an epic /
      // legendary / mythic finish actually LOOK different from a common
      // recolor there (the blade dominates the sword's silhouette).
      // Composition: the art is the SURFACE (white base × decal map) and the
      // glow follows the art's bright lines (emissiveMap) in the skin's hue.
      if (decal && skin.decalEmissive) {
        // Dedicated half-repeat copy so the art renders LARGE on the glow
        // surfaces — at normal tiling the pattern is too fine to read on a
        // thin blade.
        if (m.userData.energyDecalSrc !== decal) {
          const t = decal.clone();
          // Glow surfaces are thin (the blade especially): box UVs give them
          // a very short span on one axis, so a symmetric repeat samples a
          // narrow band of the art and reads as a flat tone. Stretch the
          // sampling across that short axis so the art streaks ALONG the
          // surface — reads as flowing energy in the blade.
          t.repeat.set(6, 1.2);
          t.needsUpdate = true;
          m.userData.energyDecal = t;
          m.userData.energyDecalSrc = decal;
        }
        m.map = m.userData.energyDecal;
        m.emissiveMap = m.userData.energyDecal;
        m.color.setHex(0xffffff);
        m.emissive.setHex(skin.energyColor !== undefined ? skin.energyColor : 0xffffff);
        m.emissiveIntensity = 1.5;
      } else {
        m.map = null;
        m.emissiveMap = null;
        m.emissiveIntensity = m.userData.baseEnergyIntensity;
        if (skin.energyColor !== undefined) {
          m.color.setHex(_hsl.setHex(skin.energyColor).multiplyScalar(0.12).getHex());
          m.emissive.setHex(skin.energyColor);
        } else {
          m.color.setHex(m.userData.baseEnergyColor);
          m.emissive.setHex(m.userData.baseEnergyEmissive);
        }
      }
      m.needsUpdate = true;
    } else if (role === 'metal') {
      m.metalness = skin.metalness;
      m.roughness = skin.roughness;
      m.color.setHex(skin.metal);
      m.emissive.setHex(skin.emissive ?? 0x000000);
      m.emissiveIntensity = skin.emissiveIntensity ?? 0;
      // Full-coverage wraps (decalOnMetal) paint the receiver/barrel too, so
      // the artwork flows across the whole gun instead of only body panels.
      // Otherwise clear the maps so a normal skin fully reverses a prior wrap.
      if (skin.decalOnMetal && decal) {
        m.map = decal;
        if (skin.decalEmissive) { m.emissiveMap = decal; m.emissive.setHex(0xffffff); }
        else m.emissiveMap = null;
      } else {
        m.map = null;
        m.emissiveMap = null;
      }
      m.needsUpdate = true;
    }
    // 'wood' and 'special' roles intentionally left as-is.
  });
}

/**
 * Called every frame for the active gun when its skin is animated.
 * Updates emissive color/intensity only on body + metal parts.
 * @param {THREE.Group} group  Active weapon model
 * @param {object}      skin   Skin definition (must have animated===true)
 * @param {number}      t      Accumulated time in seconds
 */
export function animateWeaponSkin(group, skin, t) {
  if (skin?.model) { animateAuthoredWeaponSkin(group, skin, t); return; }
  if (!skin?.animated) return;
  // For glowing-decal skins the emissiveMap supplies the colour, so we keep
  // emissive white on the body and only animate the glow intensity.
  const glowDecal = skin.decalEmissive;
  const seen = new Set();
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    if (seen.has(m)) return;
    seen.add(m);
    const role = m.userData?.role;
    if (role !== 'body' && role !== 'metal' && !(role === 'energy' && skin.weaponId === 'sword')) return;
    updateLegendaryEffect(m, t);
    const keepWhite = glowDecal && role === 'body';

    switch (skin.animType) {
      case 'pulse': {
        const pulse = (Math.sin(t * skin.animSpeed) + 1) * 0.5;
        if (!keepWhite) m.emissive.setHex(skin.emissive);
        m.emissiveIntensity = skin.animMin + pulse * (skin.animMax - skin.animMin);
        break;
      }
      case 'flicker': {
        const noise = Math.sin(t * skin.animSpeed) * 0.5
          + Math.sin(t * skin.animSpeed * 2.3) * 0.3
          + Math.sin(t * skin.animSpeed * 0.7) * 0.2;
        const f = (noise + 1) * 0.5;
        if (!keepWhite) m.emissive.setHex(skin.emissive);
        m.emissiveIntensity = skin.animMin + f * (skin.animMax - skin.animMin);
        break;
      }
      case 'cycle': {
        const hue = (t * 0.14) % 1;
        _hsl.setHSL(hue, 0.95, 0.55);
        m.emissive.copy(_hsl);
        m.emissiveIntensity = 1.6;
        break;
      }
      case 'rainbow': {
        // Fast continuous hue cycling with a gentle brightness pulse so the
        // bloom shimmers through the whole spectrum.
        const speed = skin.animSpeed ?? 0.35;
        const hue = (t * speed) % 1;
        _hsl.setHSL(hue, 1.0, 0.55);
        if (!keepWhite) m.emissive.copy(_hsl);
        const lo = skin.animMin ?? 1.2, hi = skin.animMax ?? 2.2;
        const pulse = (Math.sin(t * 4.0) + 1) * 0.5;
        m.emissiveIntensity = lo + pulse * (hi - lo);
        break;
      }
    }
  });
}
