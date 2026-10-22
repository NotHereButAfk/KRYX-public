import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import { buildReferenceWeapon } from './ReferenceWeapons.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from './BlenderArsenal.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { metalNormalMap, metalRoughnessMap, polymerNormalMap } from './WeaponTextures.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildEvAutoRifle } from './EvAutoRifle.js';

// ── Blender GLB weapon loader ─────────────────────────────────────────────────
let _weaponTemplate = null, _weaponLoading = false;

// Per-weapon override GLBs — a dedicated Blender-authored model that supersedes
// the shared weapons.glb node for that weapon (smoother than the procedural or
// placeholder build). Each file has a node named `weapon_<id>`.
const WEAPON_GLB_OVERRIDES = { sidearm: '/sidearm.glb', ...BLENDER_ARSENAL };
const _overrideTemplates = new Map();   // id -> gltf.scene
// User-selected Quaternius Sci-Fi Modular Gun Pack (CC0). Each shipped firearm
// gets a complete authored model; categories without a one-to-one pack entry
// use the nearest readable silhouette (launchers use the grenade-launcher set).
export const QUATERNIUS_GUNS = Object.freeze({
  sidearm: 'Pistol_1', uzi: 'SMG_1', levershotgun: 'AR_2',
  m4: 'AR_1', m16: 'AR_3', rifle: 'AR_5', lmg: 'AR_6',
  rpg: 'Grenade_3', boltsniper: 'Sniper_1', magnum: 'Pistol_3',
  battlerifle: 'AR_4', needler: 'Crossbow_1', plasmarifle: 'SMG_2',
  dmr: 'Sniper_2', fuelrod: 'Grenade_1', concussion: 'Grenade_2',
  energyshotgun: 'Crossbow_2',
});
// The supplied pack's barrels point down local +X. Rotate that axis into the
// game's camera/world forward direction (-Z). Fallback muzzle markers are added
// after this transform so they cannot accidentally trigger a second 180° flip.
export const QUATERNIUS_FORWARD_YAW = Math.PI / 2;
export const QUATERNIUS_LENGTH = Object.freeze({
  sidearm: 0.30, uzi: 0.44, levershotgun: 0.82, m4: 0.89, m16: 1.07,
  rifle: 0.87, lmg: 0.98, rpg: 1.00, boltsniper: 0.92, magnum: 0.34,
  battlerifle: 0.98, needler: 0.54, plasmarifle: 0.65, dmr: 0.88,
  fuelrod: 0.73, concussion: 0.69, energyshotgun: 0.81,
});
const _quaterniusTemplates = new Map();
// Authored atlases — Blender-scripted real-firearm models for the whole
// arsenal (tools/model_arsenal.py). Searched before the legacy weapons.glb.
const AUTHORED_ATLASES = ['/weapons_authored.glb'];
const _authoredTemplates = [];

// Callbacks waiting on the GLB template (e.g. WeaponSystem swaps its
// procedural viewmodels for the detailed Blender guns once it arrives).
let _readyCallbacks = [];
let _allReady = false;
const _readyWeaponIds = new Set();
const _weaponReadyCallbacks = new Map();

function _fireWeaponReady(id) {
  if (!id || _readyWeaponIds.has(id)) return;
  _readyWeaponIds.add(id);
  const callbacks = _weaponReadyCallbacks.get(id) || [];
  _weaponReadyCallbacks.delete(id);
  for (const cb of callbacks) {
    try { cb(); } catch (error) { console.warn(`[WeaponGLB] ${id} ready cb failed:`, error); }
  }
}

// Procedural viewmodels and the camera both use -Z as "forward". Some Blender
// exports were authored down +Z; normalize that convention once at the asset
// boundary so the barrel, muzzle marker, sights, tracers, and both hands all
// agree everywhere else in the game.
export function orientWeaponModelForward(root, muzzle) {
  root.updateWorldMatrix(true, true);
  const muzzleInParent = muzzle.getWorldPosition(new THREE.Vector3());
  if (root.parent) root.parent.worldToLocal(muzzleInParent);
  const flipped = muzzleInParent.z > 0;
  if (flipped) root.rotation.y += Math.PI;
  root.updateWorldMatrix(true, true);
  return flipped;
}

function _fireReady() {
  _allReady = true;
  const cbs = _readyCallbacks; _readyCallbacks = [];
  for (const cb of cbs) { try { cb(); } catch (e) { console.warn('[WeaponGLB] ready cb failed:', e); } }
}

export function onWeaponModelsReady(cb) {
  if (_allReady) { cb(); return; }
  _readyCallbacks.push(cb);
}

// HUD thumbnails only need the equipped model, not the entire armory. Guns
// supplied by the external pack signal as soon as their own request settles;
// procedural melee/utility weapons are already canonical and can render now.
export function onWeaponModelReady(id, cb) {
  if ((!QUATERNIUS_GUNS[id] && !BLENDER_ARSENAL[id]) || _readyWeaponIds.has(id) || _allReady) {
    cb();
    return;
  }
  const callbacks = _weaponReadyCallbacks.get(id) || [];
  callbacks.push(cb);
  _weaponReadyCallbacks.set(id, callbacks);
}

export function hasLoadedWeaponModel(id) {
  if (BLENDER_ARSENAL[id]) return _overrideTemplates.has(id) || (_allReady && _quaterniusTemplates.has(id));
  return _overrideTemplates.has(id) || _quaterniusTemplates.has(id);
}

export function preloadWeaponModels() {
  if (_allReady || _weaponTemplate || _weaponLoading) return;
  _weaponLoading = true;
  const loader = new GLTFLoader();
  // main atlas + authored atlases + every override; fire ready only once all
  // settle so viewmodels rebuild with the best model in place (no flash)
  const jobs = isCrazyGames()
    ? Object.entries(BLENDER_ARSENAL).map(([id, url]) => [url, { kind: 'override', id }])
    : [
    ['/weapons.glb', { kind: 'main' }],
    ...AUTHORED_ATLASES.map((url) => [url, { kind: 'authored' }]),
    ...Object.entries(WEAPON_GLB_OVERRIDES).map(([id, url]) => [url, { kind: 'override', id }]),
    ...Object.entries(QUATERNIUS_GUNS).map(([id, model]) => [
      `/vendor/quaternius/scifi-weapons/${model}.gltf`, { kind: 'quaternius', id },
    ]),
  ];
  let pending = jobs.length;
  // A per-weapon callback must wait for both its preferred model and fallback.
  // Otherwise a fast fallback request permanently thumbnails the old M4.
  const pendingByWeapon = new Map();
  for (const [, tag] of jobs) {
    if (tag.id) pendingByWeapon.set(tag.id, (pendingByWeapon.get(tag.id) || 0) + 1);
  }
  const done = (tag) => {
    if (tag.id) {
      const remaining = pendingByWeapon.get(tag.id) - 1;
      pendingByWeapon.set(tag.id, remaining);
      if (remaining === 0) _fireWeaponReady(tag.id);
    }
    if (--pending === 0) { _weaponLoading = false; _fireReady(); }
  };
  for (const [url, tag] of jobs) {
    loader.load(url + (tag.kind === 'override' && BLENDER_ARSENAL[tag.id] && tag.id !== 'sword' ? `${url.includes('?') ? '&' : '?'}v=grips-5` : ''),
      (gltf) => {
        gltf.scene.traverse((o) => { if (o.isMesh) o.geometry.userData.shared = true; });
        if (tag.kind === 'quaternius') _quaterniusTemplates.set(tag.id, gltf.scene);
        else if (tag.kind === 'override') _overrideTemplates.set(tag.id, gltf.scene);
        else if (tag.kind === 'authored') _authoredTemplates.push(gltf.scene);
        else _weaponTemplate = gltf.scene;
        done(tag);
      },
      undefined,
      (err) => { console.warn(`[WeaponGLB] load failed (${url}):`, err.message); done(tag); }
    );
  }
}

// ── Illustrated ("reference chart") look for the authored guns ──────────────
// Flat cel shading: a shared stepped ramp makes lighting break into two/three
// bands like the chart's fills instead of a smooth PBR falloff.
let _toonRampTex = null;
function _toonRamp() {
  if (_toonRampTex) return _toonRampTex;
  const d = new Uint8Array([115, 185, 235, 255]);
  _toonRampTex = new THREE.DataTexture(d, 4, 1, THREE.RedFormat);
  _toonRampTex.minFilter = _toonRampTex.magFilter = THREE.NearestFilter;
  _toonRampTex.needsUpdate = true;
  return _toonRampTex;
}
function T(role, color, opts = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: _toonRamp() });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  m.userData.role = role;   // skins recolor by role, same as the PBR path
  return m;
}

// Dark contour outline — the chart's linework. Classic inverted hull: a
// slightly inflated back-face copy of the mesh, displaced along smoothed
// vertex normals so the silhouette gets a clean dark edge from every angle.
const _outlineGeoCache = new WeakMap();
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x272c33, side: THREE.BackSide });
OUTLINE_MAT.userData.shared = true;
function _outlineGeometry(src) {
  let g = _outlineGeoCache.get(src);
  if (g) return g;
  g = src.clone();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.deleteAttribute('tangent');
  g = mergeVertices(g, 1e-4);          // weld so corner normals average smoothly
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, t = 0.005;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  }
  _outlineGeoCache.set(src, g);
  g.userData.shared = true;
  return g;
}

function _buildFromGLB(weaponDef) {
  if (weaponDef.id === 'm4') {
    const original = buildEvAutoRifle(_overrideTemplates.get('m4'), weaponDef);
    if (original) return original;
  }
  const name = `weapon_${weaponDef.id}`;
  const supplied = _quaterniusTemplates.get(weaponDef.id) || null;
  let weaponRoot = supplied || _overrideTemplates.get(weaponDef.id)?.getObjectByName(name) || null;
  if (!weaponRoot) for (const t of _authoredTemplates) { weaponRoot = t.getObjectByName(name); if (weaponRoot) break; }
  if (!weaponRoot) weaponRoot = _weaponTemplate?.getObjectByName(name) || null;
  if (!weaponRoot) return null;

  const cloned = weaponRoot.clone(true);
  cloned.position.set(0, 0, 0);

  // The supplied pack is authored with muzzle-forward +X and real metre-scale
  // proportions. Rotate it into the game's -Z convention, then scale each gun
  // to the established gameplay silhouette so sniper/launcher assets do not
  // become body-sized in first person or in a soldier's hands.
  if (supplied) {
    cloned.rotation.y = QUATERNIUS_FORWARD_YAW;
    cloned.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(cloned);
    const rawSize = raw.getSize(new THREE.Vector3());
    const targetLength = QUATERNIUS_LENGTH[weaponDef.id] || 0.8;
    cloned.scale.setScalar(targetLength / Math.max(0.001, rawSize.z));
    cloned.updateMatrixWorld(true);
    const normalized = new THREE.Box3().setFromObject(cloned);
    const center = normalized.getCenter(new THREE.Vector3());
    cloned.position.set(-center.x, 0.06 - center.y, -center.z);
    cloned.userData.quaterniusModel = QUATERNIUS_GUNS[weaponDef.id];
  }

  const color = weaponDef.color ?? 0x2a2a2a;
  // Glow hue for the energy parts (default cyan). Main guns share one finish
  // (weaponDef.sciFi): realistic graphite polymer + steel — no colour tint on
  // the body, only the conduits/emitters glow, slightly brighter than usual.
  const eCol = weaponDef.energyColor ?? 0x2ee6ff;
  const sci  = weaponDef.sciFi === true;

  // Illustrated chart palette, cel-shaded: orange furniture (def.color), light
  // flat steel, a medium grey a notch darker so receivers/mags/scopes separate
  // from the barrels the way the chart's two greys do.
  const body  = T('body',  color);
  const metal = T('metal', 0xaab1b9);
  const dark  = T('accent', 0x757c85);
  const wood  = T('wood',   0x4a2e18);
  const blade = T('metal',  0xd0d8e0);
  const scope = T('special', 0x2a3038);
  // Glow parts: near-black base + emissive keeps the neon saturated instead
  // of washing out to white under ACES tone mapping.
  const eBase = new THREE.Color(eCol).multiplyScalar(0.12).getHex();
  const energy = T('energy', eBase, { emissive: eCol, emissiveIntensity: sci ? 1.3 : 1.2 });

  cloned.traverse(obj => {
    if (!obj.isMesh) return;
    const n = (obj.material?.name || '').toLowerCase();
    if (supplied) {
      if (n.includes('black')) obj.material = T('accent', 0x24292e);
      else if (n.includes('grey')) obj.material = T('metal', 0x707981);
      else if (n.includes('white')) obj.material = T('body', 0xd7dde0);
      else if (n.includes('main')) obj.material = T('accent', 0xd67822);
      else obj.material = T('body', 0xd7dde0);
      obj.castShadow = true;
      return;
    }
    if      (n.includes('dark_metal'))  obj.material = dark;
    else if (n.includes('energy'))      obj.material = energy;
    else if (n.includes('wood'))        obj.material = wood;
    else if (n.includes('blade'))       obj.material = blade;
    else if (n.includes('scope_glass')) obj.material = scope;
    else if (n.includes('rubber'))      obj.material = body;
    else if (n.includes('metal') || n.includes('brass')) obj.material = metal;
    else                                obj.material = body;
    obj.castShadow = true;
  });

  // GLB weapon meshes ship without UVs, so painted skin decals (the color map)
  // had nowhere to land and every decal skin showed as flat colour. Generate a
  // continuous box projection across the whole assembled gun so decals map onto
  // it as one wrap (faces stay a consistent size regardless of how the mesh is
  // split). Idempotent — geometries are shared across clones, so it runs once.
  _applyBoxUVs(cloned, 1.7, true);

  // Chart-style dark contour: attach an inverted-hull outline to each mesh.
  const outlineHosts = [];
  cloned.traverse(o => { if (o.isMesh && o.material !== OUTLINE_MAT) outlineHosts.push(o); });
  for (const o of outlineHosts) {
    const ol = new THREE.Mesh(_outlineGeometry(o.geometry), OUTLINE_MAT);
    ol.name = 'outline';
    ol.castShadow = false;
    o.add(ol);
  }

  // Find muzzle point (Blender auto-renames duplicates to muzzle_point.001 etc.)
  let muzzle = null;
  cloned.traverse(obj => { if (!muzzle && /^muzzle_point/.test(obj.name)) muzzle = obj; });

  if (!muzzle && !supplied) {
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.062, -0.32);
    cloned.add(muzzle);
  }

  // Authored markers can safely determine an atlas model's orientation. The
  // supplied pack has no marker, so its explicit +X→-Z transform is final.
  if (muzzle) orientWeaponModelForward(cloned, muzzle);

  const group = new THREE.Group();
  group.add(cloned);
  if (!muzzle) {
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.062, -(QUATERNIUS_LENGTH[weaponDef.id] || 0.8) * 0.52);
    group.add(muzzle);
  }
  group.userData.weaponId = weaponDef.id;
  group.userData.weaponKind = weaponDef.kind;
  group.userData.modelSource = supplied ? 'quaternius' : 'authored';
  return { group, muzzle };
}

// Box-project UVs across the whole gun (in the assembled root's local space) so
// a tiling decal reads as one continuous wrap. TILES = how many texture repeats
// span the gun's longest axis. Only fills meshes that lack UVs; safe to re-run.
const _boxUV = {
  box: new THREE.Box3(), size: new THREE.Vector3(), v: new THREE.Vector3(),
  n: new THREE.Vector3(), m: new THREE.Matrix4(), nm: new THREE.Matrix3(),
};
function _applyBoxUVs(root, TILES = 1.7, force = false) {
  root.updateWorldMatrix(true, true);
  const box = _boxUV.box.setFromObject(root);
  const size = box.getSize(_boxUV.size);
  const span = Math.max(size.x, size.y, size.z) || 1;
  const scale = TILES / span;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (g.userData.__boxUV) return;              // already projected (shared geo)
    // Without `force`, existing UVs are kept. The authored Blender guns DO
    // ship UVs — but they're primitive defaults (each box face = the full
    // texture) and bmesh-profile parts have degenerate (0,0) UVs that sample
    // a single texel, so decals showed as flat colour there. The authored
    // path forces the continuous box wrap instead.
    if (g.attributes.uv && !force) return;       // keep real authored UVs
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    o.updateWorldMatrix(true, false);
    const m = _boxUV.m.copy(root.matrixWorld).invert().multiply(o.matrixWorld);
    const nm = _boxUV.nm.getNormalMatrix(m);
    for (let i = 0; i < pos.count; i++) {
      const v = _boxUV.v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const n = _boxUV.n.fromBufferAttribute(nor, i).applyMatrix3(nm);
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let u, w;
      if (ax >= ay && ax >= az)      { u = v.z - box.min.z; w = v.y - box.min.y; }
      else if (ay >= ax && ay >= az) { u = v.x - box.min.x; w = v.z - box.min.z; }
      else                           { u = v.x - box.min.x; w = v.y - box.min.y; }
      uv[i * 2] = u * scale; uv[i * 2 + 1] = w * scale;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.userData.__boxUV = true;
  });
}

