import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARMOR_LOOKS, buildHumanSoldier, isHumanSoldierReady, tintHumanSoldier } from './HumanSoldier.js';
import { buildLowPolyCharacter, getLowPolyPalette, isLowPolyId } from './LowPolyModels.js';
import { buildEvCharacter, isEvCharacterReady } from './EvCharacter.js';

// ── Blender-built Spartan GLB (the white/orange armoured soldier) ────────────
let _spartanTemplate = null, _spartanLoading = false;
const _spartanCbs = [];

/**
 * Resolve the equipped character's authored palette for the first-person arm.
 * This keeps FPS and third-person views on one source of truth even though
 * low-poly cyborgs, legacy soldiers and cosmetic armour use different data.
 */
export function resolveViewmodelPalette(skin, armorTypeId = 'vanguard', armorSkin = null) {
  if (armorTypeId === 'vanguard' && !armorSkin && (!skin || skin.id === 'default')) {
    // The live Vanguard preserves its GLB materials. Its arms must do the same,
    // rather than inherit the unrelated emergency low-poly body's palette.
    return { authored: true, plate: 0xf07808, sleeve: 0x242931, glove: 0x242931, accent: 0xc7ff34 };
  }
  if (armorSkin) {
    // Match tintHumanSoldier's actual rendered materials, rather than sending
    // raw catalog swatches to a second, unrelated darkening pass.
    const plate = new THREE.Color(armorSkin.primary).multiplyScalar(0.92).getHex();
    const sleeve = new THREE.Color(armorSkin.secondary)
      .lerp(new THREE.Color(0x4b5766), 0.42).getHex();
    const glove = new THREE.Color(armorSkin.secondary)
      .lerp(new THREE.Color(0x303844), 0.28).multiplyScalar(0.72).getHex();
    return {
      plate,
      sleeve,
      glove,
      accent: armorSkin.emissive ?? armorSkin.primary,
    };
  }

  if (isLowPolyId(armorTypeId)) {
    const pal = getLowPolyPalette(armorTypeId);
    return {
      // Use the authored secondary plate tone on the close-up gauntlet. The
      // broad chest colour is intentionally brighter and blows out to white
      // under the first-person camera's fill light.
      plate: pal.armor2,
      sleeve: pal.frame,
      glove: pal.joint,
      accent: pal.glow,
    };
  }

  const look = ARMOR_LOOKS[armorTypeId] || ARMOR_LOOKS.assault;
  return {
    plate: look.body,
    sleeve: skin?.secondary ?? 0x3a4048,
    glove: 0x15181d,
    accent: look.visor,
  };
}
export function preloadSpartanModel(onLoad) {
  if (isCrazyGames()) { onLoad?.(false); return; }
  if (onLoad) _spartanCbs.push(onLoad);
  if (_spartanTemplate) { onLoad?.(); return; }
  if (_spartanLoading) return;
  _spartanLoading = true;
  new GLTFLoader().load('/spartan.glb',
    (gltf) => {
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      _spartanTemplate = gltf.scene;
      _spartanLoading = false;
      _spartanCbs.splice(0).forEach((cb) => cb());
    },
    undefined,
    (err) => { console.warn('[Spartan] load failed:', err?.message); _spartanLoading = false; }
  );
}
export function isSpartanReady() { return !!_spartanTemplate; }
export function buildSpartanModel() {
  if (!_spartanTemplate) return null;
  const g = new THREE.Group();
  const m = _spartanTemplate.clone(true);
  m.traverse((o) => { if (o.isMesh && o.material) o.material = o.material.clone(); });
  g.add(m);
  g.userData = { isSpartan: true, primaryMat: null, secondaryMat: null };
  return g;
}

// ── Blender GLB player model loader ─────────────────────────────────────────
let _playerTemplate = null, _playerLoading = false;
const _loadCallbacks = [];

