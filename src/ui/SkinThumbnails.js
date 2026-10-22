/**
 * Generates small PBR material previews for every weapon/sword skin.
 * A temporary WebGLRenderer (72×72) renders a gun-shaped silhouette with
 * each skin's exact metalness / roughness / color, then stores the result
 * as a data-URL. The renderer is disposed once all thumbnails are done.
 *
 * Usage:
 *   import { getThumbnail, warmThumbnails } from './SkinThumbnails.js';
 *   warmThumbnails();                     // call once at startup
 *   const src = getThumbnail(skinId, isSword); // returns data-URL or null
 */

import * as THREE from 'three';
import { WEAPON_SKINS } from '../weapons/WeaponSkins.js';
import { SWORD_SKINS } from '../weapons/SwordSkins.js';
import { decalTexture } from '../weapons/WeaponTextures.js';

const _cache = new Map();
let _warmed  = false;

export function warmThumbnails() {
  if (_warmed) return;
  _warmed = true;
  // Run async so it doesn't block the main thread startup
  setTimeout(_generate, 0);
}

export function getThumbnail(skinId, isSword = false) {
  return _cache.get((isSword ? 's_' : 'g_') + skinId) ?? null;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function _generate() {
  const SIZE = 80;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping      = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1018);

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 10);
  camera.position.set(0, 0.08, 2.5);
  camera.lookAt(0, 0, 0);

  // ── Gun body silhouette (two boxes) ──
  const mat = new THREE.MeshStandardMaterial();

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.28, 0.14), mat);
  body.rotation.set(0.1, -0.22, 0.03);
  scene.add(body);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.46, 0.13), mat);
  grip.position.set(-0.22, -0.34, 0);
  grip.rotation.copy(body.rotation);
  grip.rotation.z += 0.14;
  scene.add(grip);

  // ── Lights ──
  scene.add(new THREE.AmbientLight(0x334455, 0.55));
  const key  = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7799cc, 0.45);
  fill.position.set(-4, 1, 2);
  scene.add(fill);
  const rim  = new THREE.DirectionalLight(0x99bbdd, 0.5);
  rim.position.set(0.5, -3, -4);
  scene.add(rim);

  // ── Render one frame per skin, capture ──
  const snap = () => renderer.domElement.toDataURL('image/jpeg', 0.88);

  const applyAndSnap = (skin, isSword) => {
    const bodyCol = isSword ? skin.blade : skin.body;
    mat.color.setHex(bodyCol);
    mat.metalness  = skin.metalness  ?? 0.5;
    mat.roughness  = skin.roughness  ?? 0.5;
    mat.emissive.setHex(skin.animated ? (skin.emissive ?? bodyCol) : 0x000000);
    mat.emissiveIntensity = skin.animated ? Math.min(skin.emissiveIntensity ?? 0.4, 0.7) : 0;
    // Show the painted decal pattern for themed skins (guns and swords).
    const decal = skin.decal ? decalTexture(skin.decal) : null;
    mat.map = decal || null;
    if (decal && skin.decalEmissive) {
      mat.emissiveMap = decal;
      mat.emissive.setHex(0xffffff);
      mat.emissiveIntensity = 0.8;
    } else {
      mat.emissiveMap = null;
    }
    mat.needsUpdate = true;
    renderer.render(scene, camera);
    return snap();
  };

  for (const skin of WEAPON_SKINS) {
    _cache.set('g_' + skin.id, applyAndSnap(skin, false));
  }
  for (const skin of SWORD_SKINS) {
    _cache.set('s_' + skin.id, applyAndSnap(skin, true));
  }

  // Dispose — we only needed this renderer for thumbnail generation
  body.geometry.dispose();
  grip.geometry.dispose();
  mat.dispose();
  renderer.dispose();
}
