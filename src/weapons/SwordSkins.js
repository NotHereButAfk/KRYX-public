import { applyAuthoredWeaponSkin, clearAuthoredWeaponSkin, animateAuthoredWeaponSkin } from './AuthoredWeaponSkins.js';
import * as THREE from 'three';
import { configureLegendaryEffect, updateLegendaryEffect } from './LegendaryEffects.js';
import { decalTexture } from './WeaponTextures.js';

// Cosmetic finishes for the sword. A sword skin recolors the blade (metal
// role), the fuller groove (accent role), and the guard (special role), while
// leaving the wooden handle untouched. Skins carry a `rarity`; fancier ones
// paint a `decal` pattern onto the blade (optionally glowing via decalEmissive).
// Animated skins pulse/cycle the blade's emissive each frame.

import { SWORD_SKINS } from '../../server/swordskins.mjs';
export { SWORD_SKINS };

const _col = new THREE.Color();

export function getSwordSkin(id) {
  // Catalog is empty — no sword skins exist, so there is no default fallback.
  return SWORD_SKINS.find((s) => s.id === id) || null;
}

/**
 * Apply a sword skin to the sword model group. Touches blade (metal role),
 * fuller (accent role), and guard (special role); handle (wood) stays.
 */
export function applySwordSkin(group, skin) {
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
    if (role === 'metal') {
      // blade
      m.color.setHex(skin.blade ?? skin.metal ?? skin.body ?? 0xffffff);
      m.metalness = skin.metalness ?? 0.35;
      m.roughness = skin.roughness ?? 0.5;
      m.emissive.setHex(skin.emissive ?? 0);
      m.emissiveIntensity = skin.emissiveIntensity ?? 0;
      // painted blade pattern
      m.map = decal || null;
      m.emissiveMap = (skin.decalEmissive && decal) ? decal : null;
      m.needsUpdate = true;
    } else if (role === 'accent') {
      // fuller groove
      m.color.setHex(skin.fuller ?? skin.accent ?? 0xffffff);
      m.emissive.setHex(skin.emissive ?? 0);
      m.emissiveIntensity = (skin.emissiveIntensity ?? 0) * 0.6;
    } else if (role === 'special') {
      // guard / crossguard
      m.color.setHex(skin.guard ?? skin.accent ?? 0xffffff);
      m.metalness = Math.min(1, (skin.metalness ?? 0.35) + 0.05);
      m.roughness = Math.max(0.08, (skin.roughness ?? 0.5) - 0.05);
    }
    if (role === 'metal' || role === 'accent') configureLegendaryEffect(m, skin);
    // 'wood' (handle) intentionally left as-is.
  });
}

/**
 * Called every frame for the active sword when its skin is animated.
 * @param {THREE.Group} group  Active weapon model
 * @param {object}      skin   Sword skin definition (animated===true)
 * @param {number}      t      Accumulated time in seconds
 */
export function animateSwordSkin(group, skin, t) {
  if (skin?.model) { animateAuthoredWeaponSkin(group, skin, t); return; }
  if (!skin?.animated) return;
  // Glowing-decal blades keep emissive white so the painted pattern shows.
  const glowDecal = skin.decalEmissive;
  const seen = new Set();
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    if (seen.has(m)) return;
    seen.add(m);
    const role = m.userData?.role;
    if (role !== 'metal' && role !== 'accent') return;
    updateLegendaryEffect(m, t);
    const keepWhite = glowDecal && role === 'metal';

    switch (skin.animType) {
      case 'pulse': {
        const pulse = (Math.sin(t * skin.animSpeed) + 1) * 0.5;
        if (!keepWhite) m.emissive.setHex(skin.emissive ?? 0);
        m.emissiveIntensity = skin.animMin + pulse * (skin.animMax - skin.animMin);
        break;
      }
      case 'cycle': {
        const hue = (t * 0.14) % 1;
        _col.setHSL(hue, 0.95, 0.55);
        m.emissive.copy(_col);
        m.emissiveIntensity = 0.6;
        break;
      }
      case 'lava': {
        // two offset sine waves create the flowing/dripping lava feel
        const a = (Math.sin(t * skin.animSpeed) + 1) * 0.5;
        const b = (Math.sin(t * skin.animSpeed * 0.6 + 1.4) + 1) * 0.5;
        _col.setHex(0xff3300);
        const hot = new THREE.Color(0xff9900);
        _col.lerp(hot, b * 0.5);
        m.emissive.copy(_col);
        m.emissiveIntensity = skin.animMin + (a * 0.5 + b * 0.5) * (skin.animMax - skin.animMin);
        break;
      }
      case 'storm': {
        // rapid electric noise: white-yellow flashes
        const n = Math.sin(t * skin.animSpeed) * 0.5
          + Math.sin(t * skin.animSpeed * 3.1) * 0.35
          + Math.sin(t * skin.animSpeed * 0.42) * 0.15;
        const f = (n + 1) * 0.5;
        const isWhite = f > 0.75;
        m.emissive.setHex(isWhite ? 0xffffff : 0xffdd00);
        m.emissiveIntensity = skin.animMin + f * (skin.animMax - skin.animMin);
        break;
      }
      case 'corruption': {
        // organic sickly pulse between green and dark purple
        const p = (Math.sin(t * skin.animSpeed) + 1) * 0.5;
        _col.setHex(0x40cc20);
        const dark = new THREE.Color(0x200a40);
        _col.lerp(dark, p * 0.7);
        m.emissive.copy(_col);
        m.emissiveIntensity = skin.animMin + (1 - p * 0.5) * (skin.animMax - skin.animMin);
        break;
      }
    }
  });
}