// ---------------------------------------------------------------------------
// Material helpers
// 'role' tags let the skin system recolor parts:
//   body   = main shell / polymer (skin-recolored)
//   accent = furniture, dark trim (skin-recolored)
//   metal  = barrels, rails, hardware (skin-recolored)
//   wood   = wooden parts (untouched)
//   special= optics, unique parts (untouched)
//
// Materials are MeshPhysicalMaterial: metal gets brushed scratches + anisotropy
// (directional sheen), polymer/furniture get a clearcoat so they read as a real
// coated surface rather than flat plastic.
// ---------------------------------------------------------------------------
function M(role, color, opts = {}) {
  const defaults = { roughness: 0.5, metalness: 0.5, envMapIntensity: 2.0 };
  const m = new THREE.MeshPhysicalMaterial({ color, ...defaults, ...opts });
  m.userData.role = role;

  if (role === 'metal') {
    m.normalMap = metalNormalMap();
    m.roughnessMap = metalRoughnessMap();
    m.normalScale = new THREE.Vector2(0.4, 0.4);
    m.anisotropy = 0.5;                 // brushed directional reflection
    m.clearcoat = 0.25;
    m.clearcoatRoughness = 0.3;
  } else if (role === 'body') {
    m.normalMap = polymerNormalMap();
    m.normalScale = new THREE.Vector2(0.2, 0.2);
    m.clearcoat = 0.55;                 // semi-gloss polymer coating
    m.clearcoatRoughness = 0.42;
  } else if (role === 'accent') {
    m.normalMap = polymerNormalMap();
    m.normalScale = new THREE.Vector2(0.14, 0.14);
    m.clearcoat = 0.35;
    m.clearcoatRoughness = 0.5;
  } else if (role === 'special') {
    m.clearcoat = 0.8;                  // glassy optics
    m.clearcoatRoughness = 0.1;
  }
  return m;
}

function addMuzzle(group, x, y, z) {
  const pt = new THREE.Object3D();
  pt.position.set(x, y, z);
  group.add(pt);
  return pt;
}

// Primitives ---------------------------------------------------------------
// Structural boxes get rounded/beveled edges so they catch light like a real
// machined part; tiny detail boxes stay sharp (and cheap).
function box(w, h, d, material) {
  const minD = Math.min(w, h, d);
  if (minD < 0.022) return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  const r = Math.min(minD * 0.16, minD * 0.48);
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), material);
}

function cyl(r1, r2, h, material, segs = 16, rotX = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, segs), material);
  m.rotation.x = rotX;
  return m;
}

function cone(r, h, material, segs = 12, rotX = -Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, segs), material);
  m.rotation.x = rotX;
  return m;
}

// Hex-nut-like knurled collar (row of small radial bumps around a cylinder).
function knurledCollar(group, mat, x, y, z, radius, count = 12) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const nub = box(0.01, 0.01, 0.018, mat);
    nub.position.set(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z);
    nub.rotation.z = a;
    group.add(nub);
  }
}

// Grid of small raised squares on a flat face — simulates grip stippling.
function stippleGrip(group, mat, cx, cy, cz, faceW, faceH, cols, rows) {
  const sw = faceW / cols * 0.45;
  const sh = faceH / rows * 0.45;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nub = box(sw, sh, 0.006, mat);
      nub.position.set(
        cx + (c / (cols - 1) - 0.5) * faceW * 0.8,
        cy + (r / (rows - 1) - 0.5) * faceH * 0.8,
        cz
      );
      group.add(nub);
    }
  }
}

// Evenly spaced slots along Z — M-LOK / vented handguard.
function railSlats(group, mat, count, x, y, zStart, zStep, w = 0.08, t = 0.012) {
  for (let i = 0; i < count; i++) {
    const slat = box(w, t, 0.03, mat);
    slat.position.set(x, y, zStart - i * zStep);
    group.add(slat);
  }
}

// Small Picatinny rail section (horizontal teeth on top of rail).
function picRail(group, mat, x, y, zStart, length, step = 0.028) {
  const count = Math.floor(length / step);
  for (let i = 0; i < count; i++) {
    const tooth = box(0.036, 0.01, 0.016, mat);
    tooth.position.set(x, y, zStart - i * step);
    group.add(tooth);
  }
}

// ===========================================================================
// PISTOLS
// ===========================================================================

// Pulse Pistol — clean light-grey faceted sci-fi Glock: long slide with a
// raised top rib and chamfered nose, bevelled frame + grip, dark cyan-lit
// barrel, and glowing cyan energy accents (sight dots, a bolt slash on the
// frame, grip charge lines + a base chevron). Default light finish is the skin.
function buildSidearm(color, def = {}) {
  const g = new THREE.Group();
  const eCol = def.energyColor ?? 0x50d4ff;
  const body  = M('body',   color ?? 0xd2cdc3, { roughness: 0.5,  metalness: 0.25 });   // light polymer frame/grip
  const slide = M('accent', 0xcac5bb,          { roughness: 0.42, metalness: 0.45 });   // slide, a hair cooler
  const metal = M('metal',  0x8a8f96,          { metalness: 0.9,  roughness: 0.28 });   // small steel bits
  const dark  = M('accent', 0x2e3238,          { roughness: 0.5,  metalness: 0.55 });   // muzzle / insets (dark grey, not black)
  const energy = M('energy', new THREE.Color(eCol).multiplyScalar(0.22).getHex(),
    { roughness: 0.2, metalness: 0.1, emissive: eCol, emissiveIntensity: 1.5 });

  // ── slide: main block + chamfer strips + raised top rib + angled nose ──
  const sl = box(0.078, 0.082, 0.38, slide); sl.position.set(0, 0.062, -0.05); g.add(sl);
  for (const sx of [-1, 1]) { const chamf = box(0.010, 0.024, 0.38, slide); chamf.position.set(sx * 0.036, 0.096, -0.05); chamf.rotation.z = sx * -0.5; g.add(chamf); }
  const topRib = box(0.030, 0.014, 0.36, slide); topRib.position.set(0, 0.106, -0.05); g.add(topRib);
  const nose = box(0.070, 0.070, 0.05, slide); nose.position.set(0, 0.058, -0.235); nose.rotation.x = -0.18; g.add(nose);
  // rear + front cocking serrations
  for (let i = 0; i < 6; i++) { const s = box(0.082, 0.066, 0.006, dark); s.position.set(0, 0.062, 0.075 + i * 0.015); g.add(s); }
  for (let i = 0; i < 4; i++) { const s = box(0.082, 0.056, 0.006, dark); s.position.set(0, 0.058, -0.175 + i * 0.015); g.add(s); }
  // ejection port
  const ej = box(0.006, 0.036, 0.075, dark); ej.position.set(0.040, 0.072, -0.085); g.add(ej);

  // ── frame: bevelled block + accessory rail + takedown pin ──
  const frame = box(0.070, 0.052, 0.30, body); frame.position.set(0, 0.004, -0.03); g.add(frame);
  const frameBevelF = box(0.062, 0.030, 0.05, body); frameBevelF.position.set(0, -0.014, -0.16); frameBevelF.rotation.x = 0.4; g.add(frameBevelF);
  const rail = box(0.048, 0.014, 0.13, dark); rail.position.set(0, -0.024, -0.11); g.add(rail);
  for (let i = 0; i < 4; i++) { const tooth = box(0.050, 0.006, 0.010, metal); tooth.position.set(0, -0.014, -0.065 - i * 0.026); g.add(tooth); }
  const pin = cyl(0.008, 0.008, 0.080, metal, 12, 0); pin.rotation.z = Math.PI / 2; pin.position.set(0, 0.000, -0.05); g.add(pin);

  // ── grip: bevelled panels + stipple ──
  const grip = box(0.074, 0.20, 0.098, body); grip.position.set(0, -0.115, 0.105); grip.rotation.x = 0.2; g.add(grip);
  for (const sx of [-1, 1]) { const panel = box(0.010, 0.15, 0.070, body); panel.position.set(sx * 0.036, -0.11, 0.105); panel.rotation.z = sx * -0.35; panel.rotation.x = 0.2; g.add(panel); }
  stippleGrip(g, dark, 0.038, -0.10, 0.070, 0.0, 0.14, 3, 5);
  const magBase = box(0.078, 0.020, 0.10, dark); magBase.position.set(0, -0.215, 0.140); magBase.rotation.x = 0.2; g.add(magBase);

  // ── angular trigger guard ──
  const tgBot = box(0.050, 0.014, 0.10, body); tgBot.position.set(0, -0.050, 0.02); g.add(tgBot);
  const tgFront = box(0.050, 0.044, 0.014, body); tgFront.position.set(0, -0.028, -0.028); tgFront.rotation.x = -0.25; g.add(tgFront);
  const trig = box(0.014, 0.044, 0.016, metal); trig.position.set(0, -0.022, 0.008); g.add(trig);

  // ── dark barrel with a cyan-lit chamber, poking through the nose ──
  const barrel = cyl(0.016, 0.015, 0.075, dark, 14); barrel.position.set(0, 0.060, -0.255); g.add(barrel);
  const crown = cyl(0.018, 0.019, 0.012, dark, 14); crown.position.set(0, 0.060, -0.290); g.add(crown);
  const bore = cyl(0.010, 0.012, 0.010, energy, 12); bore.position.set(0, 0.060, -0.295); g.add(bore);

  // ── iron sights with glowing cyan dots ──
  const sightR = box(0.024, 0.016, 0.016, dark); sightR.position.set(0, 0.120, 0.10); g.add(sightR);
  for (const sx of [-1, 1]) { const d = box(0.004, 0.005, 0.004, energy); d.position.set(sx * 0.008, 0.124, 0.104); g.add(d); }
  const sightF = box(0.010, 0.016, 0.010, dark); sightF.position.set(0, 0.120, -0.20); g.add(sightF);
  const fDot = box(0.005, 0.006, 0.004, energy); fDot.position.set(0, 0.126, -0.204); g.add(fDot);

  // ── cyan energy accents (the skin's signature glow) ──
  // a lightning-bolt slash on each frame flank above the trigger
  for (const sx of [-1, 1]) {
    const b1 = box(0.004, 0.010, 0.030, energy); b1.position.set(sx * 0.036, 0.014, -0.005); b1.rotation.x = 0.7; g.add(b1);
    const b2 = box(0.004, 0.010, 0.026, energy); b2.position.set(sx * 0.036, 0.002, 0.020); b2.rotation.x = -0.6; g.add(b2);
  }
  // a big cyan chevron mid-grip (the skin's signature) + charge dashes at the base
  for (const sx of [-1, 1]) {
    const cvU = box(0.004, 0.008, 0.030, energy); cvU.position.set(sx * 0.035, -0.090, 0.095); cvU.rotation.x = 0.9; g.add(cvU);
    const cvL = box(0.004, 0.008, 0.030, energy); cvL.position.set(sx * 0.035, -0.118, 0.100); cvL.rotation.x = -0.4; g.add(cvL);
    const l1 = box(0.004, 0.006, 0.030, energy); l1.position.set(sx * 0.035, -0.168, 0.152); l1.rotation.x = 0.2; g.add(l1);
    const l2 = box(0.004, 0.006, 0.030, energy); l2.position.set(sx * 0.035, -0.192, 0.157); l2.rotation.x = 0.2; g.add(l2);
  }
  // slide-side energy vent line
  for (const sx of [-1, 1]) { const v = box(0.004, 0.008, 0.10, energy); v.position.set(sx * 0.040, 0.040, -0.03); g.add(v); }

  const muzzle = addMuzzle(g, 0, 0.060, -0.31);
  return { group: g, muzzle };
}

function _buildGlock_REMOVED(color) {
  const g = new THREE.Group();
  const frame  = M('body',   color,    { roughness: 0.72, metalness: 0.12 });
  const slide  = M('accent', 0x141619, { roughness: 0.38, metalness: 0.68 });
  const metal  = M('metal',  0x6c7177, { metalness: 0.85, roughness: 0.25 });
  const dark   = M('accent', 0x0d0e10, { roughness: 0.6,  metalness: 0.15 });

  // Slide
  const sl = box(0.076, 0.092, 0.38, slide);
  sl.position.set(0, 0.072, -0.04);
  g.add(sl);

  // Rear slide serrations
  for (let i = 0; i < 7; i++) {
    const s = box(0.080, 0.074, 0.007, metal);
    s.position.set(0, 0.072, 0.07 + i * 0.016);
    g.add(s);
  }

  // Front serrations
  for (let i = 0; i < 4; i++) {
    const s = box(0.080, 0.06, 0.007, metal);
    s.position.set(0, 0.072, -0.2 + i * 0.016);
    g.add(s);
  }

  // Slide top flat rib
  const rib = box(0.022, 0.008, 0.36, dark);
  rib.position.set(0, 0.12, -0.04);
  g.add(rib);

  // Sights
  const sR = box(0.026, 0.016, 0.02, metal);
  sR.position.set(0, 0.126, 0.13);
  g.add(sR);
  const sF = box(0.012, 0.018, 0.014, metal);
  sF.position.set(0, 0.128, -0.19);
  g.add(sF);

  // Ejection port
  const ej = box(0.004, 0.038, 0.09, dark);
  ej.position.set(0.040, 0.075, -0.04);
  g.add(ej);

  // Frame
  const fr = box(0.070, 0.058, 0.34, frame);
  fr.position.set(0, 0.002, -0.02);
  g.add(fr);

  // Dust cover rail
  const dcRail = box(0.048, 0.018, 0.16, dark);
  dcRail.position.set(0, -0.024, -0.08);
  g.add(dcRail);
  for (let i = 0; i < 5; i++) {
    const tooth = box(0.050, 0.007, 0.011, metal);
    tooth.position.set(0, -0.014, -0.04 - i * 0.022);
    g.add(tooth);
  }

  // Grip
  const grip = box(0.076, 0.225, 0.1, frame);
  grip.position.set(0, -0.128, 0.1);
  grip.rotation.x = 0.15;
  g.add(grip);
  stippleGrip(g, dark, 0.040, -0.12, 0.052, 0.0, 0.18, 5, 7);

  // Trigger guard
  const tgBot = box(0.056, 0.015, 0.1, frame);
  tgBot.position.set(0, -0.048, 0.01);
  g.add(tgBot);
  const tgF = box(0.056, 0.042, 0.015, frame);
  tgF.position.set(0, -0.023, -0.04);
  g.add(tgF);

  // Trigger
  const trig = box(0.014, 0.048, 0.016, slide);
  trig.position.set(0, -0.018, 0.01);
  g.add(trig);

  // Barrel
  const barrel = cyl(0.014, 0.013, 0.06, metal);
  barrel.position.set(0, 0.072, -0.27);
  g.add(barrel);

  // Takedown lever
  const tdl = box(0.04, 0.012, 0.022, metal);
  tdl.position.set(0, -0.002, -0.04);
  g.add(tdl);

  const muzzle = addMuzzle(g, 0, 0.072, -0.32);
  return { group: g, muzzle };
}

// ===========================================================================
// SMGs
// ===========================================================================

function buildSMG(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.55, metalness: 0.38 });
  const dark  = M('accent', 0x111318, { roughness: 0.65, metalness: 0.2  });
  const metal = M('metal',  0x72787f, { metalness: 0.82, roughness: 0.28 });

  // Lower receiver
  const lower = box(0.095, 0.09, 0.38, body);
  lower.position.set(0, 0.02, 0.0);
  g.add(lower);

  // Upper receiver
  const upper = box(0.088, 0.075, 0.38, dark);
  upper.position.set(0, 0.108, 0.0);
  g.add(upper);

  // Top rail
  const rail = box(0.038, 0.018, 0.32, metal);
  rail.position.set(0, 0.152, 0.02);
  g.add(rail);
  picRail(g, dark, 0, 0.162, 0.14, 0.3);

  // Magazine
  const mag = box(0.058, 0.22, 0.08, dark);
  mag.position.set(0, -0.13, -0.04);
  mag.rotation.x = -0.14;
  g.add(mag);
  // Mag grip marks
  for (let i = 0; i < 3; i++) {
    const mk = box(0.062, 0.006, 0.035, metal);
    mk.position.set(0, -0.06 - i * 0.04, -0.04);
    g.add(mk);
  }

  // Pistol grip
  const grip = box(0.068, 0.18, 0.08, dark);
  grip.position.set(0, -0.092, 0.12);
  grip.rotation.x = 0.28;
  g.add(grip);
  stippleGrip(g, metal, 0.036, -0.09, 0.082, 0.0, 0.14, 4, 5);

  // Collapsible stock
  const stockTube = cyl(0.022, 0.022, 0.2, dark);
  stockTube.position.set(0, 0.04, 0.3);
  g.add(stockTube);
  const stockPlate = box(0.068, 0.12, 0.022, dark);
  stockPlate.position.set(0, 0.028, 0.41);
  g.add(stockPlate);
  const stockBrace = box(0.026, 0.008, 0.2, metal);
  stockBrace.position.set(0, 0.09, 0.3);
  g.add(stockBrace);

  // Barrel
  const barrel = cyl(0.019, 0.017, 0.26, metal);
  barrel.position.set(0, 0.05, -0.38);
  g.add(barrel);
  // Flash hider
  const fh = cyl(0.025, 0.019, 0.05, dark);
  fh.position.set(0, 0.05, -0.535);
  g.add(fh);
  // 3-prong cuts on flash hider
  for (let i = 0; i < 3; i++) {
    const prong = box(0.006, 0.022, 0.032, dark);
    prong.position.set(Math.sin(i / 3 * Math.PI * 2) * 0.018, 0.05 + Math.cos(i / 3 * Math.PI * 2) * 0.018, -0.55);
    g.add(prong);
  }

  // Charging handle
  const ch = box(0.022, 0.018, 0.04, metal);
  ch.position.set(0.05, 0.152, 0.14);
  g.add(ch);

  const muzzle = addMuzzle(g, 0, 0.05, -0.565);
  return { group: g, muzzle };
}

