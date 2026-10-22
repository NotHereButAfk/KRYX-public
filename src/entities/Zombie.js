import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import * as THREE from 'three';
import { groundPerCycle } from '../player/Locomotion.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildWeaponModel, hasLoadedWeaponModel } from '../weapons/WeaponModels.js';
import { getWeapon } from '../weapons/weaponDefs.js';

const DETECT_RADIUS   = 22;
const ATTACK_RADIUS   = 1.7;
const ATTACK_COOLDOWN = 1.5;
const RADIUS          = 0.5;

// ── the shamble ──────────────────────────────────────────────────────────────
// Amplitudes for the asymmetric limp: one leg drags, the other drives.
//
// The knees are NEGATIVE and keyed off cosine, and both of those are load-
// bearing. A knee only folds backwards, so a positive rotation here bends it
// the wrong way; and it has to bend through its own leg's FORWARD SWING, which
// for a hip on sin(t) is where cos(t) leads it. Shipped, they were positive and
// keyed on sin(t) — bending through the stance instead of the swing, which
// lifts the foot exactly when it should be planted. Combined with a phase that
// ignored ground speed entirely, the horde covered 4% of its travel with its
// feet and skated the other 96%.
//
// Legs this length can't deliver more than about a metre of ground per cycle,
// which is what sets the cadence once the phase is driven off distance.
const ZGAIT = { hipWeak: 0.45, hipStrong: 0.62, kneeWeak: 0.55, kneeStrong: 0.70 };
// Leg geometry, from _buildLeg: hip y=1.06, knee -0.48, ankle -0.42, and a
// 0.20 x 0.10 x 0.28 foot box at (0, -0.052, 0.04) under the ankle.
const ZLEG = { hipY: 1.06, thigh: 0.48, shin: 0.42,
               soleY: -0.102, toeZ: -0.10, heelZ: 0.18 };

// Ranged attack configs per weapon type
const ARMED_CFG = {
  pistol:  { stopRange: 7,  chaseRange: 13, cooldown: 2.0,  damage: 8,  accuracy: 0.68, color: 0x2a2a2a },
  rifle:   { stopRange: 11, chaseRange: 17, cooldown: 1.1,  damage: 12, accuracy: 0.80, color: 0x1a1a1a },
  shotgun: { stopRange: 5,  chaseRange: 11, cooldown: 2.4,  damage: 22, accuracy: 0.55, color: 0x3d2a10 },
};

let _nextId = 5000;

// Frame-rate-independent smoothing factor for lerp/slerp toward a target.
const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

export const ZOMBIE_DEATH_SECONDS = 0.65;

/**
 * Apply the skeletal death pose from the pose captured at the instant of
 * death. This must assign an absolute offset: adding the eased target every
 * frame makes the corpse fold farther at higher refresh rates.
 */
export function applyZombieDeathCrumple(rig, baseSpineX, baseHeadX, eased) {
  if (!rig) return;
  rig.spineGroup.rotation.x = baseSpineX + eased * 0.4;
  rig.headGroup.rotation.x  = baseHeadX  + eased * 0.3;
}

// ── DIVERSITY palettes — each zombie draws a distinct look from these, so a
// horde reads as many different corpses, not one recolored template. ──────────
const SKIN_TONES = [
  0x8a9a6b, // green rot
  0x9a9488, // ashen grey
  0xb0a25c, // jaundiced yellow
  0x8a6a74, // bruised purple
  0x7c8f84, // pallid teal
  0xa6785e, // leathery tan
  0x6f7a5e, // deep moss
  0xc9c3b4, // bloodless pale
];
const SUIT_TONES = [
  0x2a3225, // olive drab
  0x212329, // black ops
  0x3a3122, // desert tan
  0x233039, // navy
  0x3a251d, // rust brown
  0x2e2a34, // charcoal violet
  0x445236, // field green
];
// Eye/vein glow (shamblers roll one; runner/brute keep their variant glow).
const EYE_GLOWS = [0x35e0ff, 0x54ff5e, 0xffb020, 0xff3a3a, 0xb44dff, 0xe8f0ff, 0xff7a1e];
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ─── Visual/stat variants — so waves aren't clone armies ──────────────────────
// shambler: the base UNIT-73 trooper. runner: armor torn away, toxic-green
// glow, fast and frail. brute: scaled up, blood-red glow, slow and tanky.
// Armed zombies always use the shambler look (they need the full kit).
const VARIANTS = {
  shambler: { speed: 1.0,  hp: 1.0, dmg: 1.0, scale: 1.0,  anim: 1.0, stride: 1.0 },
  runner:   { speed: 1.65, hp: 0.6, dmg: 0.8, scale: 0.94, anim: 1.7, stride: 0.85, glow: 0x3aff5e,
              hide: /PlateChest|PlateCollar|PlateBack|PlatePack|PlateAb|PlateBelt|PlateName|PlateAntenna|Pauldron|GreaveThigh|GreaveShin|GuardKnee|PouchCanteen|TrimChest|TrimAb|TrimRail|TrimPauld|TrimBuckle|SocketSeam|SocketNameBand/ },
  brute:    { speed: 0.72, hp: 2.4, dmg: 1.8, scale: 1.22, anim: 0.75, stride: 1.30, glow: 0xff2e18 },
};

// ─── GLB model loader (preloaded once, shared across all zombie instances) ────

let _glbTemplate = null;
let _glbTemplates = [];
let _glbPromise = null;

export function preloadZombieModel() {
  if (isCrazyGames()) return Promise.resolve(false);
  if (_glbPromise) return _glbPromise;
  const loader = new GLTFLoader();
  _glbPromise = loader.loadAsync('/zombie-roster.glb').then(gltf => {
    _glbTemplates = gltf.scene.children.filter(o => Number.isInteger(o.userData.variantId))
      .sort((a,b) => a.userData.variantId-b.userData.variantId);
    if (_glbTemplates.length !== 20) throw new Error('Incomplete zombie roster');
    return true;
  }).catch(async error => {
    console.warn('[Zombie] roster load failed:', error.message);
    try { _glbTemplate = (await loader.loadAsync('/zombie.glb')).scene; return true; }
    catch { _glbPromise = null; return false; }
  });
  return _glbPromise;
}

export function buildZombieRigFromGLB(mat = null, modelVariant = 0) {
  const template = _glbTemplates[Math.abs(modelVariant|0) % 20] || _glbTemplate;
  if (!template) return null;
  const authored = _glbTemplates.length === 20;
  const glbScene = template.clone(true);
  const materialClones = new Map();
  glbScene.traverse(o => {
    if (o.userData.rigName) o.name = o.userData.rigName;
    if (!o.isMesh) return;
    o.geometry.userData.shared = true;
    const clone = m => {
      if (!materialClones.has(m)) materialClones.set(m,m.clone());
      return materialClones.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
    o.castShadow = true;
  });

  // Replace Blender-exported materials with our canvas-PBR Three.js materials
  glbScene.traverse(obj => {
    if (!obj.isMesh || authored || !mat) return;
    const n = obj.name;
    if (/EyeGlow/.test(n))
      obj.material = mat.eye;                                         // cyan glow (checked first)
    else if (/Plasma/.test(n))
      obj.material = mat.glowB;                                       // magenta glow
    else if (/Trim/.test(n))
      obj.material = mat.trim;                                        // orange hazard trim
    else if (/Bone|Tooth|Sternum|Vert\d|Rib|Kneecap|AnkleBall|WristBall|ElbowBall|ShoulderBall/.test(n))
      obj.material = mat.bone;
    else if (/Wound|Blood/.test(n))
      obj.material = mat.blood;
    else if (/Plate|Armor|Helm|Guard|Greave|Pauldron|Gaunt|Boot/.test(n))
      obj.material = mat.armor;                                       // sci-fi combat plate
    else if (/Suit|Vest|Pant|Belt|Pouch/.test(n))
      obj.material = mat.suit;                                        // olive fatigues
    else if (/HairL/.test(n))
      obj.material = mat.hairL;
    else if (/Hair/.test(n))
      obj.material = mat.hair;
    else if (/Strap/.test(n))
      obj.material = mat.strap;
    else if (/Rot/.test(n))
      obj.material = mat.deadFlesh;                                   // reddish decay patches
    else if (/Claw|Thumb|Bolt/.test(n))
      obj.material = mat.dark;
    else if (/EyeDark|Socket/.test(n))
      obj.material = mat.dark;
    else
      obj.material = mat.flesh;
    obj.castShadow = true;
  });

  // Wrapper group so torsoGroup.position.y bob works without disturbing spineGroup
  const root       = new THREE.Group();
  const torsoGroup = new THREE.Group();
  root.add(torsoGroup);
  torsoGroup.add(glbScene);

  const spineGroup = glbScene.getObjectByName('spineGroup') || torsoGroup;
  const neckGroup  = glbScene.getObjectByName('neckGroup')  || spineGroup;
  const headGroup  = glbScene.getObjectByName('headGroup')  || neckGroup;

  // Eye glow light attached to the glowing eye mesh
  const eyeGlowMesh = glbScene.getObjectByName('ZEyeGlow');
  const eyeGlow = new THREE.PointLight(0x1ce0ff, 0.85, 1.9, 2);
  // (sky-only lighting) eyeGlow not added to scene

  const get = (name) => glbScene.getObjectByName(name) || spineGroup;

  return {
    root, torsoGroup, spineGroup, neckGroup, headGroup, authored,
    arms: {
      left:  { shoulder: get('L_shoulder'), elbow: get('L_elbow'), wrist: get('L_wrist') },
      right: { shoulder: get('R_shoulder'), elbow: get('R_elbow'), wrist: get('R_wrist') },
    },
    legs: {
      left:  { hip: get('L_hip'), knee: get('L_knee'), ankle: get('L_ankle') },
      right: { hip: get('R_hip'), knee: get('R_knee'), ankle: get('R_ankle') },
    },
    jaw: glbScene.getObjectByName('ZJawBone') || null,   // hanging mandible (chatter anim)
    mat, eyeGlow,
  };
}

// ─── Canvas PBR texture generators (cached at module level) ──────────────────

let _skinNTex = null, _skinRTex = null, _clothNTex = null;

function _mkTex(size, fn, repeat = 5) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); fn(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 16; return t;
}