export function preloadPlayerModel(onLoad) {
  if (isCrazyGames()) { onLoad?.(false); return; }
  if (onLoad) _loadCallbacks.push(onLoad);
  if (_playerTemplate) { onLoad?.(); return; }
  if (_playerLoading) return;
  _playerLoading = true;
  new GLTFLoader().load('/player.glb',
    (gltf) => {
      _playerTemplate = gltf.scene;
      _playerLoading  = false;
      _loadCallbacks.splice(0).forEach(cb => cb());
    },
    undefined,
    (err) => { console.warn('[PlayerGLB] load failed:', err.message); _playerLoading = false; }
  );
}

function _buildFromGLB(skin, armorTypeId, armorSkin) {
  const armorRoot = _playerTemplate?.getObjectByName(`armor_${armorTypeId}`);
  if (!armorRoot) return null;

  const cloned = armorRoot.clone(true);
  cloned.position.set(0, 0, 0);
  // Blender -Y face → Three.js +Z; rotate 180° to match existing -Z facing convention
  cloned.rotation.y = Math.PI;

  const src = armorSkin || {};
  const P = new THREE.MeshStandardMaterial({
    color:             armorSkin ? armorSkin.primary   : skin.primary,
    roughness:         src.roughness         ?? 0.82,
    metalness:         src.metalness         ?? 0.06,
    emissive:          new THREE.Color(src.emissive ?? 0x000000),
    emissiveIntensity: src.emissiveIntensity ?? 0,
    envMapIntensity:   1.0,
  });
  const S = new THREE.MeshStandardMaterial({
    color:     armorSkin ? armorSkin.secondary : skin.secondary,
    roughness: (src.roughness ?? 0.82) * 1.1,
    metalness: (src.metalness ?? 0.06) * 0.2,
    envMapIntensity: 0.8,
  });

  cloned.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const n = obj.material.name || '';
    if      (n.endsWith('_Primary'))   obj.material = P;
    else if (n.endsWith('_Secondary')) obj.material = S;
    // Trim, DarkJoint, Visor materials kept from GLB
    obj.castShadow = obj.receiveShadow = true;
  });

  const g = new THREE.Group();
  g.add(cloned);
  g.userData = { primaryMat: P, secondaryMat: S, armorTypeId };
  return g;
}

// ---------------------------------------------------------------------------
// Shared fixed materials (not recolored by skins)
// ---------------------------------------------------------------------------
const _visorCyan = new THREE.MeshStandardMaterial({
  color: 0x00cfff, roughness: 0.06, metalness: 0.05,
  emissive: 0x00cfff, emissiveIntensity: 1.1,
  transparent: true, opacity: 0.84
});
const _visorGreen = new THREE.MeshStandardMaterial({
  color: 0x00ff88, roughness: 0.06, metalness: 0.05,
  emissive: 0x00ff88, emissiveIntensity: 0.9,
  transparent: true, opacity: 0.78
});
const _trimMat = new THREE.MeshStandardMaterial({
  color: 0x9aaab4, roughness: 0.22, metalness: 0.88
});
const _darkJoint = new THREE.MeshStandardMaterial({
  color: 0x08090c, roughness: 0.78, metalness: 0.08
});
const _skinMat  = new THREE.MeshStandardMaterial({ color: 0xc8a882, roughness: 0.82, metalness: 0.0 });
const _bootMat  = new THREE.MeshStandardMaterial({ color: 0x1c1a14, roughness: 0.88, metalness: 0.06 });
const _odMat    = new THREE.MeshStandardMaterial({ color: 0x3e4a2e, roughness: 0.90, metalness: 0.04 });
const _gloveMat = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.92, metalness: 0.04 });

// ---------------------------------------------------------------------------
// Primitive factories
// ---------------------------------------------------------------------------
function B(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function Cap(r, h, mat, segs = 8) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, h, segs, 12), mat);
}
function Cyl(r, h, mat, segs = 10) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), mat);
}
function Sph(r, mat, sw = 10, sh = 8) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, sw, sh), mat);
}