// Uzi — stamped steel receiver, pistol-grip mag, folding wire stock.
function buildUzi(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.42, metalness: 0.6  });
  const dark  = M('accent', 0x0e1013, { roughness: 0.58, metalness: 0.22 });
  const metal = M('metal',  0x6c7177, { metalness: 0.82, roughness: 0.28 });

  // Receiver — tall boxy stamped steel
  const recv = box(0.108, 0.135, 0.31, body);
  recv.position.set(0, 0.05, 0.0);
  g.add(recv);

  // Ribbed top cover
  for (let i = 0; i < 5; i++) {
    const rib = box(0.06, 0.01, 0.27, dark);
    rib.position.set(0, 0.12 + i * 0.001, 0.0);
    g.add(rib);
  }

  // Ejection port slot
  const ej = box(0.004, 0.05, 0.1, dark);
  ej.position.set(0.056, 0.05, -0.04);
  g.add(ej);

  // Barrel + barrel nut
  const barrel = cyl(0.019, 0.019, 0.17, metal);
  barrel.position.set(0, 0.05, -0.23);
  g.add(barrel);
  const bNut = cyl(0.03, 0.03, 0.04, body);
  bNut.position.set(0, 0.05, -0.17);
  g.add(bNut);
  knurledCollar(g, metal, 0, 0.05, -0.17, 0.036, 10);

  // Pistol grip (mag goes inside)
  const grip = box(0.083, 0.165, 0.098, dark);
  grip.position.set(0, -0.06, 0.04);
  g.add(grip);
  const mag = box(0.048, 0.24, 0.072, dark);
  mag.position.set(0, -0.22, 0.04);
  g.add(mag);
  // Mag witness holes
  for (let i = 0; i < 4; i++) {
    const wh = box(0.052, 0.01, 0.022, metal);
    wh.position.set(0, -0.11 - i * 0.03, 0.04);
    g.add(wh);
  }

  // Trigger guard
  const tgB = box(0.052, 0.013, 0.09, body);
  tgB.position.set(0, -0.036, -0.04);
  g.add(tgB);
  const tgF = box(0.052, 0.04, 0.013, body);
  tgF.position.set(0, -0.018, -0.09);
  g.add(tgF);
  const trig = box(0.016, 0.045, 0.018, metal);
  trig.position.set(0, -0.014, -0.04);
  g.add(trig);

  // Wire folding stock (2 arms + buttplate)
  const wireL = box(0.009, 0.009, 0.24, metal);
  wireL.position.set(-0.042, 0.08, 0.28);
  g.add(wireL);
  const wireR = box(0.009, 0.009, 0.24, metal);
  wireR.position.set(0.042, 0.08, 0.28);
  g.add(wireR);
  const butt = box(0.105, 0.065, 0.013, metal);
  butt.position.set(0, 0.08, 0.41);
  g.add(butt);

  const muzzle = addMuzzle(g, 0, 0.05, -0.33);
  return { group: g, muzzle };
}

// ===========================================================================
// SHOTGUNS
// ===========================================================================

function buildShotgun(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.62, metalness: 0.2  });
  const dark  = M('accent', 0x14161a, { roughness: 0.68, metalness: 0.15 });
  const metal = M('metal',  0x72787f, { metalness: 0.82, roughness: 0.28 });
  const wood  = M('wood',   0x6b3e20, { roughness: 0.72, metalness: 0.05 });

  // Main barrel
  const barrel = cyl(0.031, 0.029, 0.58, metal);
  barrel.position.set(0, 0.075, -0.2);
  g.add(barrel);
  // Magazine tube under barrel
  const tube = cyl(0.019, 0.019, 0.52, metal);
  tube.position.set(0, 0.032, -0.18);
  g.add(tube);
  // Barrel-to-tube brace rings
  for (let i = 0; i < 3; i++) {
    const ring = cyl(0.038, 0.038, 0.018, dark);
    ring.position.set(0, 0.056, -0.06 - i * 0.16);
    g.add(ring);
  }

  // Pump forend (wood)
  const pump = box(0.082, 0.078, 0.22, wood);
  pump.position.set(0, 0.038, -0.2);
  g.add(pump);
  for (let i = 0; i < 5; i++) {
    const groove = box(0.086, 0.012, 0.008, dark);
    groove.position.set(0, 0.078, -0.14 - i * 0.036);
    g.add(groove);
  }

  // Receiver
  const recv = box(0.088, 0.105, 0.22, body);
  recv.position.set(0, 0.055, 0.06);
  g.add(recv);
  // Ejection port
  const ej = box(0.004, 0.055, 0.09, dark);
  ej.position.set(0.046, 0.072, 0.04);
  g.add(ej);
  // Loading port
  const lp = box(0.006, 0.03, 0.06, dark);
  lp.position.set(0, -0.015, 0.08);
  g.add(lp);

  // Wood stock
  const stock = box(0.068, 0.11, 0.32, wood);
  stock.position.set(0, 0.025, 0.34);
  stock.rotation.x = -0.07;
  g.add(stock);
  const buttplate = box(0.074, 0.135, 0.02, dark);
  buttplate.position.set(0, 0.022, 0.5);
  g.add(buttplate);

  // Pistol grip
  const grip = box(0.068, 0.175, 0.078, wood);
  grip.position.set(0, -0.088, 0.14);
  grip.rotation.x = 0.28;
  g.add(grip);

  // Trigger guard + trigger
  const tgB = box(0.055, 0.013, 0.095, dark);
  tgB.position.set(0, -0.042, 0.1);
  g.add(tgB);
  const trig = box(0.014, 0.045, 0.016, metal);
  trig.position.set(0, -0.018, 0.1);
  g.add(trig);

  // Bead front sight
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), metal);
  bead.position.set(0, 0.085, -0.47);
  g.add(bead);

  const muzzle = addMuzzle(g, 0, 0.075, -0.5);
  return { group: g, muzzle };
}

// Lever-action shotgun
function buildLeverShotgun(color) {
  const g = new THREE.Group();
  const wood  = M('wood',   0x8b5c2a, { roughness: 0.68, metalness: 0.06 });
  const dark  = M('accent', 0x12141a, { roughness: 0.58, metalness: 0.3  });
  const metal = M('metal',  0x6e7479, { metalness: 0.84, roughness: 0.26 });

  // Receiver
  const recv = box(0.082, 0.135, 0.24, dark);
  recv.position.set(0, 0.052, 0.05);
  g.add(recv);
  // Receiver side-plate detail
  const sp = box(0.004, 0.1, 0.2, metal);
  sp.position.set(0.043, 0.055, 0.04);
  g.add(sp);

  // Barrel
  const barrel = cyl(0.026, 0.024, 0.52, metal);
  barrel.position.set(0, 0.082, -0.32);
  g.add(barrel);
  // Magazine tube
  const tube = cyl(0.017, 0.017, 0.46, metal);
  tube.position.set(0, 0.034, -0.3);
  g.add(tube);

  // Forend (dark polymer with M-LOK slots)
  const forend = box(0.068, 0.062, 0.26, dark);
  forend.position.set(0, 0.04, -0.22);
  g.add(forend);
  railSlats(g, metal, 4, 0, 0.075, -0.12, 0.065, 0.072, 0.01);

  // Wood stock
  const stock = box(0.068, 0.122, 0.35, wood);
  stock.position.set(0, 0.022, 0.34);
  stock.rotation.x = -0.055;
  g.add(stock);
  const buttplate = box(0.072, 0.145, 0.02, metal);
  buttplate.position.set(0, 0.018, 0.52);
  g.add(buttplate);

  // Pistol grip (wood)
  const grip = box(0.062, 0.16, 0.075, wood);
  grip.position.set(0, -0.078, 0.16);
  grip.rotation.x = 0.24;
  g.add(grip);

  // Lever loop (3-piece)
  const leverFront = box(0.018, 0.11, 0.018, metal);
  leverFront.position.set(0, -0.072, 0.02);
  g.add(leverFront);
  const leverBottom = box(0.018, 0.018, 0.13, metal);
  leverBottom.position.set(0, -0.128, 0.08);
  g.add(leverBottom);
  const leverBack = box(0.018, 0.08, 0.018, metal);
  leverBack.position.set(0, -0.082, 0.15);
  g.add(leverBack);
  const leverBridge = box(0.018, 0.018, 0.04, metal);
  leverBridge.position.set(0, -0.038, 0.01);
  g.add(leverBridge);

  // Muzzle brake
  const mb = cyl(0.03, 0.022, 0.04, metal);
  mb.position.set(0, 0.082, -0.6);
  g.add(mb);

  // Bead front sight
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), metal);
  bead.position.set(0, 0.098, -0.54);
  g.add(bead);

  const muzzle = addMuzzle(g, 0, 0.082, -0.625);
  return { group: g, muzzle };
}

// ===========================================================================
// RIFLES
// ===========================================================================

function buildRifle(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.55, metalness: 0.32 });
  const dark  = M('accent', 0x13151a, { roughness: 0.62, metalness: 0.2  });
  const metal = M('metal',  0x80868e, { metalness: 0.78, roughness: 0.3  });

  // Receivers
  const upper = box(0.085, 0.075, 0.42, dark);
  upper.position.set(0, 0.09, 0.0);
  g.add(upper);
  const lower = box(0.082, 0.075, 0.4, body);
  lower.position.set(0, 0.02, 0.0);
  g.add(lower);

  // Dust cover
  const dc = box(0.06, 0.018, 0.11, metal);
  dc.position.set(0, 0.018, -0.04);
  g.add(dc);

  // Picatinny top rail
  const rail = box(0.038, 0.02, 0.36, metal);
  rail.position.set(0, 0.138, -0.01);
  g.add(rail);
  picRail(g, dark, 0, 0.15, 0.14, 0.36);

  // Magazine
  const mag = box(0.058, 0.245, 0.09, dark);
  mag.position.set(0, -0.14, -0.06);
  mag.rotation.x = -0.18;
  g.add(mag);
  for (let i = 0; i < 4; i++) {
    const w = box(0.062, 0.008, 0.038, metal);
    w.position.set(0, -0.07 - i * 0.038, -0.06);
    g.add(w);
  }

  // Pistol grip
  const grip = box(0.068, 0.175, 0.08, dark);
  grip.position.set(0, -0.1, 0.15);
  grip.rotation.x = 0.3;
  g.add(grip);
  stippleGrip(g, metal, 0.036, -0.1, 0.082, 0.0, 0.14, 4, 5);

  // Fixed stock
  const stock = box(0.068, 0.095, 0.28, dark);
  stock.position.set(0, 0.038, 0.34);
  g.add(stock);
  const butt = box(0.072, 0.12, 0.022, dark);
  butt.position.set(0, 0.038, 0.48);
  g.add(butt);

  // Barrel
  const barrel = cyl(0.019, 0.016, 0.35, metal);
  barrel.position.set(0, 0.068, -0.42);
  g.add(barrel);
  // Gas block
  const gb = box(0.032, 0.03, 0.04, dark);
  gb.position.set(0, 0.068, -0.3);
  g.add(gb);
  // Gas tube
  const gtube = cyl(0.007, 0.007, 0.28, metal);
  gtube.position.set(0, 0.11, -0.17);
  g.add(gtube);
  // Flash hider
  const fh = cyl(0.024, 0.018, 0.055, dark);
  fh.position.set(0, 0.068, -0.61);
  g.add(fh);

  // Charging handle
  const ch = box(0.024, 0.016, 0.04, metal);
  ch.position.set(0, 0.138, 0.12);
  g.add(ch);

  const muzzle = addMuzzle(g, 0, 0.068, -0.645);
  return { group: g, muzzle };
}

// M4 carbine — flat-top upper, free-float M-LOK handguard, collapsible stock.
function buildM4(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.58, metalness: 0.28 });
  const dark  = M('accent', 0x101318, { roughness: 0.6,  metalness: 0.22 });
  const metal = M('metal',  0x80868e, { metalness: 0.75, roughness: 0.32 });

  // Upper receiver
  const upper = box(0.082, 0.08, 0.36, dark);
  upper.position.set(0, 0.092, 0.04);
  g.add(upper);
  // Lower receiver
  const lower = box(0.082, 0.07, 0.32, body);
  lower.position.set(0, 0.022, 0.04);
  g.add(lower);

  // M-LOK handguard
  const hg = box(0.072, 0.082, 0.46, dark);
  hg.position.set(0, 0.075, -0.32);
  g.add(hg);
  railSlats(g, metal, 6, 0, 0.12, -0.14, 0.072, 0.08);
  // Side slots
  railSlats(g, metal, 4, 0.038, 0.068, -0.16, 0.09, 0.007, 0.038);
  railSlats(g, metal, 4, -0.038, 0.068, -0.16, 0.09, 0.007, 0.038);

  // Picatinny top rail
  const topRail = box(0.038, 0.02, 0.78, metal);
  topRail.position.set(0, 0.14, -0.15);
  g.add(topRail);
  picRail(g, dark, 0, 0.152, 0.18, 0.78);

  // Front sight post (flip-up)
  const fsb = box(0.03, 0.055, 0.028, dark);
  fsb.position.set(0, 0.158, -0.56);
  g.add(fsb);
  const fsp = cyl(0.006, 0.006, 0.038, metal, 8, 0);
  fsp.position.set(0, 0.19, -0.56);
  g.add(fsp);

  // Barrel
  const barrel = cyl(0.016, 0.015, 0.22, metal);
  barrel.position.set(0, 0.075, -0.62);
  g.add(barrel);
  // Gas block
  const gb = box(0.03, 0.03, 0.04, dark);
  gb.position.set(0, 0.075, -0.52);
  g.add(gb);
  // Gas tube
  const gtube = cyl(0.007, 0.007, 0.44, metal);
  gtube.position.set(0, 0.118, -0.37);
  g.add(gtube);
  // Flash hider (A2 birdcage)
  const fhBase = cyl(0.022, 0.016, 0.055, dark);
  fhBase.position.set(0, 0.075, -0.74);
  g.add(fhBase);
  for (let i = 0; i < 5; i++) {
    const slot = box(0.005, 0.012, 0.04, metal);
    slot.position.set(Math.cos(i / 5 * Math.PI * 2) * 0.02, 0.075 + Math.sin(i / 5 * Math.PI * 2) * 0.02, -0.74);
    g.add(slot);
  }

  // Magazine — PMAG style with curved polymer
  const mag = box(0.054, 0.268, 0.088, body);
  mag.position.set(0, -0.136, 0.03);
  mag.rotation.x = -0.12;
  g.add(mag);
  const magFloor = box(0.058, 0.02, 0.092, dark);
  magFloor.position.set(0, -0.276, 0.03);
  g.add(magFloor);
  for (let i = 0; i < 3; i++) {
    const w = box(0.058, 0.007, 0.04, metal);
    w.position.set(0, -0.1 - i * 0.042, 0.03);
    g.add(w);
  }

  // Pistol grip
  const grip = box(0.068, 0.17, 0.082, dark);
  grip.position.set(0, -0.092, 0.2);
  grip.rotation.x = 0.3;
  g.add(grip);
  stippleGrip(g, metal, 0.036, -0.09, 0.084, 0.0, 0.14, 4, 5);

  // Buffer tube
  const btube = cyl(0.025, 0.025, 0.22, dark);
  btube.position.set(0, 0.062, 0.32);
  g.add(btube);
  knurledCollar(g, metal, 0, 0.062, 0.22, 0.03, 10);

  // Collapsible stock
  const stockBody = box(0.072, 0.135, 0.13, dark);
  stockBody.position.set(0, 0.03, 0.38);
  g.add(stockBody);
  const stockCheek = box(0.06, 0.02, 0.12, dark);
  stockCheek.position.set(0, 0.1, 0.38);
  g.add(stockCheek);

  // Bolt catch, mag release, selector (detail bumps)
  const bc = box(0.005, 0.018, 0.032, metal);
  bc.position.set(-0.043, 0.04, 0.06);
  g.add(bc);
  const sel = cyl(0.01, 0.01, 0.012, metal, 8, 0);
  sel.position.set(-0.043, 0.034, 0.14);
  g.add(sel);

  const muzzle = addMuzzle(g, 0, 0.075, -0.77);
  return { group: g, muzzle };
}