function _skinNormal() {
  return _skinNTex ??= _mkTex(512, (ctx, sz) => {
    ctx.fillStyle = '#8080ff'; ctx.fillRect(0, 0, sz, sz);
    // pores
    for (let i = 0; i < 2800; i++) {
      const x = Math.random()*sz, y = Math.random()*sz, r = 0.8 + Math.random()*2.2;
      const b = 82 + Math.floor(Math.random()*55);
      const g = ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,`rgba(${b},${b},200,0.92)`); g.addColorStop(1,'rgba(128,128,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,6.28); ctx.fill();
    }
    // skin creases / wrinkles
    for (let i = 0; i < 45; i++) {
      const x=Math.random()*sz, y=Math.random()*sz, len=18+Math.random()*52, a=Math.random()*Math.PI;
      ctx.strokeStyle=`rgba(68,78,195,${0.18+Math.random()*0.28})`; ctx.lineWidth=1+Math.random()*2.5;
      ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x,y);
      ctx.quadraticCurveTo(x+(Math.random()-.5)*22,y+(Math.random()-.5)*22,x+Math.cos(a)*len,y+Math.sin(a)*len);
      ctx.stroke();
    }
  });
}

function _skinRoughness() {
  return _skinRTex ??= _mkTex(512, (ctx, sz) => {
    ctx.fillStyle='#c4c4c4'; ctx.fillRect(0,0,sz,sz); // base ~0.77 roughness
    // dry / cracked patches (higher roughness)
    for (let i=0;i<14;i++){
      const x=Math.random()*sz, y=Math.random()*sz, r=22+Math.random()*58;
      const g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba(240,240,240,0.88)'); g.addColorStop(1,'rgba(196,196,196,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,6.28); ctx.fill();
    }
    // wet / bloody patches (low roughness → dark)
    for (let i=0;i<9;i++){
      const x=Math.random()*sz, y=Math.random()*sz, r=10+Math.random()*28;
      const g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba(18,18,18,0.96)'); g.addColorStop(0.55,'rgba(40,40,40,0.7)'); g.addColorStop(1,'rgba(196,196,196,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,6.28); ctx.fill();
    }
  });
}

function _clothNormal() {
  return _clothNTex ??= _mkTex(256, (ctx, sz) => {
    ctx.fillStyle='#8080ff'; ctx.fillRect(0,0,sz,sz);
    // horizontal threads
    for (let y=0;y<sz;y+=5){ctx.fillStyle=`rgba(95,95,205,${y%10===0?0.55:0.30})`;ctx.fillRect(0,y,sz,2);}
    // vertical threads
    for (let x=0;x<sz;x+=5){ctx.fillStyle=`rgba(148,148,228,${x%10===0?0.42:0.22})`;ctx.fillRect(x,0,2,sz);}
  }, 8);
}

// ─── Material factory ─────────────────────────────────────────────────────────

function makeMats() {
  const sN = _skinNormal(), sR = _skinRoughness(), cN = _clothNormal();

  // Rotting flesh — desaturated gray-olive, like the reference
  const flesh = new THREE.MeshPhysicalMaterial({
    color: 0x8a9478, roughness: 0.72, metalness: 0.0,
    clearcoat: 0.14, clearcoatRoughness: 0.65,
    sheen: 0.38, sheenRoughness: 0.65, sheenColor: new THREE.Color(0x1a1f10),
    emissive: new THREE.Color(0x050800), emissiveIntensity: 0.08,
    normalMap: sN, normalScale: new THREE.Vector2(0.62, 0.62),
    roughnessMap: sR,
  });

  // Extremities — very dark, almost blackened (decomposed digits)
  const skin2 = new THREE.MeshPhysicalMaterial({
    color: 0x353830, roughness: 0.85, metalness: 0.0,
    clearcoat: 0.08, clearcoatRoughness: 0.80,
    emissive: new THREE.Color(0x030302), emissiveIntensity: 0.06,
    normalMap: sN, normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: sR,
  });

  // Face — gaunt skull-like, slightly paler with lividity
  const faceSkin = new THREE.MeshPhysicalMaterial({
    color: 0x97a284, roughness: 0.70, metalness: 0.0,
    clearcoat: 0.18, clearcoatRoughness: 0.60,
    sheen: 0.30, sheenRoughness: 0.68, sheenColor: new THREE.Color(0x141810),
    normalMap: sN, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: sR,
  });

  // Torn clothing — almost black, very worn
  const rag = new THREE.MeshStandardMaterial({
    color: 0x1a1208, roughness: 0.98, metalness: 0.0,
    normalMap: cN, normalScale: new THREE.Vector2(0.40, 0.40),
  });

  // Exposed bone — ivory/yellowed, slight sheen
  const bone = new THREE.MeshPhysicalMaterial({
    color: 0xcfbd92, roughness: 0.58, metalness: 0.02,
    clearcoat: 0.22, clearcoatRoughness: 0.52,
    emissive: new THREE.Color(0x050400), emissiveIntensity: 0.05,
  });

  // Primary glow — bright cyan reactor light (eyes + chest energy nodes).
  // Near-black base so the emissive reads as saturated cyan under the ACES
  // tone mapping instead of clipping to white (same as the gun energy parts).
  const eye = new THREE.MeshStandardMaterial({
    color: 0x061a24, emissive: new THREE.Color(0x1ce0ff), emissiveIntensity: 2.0,
    roughness: 0.30, metalness: 0.0,
  });

  // Secondary glow — magenta plasma (the power gauntlet + one chest node).
  const glowB = new THREE.MeshStandardMaterial({
    color: 0x1a0622, emissive: new THREE.Color(0xc040ff), emissiveIntensity: 2.0,
    roughness: 0.30, metalness: 0.0,
  });

  // Deep socket / interior shadow
  const dark = new THREE.MeshStandardMaterial({ color: 0x030201, roughness: 1.0, metalness: 0.0 });

  // Matted brown hair + lighter streaks
  const hair  = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95, metalness: 0.0 });
  const hairL = new THREE.MeshStandardMaterial({ color: 0x77593a, roughness: 0.92, metalness: 0.0 });

  // Worn leather straps / webbing — warm tan, adds colour against the olive
  const strap = new THREE.MeshStandardMaterial({
    color: 0x9a713f, roughness: 0.75, metalness: 0.05,
    normalMap: cN, normalScale: new THREE.Vector2(0.4, 0.4),
  });

  // Sci-fi combat armor plate — scuffed dark gunmetal. This is a trooper who
  // turned, so his kit is still on: helmet, chest/ab plates, pauldrons,
  // greaves, boots. Weathered but clearly manufactured, not bone.
  const armor = new THREE.MeshPhysicalMaterial({
    color: 0x9198a0, roughness: 0.44, metalness: 0.72,
    clearcoat: 0.4, clearcoatRoughness: 0.35,
    emissive: new THREE.Color(0x03060c), emissiveIntensity: 0.15,
  });

  // Painted hazard trim — bright unit-orange on the armor edges. Faint glow so
  // it stays vivid in low light without blooming to white.
  const trim = new THREE.MeshStandardMaterial({
    color: 0xff7a1e, roughness: 0.5, metalness: 0.3,
    emissive: new THREE.Color(0x3a1400), emissiveIntensity: 0.35,
  });

  // Undersuit — olive-green military fatigues under the armor, torn and dirty.
  const suit = new THREE.MeshStandardMaterial({
    color: 0x3d442c, roughness: 0.86, metalness: 0.05,
    normalMap: cN, normalScale: new THREE.Vector2(0.6, 0.6),
  });

  // Fresh wet blood — clearcoat 1.0 for genuine wet sheen
  const blood = new THREE.MeshPhysicalMaterial({
    color: 0x8b0000, roughness: 0.09, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.04,
  });

  // Dried dark blood
  const bloodDry = new THREE.MeshPhysicalMaterial({
    color: 0x3a0000, roughness: 0.52, metalness: 0.0,
    clearcoat: 0.28, clearcoatRoughness: 0.42,
  });

  // Exposed inner flesh (wound bed)
  const deadFlesh = new THREE.MeshPhysicalMaterial({
    color: 0x8a5a42, roughness: 0.55, metalness: 0.0,
    clearcoat: 0.55, clearcoatRoughness: 0.28,
  });

  return { flesh, skin2, faceSkin, rag, bone, eye, glowB, dark, hair, hairL, strap, blood, bloodDry, deadFlesh, armor, trim, suit };
}