function add(g, mesh, x, y, z, rx = 0, ry = 0, rz = 0) {
  mesh.position.set(x, y, z);
  if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

function namedAdd(g, mesh, name, x, y, z, rx = 0, ry = 0, rz = 0) {
  mesh.name = name;
  return add(g, mesh, x, y, z, rx, ry, rz);
}

// ===========================================================================
// Shared human body base — BDU uniform, boots, skin face/hands.
// Every mesh that should animate with a limb carries a name matching
// rigCharacterLimbs() regexes so walk cycles work automatically.
// ===========================================================================
function _buildSoldierBase(g, P, S) {
  const SK = _skinMat, BT = _bootMat, BD = S;

  // ── Legs (left x=-0.13, right x=+0.13) ──
  for (const [sx, sd] of [[-0.13, 'L'], [0.13, 'R']]) {
    namedAdd(g, B(0.13, 0.06, 0.26, BT), `boot_${sd}`,     sx,  0.03,  0.02);
    namedAdd(g, B(0.12, 0.24, 0.15, BT), `boot_${sd}_u`,   sx,  0.18, -0.01);
    namedAdd(g, Cap(0.068, 0.27, BD, 8), `lleg_${sd}`,      sx,  0.54,  0);
    namedAdd(g, B(0.11, 0.09, 0.08, BD), `knee_${sd}`,      sx,  0.70, -0.03);
    namedAdd(g, Cap(0.092, 0.25, BD, 8), `thigh_${sd}`,     sx,  0.96,  0);
    namedAdd(g, B(0.09, 0.09, 0.07, BD), `thigh_${sd}_pkt`,
      sx + (sd === 'L' ? -0.05 : 0.05), 0.95, -0.08);
  }

  // ── Hips / belt ──
  add(g, B(0.32, 0.09, 0.25, BD),       0, 1.16, 0);
  add(g, B(0.34, 0.05, 0.27, _trimMat), 0, 1.21, 0);

  // ── Torso undersuit ──
  add(g, Cap(0.19, 0.40, BD, 8), 0, 1.48, 0);

  // ── Arms (left x=-0.33, right x=+0.33) ──
  for (const [sx, sd] of [[-0.33, 'L'], [0.33, 'R']]) {
    namedAdd(g, Cap(0.070, 0.22, BD, 8), `uarm_${sd}`,  sx, 1.51, 0);
    namedAdd(g, B(0.11, 0.08, 0.11, BD), `elbow_${sd}`, sx, 1.30, 0);
    namedAdd(g, Cap(0.060, 0.18, BD, 8), `farm_${sd}`,  sx, 1.08, 0);
    namedAdd(g, B(0.10, 0.10, 0.08, SK), `hand_${sd}`,  sx, 0.88, 0);
  }

  // ── Neck ──
  add(g, Cyl(0.066, 0.10, SK, 8), 0, 1.80, 0);

  // ── Head (skin sphere + face/chin overlays) ──
  add(g, Sph(0.150, SK, 10, 8),   0, 2.01,  0);
  add(g, B(0.17, 0.13, 0.04, SK), 0, 1.99, -0.13);
  add(g, B(0.11, 0.05, 0.04, SK), 0, 1.89, -0.11);
}

// ===========================================================================
// ASSAULT — standard plate carrier, ACH helmet
// ===========================================================================
function buildAssault(g, P, S) {
  _buildSoldierBase(g, P, S);
  const PL = P;

  // Front SAPI plate carrier
  add(g, B(0.40, 0.36, 0.09, PL), 0, 1.50, -0.17);
  for (let i = 0; i < 3; i++) add(g, B(0.38, 0.005, 0.09, _trimMat), 0, 1.38 + i * 0.10, -0.176);
  add(g, B(0.12, 0.12, 0.10, S),  0, 1.39, -0.23);  // admin pouch
  // Back plate + hydration carrier
  add(g, B(0.40, 0.34, 0.09, PL), 0, 1.50,  0.17);
  add(g, B(0.18, 0.22, 0.09, S),  0, 1.56,  0.25);
  // Side plates
  [-0.22, 0.22].forEach(px => add(g, B(0.07, 0.22, 0.07, PL), px, 1.50, 0));
  // Shoulder straps + pauldrons
  [-1, 1].forEach(s => {
    add(g, B(0.07, 0.24, 0.07, PL), s * 0.17, 1.65, -0.09);
    add(g, Sph(0.086, S),            s * 0.27, 1.70,  0);
    add(g, B(0.14, 0.07, 0.18, PL), s * 0.27, 1.70,  0);
  });
  // Knee pads (named — swing with the leg)
  for (const [sx, sd] of [[-0.13, 'L'], [0.13, 'R']]) {
    namedAdd(g, B(0.13, 0.12, 0.09, PL), `knee_${sd}_kp`, sx, 0.73, -0.09);
  }
  // ACH helmet: box shell + dome sphere + brims + ear pads + chin strap
  add(g, B(0.29, 0.16, 0.32, _odMat),     0, 2.14, 0.01);
  add(g, Sph(0.168, _odMat, 10, 7),        0, 2.17, 0.01);
  add(g, B(0.26, 0.04, 0.08, _odMat),      0, 2.07, -0.21);
  add(g, B(0.24, 0.04, 0.07, _odMat),      0, 2.07,  0.21);
  [-1, 1].forEach(s => add(g, B(0.04, 0.14, 0.22, _darkJoint), s * 0.182, 2.15, 0.01));
  add(g, B(0.20, 0.022, 0.04, _trimMat), 0, 1.89, -0.14);
}

// ===========================================================================
// RECON — lightweight chest rig, FAST helmet with NVG mount
// ===========================================================================
function buildRecon(g, P, S) {
  _buildSoldierBase(g, P, S);
  const PL = P;

  // Lightweight chest rig — front pouches, no full back plate
  add(g, B(0.34, 0.28, 0.07, PL), 0, 1.50, -0.14);
  for (let i = 0; i < 3; i++) add(g, B(0.32, 0.005, 0.07, _trimMat), 0, 1.40 + i * 0.09, -0.146);
  add(g, B(0.10, 0.10, 0.09, S),  0, 1.40, -0.20);  // utility pouch
  // Slim straps + small pauldrons
  [-0.15, 0.15].forEach(px => add(g, B(0.05, 0.22, 0.05, S), px, 1.63, -0.07));
  [-1, 1].forEach(s => {
    add(g, Sph(0.074, S),            s * 0.23, 1.67, 0);
    add(g, B(0.10, 0.05, 0.14, PL), s * 0.23, 1.67, 0);
  });
  // Slim back hydration pack
  add(g, B(0.20, 0.28, 0.08, S), 0, 1.52, 0.16);
  // Elbow pads (named — swing with arm)
  for (const [sx, sd] of [[-0.33, 'L'], [0.33, 'R']]) {
    namedAdd(g, B(0.10, 0.07, 0.09, PL), `elbow_${sd}_ep`, sx, 1.30, -0.07);
  }
  // FAST helmet — sleeker dome, smaller brims
  add(g, Sph(0.158, _odMat, 10, 8),    0, 2.14,  0);
  add(g, B(0.26, 0.14, 0.30, _odMat),  0, 2.11,  0);
  add(g, B(0.24, 0.035, 0.07, _odMat), 0, 2.06, -0.19);  // front brim
  add(g, B(0.22, 0.035, 0.06, _odMat), 0, 2.06,  0.19);  // rear brim
  // NVG mount bracket
  add(g, B(0.08, 0.04, 0.08, _trimMat),  0, 2.22, -0.11);
  add(g, B(0.14, 0.025, 0.04, _trimMat), 0, 2.25, -0.16);
  [-1, 1].forEach(s => add(g, B(0.03, 0.12, 0.18, _darkJoint), s * 0.168, 2.12, 0));
  add(g, B(0.18, 0.020, 0.04, _trimMat), 0, 1.89, -0.13);
}

// ===========================================================================
// HEAVY — full MTV vest, large MICH helmet, leg armor
// ===========================================================================
function buildHeavy(g, P, S) {
  _buildSoldierBase(g, P, S);
  const PL = P;

  // Full MTV front plate (wider coverage)
  add(g, B(0.48, 0.44, 0.10, PL), 0, 1.52, -0.19);
  for (let i = 0; i < 4; i++) add(g, B(0.46, 0.005, 0.10, _trimMat), 0, 1.36 + i * 0.09, -0.196);
  add(g, B(0.14, 0.14, 0.11, S),  0, 1.38, -0.26);
  // Back plate
  add(g, B(0.48, 0.42, 0.10, PL), 0, 1.52, 0.19);
  // Plate collar
  add(g, B(0.36, 0.08, 0.32, PL), 0, 1.79, 0);
  // Wide side plates
  [-0.25, 0.25].forEach(px => add(g, B(0.09, 0.30, 0.09, PL), px, 1.52, 0));
  // Heavy shoulder straps + large pauldrons
  [-1, 1].forEach(s => {
    add(g, B(0.09, 0.28, 0.08, PL), s * 0.20, 1.66, -0.09);
    add(g, Sph(0.11, S),             s * 0.32, 1.73,  0);
    add(g, B(0.20, 0.10, 0.24, PL), s * 0.32, 1.71,  0);
    add(g, B(0.22, 0.08, 0.26, PL), s * 0.32, 1.82,  0);
  });
  // Leg armor: greave plates + large knee pads (named — swing with leg)
  for (const [sx, sd] of [[-0.13, 'L'], [0.13, 'R']]) {
    namedAdd(g, B(0.13, 0.26, 0.08, PL), `lleg_${sd}_grv`, sx,  0.54, -0.11);
    namedAdd(g, B(0.14, 0.13, 0.10, PL), `knee_${sd}_kp`,  sx,  0.72, -0.11);
  }
  // Forearm vambraces (named — swing with arm)
  for (const [sx, sd] of [[-0.33, 'L'], [0.33, 'R']]) {
    namedAdd(g, B(0.13, 0.18, 0.08, PL), `farm_${sd}_va`, sx, 1.08, -0.10);
  }
  // Large MICH helmet
  add(g, B(0.32, 0.18, 0.36, _odMat),   0, 2.16, 0.01);
  add(g, Sph(0.182, _odMat, 10, 7),      0, 2.19, 0.01);
  add(g, B(0.28, 0.05, 0.09, _odMat),    0, 2.08, -0.22);
  add(g, B(0.26, 0.05, 0.08, _odMat),    0, 2.08,  0.23);
  [-1, 1].forEach(s => add(g, B(0.05, 0.18, 0.26, _darkJoint), s * 0.196, 2.17, 0.01));
  add(g, B(0.26, 0.08, 0.05, _trimMat),  0, 2.10, -0.23);  // visor rail
  add(g, B(0.22, 0.020, 0.04, _trimMat), 0, 1.89, -0.14);
}

// ===========================================================================
// STEALTH — minimal chest rig, soft balaclava, low-profile
// ===========================================================================
function buildStealth(g, P, S) {
  _buildSoldierBase(g, P, S);
  const PL = P;

  // Minimal chest rig (thin front panels, no back plate)
  add(g, B(0.30, 0.22, 0.07, PL), 0, 1.50, -0.12);
  for (let i = 0; i < 2; i++) add(g, B(0.28, 0.005, 0.07, _trimMat), 0, 1.42 + i * 0.09, -0.126);
  // Slim back utility pack
  add(g, B(0.14, 0.20, 0.08, S), 0, 1.56, 0.18);
  // Thin shoulder straps + minimal shoulder pads
  [-0.13, 0.13].forEach(px => add(g, B(0.05, 0.20, 0.05, S), px, 1.62, -0.06));
  [-1, 1].forEach(s => add(g, Sph(0.067, S), s * 0.21, 1.65, 0));
  // Wrist devices (named — swing with arm)
  for (const [sx, sd] of [[-0.33, 'L'], [0.33, 'R']]) {
    namedAdd(g, B(0.11, 0.07, 0.10, S),         `farm_${sd}_wr`, sx, 0.97, -0.02);
    namedAdd(g, B(0.03, 0.04, 0.014, _trimMat), `farm_${sd}_wt`, sx, 0.97, -0.079);
  }
  // Balaclava: fabric sphere covers head, face cover, eye slit
  add(g, Sph(0.158, S, 10, 8),              0, 2.01,  0.01);
  add(g, B(0.20, 0.17, 0.05, S),            0, 1.99, -0.14);
  add(g, B(0.15, 0.04, 0.025, _darkJoint),  0, 2.04, -0.185);  // eye slit
  // Soft cap / beanie on top
  add(g, Sph(0.162, _odMat, 10, 6), 0, 2.08, 0.02);
  add(g, B(0.30, 0.10, 0.33, _odMat), 0, 2.09, 0.01);
  add(g, B(0.02, 0.10, 0.04, _trimMat), 0, 1.89, -0.13);  // chin band
}

// ===========================================================================
// Public API
// ===========================================================================

const BUILDERS = {
  assault: buildAssault,
  recon:   buildRecon,
  heavy:   buildHeavy,
  stealth: buildStealth,
};

export function buildPreviewCharacter(skin, armorTypeId = 'vanguard', armorSkin = null, opts = {}) {
  if (isCrazyGames()) return buildLowPolyCharacter('vanguard');
  if (armorTypeId === 'vanguard' && isEvCharacterReady()) return buildEvCharacter(skin, armorSkin);
  // The default Vanguard is authored and animated in Blender. Prefer it before
  // the procedural roster check so gameplay callers that explicitly opt in do
  // not silently fall back to the old block-built body.
  if (armorTypeId === 'vanguard' && opts.allowHuman === true && isHumanSoldierReady()) {
    const human = buildHumanSoldier(skin, armorTypeId, armorSkin);
    if (human) return human;
  }
  // Low-poly cel-shaded models own their whole look (their own toon materials +
  // outlines. The connected HeroBody is the default gameplay chassis: one
  // continuous skinned surface with integrated helmet, chest and leg armor,
  // rather than the old rigid Blender mannequin. Rigged by the shared skeleton
  // so locomotion, weapon carry and hitboxes stay in lockstep.
  if (isLowPolyId(armorTypeId)) return buildLowPolyCharacter(armorTypeId);

  // The Blender-built Spartan (static mesh) — used for menu/loadout previews.
  if (opts.preferSpartan && isSpartanReady()) {
    const sp = buildSpartanModel();
    if (sp) return sp;
  }
  // The layered Soldier is retained for direct pose/carry tooling, but it is
  // no longer an implicit runtime fallback. A caller must opt in explicitly;
  // every normal player, bot, remote, and menu path stays on connected bodies.
  if (opts.allowHuman === true && isHumanSoldierReady()) {
    const human = buildHumanSoldier(skin, armorTypeId, armorSkin);
    if (human) return human;
  }

  // A slow/failed optional Soldier download must never put the old rigid
  // parts-bin GLB/procedural mannequin into a live match. Fall back to the
  // connected, weighted arena body whose gait and complete-mesh carry are gated.
  // The requested kit remains selected; Game upgrades this body in place when
  // the Soldier rig finishes loading.
  const arenaFallback = {
    assault: 'vanguard',
    recon: 'striker',
    heavy: 'vanguard',
    stealth: 'phantom',
  }[armorTypeId];
  if (arenaFallback) {
    const fallback = buildLowPolyCharacter(arenaFallback);
    fallback.userData.fallbackForArmorType = armorTypeId;
    return fallback;
  }

  // Non-roster preview IDs can still use the old imported fallback.
  const glbResult = _buildFromGLB(skin, armorTypeId, armorSkin);
  if (glbResult) return glbResult;

  // Fall back to procedural
  const g = new THREE.Group();

  const src = armorSkin || {};
  const primaryColor   = armorSkin ? armorSkin.primary   : skin.primary;
  const secondaryColor = armorSkin ? armorSkin.secondary : skin.secondary;

  const P = new THREE.MeshStandardMaterial({
    color:             primaryColor,
    roughness:         src.roughness         ?? 0.82,
    metalness:         src.metalness         ?? 0.06,
    emissive:          new THREE.Color(src.emissive ?? 0x000000),
    emissiveIntensity: src.emissiveIntensity ?? 0,
  });
  const S = new THREE.MeshStandardMaterial({
    color:     secondaryColor,
    roughness: (src.roughness ?? 0.82) * 1.1,
    metalness: (src.metalness ?? 0.06) * 0.2,
  });

  const builder = BUILDERS[armorTypeId] || buildAssault;
  builder(g, P, S);

  g.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow    = true;
      obj.receiveShadow = true;
    }
  });

  g.userData = { primaryMat: P, secondaryMat: S, armorTypeId };
  return g;
}