// AR-10 .308 — beefier M4 variant, 20-rd PMAG, red dot optic.
function buildAR10(color, def = {}) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.55, metalness: 0.3  });
  const dark  = M('accent', 0x0f1116, { roughness: 0.6,  metalness: 0.22 });
  const metal = M('metal',  0x7c8289, { metalness: 0.76, roughness: 0.3  });
  const glass = M('special', 0x163b2a, { metalness: 0.15, roughness: 0.1,
                                         emissive: 0x0a2a1c, emissiveIntensity: 0.2 });
  // sci-fi energy accents (the DMR uses this builder — it lives in a sci-fi
  // arsenal, so it carries glowing tech details like the rest)
  const eCol = def.energyColor ?? 0x2ee6ff;
  const energy = M('energy', new THREE.Color(eCol).multiplyScalar(0.12).getHex(),
    { roughness: 0.2, metalness: 0.1, emissive: eCol, emissiveIntensity: 3.0 });

  // Upper + lower receivers
  const upper = box(0.078, 0.070, 0.4, dark);
  upper.position.set(0, 0.098, 0.06);
  g.add(upper);
  const lower = box(0.078, 0.062, 0.38, body);
  lower.position.set(0, 0.032, 0.06);
  g.add(lower);

  // M-LOK handguard (longer/beefier)
  const hg = box(0.070, 0.078, 0.52, dark);
  hg.position.set(0, 0.084, -0.36);
  g.add(hg);
  railSlats(g, metal, 7, 0, 0.126, -0.16, 0.058, 0.09);
  railSlats(g, metal, 5, 0.037, 0.078, -0.18, 0.086, 0.007, 0.04);

  // Top rail
  const topRail = box(0.040, 0.020, 0.88, metal);
  topRail.position.set(0, 0.142, -0.19);
  g.add(topRail);
  picRail(g, dark, 0, 0.155, 0.22, 0.88);

  // Red-dot optic (Aimpoint-style) — tube lies along the bore axis
  const base = box(0.052, 0.042, 0.115, dark);
  base.position.set(0, 0.172, 0.03);
  g.add(base);
  const tube = cyl(0.032, 0.032, 0.105, dark, 16);
  tube.position.set(0, 0.216, 0.03);
  g.add(tube);
  const lens1 = cyl(0.028, 0.028, 0.012, glass, 16);
  lens1.position.set(0, 0.216, -0.028);
  g.add(lens1);
  const lens2 = cyl(0.028, 0.028, 0.012, glass, 16);
  lens2.position.set(0, 0.216, 0.088);
  g.add(lens2);
  const adjKnob = cyl(0.01, 0.01, 0.03, metal, 8, 0);
  adjKnob.position.set(0, 0.252, 0.03);
  g.add(adjKnob);
  // glowing holo reticle visible in the rear lens
  const reticle = cyl(0.012, 0.012, 0.006, energy, 10);
  reticle.position.set(0, 0.216, 0.082);
  // Declared aim point: the optical axis of the scope. Without it the viewmodel
  // infers the sight from the highest point on the weapon, which here is the
  // elevation turret 5cm above the reticle.
  const sightPoint = new THREE.Object3D();
  sightPoint.name = 'sight_point';
  sightPoint.position.set(0, 0.216, 0.082);
  g.add(sightPoint);
  g.add(reticle);

  // Barrel (heavier .308 profile)
  const barrel = cyl(0.023, 0.021, 0.24, metal);
  barrel.position.set(0, 0.078, -0.72);
  g.add(barrel);
  // Muzzle brake + energy emitter ring
  const mbBody = cyl(0.032, 0.028, 0.076, dark);
  mbBody.position.set(0, 0.078, -0.878);
  g.add(mbBody);
  for (let i = 0; i < 3; i++) {
    const port = box(0.007, 0.022, 0.018, metal);
    port.position.set(Math.cos(i / 3 * Math.PI * 2) * 0.028, 0.078 + Math.sin(i / 3 * Math.PI * 2) * 0.028, -0.87);
    g.add(port);
  }
  const mbEmit = cyl(0.018, 0.022, 0.014, energy, 12);
  mbEmit.position.set(0, 0.078, -0.912);
  g.add(mbEmit);
  // energy conduits along the handguard sides
  for (const sx of [-1, 1]) { const c = box(0.006, 0.008, 0.42, energy); c.position.set(sx * 0.0365, 0.116, -0.34); g.add(c); }

  // Magazine — 20-rd PMAG with a glowing witness strip
  const mag = box(0.052, 0.285, 0.086, body);
  mag.position.set(0, -0.16, 0.04);
  mag.rotation.x = -0.1;
  g.add(mag);
  const magFloor = box(0.056, 0.020, 0.090, dark);
  magFloor.position.set(0, -0.300, 0.04);
  g.add(magFloor);
  const witness = box(0.013, 0.20, 0.008, energy);
  witness.position.set(0, -0.145, 0.086);
  witness.rotation.x = -0.1;
  g.add(witness);

  // Pistol grip
  const grip = box(0.062, 0.150, 0.072, dark);
  grip.position.set(0, -0.082, 0.22);
  grip.rotation.x = 0.3;
  g.add(grip);
  stippleGrip(g, metal, 0.032, -0.080, 0.088, 0.0, 0.12, 4, 5);

  // Buffer tube + collapsible stock
  const btube = cyl(0.024, 0.024, 0.22, dark);
  btube.position.set(0, 0.072, 0.36);
  g.add(btube);
  const stockBody = box(0.056, 0.086, 0.135, dark);
  stockBody.position.set(0, 0.062, 0.42);
  g.add(stockBody);

  const muzzle = addMuzzle(g, 0, 0.078, -0.92);
  return { group: g, muzzle };
}

// M16A2 — full-length barrel, triangular handguard, carry handle, fixed stock.
function buildM16(color) {
  const g = new THREE.Group();
  const body      = M('body',   color,    { roughness: 0.58, metalness: 0.28 });
  const furniture = M('accent', 0x14161c, { roughness: 0.72, metalness: 0.18 });
  const metal     = M('metal',  0x7c8289, { metalness: 0.74, roughness: 0.3  });

  // Upper receiver
  const upper = box(0.082, 0.082, 0.36, body);
  upper.position.set(0, 0.092, 0.06);
  g.add(upper);
  // Lower receiver
  const lower = box(0.08, 0.07, 0.34, furniture);
  lower.position.set(0, 0.022, 0.06);
  g.add(lower);

  // Carry handle (integral A2 style)
  const handleBase = box(0.04, 0.03, 0.26, body);
  handleBase.position.set(0, 0.148, 0.06);
  g.add(handleBase);
  const handleTop = box(0.03, 0.024, 0.28, body);
  handleTop.position.set(0, 0.168, 0.05);
  g.add(handleTop);
  // Rear sight aperture
  const rearApt = box(0.028, 0.045, 0.04, furniture);
  rearApt.position.set(0, 0.178, 0.15);
  g.add(rearApt);

  // Triangular ribbed handguard
  const hg = box(0.087, 0.092, 0.44, furniture);
  hg.position.set(0, 0.055, -0.34);
  g.add(hg);
  for (let i = 0; i < 6; i++) {
    const rib = box(0.092, 0.015, 0.022, furniture);
    rib.position.set(0, 0.098, -0.16 - i * 0.064);
    g.add(rib);
  }
  // Heat shield vents
  for (let i = 0; i < 5; i++) {
    const vent = box(0.022, 0.009, 0.04, metal);
    vent.position.set(0, 0.035, -0.18 - i * 0.068);
    g.add(vent);
  }

  // Full-length barrel
  const barrel = cyl(0.016, 0.014, 0.46, metal);
  barrel.position.set(0, 0.06, -0.77);
  g.add(barrel);
  // Gas tube
  const gtube = cyl(0.007, 0.007, 0.44, metal);
  gtube.position.set(0, 0.1, -0.56);
  g.add(gtube);
  // A2 flash hider
  const fh = cyl(0.022, 0.018, 0.065, furniture);
  fh.position.set(0, 0.06, -1.02);
  g.add(fh);

  // A-frame front sight base
  const fsb = box(0.038, 0.072, 0.048, furniture);
  fsb.position.set(0, 0.106, -0.6);
  g.add(fsb);
  // Front sight ears
  const fsL = box(0.004, 0.068, 0.044, metal);
  fsL.position.set(-0.022, 0.106, -0.6);
  g.add(fsL);
  const fsR = box(0.004, 0.068, 0.044, metal);
  fsR.position.set(0.022, 0.106, -0.6);
  g.add(fsR);
  const fsp = cyl(0.006, 0.006, 0.04, metal, 8, 0);
  fsp.position.set(0, 0.148, -0.6);
  g.add(fsp);

  // Magazine
  const mag = box(0.054, 0.228, 0.088, furniture);
  mag.position.set(0, -0.115, 0.02);
  mag.rotation.x = -0.12;
  g.add(mag);

  // Pistol grip
  const grip = box(0.068, 0.17, 0.08, furniture);
  grip.position.set(0, -0.088, 0.2);
  grip.rotation.x = 0.3;
  g.add(grip);
  stippleGrip(g, metal, 0.036, -0.088, 0.082, 0.0, 0.13, 4, 5);

  // Fixed solid A2 stock
  const stock = box(0.073, 0.124, 0.36, furniture);
  stock.position.set(0, 0.054, 0.38);
  g.add(stock);
  const buttplate = box(0.078, 0.17, 0.022, furniture);
  buttplate.position.set(0, 0.054, 0.565);
  g.add(buttplate);
  // Trapdoor
  const td = box(0.03, 0.06, 0.005, metal);
  td.position.set(0, 0.075, 0.556);
  g.add(td);

  const muzzle = addMuzzle(g, 0, 0.06, -1.055);
  return { group: g, muzzle };
}

// ===========================================================================
// HEAVY WEAPONS
// ===========================================================================

// M240-style belt-fed LMG
function buildLMG(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.52, metalness: 0.38 });
  const dark  = M('accent', 0x0f1216, { roughness: 0.58, metalness: 0.22 });
  const metal = M('metal',  0x6c7177, { metalness: 0.78, roughness: 0.32 });

  // Receiver
  const recv = box(0.118, 0.162, 0.52, body);
  recv.position.set(0, 0.052, 0.02);
  g.add(recv);

  // Feed cover
  const fc = box(0.118, 0.052, 0.36, body);
  fc.position.set(0, 0.158, -0.02);
  g.add(fc);
  // Feed cover latch
  const fcl = box(0.05, 0.018, 0.03, metal);
  fcl.position.set(0, 0.186, 0.14);
  g.add(fcl);

  // Carry handle
  const handle = box(0.038, 0.052, 0.15, dark);
  handle.position.set(0, 0.21, -0.04);
  g.add(handle);
  const handleBar = cyl(0.012, 0.012, 0.155, metal);
  handleBar.position.set(0, 0.21, -0.035);
  g.add(handleBar);

  // Barrel trunnion / short heat shield. The old receiver stopped at -0.24m
  // while the visible barrel began around -0.32m, leaving a bright-background
  // gap that made the front assembly look detached from the gun.
  const trunnion = cyl(0.041, 0.034, 0.18, dark);
  trunnion.position.set(0, 0.082, -0.285);
  g.add(trunnion);

  // Long heavy barrel with fluted section
  const barrel = cyl(0.026, 0.022, 0.52, metal);
  barrel.position.set(0, 0.082, -0.58);
  g.add(barrel);
  // Flute cuts on barrel
  for (let i = 0; i < 6; i++) {
    const flute = box(0.006, 0.048, 0.44, dark);
    flute.rotation.z = i / 6 * Math.PI * 2;
    flute.position.set(Math.cos(i / 6 * Math.PI * 2) * 0.024, 0.082 + Math.sin(i / 6 * Math.PI * 2) * 0.024, -0.56);
    g.add(flute);
  }
  // Cooling rings
  for (let i = 0; i < 5; i++) {
    const ring = cyl(0.034, 0.034, 0.022, dark);
    ring.position.set(0, 0.082, -0.42 - i * 0.085);
    g.add(ring);
  }
  // Flash suppressor
  const fsup = cyl(0.035, 0.026, 0.08, dark);
  fsup.position.set(0, 0.082, -0.86);
  g.add(fsup);

  // Pistol grip
  const grip = box(0.073, 0.182, 0.09, dark);
  grip.position.set(0, -0.114, 0.22);
  grip.rotation.x = 0.28;
  g.add(grip);
  stippleGrip(g, metal, 0.038, -0.11, 0.092, 0.0, 0.15, 4, 5);

  // Butt stock (tubular)
  const sTop = box(0.048, 0.03, 0.26, dark);
  sTop.position.set(0, 0.13, 0.36);
  g.add(sTop);
  const sBot = box(0.048, 0.03, 0.26, dark);
  sBot.position.set(0, -0.02, 0.36);
  g.add(sBot);
  const sSpine = box(0.022, 0.185, 0.024, dark);
  sSpine.position.set(0, 0.055, 0.24);
  g.add(sSpine);
  const butt = box(0.058, 0.195, 0.028, dark);
  butt.position.set(0, 0.055, 0.49);
  g.add(butt);

  // Bipod folded tight along the barrel for a carried weapon. Splayed legs
  // read as floating rods in a low-ready pose and inflated the visible gun.
  const legL = cyl(0.009, 0.009, 0.28, metal, 8);
  legL.position.set(-0.045, 0.035, -0.49);
  g.add(legL);
  const legR = cyl(0.009, 0.009, 0.28, metal, 8);
  legR.position.set(0.045, 0.035, -0.49);
  g.add(legR);
  // Bipod hinge
  const bipodBase = box(0.072, 0.022, 0.035, dark);
  bipodBase.position.set(0, 0.04, -0.58);
  g.add(bipodBase);

  const muzzle = addMuzzle(g, 0, 0.082, -0.9);
  return { group: g, muzzle };
}

// RPG-7
function buildRPG(color) {
  const g = new THREE.Group();
  const tubeMat = M('body',    color,    { roughness: 0.42, metalness: 0.58 });
  const dark    = M('accent',  0x0f1215, { roughness: 0.58, metalness: 0.2  });
  const metal   = M('metal',   0x6c7177, { metalness: 0.82, roughness: 0.28 });
  const wood    = M('wood',    0xb58a4a, { roughness: 0.62, metalness: 0.05 });
  const warhead = M('special', 0x3f6b34, { roughness: 0.48, metalness: 0.32 });

  // Main launch tube
  const mainTube = cyl(0.052, 0.052, 0.98, tubeMat);
  mainTube.position.set(0, 0.062, -0.12);
  g.add(mainTube);
  knurledCollar(g, metal, 0, 0.062, -0.12, 0.058, 12);

  // Wood heat guard (central grip section)
  const woodGuard = cyl(0.064, 0.064, 0.32, wood);
  woodGuard.position.set(0, 0.062, -0.02);
  g.add(woodGuard);
  // Metal retaining rings
  const ringA = cyl(0.068, 0.068, 0.022, dark);
  ringA.position.set(0, 0.062, 0.14);
  g.add(ringA);
  const ringB = cyl(0.068, 0.068, 0.022, dark);
  ringB.position.set(0, 0.062, -0.18);
  g.add(ringB);

  // Flared venturi (opens rearward)
  const venturi = cone(0.1, 0.22, dark, 10, Math.PI / 2);
  venturi.position.set(0, 0.062, 0.46);
  g.add(venturi);
  // Rear blast shield ring
  const blastRing = cyl(0.072, 0.068, 0.02, metal);
  blastRing.position.set(0, 0.062, 0.36);
  g.add(blastRing);

  // Warhead — PG-7VL type
  const wShaft = cyl(0.032, 0.032, 0.14, metal);
  wShaft.position.set(0, 0.062, -0.62);
  g.add(wShaft);
  // Piezo nose fuse
  const piezo = cyl(0.014, 0.012, 0.05, metal);
  piezo.position.set(0, 0.062, -0.7);
  g.add(piezo);
  // Warhead body (ogive)
  const wBody = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 14), warhead);
  wBody.scale.set(1, 1, 1.5);
  wBody.position.set(0, 0.062, -0.72);
  g.add(wBody);
  const wNose = cone(0.026, 0.14, warhead, 10, -Math.PI / 2);
  wNose.position.set(0, 0.062, -0.855);
  g.add(wNose);
  // Fins (4 boattail fins)
  for (let i = 0; i < 4; i++) {
    const fin = box(0.006, 0.045, 0.1, metal);
    fin.rotation.z = i / 4 * Math.PI * 2;
    fin.position.set(Math.cos(i / 4 * Math.PI * 2) * 0.036, 0.062 + Math.sin(i / 4 * Math.PI * 2) * 0.036, -0.57);
    g.add(fin);
  }

  // Pistol grip + trigger housing
  const grip = box(0.068, 0.17, 0.082, dark);
  grip.position.set(0, -0.082, 0.06);
  grip.rotation.x = 0.16;
  g.add(grip);
  stippleGrip(g, metal, 0.036, -0.08, 0.084, 0.0, 0.13, 3, 5);
  // Trigger guard
  const tgB = box(0.042, 0.013, 0.088, dark);
  tgB.position.set(0, -0.036, 0.04);
  g.add(tgB);
  const tgF = box(0.042, 0.038, 0.013, dark);
  tgF.position.set(0, -0.016, 0.0);
  g.add(tgF);
  const trig = box(0.014, 0.044, 0.016, metal);
  trig.position.set(0, -0.014, 0.03);
  g.add(trig);

  // Forward wood grip
  const foreGrip = box(0.058, 0.14, 0.07, wood);
  foreGrip.position.set(0, -0.042, -0.18);
  g.add(foreGrip);

  // Iron sights
  const sightFront = box(0.01, 0.065, 0.01, metal);
  sightFront.position.set(0, 0.146, -0.24);
  g.add(sightFront);
  const sightRear = box(0.04, 0.052, 0.01, dark);
  sightRear.position.set(0, 0.136, 0.02);
  g.add(sightRear);
  const sightRearApt = box(0.01, 0.036, 0.014, metal);
  sightRearApt.position.set(0, 0.148, 0.022);
  g.add(sightRearApt);

  const muzzle = addMuzzle(g, 0, 0.062, -0.94);
  return { group: g, muzzle };
}

// ===========================================================================
// SNIPER RIFLES
// ===========================================================================