// ─── Rig builder ──────────────────────────────────────────────────────────────

function buildZombieRig() {
  const mat = makeMats();

  const B   = (w,h,d,m)   => new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
  const Cap = (r,h,sg,m)  => new THREE.Mesh(new THREE.CapsuleGeometry(r,h,sg||6,12), m);
  const S   = (r,sg,m)    => new THREE.Mesh(new THREE.SphereGeometry(r,sg||10,8), m);

  // ── root ──────────────────────────────────────────────────────────────────
  const root = new THREE.Group();

  // ── torsoGroup ────────────────────────────────────────────────────────────
  const torsoGroup = new THREE.Group();
  root.add(torsoGroup);

  // Pelvis
  const pelvis = B(0.44, 0.18, 0.30, mat.rag); pelvis.position.y = 1.18; torsoGroup.add(pelvis);

  // ── spineGroup ────────────────────────────────────────────────────────────
  const spineGroup = new THREE.Group(); spineGroup.position.set(0, 1.24, 0); torsoGroup.add(spineGroup);

  // Belly — emaciated, visible skin under torn shirt
  const belly = Cap(0.155, 0.18, 6, mat.flesh); belly.position.set(0, 0.14, 0); spineGroup.add(belly);

  // Chest — narrower, more skeletal
  const chest = Cap(0.185, 0.28, 6, mat.rag); chest.position.set(0, 0.52, 0); spineGroup.add(chest);

  // Clavicle bar — prominent (close to skin with no muscle)
  const clav = B(0.60, 0.065, 0.18, mat.faceSkin); clav.position.set(0, 0.80, 0); spineGroup.add(clav);

  // ── Multi-layer wound on left torso ───────────────────────────────────────
  // Outer scab ring (dried blood)
  const woundRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 5, 10), mat.bloodDry);
  woundRing.rotation.y = Math.PI/2; woundRing.position.set(-0.10, 0.32, -0.22); spineGroup.add(woundRing);
  // Wound bed (exposed inner flesh)
  const woundBed = S(0.075, 8, mat.deadFlesh); woundBed.scale.z = 0.35;
  woundBed.position.set(-0.10, 0.32, -0.22); spineGroup.add(woundBed);
  // Fresh blood pool dripping
  const woundBlood = S(0.055, 8, mat.blood); woundBlood.scale.set(1.2, 0.4, 0.4);
  woundBlood.position.set(-0.10, 0.24, -0.22); spineGroup.add(woundBlood);

  // Prominent exposed rib cage — dramatic like the reference
  [[-1,0],[-1,1],[-1,2],[1,0],[1,1],[1,2]].forEach(([side, i]) => {
    const rib = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.14+i*0.02, 4, 6), mat.bone);
    rib.position.set(side * (0.08 + i*0.015), 0.48 - i*0.10, -0.18);
    rib.rotation.z = side * (0.35 + i * 0.08);
    rib.rotation.x = 0.15;
    spineGroup.add(rib);
  });

  // Spine vertebrae nubs (visible from back)
  for (let i = 0; i < 5; i++) {
    const vert = S(0.022, 6, mat.bone); vert.position.set(0, 0.12 + i*0.14, 0.18); spineGroup.add(vert);
  }

  // ── Arm builder ───────────────────────────────────────────────────────────
  function buildArm(side) { // -1 = left, +1 = right
    const sx = side * 0.34;
    const shoulder = new THREE.Group(); shoulder.position.set(sx, 0.80, 0); spineGroup.add(shoulder);

    // Shoulder protrusion (very little muscle — skeletal)
    const delt = S(0.065, 8, mat.flesh); delt.scale.set(0.9, 0.6, 0.6);
    delt.position.set(0, -0.02, 0); shoulder.add(delt);

    // Upper arm — thin, skeletal
    const uArm = Cap(0.055, 0.30, 6, mat.flesh); uArm.position.set(0, -0.20, 0); shoulder.add(uArm);

    const elbow = new THREE.Group(); elbow.position.set(0, -0.40, 0); shoulder.add(elbow);

    // Elbow bone protrusion
    const elboneProx = S(0.038, 7, mat.bone); elboneProx.scale.set(0.7, 0.5, 0.5);
    elboneProx.position.set(0, 0, 0.05); elbow.add(elboneProx);

    // Forearm — very thin
    const fArm = Cap(0.050, 0.26, 6, mat.skin2); fArm.position.set(0, -0.16, 0); elbow.add(fArm);
    // Ulna bone ridge (visible under skin)
    const ulna = B(0.012, 0.22, 0.012, mat.bone); ulna.position.set(side*0.025, -0.16, 0.04); elbow.add(ulna);
    // Wrist tendons
    [-0.02, 0, 0.02].forEach(tz => {
      const ten = B(0.008, 0.06, 0.008, mat.bone); ten.position.set(0, -0.31, tz); elbow.add(ten);
    });

    const wrist = new THREE.Group(); wrist.position.set(0, -0.32, 0); elbow.add(wrist);

    // Hand — thin bony metacarpals
    const hand = B(0.12, 0.08, 0.13, mat.skin2); hand.position.set(0, -0.04, 0); wrist.add(hand);

    // 4 long clawed fingers (key reference feature)
    const fingerXs = [-0.050, -0.017, 0.016, 0.050];
    fingerXs.forEach((fx, fi) => {
      const fLen = 0.072 + fi * 0.008; // index longest
      const knuck = S(0.016, 6, mat.bone); knuck.position.set(fx, -0.08, 0); wrist.add(knuck);
      const seg1 = B(0.020, fLen, 0.020, mat.skin2); seg1.position.set(fx, -0.08 - fLen/2, 0); wrist.add(seg1);
      // Claw tip — long dark curved nail
      const claw = B(0.014, 0.038, 0.014, mat.dark);
      claw.position.set(fx, -0.08 - fLen - 0.020, -0.008);
      claw.rotation.x = -0.35; // curves forward
      wrist.add(claw);
    });

    // Thumb with claw
    const thumbLen = 0.055;
    const thumb = B(0.022, thumbLen, 0.022, mat.skin2);
    thumb.position.set(side*0.075, -0.065, 0); thumb.rotation.z = side * -0.5; wrist.add(thumb);
    const thumbClaw = B(0.014, 0.030, 0.014, mat.dark);
    thumbClaw.position.set(side*0.092, -0.092, -0.006); thumbClaw.rotation.x = -0.30; wrist.add(thumbClaw);

    return { shoulder, elbow, wrist };
  }

  const leftShoulder_o  = buildArm(-1), rightShoulder_o = buildArm(+1);
  const leftShoulder  = leftShoulder_o.shoulder,  leftElbow  = leftShoulder_o.elbow,  leftWrist  = leftShoulder_o.wrist;
  const rightShoulder = rightShoulder_o.shoulder, rightElbow = rightShoulder_o.elbow, rightWrist = rightShoulder_o.wrist;

  // ── Neck / head ───────────────────────────────────────────────────────────
  const neckGroup = new THREE.Group(); neckGroup.position.set(0, 0.93, 0); spineGroup.add(neckGroup);

  // Neck with visible Adam's apple
  const neck = Cap(0.088, 0.10, 6, mat.faceSkin); neck.position.set(0, 0.06, 0); neckGroup.add(neck);
  const adam = S(0.028, 6, mat.faceSkin); adam.scale.set(0.6, 0.7, 1.3); adam.position.set(0, 0.04, -0.07); neckGroup.add(adam);

  const headGroup = new THREE.Group(); headGroup.position.set(0, 0.16, 0); neckGroup.add(headGroup);

  // ── Cranium — sphere-based for realism ────────────────────────────────────
  const cranium = S(0.195, 14, 11, mat.faceSkin);
  cranium.scale.set(0.96, 1.0, 0.90); cranium.position.set(0, 0.22, 0); headGroup.add(cranium);

  // Frontal face plate (slightly different shade)
  const faceplate = S(0.16, 12, 9, mat.flesh);
  faceplate.scale.set(0.88, 0.78, 0.60); faceplate.position.set(0, 0.17, -0.08); headGroup.add(faceplate);

  // Brow ridge (supraorbital)
  const browR = Cap(0.026, 0.24, 5, mat.faceSkin);
  browR.rotation.z = Math.PI/2; browR.position.set(0, 0.325, -0.158); headGroup.add(browR);

  // Cheekbones (zygomatic arch)
  [[-0.115, 0.20, -0.135], [0.115, 0.20, -0.135]].forEach(([cx,cy,cz]) => {
    const cheek = S(0.052, 8, mat.faceSkin); cheek.scale.set(1.15, 0.65, 0.75);
    cheek.position.set(cx,cy,cz); headGroup.add(cheek);
  });

  // Orbital rims (torus around eye sockets)
  [[-0.098, 0.265, -0.155], [0.098, 0.265, -0.155]].forEach(([ox,oy,oz]) => {
    const orb = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.016, 5, 10), mat.faceSkin);
    orb.rotation.y = Math.PI/2; orb.rotation.x = 0.45; orb.position.set(ox,oy,oz); headGroup.add(orb);
  });

  // Eye sockets (deep dark recesses)
  [[-0.098, 0.264, -0.175], [0.098, 0.264, -0.175]].forEach(([sx,sy,sz]) => {
    const sock = S(0.068, 10, mat.dark); sock.scale.z = 0.45; sock.position.set(sx,sy,sz); headGroup.add(sock);
  });

  // Glowing pupils
  [[-0.098, 0.264, -0.202], [0.098, 0.264, -0.202]].forEach(([ex,ey,ez]) => {
    const pupil = S(0.040, 10, mat.eye); pupil.position.set(ex,ey,ez); headGroup.add(pupil);
  });

  // Eye glow PointLight
  const eyeGlow = new THREE.PointLight(0x1ce0ff, 0.85, 1.9, 2);
  eyeGlow.position.set(0, 0.264, -0.26); /* (sky-only) not added */

  // Temple hollows (sunken areas)
  [[-0.188, 0.24, 0.02], [0.188, 0.24, 0.02]].forEach(([tx,ty,tz]) => {
    const tem = S(0.050, 7, mat.skin2); tem.scale.set(0.35, 0.65, 0.45); tem.position.set(tx,ty,tz); headGroup.add(tem);
  });

  // Nose — bridge + rounded tip
  const noseBridge = B(0.048, 0.095, 0.068, mat.faceSkin); noseBridge.position.set(0, 0.225, -0.185); headGroup.add(noseBridge);
  const noseTip = S(0.034, 8, mat.flesh); noseTip.position.set(0, 0.172, -0.200); headGroup.add(noseTip);
  [[-0.025, 0.170, -0.200], [0.025, 0.170, -0.200]].forEach(([nx,ny,nz]) => {
    const nos = S(0.017, 6, mat.dark); nos.position.set(nx,ny,nz); headGroup.add(nos);
  });

  // Jaw — open / dropped (3 pieces for realism)
  const jawBase = B(0.26, 0.08, 0.22, mat.flesh); jawBase.position.set(0, 0.04, -0.02); jawBase.rotation.x = 0.30; headGroup.add(jawBase);
  const jawBone = B(0.22, 0.06, 0.12, mat.bone);  jawBone.position.set(0, 0.04, -0.10); jawBone.rotation.x = 0.30; headGroup.add(jawBone);
  // Masseter muscle bulges
  [[-0.11, 0.09, 0.03], [0.11, 0.09, 0.03]].forEach(([mx,my,mz]) => {
    const mass = S(0.038, 7, mat.faceSkin); mass.scale.set(0.65, 0.85, 0.55); mass.position.set(mx,my,mz); headGroup.add(mass);
  });

  // Upper teeth (6 individual)
  [-0.06,-0.036,-0.012,0.012,0.036,0.06].forEach((tx,ti) => {
    const t = B(0.022, 0.032+Math.random()*0.008, 0.020, mat.bone);
    t.position.set(tx, 0.075, -0.184); headGroup.add(t);
  });

  // Lower teeth (5)
  [-0.048,-0.024,0,0.024,0.048].forEach(tx => {
    const t = B(0.019, 0.026, 0.018, mat.bone);
    t.position.set(tx, 0.032, -0.168); t.rotation.x=0.28; headGroup.add(t);
  });

  // Tongue (lolling out)
  const tongue = S(0.048, 8, mat.blood); tongue.scale.set(1.4, 0.45, 1.0);
  tongue.position.set(0.012, 0.055, -0.155); headGroup.add(tongue);

  // Open maw interior
  const maw = B(0.16, 0.052, 0.04, mat.dark); maw.position.set(0, 0.090, -0.186); headGroup.add(maw);

  // Ears — external ear with canal
  [[-1, -0.197], [1, 0.197]].forEach(([side, ex]) => {
    const ear = S(0.048, 8, mat.faceSkin); ear.scale.set(0.45, 1.0, 0.38); ear.position.set(ex, 0.22, 0.04); headGroup.add(ear);
    const canal = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.03, 5), mat.dark);
    canal.rotation.z = Math.PI/2; canal.position.set(ex + side*0.025, 0.22, 0.04); headGroup.add(canal);
  });

  // Scalp (sphere cap flattened)
  const scalp = S(0.188, 12, 7, mat.dark); scalp.scale.set(0.96, 0.28, 0.90); scalp.position.set(0, 0.424, 0.02); headGroup.add(scalp);

  // Hair tufts (asymmetric, matted)
  [[-0.10,0.43,0.05],[0.07,0.45,-0.06],[0.14,0.41,0.09],[-0.06,0.44,-0.10]].forEach(([hx,hy,hz]) => {
    const tuft = B(0.075+Math.random()*0.03, 0.045, 0.068+Math.random()*0.02, mat.dark);
    tuft.position.set(hx,hy,hz); tuft.rotation.set((Math.random()-.5)*0.4,(Math.random()-.5)*0.5,(Math.random()-.5)*0.3);
    headGroup.add(tuft);
  });

  // Necrosis / decay spots on face
  for (let i=0;i<6;i++){
    const spot = S(0.010+Math.random()*0.010, 6, mat.bloodDry);
    spot.position.set((Math.random()-.5)*0.28, 0.12+Math.random()*0.20, -0.13-Math.random()*0.05);
    headGroup.add(spot);
  }

  // ── Leg builder ───────────────────────────────────────────────────────────
  function buildLeg(side) {
    const xOff = side * 0.17;
    const hip = new THREE.Group(); hip.position.set(xOff, 1.06, 0); root.add(hip);

    // Thigh — thin, skeletal (no muscle)
    const thigh = Cap(0.085, 0.28, 6, mat.rag); thigh.position.set(0, -0.22, 0); hip.add(thigh);
    // Visible femur outline
    const femur = B(0.018, 0.22, 0.018, mat.bone); femur.position.set(0, -0.22, -0.06); hip.add(femur);

    const knee = new THREE.Group(); knee.position.set(0, -0.48, 0); hip.add(knee);

    // Kneecap — very prominent (almost no tissue)
    const kneecap = S(0.060, 9, mat.bone); kneecap.scale.set(0.9, 0.7, 0.55); kneecap.position.set(0, 0, -0.052); knee.add(kneecap);

    // Shin — very thin, almost skeletal
    const shin = Cap(0.062, 0.26, 6, mat.rag); shin.position.set(0, -0.20, 0); knee.add(shin);
    // Tibia bone visible through thin skin
    const tibia = B(0.015, 0.22, 0.015, mat.bone); tibia.position.set(0, -0.20, -0.055); knee.add(tibia);

    if (side < 0) {
      // Left leg: exposed bone fragment (injury)
      const chip = B(0.038, 0.085, 0.028, mat.bone);
      chip.position.set(0.058, -0.19, -0.090); chip.rotation.z = 0.3; knee.add(chip);
      // Blood drip from wound
      const drip = S(0.022, 6, mat.blood); drip.scale.set(0.6, 1.4, 0.6);
      drip.position.set(0.055, -0.28, -0.085); knee.add(drip);
    }

    const ankle = new THREE.Group(); ankle.position.set(0, -0.42, 0); knee.add(ankle);

    // Ankle bone prominences
    [[-0.095, 0, 0], [0.095, 0, 0]].forEach(([ax,ay,az]) => {
      const malle = S(0.028, 6, mat.bone); malle.position.set(ax,ay,az); ankle.add(malle);
    });

    // Foot — more shaped (not just a box)
    const foot = B(0.20, 0.10, 0.28, mat.bone); foot.position.set(0, -0.052, 0.04); ankle.add(foot);
    const heel = S(0.05, 7, mat.bone); heel.scale.set(1.0, 0.6, 0.7); heel.position.set(0, -0.06, 0.14); ankle.add(heel);

    // Individual toe nubs (3)
    [-0.055, 0, 0.055].forEach((tx,ti) => {
      const toe = B(0.050, 0.050, 0.065, mat.bone); toe.position.set(tx, -0.054, -0.114); ankle.add(toe);
      if (ti===1){ const nail=B(0.030,0.010,0.040,mat.dark); nail.position.set(tx,-0.050,-0.135); ankle.add(nail); }
    });

    return { hip, knee, ankle };
  }

  const legL = buildLeg(-1), legR = buildLeg(+1);

  root.traverse(obj => { if (obj.isMesh){ obj.castShadow=true; obj.receiveShadow=true; } });

  return {
    root, torsoGroup, spineGroup, neckGroup, headGroup,
    arms: {
      left:  { shoulder: leftShoulder,  elbow: leftElbow,  wrist: leftWrist  },
      right: { shoulder: rightShoulder, elbow: rightElbow, wrist: rightWrist },
    },
    legs: { left: legL, right: legR },
    mat, eyeGlow,
  };
}