export function applySkinToCharacter(group, skin, armorSkin = null) {
  if (group.userData?.isEvCharacter) { group.userData.applyFinish(skin, armorSkin); return; }
  // Low-poly models ship a designed cel palette — leave it intact.
  if (group.userData?.isLowPoly) return;
  // Human soldier: tint the body texture instead of recoloring armor plates.
  if (group.userData?.isHuman) { tintHumanSoldier(group, skin, armorSkin); return; }

  const { primaryMat, secondaryMat } = group.userData;
  if (!primaryMat || !secondaryMat) return;
  primaryMat.color.setHex(armorSkin ? armorSkin.primary   : skin.primary);
  secondaryMat.color.setHex(armorSkin ? armorSkin.secondary : skin.secondary);
  if (armorSkin) {
    primaryMat.roughness         = armorSkin.roughness         ?? 0.42;
    primaryMat.metalness         = armorSkin.metalness         ?? 0.52;
    primaryMat.emissive.setHex(armorSkin.emissive ?? 0x000000);
    primaryMat.emissiveIntensity = armorSkin.emissiveIntensity ?? 0;
  }
}

// ===========================================================================
// Limb rigging for the third-person body
// ---------------------------------------------------------------------------
// The character is a flat collection of armour plates (named GLB nodes). To
// animate a walk cycle we regroup those plates into four pivots — left/right
// shoulder and left/right hip — so each limb can swing about its joint.
// Returns a rig object { armL, armR, legL, legR } or null when it can't rig
// (e.g. the procedural fallback, whose meshes are unnamed).
// ===========================================================================
const _ARM_RE = /uarm|farm|elbow|hand|shoulder|pau|pvs/i;
const _LEG_RE = /thigh|lleg|knee|boot|shinp|sole|grv|kn_|knsph|tpl|cg_/i;
// Lower-limb parts split off onto a second bone (elbow / knee) so limbs BEND
// instead of swinging rigid — the difference between a natural walk and a march.
const _ARM_LO = /farm|forearm|hand|elbow|wrist/i;
const _LEG_LO = /lleg|shin|calf|boot|sole|foot|toe|ankle|knee|grv|kn_|knsph/i;
// …and the foot splits off again onto a third bone (the ankle) so the sole can
// stay level through stance and push off at the end of it, instead of the whole
// foot rotating rigidly with the shin.
const _LEG_FT = /boot|sole|foot|toe|ankle/i;