function buildSniper(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.52, metalness: 0.32 });
  const dark  = M('accent', 0x101316, { roughness: 0.58, metalness: 0.22 });
  const metal = M('metal',  0x8a9097, { metalness: 0.82, roughness: 0.22 });

  // Upper/lower receivers
  const upper = box(0.078, 0.078, 0.52, dark);
  upper.position.set(0, 0.092, 0.0);
  g.add(upper);
  const lower = box(0.076, 0.068, 0.46, body);
  lower.position.set(0, 0.022, 0.02);
  g.add(lower);

  // Scope rail
  const rail = box(0.038, 0.02, 0.46, metal);
  rail.position.set(0, 0.144, -0.02);
  g.add(rail);
  picRail(g, dark, 0, 0.156, 0.2, 0.46);

  // Scope — variable magnification
  const scopeTube = cyl(0.027, 0.027, 0.35, dark, 16, 0);
  scopeTube.position.set(0, 0.188, -0.06);
  g.add(scopeTube);
  const obj = cyl(0.038, 0.034, 0.075, dark, 16, 0);
  obj.position.set(0, 0.188, -0.252);
  g.add(obj);
  const eye = cyl(0.035, 0.031, 0.065, dark, 16, 0);
  eye.position.set(0, 0.188, 0.135);
  g.add(eye);
  // Scope rings
  const ringA = box(0.052, 0.04, 0.025, metal);
  ringA.position.set(0, 0.178, -0.16);
  g.add(ringA);
  const ringB = box(0.052, 0.04, 0.025, metal);
  ringB.position.set(0, 0.178, 0.06);
  g.add(ringB);
  // Elevation + windage turrets
  const elev = cyl(0.012, 0.012, 0.03, metal, 8, 0);
  elev.position.set(0, 0.222, -0.052);
  g.add(elev);
  const wind = cyl(0.012, 0.012, 0.03, metal, 8, 0);
  wind.position.set(-0.032, 0.188, -0.052);
  wind.rotation.z = Math.PI / 2;
  g.add(wind);
  // Scope reticle (glass lens)
  const lensF = cyl(0.025, 0.025, 0.01, M('special', 0x162b1e, { roughness: 0.08, metalness: 0.1, emissive: 0x0a2015, emissiveIntensity: 0.15 }), 16, 0);
  lensF.position.set(0, 0.188, -0.29);
  g.add(lensF);

  // Long barrel
  const barrel = cyl(0.017, 0.013, 0.55, metal);
  barrel.position.set(0, 0.08, -0.56);
  g.add(barrel);
  // Threaded muzzle + brake
  const mB = cyl(0.026, 0.022, 0.065, dark);
  mB.position.set(0, 0.08, -0.86);
  g.add(mB);
  // Brake vents
  for (let i = 0; i < 4; i++) {
    const v = box(0.006, 0.018, 0.042, metal);
    v.position.set(Math.cos(i / 4 * Math.PI * 2) * 0.024, 0.08 + Math.sin(i / 4 * Math.PI * 2) * 0.024, -0.857);
    g.add(v);
  }

  // Pistol grip
  const grip = box(0.068, 0.17, 0.08, dark);
  grip.position.set(0, -0.082, 0.2);
  grip.rotation.x = 0.3;
  g.add(grip);
  stippleGrip(g, metal, 0.036, -0.08, 0.082, 0.0, 0.13, 4, 5);

  // Bolt handle
  const boltBody = box(0.044, 0.024, 0.026, metal);
  boltBody.position.set(0.055, 0.12, 0.08);
  g.add(boltBody);
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), metal);
  boltKnob.position.set(0.075, 0.12, 0.08);
  g.add(boltKnob);

  // Stock
  const stock = box(0.068, 0.115, 0.36, dark);
  stock.position.set(0, 0.054, 0.38);
  g.add(stock);
  const cheek = box(0.055, 0.035, 0.24, body);
  cheek.position.set(0, 0.125, 0.36);
  g.add(cheek);
  const buttplate = box(0.072, 0.145, 0.022, dark);
  buttplate.position.set(0, 0.05, 0.565);
  g.add(buttplate);

  const muzzle = addMuzzle(g, 0, 0.08, -0.895);
  return { group: g, muzzle };
}

// Precision bolt-action — chassis stock, big variable optic, bipod.
function buildBoltSniper(color) {
  const g = new THREE.Group();
  const body  = M('body',   color,    { roughness: 0.48, metalness: 0.35 });
  const dark  = M('accent', 0x0d1015, { roughness: 0.58, metalness: 0.22 });
  const metal = M('metal',  0x8a9097, { metalness: 0.84, roughness: 0.2  });

  // Aluminium chassis (flat-dark-earth style, body color)
  const chassis = box(0.082, 0.125, 0.6, body);
  chassis.position.set(0, 0.065, 0.04);
  g.add(chassis);

  // Handguard (aluminum)
  const hg = box(0.068, 0.078, 0.38, dark);
  hg.position.set(0, 0.072, -0.38);
  g.add(hg);
  railSlats(g, metal, 5, 0, 0.116, -0.22, 0.072, 0.075, 0.012);
  railSlats(g, metal, 3, 0.036, 0.065, -0.24, 0.1, 0.007, 0.04);

  // Top rail (full-length)
  const topRail = box(0.04, 0.022, 0.84, metal);
  topRail.position.set(0, 0.154, -0.17);
  g.add(topRail);
  picRail(g, dark, 0, 0.167, 0.2, 0.84);

  // Heavy variable scope (Schmidt & Bender style)
  const scopeTube = cyl(0.032, 0.032, 0.38, dark, 16, 0);
  scopeTube.position.set(0, 0.202, -0.04);
  g.add(scopeTube);
  const scopeObj = cyl(0.048, 0.042, 0.082, dark, 16, 0);
  scopeObj.position.set(0, 0.202, -0.265);
  g.add(scopeObj);
  const scopeEye = cyl(0.044, 0.038, 0.072, dark, 16, 0);
  scopeEye.position.set(0, 0.202, 0.163);
  g.add(scopeEye);
  const scopeRingA = box(0.058, 0.044, 0.028, metal);
  scopeRingA.position.set(0, 0.19, -0.14);
  g.add(scopeRingA);
  const scopeRingB = box(0.058, 0.044, 0.028, metal);
  scopeRingB.position.set(0, 0.19, 0.1);
  g.add(scopeRingB);
  // Turrets
  const elevTur = cyl(0.016, 0.016, 0.038, metal, 8, 0);
  elevTur.position.set(0, 0.24, -0.02);
  g.add(elevTur);
  const windTur = cyl(0.016, 0.016, 0.038, metal, 8, 0);
  windTur.position.set(-0.036, 0.202, -0.02);
  windTur.rotation.z = Math.PI / 2;
  g.add(windTur);
  // Lenses
  const lensGlassMat = M('special', 0x152a1f, { roughness: 0.06, metalness: 0.08, emissive: 0x091a12, emissiveIntensity: 0.18 });
  const lensF = cyl(0.038, 0.038, 0.01, lensGlassMat, 16, 0);
  lensF.position.set(0, 0.202, -0.307);
  g.add(lensF);
  const lensR = cyl(0.034, 0.034, 0.01, lensGlassMat, 16, 0);
  lensR.position.set(0, 0.202, 0.2);
  g.add(lensR);

  // Heavy bull barrel
  const barrel = cyl(0.02, 0.016, 0.52, metal);
  barrel.position.set(0, 0.075, -0.65);
  g.add(barrel);
  // Muzzle brake (large, 3-port)
  const mbBody = cyl(0.034, 0.03, 0.082, dark);
  mbBody.position.set(0, 0.075, -0.93);
  g.add(mbBody);
  for (let i = 0; i < 4; i++) {
    const port = box(0.007, 0.024, 0.022, metal);
    port.position.set(Math.cos(i / 4 * Math.PI * 2) * 0.03, 0.075 + Math.sin(i / 4 * Math.PI * 2) * 0.03, -0.92);
    g.add(port);
  }

  // Pistol grip
  const grip = box(0.07, 0.175, 0.084, dark);
  grip.position.set(0, -0.086, 0.22);
  grip.rotation.x = 0.3;
  g.add(grip);
  stippleGrip(g, metal, 0.037, -0.082, 0.086, 0.0, 0.14, 4, 5);

  // Bolt handle
  const boltBody = box(0.048, 0.026, 0.028, metal);
  boltBody.position.set(0.062, 0.125, 0.1);
  g.add(boltBody);
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), metal);
  boltKnob.position.set(0.085, 0.122, 0.1);
  g.add(boltKnob);

  // Folding chassis stock
  const stockFold = box(0.072, 0.145, 0.32, dark);
  stockFold.position.set(0, 0.044, 0.42);
  g.add(stockFold);
  const cheek = box(0.062, 0.038, 0.22, body);
  cheek.position.set(0, 0.132, 0.42);
  g.add(cheek);
  const buttHook = box(0.074, 0.055, 0.035, dark);
  buttHook.position.set(0, 0.01, 0.6);
  g.add(buttHook);

  // Bipod (Harris-style)
  const bipodBase = box(0.066, 0.022, 0.038, dark);
  bipodBase.position.set(0, 0.042, -0.5);
  g.add(bipodBase);
  const legL = cyl(0.01, 0.01, 0.32, metal, 8, Math.PI / 2.5);
  legL.position.set(-0.072, -0.1, -0.5);
  legL.rotation.z = 0.44;
  g.add(legL);
  const legR = cyl(0.01, 0.01, 0.32, metal, 8, Math.PI / 2.5);
  legR.position.set(0.072, -0.1, -0.5);
  legR.rotation.z = -0.44;
  g.add(legR);
  // Leg feet
  const footL = box(0.022, 0.008, 0.022, dark);
  footL.position.set(-0.138, -0.228, -0.48);
  g.add(footL);
  const footR = box(0.022, 0.008, 0.022, dark);
  footR.position.set(0.138, -0.228, -0.48);
  g.add(footR);

  const muzzle = addMuzzle(g, 0, 0.075, -0.975);
  return { group: g, muzzle };
}

// ===========================================================================
// MELEE — Reaver Blade
// ===========================================================================

function buildSword(color) {
  const g = new THREE.Group();
  const bladeMat = M('metal', 0x353239, { metalness: 0.35, roughness: 0.58 });
  const plateMat = M('body', 0x69636a, { metalness: 0.3, roughness: 0.6 });
  const darkMat = M('wood', 0x211e22, { metalness: 0.15, roughness: 0.75 });
  const guardMat = M('special', 0x29252a, { metalness: 0.4, roughness: 0.5 });
  const orange = M('accent', 0xe57808, { roughness: 0.6, metalness: 0.2 });
  const edgeMat = M('energy', 0xb7f000, { emissive: 0xb7f000, emissiveIntensity: 0.7, roughness: 0.4 });
  const slab = (name, points, depth, material, y=-0.02) => {
    const shape = new THREE.Shape(); points.forEach(([x,z],i)=>i?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});
    geometry.rotateX(Math.PI/2);geometry.translate(0,depth/2,0);
    const mesh = new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.y=y;g.add(mesh);return mesh;
  };
  // Asymmetric slab with a stepped spine and a continuous single energy edge.
  slab('angular dark blade',[[.032,.045],[-.021,.045],[-.042,-.10],[-.042,-.66],[-.025,-.80],[.024,-.735],[.033,-.62],[.025,-.60],[.033,-.57],[.033,-.38],[.022,-.36],[.033,-.33],[.033,-.13],[.025,-.11]],.017,bladeMat);
  slab('lime cutting edge',[[-.021,.045],[-.038,.020],[-.048,-.01],[-.040,-.035],[-.047,-.13],[-.047,-.66],[-.025,-.80],[-.034,-.64],[-.034,-.14]],.019,edgeMat);
  for(const y of [-.031,-.009]) {
    slab('angular gray side plate',[[-.026,-.09],[.005,-.06],[.019,-.09],[.019,-.28],[.010,-.29],[.010,-.39],[.022,-.41],[.022,-.56],[.007,-.58],[.007,-.69],[-.026,-.70]],.004,plateMat,y);
    slab('orange upper inset',[[-.027,-.46],[-.017,-.45],[-.017,-.69],[.014,-.73],[-.021,-.77]],.005,orange,y);
    for(const z of [-.205,-.223]) {
      const stripe=box(.038,.005,.008,orange);stripe.position.set(-.007,y,z);stripe.rotation.y=.25;g.add(stripe);
    }
    for(const z of [-.10,-.116,-.132]) {
      const pin=new THREE.Mesh(new THREE.CylinderGeometry(.0025,.0025,.005,6),darkMat);pin.position.set(.006,y,z);g.add(pin);
    }
  }
  const guard=box(.18,.027,.049,guardMat);guard.position.set(0,-.02,.059);g.add(guard);
  const handle=box(.033,.032,.195,darkMat);handle.position.set(0,-.02,.175);g.add(handle);
  for(let i=0;i<8;i++) {const band=box(.043,.042,.012,guardMat);band.position.set(0,-.02,.086+i*.024);g.add(band);}
  const pommel=box(.049,.046,.024,guardMat);pommel.position.set(0,-.02,.284);g.add(pommel);
  const muzzle=addMuzzle(g,0,-.02,-.80);
  return {group:g,muzzle};
}

// Tactical combat knife — sci-fi tanto. Roles match the sword so melee skins
// (blade=metal, groove=accent, guard=special, grip=wood) recolor it identically.
function buildKnife(color) {
  const g = new THREE.Group();
  const bladeMat = M('metal',   color,    { metalness: 0.9,  roughness: 0.14 });
  const gripMat  = M('wood',    0x16181c, { metalness: 0.1,  roughness: 0.82 });
  const guardMat = M('special', 0x2a2e34, { metalness: 0.78, roughness: 0.32 });
  const darkMat  = M('accent',  0x101216, { metalness: 0.5,  roughness: 0.5  });

  // Grip — wrapped paracord handle (alternating bands)
  const handle = cyl(0.016, 0.014, 0.13, gripMat);
  handle.position.set(0, -0.02, 0.12);
  g.add(handle);
  for (let i = 0; i < 6; i++) {
    const wrap = cyl(0.018, 0.018, 0.012, i % 2 === 0 ? darkMat : gripMat);
    wrap.position.set(0, -0.02, 0.07 + i * 0.018);
    g.add(wrap);
  }
  // Pommel / lanyard hole cap
  const pommel = box(0.024, 0.024, 0.022, guardMat);
  pommel.position.set(0, -0.02, 0.19);
  g.add(pommel);

  // Finger guard
  const guard = box(0.07, 0.02, 0.022, guardMat);
  guard.position.set(0, -0.02, 0.045);
  g.add(guard);

  // Ricasso (base of blade)
  const ricasso = box(0.028, 0.012, 0.05, bladeMat);
  ricasso.position.set(0, -0.02, 0.01);
  g.add(ricasso);

  // Main blade — tanto profile, tapering
  const blade = box(0.03, 0.01, 0.26, bladeMat);
  blade.position.set(0, -0.02, -0.14);
  g.add(blade);
  // Blade flat / fuller groove
  const groove = box(0.009, 0.0035, 0.22, darkMat);
  groove.position.set(0, -0.014, -0.13);
  g.add(groove);
  // Angled tanto tip
  const tip = cone(0.016, 0.07, bladeMat, 6, -Math.PI / 2);
  tip.position.set(0, -0.02, -0.3);
  g.add(tip);
  // Serration spine detail
  for (let i = 0; i < 5; i++) {
    const serr = box(0.006, 0.012, 0.01, bladeMat);
    serr.position.set(0, -0.012, -0.04 - i * 0.022);
    g.add(serr);
  }

  const muzzle = addMuzzle(g, 0, -0.02, -0.34);
  return { group: g, muzzle };
}

// ===========================================================================
// Energy / Halo-style weapon builder (shared by all new Spartan weapons)
// ===========================================================================

// Shared sci-fi material set for the main guns. Roles body / accent / metal /
// energy; the energy parts glow in the weapon's signature `energyColor`.
function _sciFiMats(color, eCol) {
  // Tuned for tonal separation: mid-tone polymer furniture (def.color), hard
  // anodized receiver parts that still catch light, bright brushed steel.
  return {
    body:   M('body',   color,    { roughness: 0.46, metalness: 0.35 }),
    dark:   M('accent', 0x1a1e24, { roughness: 0.38, metalness: 0.62 }),
    metal:  M('metal',  0x9aa3ad, { metalness: 0.92, roughness: 0.22 }),
    energy: M('energy', eCol,     { roughness: 0.20, metalness: 0.10, emissive: eCol, emissiveIntensity: 3.2 }),
  };
}

