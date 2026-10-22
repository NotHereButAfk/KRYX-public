/**
 * Renders a small 3D thumbnail of every actual weapon MODEL (from the weapon
 * GLB) for the loadout inventory cards — so each card shows the real gun we
 * have, not a generic icon. Generated once into data-URLs and cached by id.
 *
 *   import { warmWeaponThumbs, getWeaponThumb } from './WeaponThumbnails.js';
 *   warmWeaponThumbs(() => refreshCards());   // call once; onReady fires when done
 *   const src = getWeaponThumb(weaponId);     // data-URL or null (use icon fallback)
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS } from '../weapons/weaponDefs.js';
import {
  buildWeaponModel,
  hasLoadedWeaponModel,
  onWeaponModelReady,
  onWeaponModelsReady,
  preloadWeaponModels,
  QUATERNIUS_GUNS,
} from '../weapons/WeaponModels.js';
import { applyWeaponSkin } from '../weapons/WeaponSkins.js';
import { applySwordSkin } from '../weapons/SwordSkins.js';
import { disposeModel } from '../core/ModelResources.js';

// Studio-style scene shared by both thumbnail paths. The guns are largely
// metallic, and metals lit only by punctual lights render near-black — the
// PMREM room environment is what makes the finishes actually read.
function _studio(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  pmrem.dispose();
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5); fill.position.set(-3, 1, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe0b0, 0.45); rim.position.set(0, -2, -3); scene.add(rim);
  return () => {
    scene.environment = null;
    environment.dispose();
  };
}


// Place the camera along the standard three-quarter direction at a distance
// where the frustum comfortably contains a unit-normalised model.
const _camDir = new THREE.Vector3(0.55, 0.28, 0.9).normalize();
function _fitCamera(camera) {
  const dist = (0.5 * 0.88) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.35;
  camera.position.copy(_camDir).multiplyScalar(dist);
  camera.lookAt(0, 0, 0);
}

const _cache = new Map();
const _hudCache = new Map();
const _hudFallbackCache = new Map();
const _hudPending = new Set();
const _hudReadyCallbacks = new Set();
const _hudUpgradeCallbacks = new Map();
const _hudAuthoredWatch = new Set();
let _warmed = false;
let _warming = false;
let _generating = false;
let _hudGenerating = false;
const _readyCallbacks = new Set();

export function getWeaponThumb(id) { return WEAPONS.some(w => w.id === id) ? '/assets/default-weapon-cards/' + id + '.png' : null; }

// The match HUD is available before the optional 3D inventory renderer has
// warmed its WebGL thumbnails.  Returning null here used to omit the image
// node entirely, leaving only ammo and slot keys on a player's first match.
// These tiny inline silhouettes are immediate and allocation-cached; the real
// model render automatically wins whenever it has been generated.
function _hudFallbackThumb(id) {
  if (_hudFallbackCache.has(id)) return _hudFallbackCache.get(id);
  const def = WEAPONS.find((weapon) => weapon.id === id);
  const isMelee = def?.kind === 'melee';
  const isPistol = /magnum|pistol|sidearm/i.test(`${id} ${def?.name || ''}`);
  const isLauncher = def?.kind === 'rocket' || /launcher|cannon|fuel|concussion/i.test(`${id} ${def?.name || ''}`);
  const isShotgun = /shotgun|scatter|sweeper/i.test(`${id} ${def?.name || ''}`);
  let shape;
  if (isMelee) {
    shape = '<path d="M25 50 112 13l22 2-16 16-88 27z"/><path d="m103 21 10-10 28 12-9 10z"/><path d="m23 43 14 14-9 7-14-14z"/>';
  } else if (isPistol) {
    shape = '<path d="M30 19h92l14 10-9 12H78L66 56H47l8-17H30z"/><path d="M78 39h22L88 62H66z"/>';
  } else if (isLauncher) {
    shape = '<path d="M13 20h121l14 10-14 12H13L4 31z"/><path d="M34 42h28L49 61H27z"/><rect x="117" y="14" width="25" height="34" rx="5"/>';
  } else if (isShotgun) {
    shape = '<path d="M7 23h137l10 8-10 8H50L37 51H16L28 39H7z"/><path d="M67 39h27L83 60H61z"/><rect x="104" y="18" width="42" height="6" rx="3"/>';
  } else {
    shape = '<path d="M7 20h118l28 11-28 11H61L43 54H17l13-12H7z"/><path d="M68 42h27L83 61H61z"/><path d="m117 20 13-10h18l-8 16z"/>';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64"><g fill="#f4f6f8" stroke="#111820" stroke-width="2" stroke-linejoin="round">${shape}</g><path d="M8 58h144" stroke="#d9782e" stroke-width="2" opacity=".9"/></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  _hudFallbackCache.set(id, url);
  return url;
}

export function getWeaponHudThumb(id) {
  return _hudCache.get(id) ?? _cache.get(id) ?? _hudFallbackThumb(id);
}

// Render only the weapons the player is actually carrying. This restores the
// real model pictures in the match HUD without paying the cost of rasterising
// the complete armory during startup. The inline silhouette above remains on
// screen only while the authored GLBs and these one/two PNGs finish.
export function warmWeaponHudThumbs(ids, onReady) {
  const requested = [...new Set(ids || [])].filter(Boolean);
  if (requested.every((id) => _hudCache.has(id))) {
    queueMicrotask(() => onReady?.());
    return;
  }
  if (onReady) _hudReadyCallbacks.add(onReady);
  for (const id of requested) {
    if (!_hudCache.has(id)) _hudPending.add(id);
    const hasAuthoredUpgrade = QUATERNIUS_GUNS[id] && !hasLoadedWeaponModel(id);
    if (onReady && hasAuthoredUpgrade) {
      const callbacks = _hudUpgradeCallbacks.get(id) || new Set();
      callbacks.add(onReady);
      _hudUpgradeCallbacks.set(id, callbacks);
    }
    if (hasAuthoredUpgrade && !_hudAuthoredWatch.has(id)) {
      _hudAuthoredWatch.add(id);
      onWeaponModelReady(id, () => {
        _hudAuthoredWatch.delete(id);
        _hudCache.delete(id);
        _hudPending.add(id);
        _generateHudThumbs();
      });
    }
  }
  _generateHudThumbs();
  preloadWeaponModels();
}

// Render a one-off larger thumbnail of a weapon wearing a specific skin (or raw
// if skin is null). Returns a data-URL, or null if the weapon GLB isn't ready.
let _live = null;
function _ensureLive() {
  if (_live) return _live;
  const SIZE = 340;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  _studio(renderer, scene);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  _live = { renderer, scene, camera };
  return _live;
}

export function renderWeaponSkinned(weaponDef, skin) {
  if (!skin && WEAPONS.some(w => w.id === weaponDef?.id)) return '/assets/default-weapon-cards/' + weaponDef.id + '.png';
  if (skin?.thumbnail) return skin.thumbnail + (skin.model ? '?v=20261004-material-fit' : '');
  let built;
  try { built = buildWeaponModel(weaponDef); } catch { built = null; }
  if (!built) return null;
  const { renderer, scene, camera } = _ensureLive();
  const g = built.group;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  if (skin) {
    // Route by the skin's catalog shape: sword-catalog entries carry .blade;
    // the shared gun catalog (which the sword also wears) carries .body.
    if (skin.blade !== undefined) applySwordSkin(g, skin);
    else                          applyWeaponSkin(g, skin);
  }
  scene.add(g);
  // Some Blender-exported weapon models keep their mesh nodes positioned far
  // from the group's own origin (a leftover scene layout offset — e.g. props
  // laid out side-by-side in the source scene). Rotation must be applied
  // BEFORE measuring the centering box: rotating a large baked offset by even
  // a small angle displaces it by an amount proportional to its magnitude, so
  // centering computed pre-rotation leaves a large residual error once the
  // rotation is applied on top. Scale is likewise applied before the final
  // center measurement, for the same reason. This order keeps recentring
  // correct regardless of how far the model's authored offset sits — doing
  // it in the wrong order is negligible for guns (tiny baked offset) but
  // threw far-offset models like the sword completely out of frame.
  g.rotation.set(0.12, g.userData.modelSource === 'reference' ? Math.PI - 0.5 : -0.5, 0.04);
  const sz = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
  g.scale.setScalar(0.88 / maxDim);
  const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
  g.position.sub(c);
  // Camera distance derived from the FOV so a 0.88-unit model always fits
  // with margin, whatever its aspect (pistols used to clip the frame).
  _fitCamera(camera);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(g);
  disposeModel(g);
  return url;
}

export function warmWeaponThumbs(onReady) {
  if (onReady) _readyCallbacks.add(onReady);
  if (_warmed) {
    queueMicrotask(() => {
      _readyCallbacks.delete(onReady);
      onReady?.();
    });
    return;
  }
  if (_warming) return;
  _warming = true;
  // WeaponModels always has a procedural fallback, so probing
  // buildWeaponModel() does not tell us whether the GLBs have loaded. Wait for
  // the real loader signal and avoid rendering the whole armory during boot.
  onWeaponModelsReady(_generate);
  preloadWeaponModels();
}

function _disposeGroup(g) {
  disposeModel(g);
}

function _generateHudThumbs() {
  if (_hudGenerating || !_hudPending.size) return;
  _hudGenerating = true;
  const requested = [..._hudPending];
  _hudPending.clear();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (error) {
    _hudGenerating = false;
    console.warn('[weapon thumbnails] HUD renderer unavailable', error);
    const callbacks = [..._hudReadyCallbacks];
    _hudReadyCallbacks.clear();
    for (const cb of callbacks) cb();
    return;
  }
  const SIZE = 144;
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const disposeStudio = _studio(renderer, scene);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  let index = 0;

  const renderOne = (id) => {
    const weapon = WEAPONS.find((entry) => entry.id === id);
    if (!weapon || _hudCache.has(id)) return;
    let built;
    try { built = buildWeaponModel(weapon); } catch { built = null; }
    if (!built) return;
    const g = built.group;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(g);
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(1);
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    g.scale.setScalar(0.94 / maxDim);
    const center = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    g.position.sub(center);
    const distance = (0.5 * 0.94) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18;
    // Blades are broad on their X/Z face; the firearm +X profile sees only a
    // sword's 11mm edge and reduces it to a faint line. Give melee a near-top
    // three-quarter view so its blade, guard and hilt all read in the HUD.
    if (weapon.kind === 'melee') camera.position.set(distance * 0.12, distance, distance * 0.08);
    else                         camera.position.set(distance, distance * 0.10, 0);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    _hudCache.set(id, renderer.domElement.toDataURL('image/png'));
    scene.remove(g);
    _disposeGroup(g);
  };

  const schedule = (fn) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 120 });
    else setTimeout(() => fn(null), 0);
  };
  const pump = (deadline) => {
    const sliceStart = performance.now();
    do {
      const id = requested[index++];
      renderOne(id);
    } while (
      index < requested.length
      && (deadline?.timeRemaining?.() > 3 || performance.now() - sliceStart < 8)
    );
    if (index < requested.length) {
      schedule(pump);
      return;
    }
    disposeStudio();
    renderer.dispose();
    _hudGenerating = false;
    if (_hudPending.size) {
      _generateHudThumbs();
      return;
    }
    const callbacks = [..._hudReadyCallbacks];
    _hudReadyCallbacks.clear();
    for (const cb of callbacks) {
      try { cb(); } catch (error) { console.warn('[weapon thumbnails] HUD ready callback failed', error); }
    }
    for (const id of requested) {
      if (!hasLoadedWeaponModel(id)) continue;
      const upgrades = [...(_hudUpgradeCallbacks.get(id) || [])];
      _hudUpgradeCallbacks.delete(id);
      for (const cb of upgrades) {
        try { cb(); } catch (error) { console.warn('[weapon thumbnails] HUD upgrade callback failed', error); }
      }
    }
  };
  schedule(pump);
}

function _generate() {
  if (_generating || _warmed) return;
  _generating = true;
  const SIZE = 144;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const disposeStudio = _studio(renderer, scene);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  let weaponIndex = 0;

  const renderOne = (w) => {
    let built;
    try { built = buildWeaponModel(w); } catch { built = null; }
    if (!built) return;
    const g = built.group;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(g);

    // Rotate and scale BEFORE the final centering measurement (see the note in
    // renderWeaponSkinned — centering computed pre-rotation leaves a residual
    // offset once the rotation lands on top).
    g.rotation.set(0.12, g.userData.modelSource === 'reference' ? Math.PI - 0.5 : -0.5, 0.04);
    const sz = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
    g.scale.setScalar(0.88 / maxDim);
    const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    g.position.sub(c);

    _fitCamera(camera);
    renderer.render(scene, camera);
    _cache.set(w.id, renderer.domElement.toDataURL('image/png'));

    // The in-game inventory uses a clean side silhouette. Reset the model and
    // capture it from +X so the barrel/stock axis reads across the HUD slot.
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(1);
    const hudSize = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    const hudMaxDim = Math.max(hudSize.x, hudSize.y, hudSize.z) || 1;
    g.scale.setScalar(0.94 / hudMaxDim);
    const hudCenter = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    g.position.sub(hudCenter);
    const hudDistance = (0.5 * 0.94) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18;
    if (w.kind === 'melee') camera.position.set(hudDistance * 0.12, hudDistance, hudDistance * 0.08);
    else                    camera.position.set(hudDistance, hudDistance * 0.10, 0);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    _hudCache.set(w.id, renderer.domElement.toDataURL('image/png'));

    scene.remove(g);
    _disposeGroup(g);
  };

  // PNG encoding is CPU-heavy. Generate a small slice at a time so opening
  // the inventory cannot monopolize the main thread for a long frame.
  const schedule = (fn) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 120 });
    else setTimeout(() => fn(null), 0);
  };
  const pump = (deadline) => {
    const sliceStart = performance.now();
    do {
      renderOne(WEAPONS[weaponIndex++]);
    } while (
      weaponIndex < WEAPONS.length
      && (deadline?.timeRemaining?.() > 3 || performance.now() - sliceStart < 8)
    );

    if (weaponIndex < WEAPONS.length) {
      schedule(pump);
      return;
    }

    disposeStudio();
    renderer.dispose();
    _generating = false;
    _warming = false;
    _warmed = true;
    const callbacks = [..._readyCallbacks];
    _readyCallbacks.clear();
    for (const cb of callbacks) {
      try { cb(); } catch (error) { console.warn('[weapon thumbnails] ready callback failed', error); }
    }
  };
  schedule(pump);
}