export function rigCharacterLimbs(group) {
  try {
    // A skinned body arrives already rigged: its joints are bones, positioned
    // by construction, and re-parenting its meshes into pivot groups would tear
    // the skin off the skeleton. Hand back the rig it was built with.
    if (group.userData?.rig) return group.userData.rig;
    group.updateWorldMatrix(true, true);
    // Work in the GROUP's local space, not world space. Limbs are bucketed
    // left/right by their x, and callers rig AFTER placing the character — so
    // reading world positions meant a bot spawned at x=24 had every limb land
    // in the "right" bucket, the left ones came up empty, and rigging returned
    // null. Only characters standing near x=0 ever rigged.
    const _toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();

    const meshes = [];
    group.traverse((o) => { if (o.isMesh && o.name) meshes.push(o); });
    if (!meshes.length) return null; // procedural / unnamed — leave un-rigged

    // Each limb splits into an UPPER set (rides the root pivot) and a LOWER set
    // (rides the joint pivot, a child of the root).
    const buckets = {
      armL: { up: [], lo: [] }, armR: { up: [], lo: [] },
      legL: { up: [], lo: [], ft: [] }, legR: { up: [], lo: [], ft: [] },
    };
    const wp = new THREE.Vector3();
    for (const m of meshes) {
      m.getWorldPosition(wp).applyMatrix4(_toLocal);
      const side = wp.x < 0 ? 'L' : 'R';
      if (_ARM_RE.test(m.name) && Math.abs(wp.x) > 0.12) {
        buckets['arm' + side][_ARM_LO.test(m.name) ? 'lo' : 'up'].push(m);
      } else if (_LEG_RE.test(m.name) && Math.abs(wp.x) > 0.04) {
        const b = buckets['leg' + side];
        (_LEG_FT.test(m.name) ? b.ft : _LEG_LO.test(m.name) ? b.lo : b.up).push(m);
      }
    }

    // Build a limb chain: a root pivot at rootY, a joint (knee/elbow) pivot at
    // jointY parented to it, and — for legs — a third tip pivot (the ankle) at
    // tipY parented to the joint. Returns { root, joint, tip } or null if too
    // sparse.
    const makeLimb = (parts, rootY, jointY, tipY) => {
      const ft = parts.ft || [];
      const all = [...parts.up, ...parts.lo, ...ft];
      if (all.length < 2) return null;
      let ax = 0;
      for (const m of all) { m.getWorldPosition(wp).applyMatrix4(_toLocal); ax += wp.x; }
      ax /= all.length;
      const root = new THREE.Group();
      root.position.set(ax, rootY, 0);
      group.add(root);
      const joint = new THREE.Group();
      joint.position.set(0, jointY - rootY, 0);   // local to root → world (ax, jointY, 0)
      root.add(joint);
      let tip = null;
      if (tipY != null && ft.length) {
        tip = new THREE.Group();
        tip.position.set(0, tipY - jointY, 0);    // local to joint → world (ax, tipY, 0)
        joint.add(tip);
      }
      root.updateWorldMatrix(true, true);
      for (const m of parts.up) root.attach(m);    // attach() preserves world transform
      for (const m of parts.lo) joint.attach(m);
      for (const m of ft) (tip || joint).attach(m);
      return { root, joint, tip };
    };

    const legL = makeLimb(buckets.legL, 1.21, 0.62, 0.27);
    const legR = makeLimb(buckets.legR, 1.21, 0.62, 0.27);
    const armL = makeLimb(buckets.armL, 1.76, 1.28);
    const armR = makeLimb(buckets.armR, 1.76, 1.28);
    if (!legL || !legR || !armL || !armR) return null;

    // Back-compatible API: rig.legL/armL are the ROOT (hip/shoulder) pivots, so
    // existing `rig.legL.rotation.x = …` still swings the whole limb. The
    // .kneeL/.kneeR/.elbowL/.elbowR joints add the bend, and .ankleL/.ankleR
    // the foot roll (null on rigs whose feet couldn't be split out).
    const rig = {
      armL: armL.root, armR: armR.root, legL: legL.root, legR: legR.root,
      elbowL: armL.joint, elbowR: armR.joint, kneeL: legL.joint, kneeR: legR.joint,
      ankleL: legL.tip, ankleR: legR.tip,
    };
    group.userData.rig = rig;
    return rig;
  } catch (e) {
    console.warn('[rigCharacterLimbs] failed:', e.message);
    return null;
  }
}