// m4 — realistic AR-15-pattern carbine with a light sci-fi accent: proper
// upper/lower receivers (magwell, ejection port, brass deflector, charging
// handle), M-LOK handguard, gas block + tube, birdcage flash hider, PMAG with
// ribs, stippled grip, buffer tube + collapsible stock, red-dot optic.
function buildSciFiAR(color, def = {}) {
  const eCol = def.energyColor ?? 0x2ee6ff;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();

  // receivers
  const lower = box(0.072, 0.068, 0.30, body); lower.position.set(0, 0.014, 0.07); g.add(lower);
  const magwell = box(0.062, 0.052, 0.085, body); magwell.position.set(0, -0.030, 0.045); g.add(magwell);
  const upper = box(0.076, 0.070, 0.34, dark); upper.position.set(0, 0.082, 0.03); g.add(upper);
  // ejection port + brass deflector + forward assist (right side)
  const port = box(0.006, 0.030, 0.075, metal); port.position.set(0.039, 0.078, -0.015); g.add(port);
  const deflector = box(0.014, 0.026, 0.020, dark); deflector.position.set(0.042, 0.078, 0.035); g.add(deflector);
  const fwdAssist = cyl(0.011, 0.011, 0.016, metal, 10, 0); fwdAssist.rotation.z = Math.PI / 2; fwdAssist.position.set(0.044, 0.062, 0.055); g.add(fwdAssist);
  // charging handle
  const chandle = box(0.040, 0.012, 0.050, dark); chandle.position.set(0, 0.108, 0.19); g.add(chandle);
  const chLatch = box(0.016, 0.010, 0.026, metal); chLatch.position.set(-0.026, 0.108, 0.185); g.add(chLatch);

  // full-length top rail + optic
  const rail = box(0.036, 0.016, 0.52, metal); rail.position.set(0, 0.126, -0.08); g.add(rail);
  picRail(g, dark, 0, 0.138, 0.16, 0.50);
  const optBase = box(0.038, 0.020, 0.070, dark); optBase.position.set(0, 0.148, 0.06); g.add(optBase);
  const optHood = box(0.042, 0.040, 0.056, dark); optHood.position.set(0, 0.178, 0.055); g.add(optHood);
  const optGlass = box(0.034, 0.032, 0.006, M('special', 0x0a1420, { roughness: 0.05, metalness: 0.2, clearcoat: 1 })); optGlass.position.set(0, 0.178, 0.028); g.add(optGlass);
  // holographic reticle: glowing ring + centre dot floating in the glass
  const optRing = cyl(0.011, 0.011, 0.005, energy, 12); optRing.position.set(0, 0.178, 0.025); g.add(optRing);
  const optDot = box(0.005, 0.005, 0.005, energy); optDot.position.set(0, 0.178, 0.023); g.add(optDot);
  const optKnob = cyl(0.009, 0.009, 0.012, metal, 10, 0); optKnob.rotation.z = Math.PI / 2; optKnob.position.set(0.026, 0.178, 0.055); g.add(optKnob);

  // M-LOK handguard with slots + thin energy conduits along the top edges
  const hg = box(0.060, 0.074, 0.36, dark); hg.position.set(0, 0.080, -0.33); g.add(hg);
  railSlats(g, metal, 4, 0.032, 0.070, -0.20, 0.088, 0.007, 0.034);
  railSlats(g, metal, 4, -0.032, 0.070, -0.20, 0.088, 0.007, 0.034);
  railSlats(g, metal, 4, 0, 0.040, -0.20, 0.088, 0.040, 0.010);
  for (const sx of [-1, 1]) { const c = box(0.006, 0.010, 0.30, energy); c.position.set(sx * 0.030, 0.114, -0.31); g.add(c); }
  // glowing status strip on the receiver flank (ammo readout)
  const status = box(0.005, 0.010, 0.085, energy); status.position.set(-0.039, 0.096, 0.03); g.add(status);
  // angled foregrip at the front of the handguard
  const afg = box(0.034, 0.062, 0.040, body); afg.position.set(0, 0.026, -0.44); afg.rotation.x = -0.55; g.add(afg);
  // flip-up rear sight aperture on the rail
  const rsBase = box(0.030, 0.016, 0.026, dark); rsBase.position.set(0, 0.144, 0.135); g.add(rsBase);
  const rsRing = cyl(0.009, 0.009, 0.007, metal, 10, 0); rsRing.position.set(0, 0.162, 0.135); g.add(rsRing);

  // barrel group: gas block, tube, exposed barrel, birdcage flash hider
  const brl = cyl(0.017, 0.016, 0.16, metal, 12); brl.position.set(0, 0.078, -0.575); g.add(brl);
  const gasBlock = box(0.028, 0.030, 0.036, dark); gasBlock.position.set(0, 0.082, -0.50); g.add(gasBlock);
  const gasTube = cyl(0.006, 0.006, 0.34, metal, 8); gasTube.position.set(0, 0.108, -0.34); g.add(gasTube);
  const fh = cyl(0.021, 0.016, 0.055, dark, 12); fh.position.set(0, 0.078, -0.665); g.add(fh);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const slot = box(0.005, 0.011, 0.038, metal); slot.position.set(Math.cos(a) * 0.019, 0.078 + Math.sin(a) * 0.019, -0.665); g.add(slot); }
  const emit = cyl(0.014, 0.017, 0.014, energy, 10); emit.position.set(0, 0.078, -0.690); g.add(emit);

  // PMAG: curved polymer, ribs, floorplate, glowing witness strip
  const mag = box(0.048, 0.185, 0.074, body); mag.position.set(0, -0.128, 0.035); mag.rotation.x = -0.14; g.add(mag);
  for (let i = 0; i < 3; i++) { const rib = box(0.052, 0.007, 0.064, dark); rib.position.set(0, -0.092 - i * 0.042, 0.042 + i * 0.006); rib.rotation.x = -0.14; g.add(rib); }
  const magFloor = box(0.054, 0.015, 0.080, dark); magFloor.position.set(0, -0.224, 0.050); magFloor.rotation.x = -0.14; g.add(magFloor);
  const witness = box(0.013, 0.14, 0.008, energy); witness.position.set(0, -0.124, 0.075); witness.rotation.x = -0.14; g.add(witness);

  // controls: mag release, selector both sides, bolt catch, trigger + guard
  const magRel = cyl(0.008, 0.008, 0.012, metal, 8, 0); magRel.rotation.z = Math.PI / 2; magRel.position.set(0.040, 0.010, 0.005); g.add(magRel);
  for (const sx of [-1, 1]) { const sel = box(0.008, 0.010, 0.030, metal); sel.position.set(sx * 0.040, 0.036, 0.115); g.add(sel); }
  const boltCatch = box(0.006, 0.022, 0.030, metal); boltCatch.position.set(-0.040, 0.030, 0.02); g.add(boltCatch);
  const trigger = box(0.010, 0.032, 0.008, metal); trigger.position.set(0, -0.026, 0.115); trigger.rotation.x = 0.25; g.add(trigger);
  const tg = box(0.034, 0.008, 0.085, dark); tg.position.set(0, -0.048, 0.10); g.add(tg);
  const tgFront = box(0.034, 0.030, 0.008, dark); tgFront.position.set(0, -0.032, 0.062); g.add(tgFront);

  // stippled pistol grip with backstrap
  const grip = box(0.052, 0.125, 0.058, body); grip.position.set(0, -0.070, 0.165); grip.rotation.x = 0.32; g.add(grip);
  const backstrap = box(0.052, 0.115, 0.012, dark); backstrap.position.set(0, -0.078, 0.196); backstrap.rotation.x = 0.32; g.add(backstrap);
  stippleGrip(g, dark, 0, -0.075, 0.140, 0.034, 0.095, 3, 4);

  // buffer tube + castle nut + 6-position collapsible stock
  const btube = cyl(0.023, 0.023, 0.17, dark, 12); btube.position.set(0, 0.062, 0.28); g.add(btube);
  knurledCollar(g, metal, 0, 0.062, 0.205, 0.027, 10);
  for (let i = 0; i < 3; i++) { const notch = box(0.050, 0.006, 0.008, metal); notch.position.set(0, 0.040, 0.24 + i * 0.04); g.add(notch); }
  // stock stays in scale with the receiver — comb on the buffer-tube line
  const stock = box(0.054, 0.082, 0.115, body); stock.position.set(0, 0.046, 0.375); g.add(stock);
  const cheek = box(0.046, 0.016, 0.105, dark); cheek.position.set(0, 0.092, 0.375); g.add(cheek);
  const stockToe = box(0.048, 0.042, 0.052, body); stockToe.position.set(0, 0.008, 0.396); stockToe.rotation.x = 0.35; g.add(stockToe);
  const buttpad = box(0.052, 0.086, 0.016, dark); buttpad.position.set(0, 0.046, 0.437); g.add(buttpad);
  const slingLoop = box(0.010, 0.020, 0.008, metal); slingLoop.position.set(0, 0.000, 0.36); g.add(slingLoop);

  const muzzle = addMuzzle(g, 0, 0.078, -0.70);
  return { group: g, muzzle };
}

// magnum — realistic heavy revolver-automag hybrid: serrated slide, ported
// barrel shroud, fluted six-shot cylinder (glowing chambers), hammer spur,
// under-rail, stippled grip panels, proper sights.
function buildSciFiHandCannon(color, def = {}) {
  const eCol = def.energyColor ?? 0xffb03a;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();

  // Proportions follow a real large-frame pistol: slim slide riding a shallow
  // frame, everything hung off one bore line (y=0.072).
  // slide with front + rear cocking serrations and ejection port
  const slide = box(0.048, 0.052, 0.30, dark); slide.position.set(0, 0.072, -0.05); g.add(slide);
  // brushed-steel sight rib along the slide top — breaks up the black slab
  const sightRib = box(0.026, 0.007, 0.29, metal); sightRib.position.set(0, 0.101, -0.05); g.add(sightRib);
  for (let i = 0; i < 5; i++) { const s = box(0.052, 0.028, 0.005, metal); s.position.set(0, 0.078, 0.055 + i * 0.013); g.add(s); }
  for (let i = 0; i < 3; i++) { const s = box(0.052, 0.028, 0.005, metal); s.position.set(0, 0.078, -0.145 - i * 0.013); g.add(s); }
  const eport = box(0.006, 0.020, 0.060, metal); eport.position.set(0.025, 0.076, -0.03); g.add(eport);

  // ported barrel shroud + exposed match barrel + recessed crown — the middle
  // port on each side glows (energy bleed-off vents)
  const shroud = box(0.044, 0.044, 0.115, body); shroud.position.set(0, 0.072, -0.245); g.add(shroud);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const p = box(0.006, 0.014, 0.022, i === 1 ? energy : dark); p.position.set(sx * 0.023, 0.082, -0.21 - i * 0.032); g.add(p); }
  const brl = cyl(0.015, 0.015, 0.06, metal, 12); brl.position.set(0, 0.072, -0.285); g.add(brl);
  const crown = cyl(0.017, 0.019, 0.014, dark, 12); crown.position.set(0, 0.072, -0.292); g.add(crown);
  const emit = cyl(0.010, 0.012, 0.010, energy, 10); emit.position.set(0, 0.072, -0.298); g.add(emit);

  // fluted six-shot cylinder on a crane, chambers glow
  const cylC = cyl(0.032, 0.032, 0.095, dark, 12); cylC.position.set(0, 0.034, 0.015); g.add(cylC);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const flute = box(0.008, 0.008, 0.080, metal); flute.position.set(Math.cos(a) * 0.032, 0.034 + Math.sin(a) * 0.032, 0.015); flute.rotation.z = a; g.add(flute);
    const ch = cyl(0.006, 0.006, 0.098, energy, 6); ch.position.set(Math.cos(a + 0.5) * 0.019, 0.034 + Math.sin(a + 0.5) * 0.019, 0.015); g.add(ch);
  }
  const crane = box(0.010, 0.028, 0.060, metal); crane.position.set(-0.028, 0.018, 0.015); g.add(crane);
  const cylLatch = box(0.008, 0.013, 0.028, metal); cylLatch.position.set(-0.027, 0.048, 0.075); g.add(cylLatch);
  // glowing energy seam ring on the cylinder face
  const cylSeam = cyl(0.026, 0.026, 0.006, energy, 12); cylSeam.position.set(0, 0.034, -0.036); g.add(cylSeam);

  // frame with a cylinder window (front section + rear section) so the fluted
  // cylinder and its glowing chambers stay visible, like a Mateba automag.
  const frame = box(0.044, 0.038, 0.155, body); frame.position.set(0, 0.022, -0.133); g.add(frame);
  // rear frame block runs from the slide all the way down into the grip so the
  // back end reads as one piece instead of hanging chunks
  const frameRear = box(0.042, 0.088, 0.058, body); frameRear.position.set(0, 0.002, 0.072); g.add(frameRear);
  const underCyl = box(0.040, 0.014, 0.11, body); underCyl.position.set(0, -0.004, 0.015); g.add(underCyl);
  const dust = box(0.038, 0.012, 0.10, dark); dust.position.set(0, 0.000, -0.22); g.add(dust);
  picRail(g, metal, 0, -0.008, -0.17, 0.09, 0.022);

  // hammer spur + beavertail
  const hammer = box(0.013, 0.028, 0.015, metal); hammer.position.set(0, 0.094, 0.098); hammer.rotation.x = -0.5; g.add(hammer);
  const beaver = box(0.040, 0.013, 0.042, dark); beaver.position.set(0, 0.026, 0.096); g.add(beaver);

  // sights: serrated ramp front with glow dot, notch rear with two dots
  const fs = box(0.011, 0.020, 0.015, dark); fs.position.set(0, 0.100, -0.27); g.add(fs);
  const fsDot = box(0.006, 0.006, 0.005, energy); fsDot.position.set(0, 0.108, -0.276); g.add(fsDot);
  const rs = box(0.030, 0.016, 0.015, dark); rs.position.set(0, 0.104, 0.085); g.add(rs);
  for (const sx of [-1, 1]) { const d = box(0.005, 0.005, 0.005, energy); d.position.set(sx * 0.010, 0.110, 0.092); g.add(d); }

  // grip: stippled panels, finger grooves, lanyard loop, energy cell window
  // (gentler rake, tucked up into the rear frame block)
  const grip = box(0.046, 0.140, 0.056, body); grip.position.set(0, -0.055, 0.062); grip.rotation.x = 0.34; g.add(grip);
  for (const sx of [-1, 1]) { const panel = box(0.006, 0.095, 0.042, dark); panel.position.set(sx * 0.024, -0.058, 0.065); panel.rotation.x = 0.34; g.add(panel); }
  for (let i = 0; i < 3; i++) { const groove = box(0.048, 0.008, 0.010, dark); groove.position.set(0, -0.025 - i * 0.035, 0.030 + i * 0.013); g.add(groove); }
  const cell = box(0.015, 0.065, 0.018, energy); cell.position.set(0, -0.065, 0.088); cell.rotation.x = 0.34; g.add(cell);
  const lanyard = box(0.010, 0.013, 0.008, metal); lanyard.position.set(0, -0.118, 0.078); g.add(lanyard);

  // trigger + guard bridging the grip front to the frame underside
  const trigger = box(0.010, 0.026, 0.008, metal); trigger.position.set(0, -0.018, 0.020); trigger.rotation.x = 0.3; g.add(trigger);
  const tgB = box(0.032, 0.008, 0.085, dark); tgB.position.set(0, -0.042, 0.010); g.add(tgB);
  const tgF = box(0.032, 0.034, 0.008, dark); tgF.position.set(0, -0.026, -0.028); g.add(tgF);

  const muzzle = addMuzzle(g, 0, 0.072, -0.31);
  return { group: g, muzzle };
}

// battlerifle — realistic scoped DMR: monolithic receiver, free-float M-LOK
// handguard, fluted heavy barrel + muzzle brake, full scope (bell, turrets,
// rings, sunshade), 20-rd mag, adjustable precision stock.
function buildSciFiBattleRifle(color, def = {}) {
  const eCol = def.energyColor ?? 0x39ff9d;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();

  // receivers + magwell + ejection port + side charging handle
  const lower = box(0.066, 0.070, 0.34, body); lower.position.set(0, 0.014, 0.055); g.add(lower);
  const upper = box(0.072, 0.062, 0.42, dark); upper.position.set(0, 0.082, 0.00); g.add(upper);
  const magwell = box(0.058, 0.045, 0.080, body); magwell.position.set(0, -0.026, 0.015); g.add(magwell);
  const eport = box(0.006, 0.026, 0.070, metal); eport.position.set(0.037, 0.078, -0.03); g.add(eport);
  const chandle = box(0.028, 0.012, 0.045, metal); chandle.position.set(-0.052, 0.092, 0.05); g.add(chandle);

  // full-length rail
  const rail = box(0.034, 0.014, 0.60, metal); rail.position.set(0, 0.120, -0.10); g.add(rail);
  picRail(g, dark, 0, 0.131, 0.16, 0.56);

  // free-float M-LOK handguard + bottom bipod rail stub + conduits
  const hg = box(0.058, 0.066, 0.34, dark); hg.position.set(0, 0.076, -0.37); g.add(hg);
  railSlats(g, metal, 4, 0.031, 0.066, -0.26, 0.082, 0.007, 0.030);
  railSlats(g, metal, 4, -0.031, 0.066, -0.26, 0.082, 0.007, 0.030);
  picRail(g, metal, 0, 0.038, -0.44, 0.09, 0.024);
  for (const sx of [-1, 1]) { const c = box(0.006, 0.009, 0.28, energy); c.position.set(sx * 0.029, 0.106, -0.36); g.add(c); }
  for (const sx of [-1, 1]) { const c = box(0.005, 0.008, 0.22, energy); c.position.set(sx * 0.0295, 0.058, -0.35); g.add(c); }

  // fluted heavy barrel + target crown muzzle brake with side ports
  const brl = cyl(0.018, 0.017, 0.24, metal, 12); brl.position.set(0, 0.078, -0.60); g.add(brl);
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; const fl = box(0.005, 0.005, 0.20, dark); fl.position.set(Math.cos(a) * 0.017, 0.078 + Math.sin(a) * 0.017, -0.60); g.add(fl); }
  const brake = box(0.034, 0.034, 0.065, dark); brake.position.set(0, 0.078, -0.715); g.add(brake);
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) { const p = box(0.008, 0.016, 0.016, metal); p.position.set(sx * 0.018, 0.078, -0.700 - i * 0.024); g.add(p); }
  const emit = cyl(0.012, 0.015, 0.012, energy, 10); emit.position.set(0, 0.078, -0.752); g.add(emit);

  // scope: rings, tube, objective bell + sunshade, ocular, turrets, glow lens
  for (const z of [-0.03, 0.13]) { const ring = box(0.022, 0.032, 0.022, dark); ring.position.set(0, 0.146, z); g.add(ring); }
  const tube = cyl(0.024, 0.024, 0.26, dark, 14); tube.position.set(0, 0.168, 0.05); g.add(tube);
  const bell = cyl(0.034, 0.026, 0.055, dark, 14); bell.position.set(0, 0.168, -0.10); g.add(bell);
  const shade = cyl(0.035, 0.035, 0.035, metal, 14); shade.position.set(0, 0.168, -0.145); g.add(shade);
  const objGlow = cyl(0.019, 0.019, 0.006, energy, 14); objGlow.position.set(0, 0.168, -0.158); g.add(objGlow);
  const ocular = cyl(0.028, 0.024, 0.045, dark, 14); ocular.position.set(0, 0.168, 0.195); g.add(ocular);
  const magRing = cyl(0.026, 0.026, 0.018, metal, 14); magRing.position.set(0, 0.168, 0.165); g.add(magRing);
  const lens = cyl(0.020, 0.020, 0.008, energy, 14); lens.position.set(0, 0.168, 0.220); g.add(lens);
  const elev = cyl(0.013, 0.013, 0.020, metal, 10, 0); elev.position.set(0, 0.200, 0.045); g.add(elev);
  const wind = cyl(0.013, 0.013, 0.020, metal, 10, 0); wind.rotation.z = Math.PI / 2; wind.position.set(0.034, 0.168, 0.045); g.add(wind);
  const para = cyl(0.011, 0.011, 0.016, metal, 10, 0); para.rotation.z = Math.PI / 2; para.position.set(-0.032, 0.168, 0.045); g.add(para);

  // 20-rd straight mag with ribs + witness glow
  const mag = box(0.048, 0.175, 0.068, dark); mag.position.set(0, -0.115, 0.010); mag.rotation.x = -0.06; g.add(mag);
  for (let i = 0; i < 3; i++) { const rib = box(0.052, 0.006, 0.060, metal); rib.position.set(0, -0.080 - i * 0.040, 0.014); g.add(rib); }
  const witness = box(0.012, 0.125, 0.008, energy); witness.position.set(0, -0.110, 0.046); witness.rotation.x = -0.06; g.add(witness);

  // stippled grip + palm shelf, trigger + guard
  const grip = box(0.050, 0.125, 0.056, body); grip.position.set(0, -0.066, 0.150); grip.rotation.x = 0.28; g.add(grip);
  stippleGrip(g, dark, 0, -0.070, 0.126, 0.032, 0.09, 3, 4);
  const shelf = box(0.054, 0.014, 0.050, dark); shelf.position.set(0, -0.128, 0.168); g.add(shelf);
  const trigger = box(0.010, 0.030, 0.008, metal); trigger.position.set(0, -0.024, 0.105); trigger.rotation.x = 0.25; g.add(trigger);
  const tgB = box(0.032, 0.008, 0.080, dark); tgB.position.set(0, -0.046, 0.09); g.add(tgB);
  const tgF = box(0.032, 0.030, 0.008, dark); tgF.position.set(0, -0.030, 0.052); g.add(tgF);

  // precision stock: body, adjustable cheek riser with knobs, buttpad, hook —
  // kept at receiver height so the back end doesn't outgrow the gun
  const stock = box(0.054, 0.082, 0.185, body); stock.position.set(0, 0.038, 0.285); g.add(stock);
  const riser = box(0.046, 0.022, 0.110, dark); riser.position.set(0, 0.088, 0.275); g.add(riser);
  for (const z of [0.235, 0.315]) { const knob = cyl(0.009, 0.009, 0.013, metal, 10, 0); knob.rotation.z = Math.PI / 2; knob.position.set(0.029, 0.062, z); g.add(knob); }
  const buttpad = box(0.052, 0.086, 0.016, dark); buttpad.position.set(0, 0.038, 0.382); g.add(buttpad);
  const hook = box(0.028, 0.026, 0.050, dark); hook.position.set(0, -0.012, 0.345); g.add(hook);
  const stGlow = box(0.010, 0.040, 0.10, energy); stGlow.position.set(0, 0.055, 0.285); g.add(stGlow);

  const muzzle = addMuzzle(g, 0, 0.078, -0.76);
  return { group: g, muzzle };
}