// ─── Gun mesh ─────────────────────────────────────────────────────────────────

function buildGunMesh(type) {
  const id = type === 'rifle' ? 'm4' : type === 'pistol' ? 'magnum' : 'levershotgun';
  if (hasLoadedWeaponModel(id)) {
    const built = buildWeaponModel(getWeapon(id));
    if (built?.group) { built.group.userData.zombieAuthoredGun = true; return { group: built.group, flash: null }; }
  }
  const group  = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: ARMED_CFG[type].color, roughness: 0.55, metalness: 0.85 });
  const woodMat= new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.88, metalness: 0.05 });
  const B = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  let muzzleOffset;

  if (type === 'pistol') {
    const body   = B(0.065, 0.075, 0.20, gunMat); body.position.z = -0.04; group.add(body);
    const barrel = B(0.030, 0.028, 0.14, gunMat); barrel.position.set(0, 0.028, -0.17); group.add(barrel);
    const grip   = B(0.052, 0.11,  0.05, gunMat); grip.position.set(0, -0.082, -0.02); group.add(grip);
    muzzleOffset = new THREE.Vector3(0, 0.028, -0.245);
  } else if (type === 'rifle') {
    const body   = B(0.060, 0.065, 0.36, gunMat); body.position.z = -0.07; group.add(body);
    const barrel = B(0.026, 0.026, 0.20, gunMat); barrel.position.set(0, 0.026, -0.29); group.add(barrel);
    const stock  = B(0.055, 0.050, 0.15, woodMat); stock.position.set(0, -0.01, 0.115); group.add(stock);
    const grip   = B(0.044, 0.10,  0.044, gunMat); grip.position.set(0, -0.072, 0.01); group.add(grip);
    const mag    = B(0.030, 0.08,  0.032, gunMat); mag.position.set(0, -0.08, -0.04); group.add(mag);
    muzzleOffset = new THREE.Vector3(0, 0.026, -0.39);
  } else { // shotgun
    const body   = B(0.075, 0.075, 0.28, gunMat); body.position.z = -0.04; group.add(body);
    const barrel = B(0.065, 0.040, 0.12, gunMat); barrel.position.set(0, 0.035, -0.22); group.add(barrel);
    const stock  = B(0.065, 0.055, 0.15, woodMat); stock.position.set(0, -0.01, 0.105); group.add(stock);
    const grip   = B(0.055, 0.10,  0.048, gunMat); grip.position.set(0, -0.082, 0.005); group.add(grip);
    muzzleOffset = new THREE.Vector3(0, 0.035, -0.285);
  }

  // Muzzle flash light (off by default)
  const flash = new THREE.PointLight(0xff8822, 0, 4, 2);
  flash.position.copy(muzzleOffset);
  // (sky-only lighting) zombie muzzle flash light not added to scene

  group.traverse(obj => { if (obj.isMesh) obj.castShadow = false; });

  return { group, flash, muzzleOffset };
}