// energyshotgun — realistic tactical pump shotgun: vented heat shield over the
// barrel, under-barrel mag tube, grooved pump with action bars, side-saddle
// shell carrier with visible shells, ghost-ring sight, rubber recoil pad.
function buildSciFiScattergun(color, def = {}) {
  const eCol = def.energyColor ?? 0x3a86ff;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();
  const shellRed = M('accent', 0x8a2a22, { roughness: 0.6, metalness: 0.1 });
  const brass    = M('metal', 0xb8963a, { metalness: 0.9, roughness: 0.3 });

  // receiver — slim, barely taller than the barrel line, like a real shotgun
  const rec = box(0.062, 0.066, 0.26, body); rec.position.set(0, 0.062, 0.03); g.add(rec);
  const eport = box(0.006, 0.028, 0.085, metal); eport.position.set(0.032, 0.068, -0.01); g.add(eport);
  const bolt = box(0.012, 0.022, 0.055, metal); bolt.position.set(0.031, 0.068, 0.045); g.add(bolt);
  const lport = box(0.028, 0.006, 0.070, dark); lport.position.set(0, 0.032, 0.02); g.add(lport);

  // barrel + vented heat shield + bead sight; the bore glows faintly (energy)
  const brl = cyl(0.020, 0.020, 0.34, metal, 14); brl.position.set(0, 0.085, -0.29); g.add(brl);
  const shield = box(0.052, 0.030, 0.30, dark); shield.position.set(0, 0.104, -0.27); g.add(shield);
  railSlats(g, metal, 6, 0, 0.121, -0.15, 0.048, 0.036, 0.008);
  // energy bleed lines along the heat-shield flanks + mag-tube charge ring
  for (const sx of [-1, 1]) { const c = box(0.005, 0.008, 0.27, energy); c.position.set(sx * 0.028, 0.104, -0.27); g.add(c); }
  const tubeEmit = cyl(0.011, 0.013, 0.010, energy, 10); tubeEmit.position.set(0, 0.048, -0.443); g.add(tubeEmit);
  const fsHousing = box(0.020, 0.022, 0.024, dark); fsHousing.position.set(0, 0.120, -0.435); g.add(fsHousing);
  const bead = cyl(0.006, 0.006, 0.010, energy, 8, 0); bead.position.set(0, 0.138, -0.435); g.add(bead);
  const bore = cyl(0.013, 0.016, 0.012, energy, 12); bore.position.set(0, 0.085, -0.462); g.add(bore);
  const choke = cyl(0.022, 0.024, 0.020, dark, 14); choke.position.set(0, 0.085, -0.452); g.add(choke);

  // under-barrel magazine tube + end cap + barrel clamp
  const tubeMag = cyl(0.014, 0.014, 0.30, dark, 12); tubeMag.position.set(0, 0.048, -0.27); g.add(tubeMag);
  const cap = cyl(0.016, 0.016, 0.022, metal, 12); cap.position.set(0, 0.048, -0.428); g.add(cap);
  const clamp = box(0.048, 0.062, 0.016, metal); clamp.position.set(0, 0.066, -0.38); g.add(clamp);

  // grooved pump forend riding the mag tube + twin action bars
  const pump = box(0.062, 0.055, 0.13, body); pump.position.set(0, 0.042, -0.20); g.add(pump);
  for (let i = 0; i < 5; i++) { const gr = box(0.066, 0.008, 0.010, dark); gr.position.set(0, 0.030, -0.15 - i * 0.024); g.add(gr); }
  for (const sx of [-1, 1]) { const bar = box(0.006, 0.012, 0.16, metal); bar.position.set(sx * 0.030, 0.058, -0.10); g.add(bar); }

  // side-saddle shell carrier with four visible shells (brass heads down)
  const saddle = box(0.012, 0.058, 0.13, dark); saddle.position.set(-0.040, 0.062, 0.045); g.add(saddle);
  for (let i = 0; i < 4; i++) {
    const sh = cyl(0.009, 0.009, 0.046, shellRed, 8, 0); sh.position.set(-0.048, 0.066, -0.005 + i * 0.032); g.add(sh);
    const bh = cyl(0.010, 0.010, 0.010, brass, 8, 0); bh.position.set(-0.048, 0.040, -0.005 + i * 0.032); g.add(bh);
  }

  // ghost ring rear sight + short rail
  const rail = box(0.030, 0.010, 0.14, metal); rail.position.set(0, 0.100, 0.05); g.add(rail);
  const ghost = cyl(0.011, 0.011, 0.008, dark, 12); ghost.rotation.x = 0; ghost.position.set(0, 0.110, 0.09); g.add(ghost);

  // trigger group hangs directly off the receiver underside into the grip
  const trigger = box(0.010, 0.026, 0.008, metal); trigger.position.set(0, 0.008, 0.115); trigger.rotation.x = 0.25; g.add(trigger);
  const tgB = box(0.032, 0.008, 0.090, dark); tgB.position.set(0, -0.018, 0.105); g.add(tgB);
  const tgF = box(0.032, 0.050, 0.008, dark); tgF.position.set(0, 0.004, 0.062); g.add(tgF);
  const grip = box(0.048, 0.110, 0.056, body); grip.position.set(0, -0.038, 0.165); grip.rotation.x = 0.34; g.add(grip);
  stippleGrip(g, dark, 0, -0.044, 0.140, 0.032, 0.080, 3, 4);
  // stock runs forward to meet the receiver, held at receiver height
  const stock = box(0.054, 0.082, 0.24, body); stock.position.set(0, 0.048, 0.275); g.add(stock);
  const comb = box(0.046, 0.014, 0.20, dark); comb.position.set(0, 0.092, 0.285); g.add(comb);
  const pad = box(0.052, 0.086, 0.020, dark); pad.position.set(0, 0.048, 0.40); g.add(pad);
  const stud = cyl(0.006, 0.006, 0.012, metal, 8, 0); stud.position.set(0, 0.012, 0.34); g.add(stud);
  const cellGlow = box(0.010, 0.045, 0.08, energy); cellGlow.position.set(0, 0.055, 0.29); g.add(cellGlow);

  const muzzle = addMuzzle(g, 0, 0.085, -0.47);
  return { group: g, muzzle };
}

// plasmarifle — machined directed-energy rifle: clamshell body over an exposed
// glowing core with rib clamps, heat-sink fin stack, coolant line, forked
// emitter with focus ring, rear power-cell drum. Reads mechanical, not toy.
function buildSciFiPlasma(color, def = {}) {
  const eCol = def.energyColor ?? 0xb44bff;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();

  // clamshell body: chamfered top/bottom shells with an exposed core between.
  // The core gets its own dimmer emissive so it doesn't blow out to white.
  const coreMat = M('energy', new THREE.Color(eCol).multiplyScalar(0.15).getHex(),
    { roughness: 0.25, metalness: 0.1, emissive: eCol, emissiveIntensity: 1.3 });
  const topShell = box(0.050, 0.034, 0.56, dark); topShell.position.set(0, 0.104, -0.09); g.add(topShell);
  const topChamfer = box(0.038, 0.012, 0.52, metal); topChamfer.position.set(0, 0.124, -0.09); g.add(topChamfer);
  const botShell = box(0.050, 0.034, 0.42, body); botShell.position.set(0, 0.036, -0.03); g.add(botShell);
  const core = cyl(0.021, 0.021, 0.36, coreMat, 14); core.position.set(0, 0.070, -0.10); g.add(core);
  for (let i = 0; i < 5; i++) { const clampR = cyl(0.028, 0.028, 0.020, dark, 14); clampR.position.set(0, 0.070, -0.26 + i * 0.08); g.add(clampR);
    const bolt = box(0.008, 0.062, 0.010, metal); bolt.position.set(0, 0.070, -0.26 + i * 0.08); g.add(bolt); }

  // heat-sink fin stack on the top rear + coolant line down the left side
  for (let i = 0; i < 6; i++) { const fin = box(0.044, 0.020, 0.006, metal); fin.position.set(0, 0.130, 0.02 + i * 0.016); g.add(fin); }
  const pipeA = cyl(0.006, 0.006, 0.30, metal, 8); pipeA.position.set(-0.030, 0.094, -0.12); g.add(pipeA);
  const pipeB = cyl(0.006, 0.006, 0.10, metal, 8, 0); pipeB.position.set(-0.030, 0.055, 0.035); g.add(pipeB);
  const pipeJoint = cyl(0.009, 0.009, 0.016, dark, 8); pipeJoint.position.set(-0.030, 0.094, 0.03); g.add(pipeJoint);

  // side cooling vents (louvered)
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const v = box(0.006, 0.018, 0.010, dark); v.position.set(sx * 0.027, 0.104, -0.22 - i * 0.035); g.add(v); }

  // forked emitter: a nose cap closes the shells, then two slim separated
  // prongs reach forward with the arc glowing in the gap between their tips
  const noseCap = box(0.046, 0.048, 0.055, dark); noseCap.position.set(0, 0.076, -0.385); g.add(noseCap);
  const focus = cyl(0.024, 0.028, 0.020, dark, 12); focus.position.set(0, 0.070, -0.372); g.add(focus);
  for (const sx of [-1, 1]) { const pr = box(0.009, 0.032, 0.13, metal); pr.position.set(sx * 0.027, 0.076, -0.455); pr.rotation.y = sx * -0.06; g.add(pr); }
  const arc = box(0.044, 0.012, 0.020, energy); arc.position.set(0, 0.076, -0.50); g.add(arc);
  const tip = cyl(0.013, 0.017, 0.016, energy, 12); tip.position.set(0, 0.076, -0.445); g.add(tip);

  // iron sight blades
  const fsight = box(0.008, 0.018, 0.008, dark); fsight.position.set(0, 0.130, -0.33); g.add(fsight);
  const rsight = box(0.022, 0.014, 0.008, dark); rsight.position.set(0, 0.128, 0.115); g.add(rsight);

  // grip with stipple, trigger + guard
  const grip = box(0.048, 0.125, 0.058, body); grip.position.set(0, -0.055, 0.105); grip.rotation.x = 0.32; g.add(grip);
  stippleGrip(g, dark, 0, -0.060, 0.082, 0.032, 0.085, 3, 4);
  const trigger = box(0.010, 0.028, 0.008, metal); trigger.position.set(0, -0.012, 0.062); trigger.rotation.x = 0.28; g.add(trigger);
  const tgB = box(0.032, 0.008, 0.075, dark); tgB.position.set(0, -0.034, 0.05); g.add(tgB);
  const tgF = box(0.032, 0.028, 0.008, dark); tgF.position.set(0, -0.020, 0.015); g.add(tgF);

  // rear power-cell drum: knurled ring + glow window + eject lever
  const chamber = cyl(0.030, 0.030, 0.095, dark, 12); chamber.position.set(0, 0.062, 0.21); g.add(chamber);
  knurledCollar(g, metal, 0, 0.062, 0.17, 0.030, 10);
  const chGlow = cyl(0.020, 0.020, 0.100, energy, 12); chGlow.position.set(0, 0.062, 0.21); g.add(chGlow);
  const lever = box(0.010, 0.024, 0.030, metal); lever.position.set(0.034, 0.076, 0.23); g.add(lever);

  const muzzle = addMuzzle(g, 0, 0.070, -0.52);
  return { group: g, muzzle };
}

// needler — needle SMG built like a REAL firearm: boxy railed receiver,
// barrel shroud + multi-port needle muzzle, front/rear sights, curved energy
// magazine, stippled grip, skeleton stock — the crystal shard row rides in a
// top-mounted ammo rack like a transparent magazine. Pink glow.
function buildNeedler(color, def = {}) {
  const eCol = def.energyColor ?? 0xff4dd2;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const crystal = M('energy', new THREE.Color(eCol).multiplyScalar(0.25).getHex(),
    { roughness: 0.15, metalness: 0.1, emissive: eCol, emissiveIntensity: 2.2, transparent: true, opacity: 0.85 });
  const g = new THREE.Group();

  // ── receiver: boxy SMG body with a bottom accent plate and rear cap ──
  const receiver = box(0.058, 0.068, 0.30, body); receiver.position.set(0, 0.058, 0.03); g.add(receiver);
  const belly = box(0.050, 0.012, 0.26, dark); belly.position.set(0, 0.020, 0.02); g.add(belly);
  const rearCap = box(0.050, 0.060, 0.020, dark); rearCap.position.set(0, 0.058, 0.185); g.add(rearCap);
  // machined detail: panel seam lines, retaining screws, ejection port with a
  // steel rim, charging handle on the left — a manufactured receiver, not a slab
  for (const y of [0.038, 0.080]) { const seam = box(0.0592, 0.004, 0.27, dark); seam.position.set(0, y, 0.03); g.add(seam); }
  const vseam = box(0.0592, 0.048, 0.004, dark); vseam.position.set(0, 0.058, 0.135); g.add(vseam);
  for (const sx of [-1, 1]) for (const [py, pz] of [[0.074, -0.085], [0.074, 0.155], [0.042, -0.085], [0.042, 0.155]]) {
    const screw = cyl(0.0035, 0.0035, 0.004, metal, 8, 0); screw.rotation.z = Math.PI / 2; screw.position.set(sx * 0.0296, py, pz); g.add(screw);
  }
  const eject = box(0.006, 0.020, 0.055, metal); eject.position.set(0.0295, 0.066, -0.045); g.add(eject);
  const chandle = box(0.020, 0.010, 0.030, metal); chandle.position.set(-0.036, 0.076, 0.10); g.add(chandle);
  // glowing feed slits on the receiver flanks
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const slit = box(0.005, 0.016, 0.007, energy); slit.position.set(sx * 0.030, 0.058, 0.005 + i * 0.05); g.add(slit);
  }

  // ── top-mounted needle magazine: a translucent box mag (like a P90's) with
  // the glowing needle rounds stacked visibly inside — reads as real ammo in a
  // real container, not exposed spikes ──
  // ── top-mounted needle magazine: a SOLID armoured pod (matches the gun body,
  // recolours with skins) with a glowing energy charge-window down each flank
  // showing the needle reserve — clean sci-fi tech, not a clear plastic box ──
  const magBody = box(0.046, 0.064, 0.29, body); magBody.position.set(0, 0.126, 0.040); g.add(magBody);
  const magTop  = box(0.034, 0.016, 0.29, dark); magTop.position.set(0, 0.166, 0.040); g.add(magTop);
  const capF = box(0.050, 0.068, 0.016, dark); capF.position.set(0, 0.126, -0.092); g.add(capF);
  const capR = box(0.050, 0.068, 0.016, dark); capR.position.set(0, 0.126, 0.172); g.add(capR);
  // horizontal seam + retaining screws on the pod body (machined detail)
  const magSeam = box(0.0472, 0.004, 0.26, dark); magSeam.position.set(0, 0.146, 0.040); g.add(magSeam);
  for (const sx of [-1, 1]) for (const pz of [-0.05, 0.13]) {
    const s = cyl(0.003, 0.003, 0.005, metal, 8, 0); s.rotation.z = Math.PI / 2; s.position.set(sx * 0.0236, 0.104, pz); g.add(s);
  }
  // glowing charge window down each flank, segmented into discrete needle cells
  for (const sx of [-1, 1]) {
    const frame = box(0.006, 0.036, 0.24, dark); frame.position.set(sx * 0.023, 0.122, 0.040); g.add(frame);
    const win   = box(0.004, 0.028, 0.225, energy); win.position.set(sx * 0.0255, 0.122, 0.040); g.add(win);
    for (let i = 0; i < 8; i++) { const tick = box(0.005, 0.030, 0.005, dark); tick.position.set(sx * 0.0256, 0.122, -0.070 + i * 0.030); g.add(tick); }
  }
  // three crystal needle tips just breaking the front feed lip (identity accent)
  for (let i = 0; i < 3; i++) {
    const tip = cone(0.0075, 0.028, crystal, 6, 0);
    tip.position.set(0, 0.170, -0.068 + i * 0.026); tip.rotation.x = -0.25; g.add(tip);
  }
  // front feed throat where the needles drop down into the receiver
  const throat = box(0.042, 0.026, 0.026, dark); throat.position.set(0, 0.100, -0.078); g.add(throat);

  // ── iron sights raised on posts over the magazine spine (sighted over the
  // top mag, like a real top-fed SMG) ──
  const fsWing = box(0.016, 0.018, 0.010, dark); fsWing.position.set(0, 0.182, -0.090); g.add(fsWing);
  const fsPost = box(0.005, 0.014, 0.006, dark); fsPost.position.set(0, 0.190, -0.090); g.add(fsPost);
  const fsDot  = box(0.004, 0.004, 0.004, energy); fsDot.position.set(0, 0.197, -0.093); g.add(fsDot);
  const rsBase = box(0.024, 0.016, 0.014, dark); rsBase.position.set(0, 0.181, 0.150); g.add(rsBase);
  const rsNotch = box(0.006, 0.012, 0.008, dark); rsNotch.position.set(0, 0.189, 0.150); g.add(rsNotch);
  for (const sx of [-1, 1]) { const d = box(0.004, 0.004, 0.004, energy); d.position.set(sx * 0.008, 0.191, 0.153); g.add(d); }

  // ── barrel group: shroud with glowing vents, exposed barrel, needle head ──
  // a collar fairs the receiver into the slimmer shroud
  const collar = box(0.052, 0.058, 0.026, dark); collar.position.set(0, 0.058, -0.118); g.add(collar);
  const shroud = box(0.046, 0.050, 0.13, dark); shroud.position.set(0, 0.058, -0.185); g.add(shroud);
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const v = box(0.005, 0.014, 0.020, energy); v.position.set(sx * 0.024, 0.058, -0.150 - i * 0.045); g.add(v);
  }
  const brl = cyl(0.014, 0.014, 0.06, metal, 12); brl.position.set(0, 0.058, -0.275); g.add(brl);
  // multi-port needle muzzle: tapered head, steel face, seven glowing tubes
  const head = cyl(0.019, 0.023, 0.040, dark, 12); head.position.set(0, 0.058, -0.318); g.add(head);
  const face = cyl(0.017, 0.019, 0.010, metal, 12); face.position.set(0, 0.058, -0.340); g.add(face);
  const port0 = cyl(0.0040, 0.0040, 0.013, energy, 6); port0.position.set(0, 0.058, -0.343); g.add(port0);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const port = cyl(0.0040, 0.0040, 0.013, energy, 6);
    port.position.set(Math.cos(a) * 0.010, 0.058 + Math.sin(a) * 0.010, -0.343);
    g.add(port);
  }

  // ── curved energy magazine ahead of the trigger guard ──
  const mag = box(0.044, 0.155, 0.062, dark); mag.position.set(0, -0.052, -0.032); mag.rotation.x = -0.14; g.add(mag);
  for (let i = 0; i < 2; i++) { const rib = box(0.048, 0.006, 0.054, metal); rib.position.set(0, -0.030 - i * 0.045, -0.028 - i * 0.006); rib.rotation.x = -0.14; g.add(rib); }
  const magFloor = box(0.048, 0.013, 0.066, metal); magFloor.position.set(0, -0.128, -0.044); magFloor.rotation.x = -0.14; g.add(magFloor);
  const witness = box(0.011, 0.115, 0.007, energy); witness.position.set(0, -0.048, 0.000); witness.rotation.x = -0.14; g.add(witness);

  // ── grip, trigger + guard bridging up to the receiver ──
  const grip = box(0.046, 0.115, 0.056, body); grip.position.set(0, -0.038, 0.100); grip.rotation.x = 0.32; g.add(grip);
  stippleGrip(g, dark, 0, -0.044, 0.076, 0.030, 0.080, 3, 4);
  const trigger = box(0.010, 0.026, 0.008, metal); trigger.position.set(0, -0.002, 0.052); trigger.rotation.x = 0.3; g.add(trigger);
  const tgB = box(0.030, 0.008, 0.080, dark); tgB.position.set(0, -0.026, 0.032); g.add(tgB);
  const tgF = box(0.030, 0.034, 0.008, dark); tgF.position.set(0, -0.006, -0.004); g.add(tgF);

  // ── solid skeleton stock: twin struts framing an open window, ribbed pad ──
  const strutTop = box(0.022, 0.018, 0.115, dark); strutTop.position.set(0, 0.076, 0.245); g.add(strutTop);
  const strutLow = box(0.018, 0.014, 0.108, dark); strutLow.position.set(0, 0.032, 0.245); strutLow.rotation.x = -0.16; g.add(strutLow);
  const pad = box(0.046, 0.085, 0.020, body); pad.position.set(0, 0.052, 0.305); g.add(pad);
  const padRib = box(0.048, 0.088, 0.006, dark); padRib.position.set(0, 0.052, 0.317); g.add(padRib);

  const muzzle = addMuzzle(g, 0, 0.058, -0.35);
  return { group: g, muzzle };
}

// fuelrod — shoulder-fired fuel rod cannon: fat segmented tube, flared muzzle
// bell, side fuel canister with glowing windows, carry handle, front grip.
function buildFuelRod(color, def = {}) {
  const eCol = def.energyColor ?? 0x5cff7a;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();

  // main tube with segment rings + rivets (knurl sunk into the ring surface)
  const tube = cyl(0.045, 0.045, 0.52, body, 16); tube.position.set(0, 0.075, -0.13); g.add(tube);
  for (const z of [-0.34, -0.18, -0.02, 0.10]) {
    const ring = cyl(0.050, 0.050, 0.020, dark, 16); ring.position.set(0, 0.075, z); g.add(ring);
    knurledCollar(g, metal, 0, 0.075, z, 0.047, 8);
    const seam = cyl(0.0465, 0.0465, 0.007, energy, 16); seam.position.set(0, 0.075, z + 0.016); g.add(seam);
  }
  // flared muzzle bell + inner glow
  const bell = cyl(0.048, 0.062, 0.075, dark, 16); bell.position.set(0, 0.075, -0.435); g.add(bell);
  const bore = cyl(0.034, 0.046, 0.020, energy, 14); bore.position.set(0, 0.075, -0.465); g.add(bore);

  // rear breech + vent grill
  const breech = cyl(0.048, 0.040, 0.10, dark, 16); breech.position.set(0, 0.075, 0.18); g.add(breech);
  for (let i = 0; i < 4; i++) { const vent = box(0.070, 0.006, 0.010, metal); vent.position.set(0, 0.075, 0.145 + i * 0.018); g.add(vent); }

  // side fuel canister with three glowing windows + valve
  const can = cyl(0.024, 0.024, 0.15, dark, 12); can.position.set(0.058, 0.055, 0.01); g.add(can);
  for (let i = 0; i < 3; i++) { const win = box(0.010, 0.014, 0.026, energy); win.position.set(0.070, 0.055, -0.03 + i * 0.045); g.add(win); }
  const valve = cyl(0.010, 0.010, 0.014, metal, 8); valve.position.set(0.058, 0.055, 0.095); g.add(valve);

  // top carry handle + simple sights
  const handle = box(0.020, 0.014, 0.16, dark); handle.position.set(0, 0.155, -0.04); g.add(handle);
  for (const z of [-0.11, 0.03]) { const post = box(0.014, 0.032, 0.014, dark); post.position.set(0, 0.134, z); g.add(post); }
  const fs = box(0.006, 0.020, 0.006, metal); fs.position.set(0, 0.128, -0.30); g.add(fs);

  // front vertical grip + rear pistol grip + trigger + shoulder pad
  const fgrip = box(0.036, 0.090, 0.042, body); fgrip.position.set(0, -0.005, -0.25); fgrip.rotation.x = -0.15; g.add(fgrip);
  for (let i = 0; i < 3; i++) { const gr = box(0.040, 0.007, 0.008, dark); gr.position.set(0, -0.008 - i * 0.018, -0.247 - i * 0.003); g.add(gr); }
  const grip = box(0.046, 0.115, 0.056, body); grip.position.set(0, -0.025, 0.10); grip.rotation.x = 0.35; g.add(grip);
  const trigger = box(0.010, 0.026, 0.008, metal); trigger.position.set(0, 0.012, 0.055); trigger.rotation.x = 0.28; g.add(trigger);
  const tgB = box(0.030, 0.008, 0.070, dark); tgB.position.set(0, -0.010, 0.045); g.add(tgB);
  const pad = box(0.050, 0.110, 0.020, dark); pad.position.set(0, 0.060, 0.245); g.add(pad);

  const muzzle = addMuzzle(g, 0, 0.075, -0.48);
  return { group: g, muzzle };
}

// concussion — violet plasma mortar rifle: thick tapering barrel with glowing
// segment seams, wide aperture, humped receiver with spine fins, twin grips.
function buildConcussion(color, def = {}) {
  const eCol = def.energyColor ?? 0xb27bff;
  const { body, dark, metal, energy } = _sciFiMats(color, eCol);
  const g = new THREE.Group();

  // thick tapering barrel with glowing seams between segments
  const seg1 = cyl(0.040, 0.044, 0.14, body, 14); seg1.position.set(0, 0.075, -0.16); g.add(seg1);
  const seg2 = cyl(0.036, 0.040, 0.13, dark, 14); seg2.position.set(0, 0.075, -0.29); g.add(seg2);
  const seg3 = cyl(0.032, 0.036, 0.11, body, 14); seg3.position.set(0, 0.075, -0.40); g.add(seg3);
  for (const z of [-0.225, -0.35]) { const seam = cyl(0.041, 0.041, 0.010, energy, 14); seam.position.set(0, 0.075, z); g.add(seam); }
  // wide aperture: flare ring + inner glow
  const aper = cyl(0.034, 0.044, 0.030, dark, 14); aper.position.set(0, 0.075, -0.465); g.add(aper);
  const glowMouth = cyl(0.024, 0.034, 0.016, energy, 14); glowMouth.position.set(0, 0.075, -0.478); g.add(glowMouth);

  // humped receiver + spine fins + side plasma drum
  const rec = box(0.072, 0.095, 0.26, body); rec.position.set(0, 0.055, 0.04); g.add(rec);
  const hump = box(0.058, 0.040, 0.18, dark); hump.position.set(0, 0.125, 0.05); g.add(hump);
  for (let i = 0; i < 4; i++) { const fin = box(0.008, 0.026, 0.036, metal); fin.position.set(0, 0.155, -0.02 + i * 0.048); g.add(fin); }
  const drum = cyl(0.030, 0.030, 0.075, dark, 12, 0); drum.rotation.z = Math.PI / 2; drum.position.set(0.052, 0.060, 0.09); g.add(drum);
  const drumGlow = cyl(0.020, 0.020, 0.080, energy, 12, 0); drumGlow.rotation.z = Math.PI / 2; drumGlow.position.set(0.052, 0.060, 0.09); g.add(drumGlow);

  // underside vent slats + energy feed line into the barrel
  for (let i = 0; i < 3; i++) { const v = box(0.040, 0.008, 0.012, dark); v.position.set(0, 0.010, -0.14 - i * 0.05); g.add(v); }
  const feed = cyl(0.007, 0.007, 0.20, energy, 8); feed.position.set(0, 0.030, -0.20); g.add(feed);

  // blade sight
  const fs = box(0.008, 0.020, 0.008, dark); fs.position.set(0, 0.150, -0.40); g.add(fs);
  const rs = box(0.022, 0.014, 0.008, dark); rs.position.set(0, 0.150, 0.13); g.add(rs);

  // twin grips: angled foregrip + rear grip with stipple, trigger + guard
  const fgrip = box(0.038, 0.085, 0.044, body); fgrip.position.set(0, -0.008, -0.16); fgrip.rotation.x = -0.35; g.add(fgrip);
  const grip = box(0.048, 0.120, 0.058, body); grip.position.set(0, -0.045, 0.155); grip.rotation.x = 0.36; g.add(grip);
  stippleGrip(g, dark, 0, -0.050, 0.128, 0.032, 0.085, 3, 4);
  const trigger = box(0.010, 0.028, 0.008, metal); trigger.position.set(0, -0.002, 0.105); trigger.rotation.x = 0.28; g.add(trigger);
  const tgB = box(0.032, 0.008, 0.075, dark); tgB.position.set(0, -0.026, 0.09); g.add(tgB);
  const tgF = box(0.032, 0.028, 0.008, dark); tgF.position.set(0, -0.012, 0.055); g.add(tgF);

  const muzzle = addMuzzle(g, 0, 0.075, -0.49);
  return { group: g, muzzle };
}

function buildEnergyWeapon(color) {
  const g    = new THREE.Group();
  const body = M('body', color,    { roughness: 0.35, metalness: 0.75 });
  const trim = M('trim', 0x44aaff, { roughness: 0.20, metalness: 0.90,
                                      emissive: 0x003366, emissiveIntensity: 0.4 });
  const glow = M('glow', 0x00ccff, { roughness: 0.10, metalness: 0.50,
                                      emissive: 0x00aaff, emissiveIntensity: 1.2,
                                      transparent: true, opacity: 0.85 });
  const dark = M('dark', 0x080c14, { roughness: 0.60, metalness: 0.50 });

  const frame = box(0.06,  0.11, 0.40, body);  g.add(frame);
  const rail  = box(0.04,  0.04, 0.44, trim);  rail.position.set(0, 0.08, 0); g.add(rail);
  const grip  = box(0.055, 0.14, 0.07, dark);  grip.position.set(0, -0.10, 0.08); g.add(grip);
  const brl   = cyl(0.018, 0.018, 0.14, body, 8, 0); brl.position.set(0, 0.01, -0.27); g.add(brl);
  const core  = box(0.03,  0.07, 0.18, glow);  core.position.set(0, 0.02, 0.02); g.add(core);
  const tg    = box(0.03,  0.03, 0.09, trim);  tg.position.set(0, -0.04, 0.04); g.add(tg);

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.34); g.add(muzzle);
  g.position.set(0.06, -0.10, -0.30);
  return { group: g, muzzle };
}

function buildGravityHammer(color) {
  const g    = new THREE.Group();
  const body = M('body', color,    { roughness: 0.40, metalness: 0.70 });
  const glow = M('glow', 0xff6600, { roughness: 0.10, metalness: 0.30,
                                      emissive: 0xff4400, emissiveIntensity: 1.5,
                                      transparent: true, opacity: 0.90 });
  const dark = M('dark', 0x0a0804, { roughness: 0.60, metalness: 0.50 });

  const shaft = cyl(0.025, 0.025, 0.70, body, 8, 0); shaft.position.set(0, -0.05, 0.10); g.add(shaft);
  const head  = box(0.22,  0.18, 0.14, body); head.position.set(0,  0.03, -0.28); g.add(head);
  const gl1   = box(0.24,  0.04, 0.16, glow); gl1.position.set(0,   0.10, -0.28); g.add(gl1);
  const gl2   = box(0.24,  0.04, 0.16, glow); gl2.position.set(0,  -0.04, -0.28); g.add(gl2);
  const grip  = box(0.06,  0.14, 0.06, dark); grip.position.set(0, -0.12,  0.18); g.add(grip);

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.36); g.add(muzzle);
  g.position.set(0.10, -0.12, -0.20);
  return { group: g, muzzle };
}

// ===========================================================================
// Registry + export
// ===========================================================================

const BUILDERS = {
  sidearm:      buildSidearm,
  uzi:          buildUzi,
  levershotgun: buildLeverShotgun,
  m4:           buildSciFiAR,
  m16:          buildM16,
  rifle:        buildRifle,
  lmg:          buildLMG,
  rpg:          buildRPG,
  boltsniper:   buildBoltSniper,
  sword:        buildSword,
  knife:        buildKnife,
  // Halo/Destiny expanded arsenal
  magnum:       buildSciFiHandCannon,
  battlerifle:  buildSciFiBattleRifle,
  needler:      buildNeedler,
  plasmarifle:  buildSciFiPlasma,
  dmr:          buildAR10,
  fuelrod:      buildFuelRod,
  concussion:   buildConcussion,
  energyshotgun: buildSciFiScattergun,
  ghammer:      buildGravityHammer,
};

export function buildWeaponModel(weaponDef, opts = {}) {
  const authored = BLENDER_ARSENAL[weaponDef.id]
    && buildBlenderWeapon(_overrideTemplates.get(weaponDef.id), weaponDef);
  if (authored) return authored;
  const reference = !isCrazyGames() && buildReferenceWeapon(weaponDef);
  if (reference) return reference;
  // The original Auto Rifle takes precedence for M4. The normalized pack still
  // supplies other guns and remains the M4 fallback if its override is missing.
  // Procedural geometry is immediately available while requests are pending.
  const glb = !isCrazyGames() && hasLoadedWeaponModel(weaponDef.id) && _buildFromGLB(weaponDef);
  if (glb) return glb;

  // Fall back to procedural
  const builder = BUILDERS[weaponDef.id] ?? buildEnergyWeapon;
  const { group, muzzle } = builder(weaponDef.color, weaponDef);
  group.userData.weaponId = weaponDef.id;
  group.userData.weaponKind = weaponDef.kind;
  group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  return { group, muzzle };
}