// ─── Health bar ───────────────────────────────────────────────────────────────

function buildHealthBar() {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x14161a, depthTest: false })
  );
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x44cc22, depthTest: false })
  );
  bg.renderOrder = 10; fg.renderOrder = 11;
  bg.userData.noHit = true; fg.userData.noHit = true;
  group.add(bg); group.add(fg);
  group.position.y = 2.85;
  return { group, fg };
}

// ─── Zombie class ─────────────────────────────────────────────────────────────

export class Zombie {
  /**
   * @param {object}        world
   * @param {THREE.Vector3} spawnPoint
   * @param {number}        hpMult
   * @param {number}        speedMult
   * @param {number}        wave
   * @param {string|null}   armedType  — null | 'pistol' | 'rifle' | 'shotgun'
   */
  constructor(world, spawnPoint, hpMult = 1, speedMult = 1, wave = 1, armedType = null, variant = 'shambler', dmgMult = 1, modelVariant = 0) {
    const V = VARIANTS[armedType ? 'shambler' : variant] ?? VARIANTS.shambler;
    this.variant      = armedType ? 'shambler' : variant;
    this._animMul     = V.anim;
    // Variant stride: a brute takes long slow strides, a runner short quick
    // ones. This is what carries the variants' character now that the cadence
    // is a consequence of speed rather than a dial — the same distance covered
    // in fewer, bigger steps or more, smaller ones.
    this._strideScale = V.stride ?? 1;
    // How much ground this zombie's own legs actually cover in one cycle, so
    // the phase can be advanced by distance travelled. Measured off the pose it
    // will really play, not assumed.
    this._groundPerCycle = groundPerCycle(ZLEG, (p) => {
      const S = this._strideScale;
      return [
        -Math.sin(p) * ZGAIT.hipWeak * S,
        -Math.max(0, -Math.cos(p)) * ZGAIT.kneeWeak * S,
        -Math.sin(p) * 0.08,
         Math.sin(p) * ZGAIT.hipStrong * S,
        -Math.max(0, Math.cos(p)) * ZGAIT.kneeStrong * S,
         Math.sin(p) * 0.10,
      ];
    });
    // Seeded on the first animated frame — `position` is assigned further down.
    this._prevAnimX = null;
    this._prevAnimZ = 0;
    this.id           = _nextId++;
    this.world        = world;
    this.maxHealth    = Math.round(80 * hpMult * V.hp);
    this.health       = this.maxHealth;
    this.alive        = true;
    this.noRespawn    = true;
    this.attackCooldown  = 0;
    this.flashTimer      = 0;
    this.wanderTarget    = spawnPoint.clone();
    this.wanderCooldown  = 0;
    this.speed           = (1.6 + Math.random() * 0.7) * speedMult * V.speed;
    // Damage: the survival curve owns wave-based scaling now (dmgMult),
    // variant applies its own multiplier on top.
    this.attackDamage    = Math.round(14 * dmgMult * V.dmg);
    this.lungeTimer      = 0;
    this._dying          = false;
    this._deathT         = 0;
    this._deathSide      = 1;
    this._deathBaseY     = 0;
    this._animPhase      = Math.random() * Math.PI * 2;
    this._muzzleFlashTimer = 0;
    // ── realism state ──
    this._weaveT     = Math.random() * 10;       // drunken lateral drift phase
    this._weaveAmt   = 0.14 + Math.random() * 0.16;
    this._stumbleIn  = 3 + Math.random() * 5;    // seconds until next stumble
    this._stumbleT   = 0;                         // >0 while mid-stumble
    this._surge      = 1;                         // gait-driven forward surge
    this._distToPlayer = 999;                     // shared with _animate for reach
    this._reach      = 0;                          // 0..1 arm-reach blend
    this._headTrack  = 0;                          // 0..1 look-at-player blend
    this._tmpQuat    = new THREE.Quaternion();
    this._healthQuat = new THREE.Quaternion();
    this._tmpObj     = new THREE.Object3D();

    // Armed state
    this.armedType     = armedType;
    this.shootCooldown = 0;
    this._muzzleFlash  = null;

    // Audio (assigned after construction by ZombieManager)
    this.audio = null;
    this._growlTimer = 2 + Math.random() * 3; // first growl after 2-5s

    this.position = spawnPoint.clone();

    // ── PER-INSTANCE PROFILE — every zombie is physically distinct ──────────
    // build, decay, posture and gait personality are all randomised so a wave
    // reads as a mob of individuals, not a clone army. Applies to armed
    // zombies too (they wear the shambler look but still vary).
    const R = () => Math.random();
    const prof = this._profile = {
      height:  0.98 + R() * 0.12,      // 0.98–1.10 — centred so a shambler ≈ player height
      girth:   1.05 + R() * 0.20,      // 1.05–1.25 — broad/meaty without hulking out
      decay:   R(),                    // 0 fresh ↔ 1 rotted
      lean:    0.12 + R() * 0.16,      // permanent forward hunch
      hunch:  (R() - 0.5) * 0.16,      // shoulder/spine tilt to one side
      headTilt:(R() - 0.5) * 0.55,     // cocked-head loll bias
      headTurn:(R() - 0.5) * 0.4,
      limpSide: R() < 0.5 ? 1 : -1,    // which leg drags
      gaitMul: 0.85 + R() * 0.35,      // cadence personality
    };

    const mat = makeMats();
    // Distinct SKIN + CLOTHING family per zombie, then decay + fine jitter on
    // top (so even two "green rot" corpses aren't identical).
    const hueJit = (R() - 0.5) * 0.06;
    mat.flesh.color.setHex(pick(SKIN_TONES)).offsetHSL(hueJit, -prof.decay * 0.14 + (R() - 0.5) * 0.05, -prof.decay * 0.12 + (R() - 0.5) * 0.04);
    if (mat.faceSkin) mat.faceSkin.color.copy(mat.flesh.color).offsetHSL(0, 0, 0.04);
    if (mat.skin2)    mat.skin2.color.copy(mat.flesh.color).offsetHSL(0, -0.04, -0.05);
    mat.suit.color.setHex(pick(SUIT_TONES)).offsetHSL(hueJit * 0.5, 0, (R() - 0.5) * 0.05);
    if (mat.rag)  mat.rag.color.copy(mat.suit.color).offsetHSL(0, -0.05, -0.06);
    // Rotted ones get faintly glowing infected wounds.
    if (mat.blood) mat.blood.emissive.setRGB(prof.decay * 0.22, 0, 0);
    // Eye/vein glow — variant glow wins; otherwise a per-instance colour.
    const glow = V.glow ?? pick(EYE_GLOWS);
    mat.eye.emissive.setHex(glow);
    mat.eye.color.copy(new THREE.Color(glow)).multiplyScalar(0.12);
    const rig = buildZombieRigFromGLB(mat, modelVariant) ?? buildZombieRig();
    this.modelVariant = modelVariant;
    // Runner: tear the armor off (hide the heavy kit meshes).
    if (V.hide) rig.root.traverse(o => { if (o.isMesh && V.hide.test(o.name)) o.visible = false; });
    rig.eyeGlow?.color.setHex(glow);
    // Non-uniform build scale (height × girth) on top of the variant scale.
    // SIZE is calibrated so a standard shambler (variant 1.0, mid height 1.04)
    // renders at ~1.83m — the same height as the player soldier model
    // (native zombie rig is 2.048m tall → 1.83 / 2.048 ≈ 0.895 = SIZE·1.04).
    const SIZE = 0.86;
    const s = V.scale * SIZE;
    rig.root.scale.set(s * prof.girth, s * prof.height, s * prof.girth);
    this._baseScale = rig.root.scale.clone();   // preserved through lunge pulses

    // ── STRUCTURAL mutations — distinct silhouettes at a glance ──
    const headScale = rig.authored ? 1 : 0.82 + R() * 0.5;            // pinhead ↔ swollen head
    rig.headGroup.scale.multiplyScalar(headScale);
    // withered / overgrown limbs (asymmetric) — scale a limb's root joint
    const limbScale = (j, sx, sy) => { j.scale.x *= sx; j.scale.z *= sx; j.scale.y *= sy; };
    if (!rig.authored && R() < 0.4) {                                // one withered arm
      const arm = R() < 0.5 ? rig.arms.left : rig.arms.right;
      limbScale(arm.shoulder, 0.68, 0.86);
    } else if (!rig.authored && R() < 0.3) {                         // one over-long grabbing arm
      const arm = R() < 0.5 ? rig.arms.left : rig.arms.right;
      limbScale(arm.shoulder, 1.12, 1.2);
    }
    if (!rig.authored && R() < 0.3) limbScale((R() < 0.5 ? rig.legs.left : rig.legs.right).hip, 0.9, 0.9); // gimp leg
    // uneven shoulders (hunched to one side)
    rig.arms.left.shoulder.position.y  += prof.hunch * 0.4;
    rig.arms.right.shoulder.position.y -= prof.hunch * 0.4;

    this._rig       = rig;
    this._fleshMat  = rig.mat.flesh;

    this.mesh = rig.root;
    this.mesh.userData.bot = this;
    this.mesh.traverse(obj => { obj.userData.bot = this; });

    // Default arm pose — zombie reach (both arms forward-up)
    rig.arms.left.shoulder.rotation.x  = -0.65;
    rig.arms.left.shoulder.rotation.z  =  0.18;
    rig.arms.left.elbow.rotation.x     = -0.30;
    rig.arms.right.shoulder.rotation.x = -0.65;
    rig.arms.right.shoulder.rotation.z = -0.18;
    rig.arms.right.elbow.rotation.x    = -0.30;

    // Attach gun to right wrist if armed
    if (armedType) {
      const { group: gunGroup, flash } = buildGunMesh(armedType);
      gunGroup.position.set(0, -0.10, -0.06);
      gunGroup.rotation.x = gunGroup.userData.zombieAuthoredGun ? -Math.PI/2 : 0.12;
      rig.arms.right.wrist.add(gunGroup);
      this._muzzleFlash = flash;

      this.maxHealth = Math.round(this.maxHealth * 1.2);
      this.health    = this.maxHealth;
      this.attackDamage = Math.round(this.attackDamage * 0.6);

      const cfg = ARMED_CFG[armedType];
      this.shootCooldown = cfg.cooldown * (0.5 + Math.random() * 0.5);
    }

    const { group: hpGroup, fg } = buildHealthBar();
    this.healthBarFg    = fg;
    this.healthBarGroup = hpGroup;
    this.mesh.add(hpGroup);
    this.mesh.position.copy(this.position);

    // Pre-allocated scratch vectors — avoids per-frame GC pressure
    this._toPlayer  = new THREE.Vector3();
    this._strafeVec = new THREE.Vector3();
    this._wanderDir = new THREE.Vector3();
    this._sightRay = new THREE.Ray();
    this._strafeT   = Math.random() * Math.PI * 2; // smooth strafe oscillator
  }

  // ─── Animation ──────────────────────────────────────────────────────────────

  _animate(dt, isMoving) {
    const rig = this._rig;
    // Variant gait speed: runners scurry (1.7x), brutes trudge (0.75x).
    // The phase advances UNEVENLY — a quick push on the driving stride, a slow
    // drag between — which reads as a lurching shamble instead of a metronome.
    const P = this._profile;
    // The phase advances with the DISTANCE COVERED, not on a clock. It used to
    // run at a flat 3.2 rad/s regardless of how fast the thing was actually
    // travelling, so a shambler moving 1.95 m/s needed 3.83m of ground per
    // cycle out of legs that deliver 0.9 — the feet slid ~96% of the way and
    // the whole horde glided. Driving it off distance also keeps the lurch
    // honest for free: the body surges further on the strong stride, so the
    // legs get further through their cycle in that same moment.
    // Measured from where the body ACTUALLY ended up, not from the velocity it
    // intended. Collision resolution runs after the move, and in a wave of
    // eight converging on the same target they spend most of their time
    // shouldering into each other — intent and displacement come apart, and
    // the difference is exactly the amount the feet would slide.
    if (this._prevAnimX === null) { this._prevAnimX = this.position.x; this._prevAnimZ = this.position.z; }
    const dx = this.position.x - this._prevAnimX, dz = this.position.z - this._prevAnimZ;
    this._prevAnimX = this.position.x; this._prevAnimZ = this.position.z;
    if (isMoving) {
      const perCycle = this._groundPerCycle * Math.max(0.2, this._moveBlend ?? 1);
      this._animPhase += ((Math.PI * 2) / perCycle) * Math.hypot(dx, dz);
    } else {
      this._animPhase += dt * 1.0 * (P?.gaitMul ?? 1);      // idle sway
    }
    const t = this._animPhase;

    // Forward SURGE from the gait — velocity peaks on the strong stride (used
    // by update() to modulate movement speed). Base tuned so the lurch nets
    // ~95% of the constant speed (keeps the wave difficulty curve intact).
    this._surge = isMoving ? (0.74 + 1.3 * Math.max(0, Math.sin(t))) : 1;

    const staggering = this._stumbleT > 0;
    // Hungry reach + head-track ramp in when the player is close (melee only).
    const wantReach = (!this.armedType && this._distToPlayer < 3.4) ? 1 : 0;
    const wantTrack = (this._distToPlayer < 9) ? 1 : 0;
    this._reach     = this._reach     + (wantReach - this._reach)     * damp(8, dt);
    this._headTrack = this._headTrack + (wantTrack - this._headTrack) * damp(5, dt);

    // which leg drags is per-instance (limpSide) — swaps the weak/strong roles
    const wk = (P?.limpSide ?? 1) > 0 ? rig.legs.left  : rig.legs.right;   // weak/limp
    const st = (P?.limpSide ?? 1) > 0 ? rig.legs.right : rig.legs.left;    // strong

    // Smooth start/stop: blend the whole walk cycle in and out with one eased
    // factor instead of hard-switching idle↔moving (that snap was the last
    // rough edge). At mb=0 the amplitudes fade to a resting stand; at mb=1 the
    // full shamble plays. Everything below scales by mb, so nothing pops.
    this._moveBlend = (this._moveBlend ?? 0) + ((isMoving ? 1 : 0) - (this._moveBlend ?? 0)) * damp(7, dt);
    const mb = this._moveBlend;

    // Walk cycle — asymmetric shamble (one leg limps, the other drives),
    // amplitude-scaled by the move blend. See ZGAIT for why the knees are
    // negative and keyed off cosine.
    const S = this._strideScale * mb;
    wk.hip.rotation.x   = -Math.sin(t) * ZGAIT.hipWeak * S;
    st.hip.rotation.x   =  Math.sin(t) * ZGAIT.hipStrong * S;
    wk.knee.rotation.x  = -Math.max(0, -Math.cos(t)) * ZGAIT.kneeWeak * S;
    st.knee.rotation.x  = -Math.max(0,  Math.cos(t)) * ZGAIT.kneeStrong * S;
    wk.ankle.rotation.x = -Math.sin(t) * 0.08 * mb;
    st.ankle.rotation.x =  Math.sin(t) * 0.10 * mb;
    // Pelvis bob + torso sway (idle keeps a faint sway, walk swells it).
    rig.torsoGroup.position.y = Math.abs(Math.sin(t)) * -0.035 * mb;
    rig.spineGroup.rotation.z = Math.sin(t * 1.3) * (0.025 + 0.04 * mb);
    // Arms sway opposite the legs (unarmed), easing between rest and swing.
    if (!this.armedType) {
      rig.arms.left.shoulder.rotation.x  = -0.65 + Math.sin(t) * 0.18 * mb;
      rig.arms.right.shoulder.rotation.x = -0.65 - Math.sin(t) * 0.18 * mb;
      rig.arms.left.elbow.rotation.x     = -0.30 - Math.max(0,  Math.sin(t + 0.5)) * 0.22 * mb;
      rig.arms.right.elbow.rotation.x    = -0.30 - Math.max(0, -Math.sin(t + 0.5)) * 0.22 * mb;
    }

    // Always: per-instance forward lean + side hunch + rock
    rig.spineGroup.rotation.x = (P?.lean ?? 0.18) + Math.sin(t * 0.8) * 0.04;
    rig.spineGroup.rotation.z += (P?.hunch ?? 0);

    // Head loll — per-instance cocked-head bias + hungry lean-in when close.
    rig.headGroup.rotation.z = (P?.headTilt ?? 0) + Math.sin(t * 0.9 + 0.4) * 0.14 * (1 - this._headTrack * 0.6);
    rig.headGroup.rotation.x = -0.06 + Math.sin(t * 1.1) * 0.05 + this._headTrack * 0.22;
    rig.headGroup.rotation.y = (P?.headTurn ?? 0) * (1 - this._headTrack);

    // Hungry REACH — both arms extend forward to grab as it closes in (melee).
    if (this._reach > 0.01 && !this.armedType) {
      const r = this._reach;
      rig.arms.left.shoulder.rotation.x  = THREE.MathUtils.lerp(rig.arms.left.shoulder.rotation.x,  -1.35, r);
      rig.arms.right.shoulder.rotation.x = THREE.MathUtils.lerp(rig.arms.right.shoulder.rotation.x, -1.35, r);
      rig.arms.left.elbow.rotation.x     = THREE.MathUtils.lerp(rig.arms.left.elbow.rotation.x,     -0.15, r);
      rig.arms.right.elbow.rotation.x    = THREE.MathUtils.lerp(rig.arms.right.elbow.rotation.x,    -0.15, r);
      // clawing fingers twitch as it reaches
      rig.spineGroup.rotation.x += r * (0.12 + Math.sin(t * 6) * 0.03);
    }

    // Stagger — a stumble pitches the whole body forward and flails the arms.
    if (staggering) {
      const s = Math.sin((this._stumbleT / 0.5) * Math.PI);   // 0→1→0 over the stumble
      rig.spineGroup.rotation.x += s * 0.28;
      rig.torsoGroup.position.y -= s * 0.06;
      rig.arms.left.shoulder.rotation.z  += s * 0.4;
      rig.arms.right.shoulder.rotation.z -= s * 0.4;
    }

    // Jaw chatter — the hanging mandible works while it shambles, snaps wide
    // during a lunge.
    if (rig.jaw) {
      const snap = this.lungeTimer > 0 ? Math.sin((this.lungeTimer / 0.20) * Math.PI) * 0.45 : 0;
      rig.jaw.rotation.x = 0.10 + Math.abs(Math.sin(t * 1.9)) * 0.28 + snap;
    }

    // Armed zombie — override right arm to aiming pose
    if (this.armedType) {
      rig.arms.right.shoulder.rotation.x = -0.78;
      rig.arms.right.shoulder.rotation.z = -0.30;
      rig.arms.right.elbow.rotation.x    = -0.65;
    }

    // Lunge attack
    if (this.lungeTimer > 0) {
      const p      = this.lungeTimer / 0.20;
      const strike = Math.sin(p * Math.PI) * 0.5;
      rig.arms.left.shoulder.rotation.x  -= strike;
      rig.arms.right.shoulder.rotation.x -= strike;
      rig.spineGroup.rotation.x          += strike * 0.3;
    }

    // Hit flinch
    if (this.flashTimer > 0) {
      const flinch = (this.flashTimer / 0.12) * 0.12;
      rig.spineGroup.rotation.x -= flinch;
    }

    // Eye glow pulse
    if (rig.eyeGlow) rig.eyeGlow.intensity = 0.85 + Math.sin(t * 2.3) * 0.30;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.flashTimer = 0.12;
    this.healthBarFg.scale.x    = Math.max(0.001, this.health / this.maxHealth);
    this.healthBarFg.position.x = -((1 - this.healthBarFg.scale.x) * 0.33);
    if (this.health <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    this.alive      = false;
    this._dying     = true;
    this._deathT    = 0;
    this._deathSide = Math.random() < 0.5 ? 1 : -1;
    this._deathBaseY= this.mesh.position.y;
    this._deathSpineX = this._rig?.spineGroup.rotation.x ?? 0;
    this._deathHeadX  = this._rig?.headGroup.rotation.x ?? 0;
    this.healthBarGroup.visible = false;
    if (this._muzzleFlash) this._muzzleFlash.intensity = 0;
    if (this.audio) this.audio.playZombieDeath();
  }

  dispose() {
    const geometries = new Set(), materials = new Set(Object.values(this._rig?.mat || {}));
    this.mesh.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry?.userData.shared) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (!m?.userData.shared) materials.add(m);
    });
    for (const g of geometries) g?.dispose();
    // Canvas textures and imported geometry belong to shared caches.
    for (const m of materials) m?.dispose();
  }

  _fireAt(player, onAttack) {
    const cfg = ARMED_CFG[this.armedType];
    if (Math.random() < cfg.accuracy) {
      onAttack(this.attackDamage, this.position);
    }
    if (this._muzzleFlash) {
      this._muzzleFlash.intensity = 5.5;
      this._muzzleFlashTimer = 0.09;
    }
    this.shootCooldown = cfg.cooldown;
  }

  update(dt, player, camera, onAttack) {
    // Muzzle flash decay (use separate _muzzleFlashTimer)
    if (this._muzzleFlash && this._muzzleFlashTimer > 0) {
      this._muzzleFlashTimer -= dt;
      if (this._muzzleFlashTimer <= 0) this._muzzleFlash.intensity = 0;
    }

    // Periodic growl when alive and chasing
    if (this.alive && this.audio) {
      this._growlTimer -= dt;
      if (this._growlTimer <= 0) {
        this._growlTimer = 3.5 + Math.random() * 4;
        const dx = player.position.x - this.position.x;
        const dz = player.position.z - this.position.z;
        const growlRadius = DETECT_RADIUS + 4;
        if (dx * dx + dz * dz < growlRadius * growlRadius) this.audio.playZombieGrowl();
      }
    }

    // Death animation
    if (this._dying) {
      this._deathT += dt;
      const p = Math.min(1, this._deathT / ZOMBIE_DEATH_SECONDS);
      const e = p * p;
      this.mesh.rotation.z = e * (Math.PI / 2) * this._deathSide;
      this.mesh.rotation.x = e * 0.25;
      this.mesh.position.y = this._deathBaseY - e * 0.55;

      // Enhanced crumple
      applyZombieDeathCrumple(
        this._rig,
        this._deathSpineX ?? 0,
        this._deathHeadX ?? 0,
        e
      );

      if (p > 0.55) {
        const fade = 1 - (p - 0.55) / 0.45;
        this.mesh.traverse(o => {
          if (o.isMesh && o.material) {
            o.material.transparent = true;
            o.material.opacity     = fade;
          }
        });
      }
      if (p >= 1) {
        this._dying      = false;
        this.mesh.visible= false;
        this.mesh.rotation.set(0, 0, 0);
        this.mesh.position.y = this._deathBaseY;
        this.mesh.traverse(o => {
          if (o.isMesh && o.material) {
            o.material.transparent = false;
            o.material.opacity     = 1;
          }
        });
      }
      return;
    }

    if (!this.alive) return;

    // Hit flash on flesh mat
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this._fleshMat.emissive.setRGB(0.4, 1, 0.2);
      this._fleshMat.emissiveIntensity = Math.max(0, this.flashTimer / 0.12) * 0.7;
    } else {
      this._fleshMat.emissiveIntensity = 0;
    }

    // Lunge scale pulse — MULTIPLIES the per-instance build scale (girth ×
    // height × variant) rather than replacing it, so a lunge no longer wipes
    // the zombie's individual proportions.
    const bs = this._baseScale;
    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt;
      const s = 1 + Math.sin((this.lungeTimer / 0.2) * Math.PI) * 0.12;
      this.mesh.scale.set(bs.x * s, bs.y * s, bs.z * s);
    } else {
      this.mesh.scale.copy(bs);
    }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.shootCooldown  > 0) this.shootCooldown  -= dt;

    this._toPlayer.set(
      player.position.x - this.position.x,
      0,
      player.position.z - this.position.z
    );
    const toPlayer = this._toPlayer;
    const dist = toPlayer.length();
    this._distToPlayer = dist;
    let moveDir  = null;
    let isMoving = false;

    // ── stumble / stagger: every so often a shambler trips and lurches ──
    this._stumbleIn -= dt;
    if (this._stumbleT > 0) this._stumbleT -= dt;
    else if (this._stumbleIn <= 0) {
      this._stumbleT = 0.35 + Math.random() * 0.35;   // brief stagger
      this._stumbleIn = 4 + Math.random() * 6;
    }
    const staggering = this._stumbleT > 0;

    // Zombies know the player's current position across the entire map.
    // Cover blocks attacks, not awareness of where to pursue the player.
    let visible = true;
    if (!player.isDead && this.world.raycastCollisionDistance) {
      this._sightRay.origin.copy(this.position).y += 1.1;
      this._sightRay.direction.copy(player.position).y += 1.1;
      this._sightRay.direction.sub(this._sightRay.origin);
      const sightDistance = this._sightRay.direction.length();
      this._sightRay.direction.normalize();
      visible = this.world.raycastCollisionDistance(this._sightRay, sightDistance) >= sightDistance - .25;
    }
    if (!player.isDead) {
      // Clumsy TURNING — zombies don't snap to face you; they slew toward you
      // (brutes slowest). Slerp the whole mesh quaternion (convention-safe).
      this._tmpObj.position.copy(this.mesh.position);
      this._tmpObj.lookAt(player.position.x, this.position.y + 1.08, player.position.z);
      const turnRate = this.armedType ? 6 : (2.2 + this._surge * 1.5);
      this.mesh.quaternion.slerp(this._tmpObj.quaternion, damp(turnRate, dt));

      if (this.armedType) {
        const cfg = ARMED_CFG[this.armedType];

        if (visible && dist < ATTACK_RADIUS * 0.9) {
          // Melee fallback when too close
          if (this.attackCooldown <= 0) {
            this.attackCooldown = ATTACK_COOLDOWN;
            this.lungeTimer     = 0.2;
            if (this.audio) this.audio.playZombieAttack();
            onAttack(this.attackDamage, this.position);
          }
        } else if (visible && dist <= cfg.stopRange) {
          // Stand and shoot
          if (this.shootCooldown <= 0) {
            this._fireAt(player, onAttack);
          }
          // Slight strafe
          this._strafeT += dt * 0.7;
          this._strafeVec.set(-toPlayer.z, 0, toPlayer.x).normalize();
          const strafeSign = Math.sin(this._strafeT + this.id * 0.01) > 0 ? 1 : -1;
          moveDir  = this._strafeVec.multiplyScalar(strafeSign * 0.35);
          isMoving = true;
        } else {
          // Chase
          moveDir  = toPlayer.normalize();
          isMoving = true;
        }
      } else {
        // Pure melee — chase with a drunken WEAVE so a horde doesn't beeline
        // in perfect parallel lines (organic, staggering approach).
        if (!visible || dist > ATTACK_RADIUS * 0.85) {
          this._weaveT += dt * 1.3;
          const fwd = toPlayer.normalize();
          // perpendicular in the ground plane
          this._strafeVec.set(-fwd.z, 0, fwd.x);
          const weave = Math.sin(this._weaveT) * this._weaveAmt * Math.min(1, dist / 6);
          moveDir  = fwd.addScaledVector(this._strafeVec, weave).normalize();
          isMoving = true;
        } else if (this.attackCooldown <= 0) {
          this.attackCooldown = ATTACK_COOLDOWN;
          this.lungeTimer     = 0.2;
          if (this.audio) this.audio.playZombieAttack();
          onAttack(this.attackDamage, this.position);
        }
      }
    } else if (!this.armedType) {
      // Melee wander
      this.wanderCooldown -= dt;
      if (this.wanderCooldown <= 0 || this.position.distanceTo(this.wanderTarget) < 1.5) {
        const r = this.world.arenaHalf - 4;
        this.wanderTarget.set(
          (Math.random() * 2 - 1) * r,
          0,
          (Math.random() * 2 - 1) * r
        );
        this.wanderCooldown = 2 + Math.random() * 2;
      }
      this._wanderDir.subVectors(this.wanderTarget, this.position);
      if (this._wanderDir.lengthSq() > 0.04) {
        moveDir  = this._wanderDir.normalize();
        isMoving = true;
        this.mesh.lookAt(this.wanderTarget.x, this.position.y + 1.08, this.wanderTarget.z);
      }
    }

    if (moveDir) {
      // Lurching gait: velocity SURGES on the strong stride and drags between
      // (this._surge is set from the gait phase in _animate). Staggering cuts
      // the shambler to a near-crawl mid-stumble.
      const gaitVel = this.speed * this._surge * (staggering ? 0.25 : 1);
      this.position.addScaledVector(moveDir, gaitVel * dt);
      this.world.resolveCollisions(this.position, RADIUS);
    }
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);

    // Run bone animation
    this._animate(dt, isMoving);

    // Billboard health bar
    if (this.healthBarGroup) {
      this._healthQuat.copy(this.mesh.quaternion).invert().multiply(camera.quaternion);
      this.healthBarGroup.quaternion.copy(this._healthQuat);
    }
  }
}
