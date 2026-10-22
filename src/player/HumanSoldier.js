import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  dampHumanTimeScale,
  humanStrideWarpAngle,
  humanTravelPose,
  humanMotionTransitionSeconds,
  humanAimPose,
  mapHumanMotionPhase,
  selectHumanMotion,
  targetHumanStrideScale,
  targetHumanTimeScale,
} from './HumanLocomotion.js';
import { ACTION_TIME } from './Actions.js';
import {
  createHumanActionPose,
  createHumanDeathPose,
  sampleHumanActionPose,
  sampleHumanDeathPose,
} from './HumanActionMotion.js';
import {
  applyHumanRifleCarry,
  HUMAN_LOW_READY_AIM,
  humanWeaponScale,
} from './HumanRifleCarry.js';

// ───────────────────────────────────────────────────────────────────────────
// Real rigged human soldier (Mixamo "Vanguard"), with Idle / Walk / Run clips.
// Replaces the procedural block character: this is an actual human mesh driven
// by skeletal animation rather than rotating box primitives.
// ───────────────────────────────────────────────────────────────────────────
let _template   = null;   // { scene, animations }
let _loading    = false;
const _callbacks = [];

function _asMapToonMaterial(source) {
  const material = new THREE.MeshToonMaterial({
    color: source.color?.clone?.() ?? new THREE.Color(0x343a40),
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
  });
  material.name = source.name;
  return material;
}

const SOURCE_BONE_NAMES = Object.freeze({
  root: 'mixamorigRoot',
  'DEF-hips': 'mixamorigHips',
  'DEF-spine001': 'mixamorigSpine',
  'DEF-spine002': 'mixamorigSpine1',
  'DEF-spine003': 'mixamorigSpine2',
  'DEF-neck': 'mixamorigNeck',
  'DEF-head': 'mixamorigHead',
  'DEF-thighL': 'mixamorigLeftUpLeg', 'DEF-shinL': 'mixamorigLeftLeg',
  'DEF-footL': 'mixamorigLeftFoot', 'DEF-toeL': 'mixamorigLeftToeBase',
  'DEF-thighR': 'mixamorigRightUpLeg', 'DEF-shinR': 'mixamorigRightLeg',
  'DEF-footR': 'mixamorigRightFoot', 'DEF-toeR': 'mixamorigRightToeBase',
});

function sourceBoneName(name) {
  if (SOURCE_BONE_NAMES[name]) return SOURCE_BONE_NAMES[name];
  let match = /^DEF-(shoulder|upper_arm|forearm|hand)(L|R)$/.exec(name);
  if (match) {
    const side = match[2] === 'L' ? 'Left' : 'Right';
    const part = { shoulder: 'Shoulder', upper_arm: 'Arm', forearm: 'ForeArm', hand: 'Hand' }[match[1]];
    return `mixamorig${side}${part}`;
  }
  match = /^DEF-(?:f_)?(index|middle|ring|pinky|thumb)(\d\d)(L|R)$/.exec(name);
  if (match) {
    const side = match[3] === 'L' ? 'Left' : 'Right';
    const finger = match[1][0].toUpperCase() + match[1].slice(1);
    return `mixamorig${side}Hand${finger}${Number(match[2])}`;
  }
  return name;
}

export function retargetKyxLocomotionClips(clips) {
  return clips.map((source) => {
    const clip = source.clone();
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (dot < 0) continue;
      track.name = `${sourceBoneName(track.name.slice(0, dot))}${track.name.slice(dot)}`;
      // The library sprint sinks its toes below the Idle/Walk ground plane.
      // Preserve the existing measured correction without re-exporting any
      // rotations through Blender (the operation that broke the torso).
      if (clip.name === 'Run' && track.name === 'mixamorigHips.position') {
        for (let i = 2; i < track.values.length; i += 3) track.values[i] += 0.037;
      }
    }
    return clip;
  });
}

export function preloadHumanSoldier(onLoad) {
  if (_template) { onLoad?.(true); return; }
  if (onLoad) _callbacks.push(onLoad);
  if (_loading) return;
  _loading = true;
  // Blender-authored body plus untouched source-space locomotion. Re-exporting
  // the actions through Blender altered their rest rotations and made the live
  // bots fold and somersault. This compact source clip keeps the original walk.
  const loader = new GLTFLoader();
  let bodyGltf = null, motionGltf = null, failed = false;
  const fail = (err) => {
    if (failed) return;
    failed = true;
    console.warn('[HumanSoldier] load failed:', err?.message);
    _loading = false;
    _callbacks.splice(0).forEach((cb) => cb(false));
  };
  const finish = () => {
    if (failed || !bodyGltf || !motionGltf) return;
    try {
      bodyGltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false; // skinned bounds expand past the bind pose
        }
      });
      _template = {
        scene: bodyGltf.scene,
        animations: retargetKyxLocomotionClips(motionGltf.animations),
      };
      _loading  = false;
      _callbacks.splice(0).forEach((cb) => cb(true));
    } catch (error) { fail(error); }
  };
  loader.load('/kyx-player.glb', (gltf) => { bodyGltf = gltf; finish(); }, undefined, fail);
  loader.load('/kyx-locomotion.glb', (gltf) => { motionGltf = gltf; finish(); }, undefined, fail);
}

export function isHumanSoldierReady() { return !!_template; }

// The Vanguard model is authored ~1.8 world units tall already, but the game's
// character pedestal / capsule assumes ~1.8m standing at y=0. Tune to taste.
const MODEL_SCALE = 1.0;

// The Vanguard head/hair is tall; we compress it vertically (and shrink it a
// little) so the helmet can be a compact round shape instead of a tall egg. The
// head is fully hidden under the helmet, so this only frees up the silhouette.
const HEAD_SQUASH = new THREE.Vector3(0.82, 0.6, 0.86);

// ── Per-armor-type Spartan variants ─────────────────────────────────────────
// Each loadout armor type renders a visibly distinct futuristic super-soldier:
// its own armour colour, glowing visor/accent hue, surface finish, and build
// scale. This is what makes the loadout's armor cards each preview a different
// "model" instead of the same green Chief four times.
export const ARMOR_LOOKS = {
  assault: { // matte warm-gray exosuit with restrained cyan signal light
    body: 0xaeb3b5, visor: 0x79cbd6,
    roughness: 0.78, metalness: 0.08, scale: 1.00,
  },
  recon: {   // sleek light-blue scout exo
    body: 0x2f6fae, visor: 0x36f0ff,
    roughness: 0.42, metalness: 0.48, scale: 0.97,
  },
  heavy: {   // bulky burnt-orange juggernaut plate
    body: 0x9a4a1f, visor: 0xff7a1a,
    roughness: 0.62, metalness: 0.30, scale: 1.09,
  },
  stealth: { // dark infiltrator plate with violet glow (kept light enough to read)
    body: 0x2c3042, visor: 0xb24bff,
    roughness: 0.30, metalness: 0.62, scale: 0.95,
  },
};
const DEFAULT_LOOK = ARMOR_LOOKS.assault;

function _lookFor(armorTypeId) {
  return ARMOR_LOOKS[armorTypeId] || DEFAULT_LOOK;
}

// Resolve a Mixamo bone by short name across the naming variants GLTF/THREE can
// produce: "mixamorig:Head" (raw), "mixamorigHead" (colon sanitized away), or a
// bare "Head". Returns null if none match.
function findBone(root, name) {
  return root.getObjectByName('mixamorig:' + name)
      || root.getObjectByName('mixamorig' + name)
      || root.getObjectByName(name)
      || null;
}

/**
 * Build an independent, animated human-soldier instance.
 * Returns a THREE.Group whose userData carries { mixer, actions, setMotion, isHuman }.
 * Call `group.userData.mixer.update(dt)` every frame and
 * `group.userData.setMotion('idle'|'walk'|'run')` to switch clips.
 * `armorTypeId` selects one of the ARMOR_LOOKS variants so each loadout armor
 * type previews as a distinct super-soldier.
 */
export function buildHumanSoldier(skin = null, armorTypeId = 'assault', armorSkin = null) {
  if (!_template) return null;

  const look = _lookFor(armorTypeId);
  const root = cloneSkeleton(_template.scene);
  root.scale.setScalar(MODEL_SCALE * look.scale);
  const authoredArmor = !!root.getObjectByName('KYX_HelmetHood')
    || !!root.getObjectByName('KYX_CoreVest');

  // Give this instance its own materials, and split body vs visor so we can
  // paint each armour variant: coloured plate + glowing visor.
  const bodyMats = [];
  const visorMats = [];
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      const source = o.material;
      const n = (source.name || '') + ' ' + (o.name || '');
      o.material = _asMapToonMaterial(source);
      if (/visor/i.test(n)) visorMats.push(o.material);
      else                  bodyMats.push(o.material);
    }
  });
  // The Blender-authored KYX model already contains its designed white,
  // graphite, and orange material blocking. Flattening every non-visor mesh to
  // one armor-look colour is what turned the live model into the featureless
  // blue-gray figure even though the inventory preview showed the correct
  // white/orange character. Only legacy/non-authored soldiers need that pass.
  if (!authoredArmor) _applyArmorLook(bodyMats, visorMats, look);

  const group = new THREE.Group();
  group.add(root);

  // Squash the head down. The Vanguard's tall hair/scalp forces any helmet that
  // covers it into an egg silhouette; since the head is fully hidden under the
  // helmet, we vertically compress (and slightly shrink) the head bone so a
  // compact, ROUND helmet can cover it. The armour pieces are pinned in world
  // space by _attachAtWorld, so they are unaffected by this bone scale — only the
  // hidden head mesh shrinks. HEAD_SQUASH is re-asserted each frame in armorTick.
  const _headBone = findBone(root, 'Head');
  if (_headBone && !authoredArmor) _headBone.scale.copy(HEAD_SQUASH);

  // Bolt on this loadout's distinct armour set (bone-parented so plates ride the
  // skeleton during the animation). Each armor type gets its own silhouette.
  group.updateMatrixWorld(true);
  const armor = authoredArmor
    ? { animated: [], materials: [], pieces: [] }
    : _buildArmorPieces(root, armorTypeId, look, armorSkin);

  // Measure the standing figure now, while its matrices resolve cleanly, and
  // stash the result. Re-measuring a posed SkinnedMesh elsewhere (e.g. the
  // loadout turntable) can collapse to a degenerate box, so consumers that
  // need to frame the model should read these instead of re-running setFromObject.
  group.updateMatrixWorld(true);
  const _box = new THREE.Box3().setFromObject(group);
  const _size = _box.getSize(new THREE.Vector3());
  const _ctr  = _box.getCenter(new THREE.Vector3());

  // ── Animation: 3 clips (idle/walk/run) + rich procedural motion layers ──
  const mixer   = new THREE.AnimationMixer(root);
  const byName  = {};
  for (const source of _template.animations) {
    const clip = source.clone();
    byName[clip.name] = clip;
  }

  const actions = {
    idle: byName.Idle ? mixer.clipAction(byName.Idle) : null,
    walk: byName.Walk ? mixer.clipAction(byName.Walk) : null,
    run:  byName.Run  ? mixer.clipAction(byName.Run)  : null,
  };
  for (const a of Object.values(actions)) {
    if (a) { a.enabled = true; a.setEffectiveWeight(1); a.play(); a.setEffectiveWeight(0); }
  }

  let current = null;
  // Phase-matched crossfades preserve which foot is planted. Resetting every
  // new clip to frame zero made both feet pop whenever walk/run switched, while
  // Three's warp option briefly sped one clip up and slowed the other down.
  const _fadeKey = (from, to) => {
    if (!from || !to) return 0.2;
    const f = from === actions.idle ? 'idle' : from === actions.walk ? 'walk' : 'run';
    const t = to   === actions.idle ? 'idle' : to   === actions.walk ? 'walk' : 'run';
    return humanMotionTransitionSeconds(f, t);
  };
  const setMotion = (name, fadeOverride) => {
    const next = actions[name] || actions.idle;
    if (!next || next === current) return;
    const fromName = current === actions.walk ? 'walk'
      : current === actions.run ? 'run' : 'idle';
    const toName = next === actions.walk ? 'walk'
      : next === actions.run ? 'run' : 'idle';
    const rawPhase = current
      ? (current.time / Math.max(1e-5, current.getClip().duration)) % 1 : 0;
    const phase = mapHumanMotionPhase(rawPhase, fromName, toName);
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.reset().play();
    if (phase > 0) next.time = phase * next.getClip().duration;
    if (current) {
      const fade = Number.isFinite(fadeOverride) ? fadeOverride : _fadeKey(current, next);
      current.crossFadeTo(next, fade, false);
    }
    current = next;
  };
  setMotion('idle');

  // ── Per-armor motion: animation speed + additive stance + animated armour ──
  const motion = ARMOR_MOTION[armorTypeId] || ARMOR_MOTION.assault;
  const baseTS = motion.speed;
  // The mixer owns fade scheduling: its clock must always run forward. Only
  // individual gait clips may reverse when a player/bot backpedals.
  mixer.timeScale = 1;

  // ── Bone lookup (Mixamo rig) ────────────────────────────────────────────────
  // Cached once so armorTick doesn't traverse the skeleton every frame. Any
  // bone that's missing degrades gracefully (procedural offsets just skip it).
  // GLTF/THREE sanitizes node names, so "mixamorig:Head" can arrive as
  // "mixamorigHead" (or bare "Head") — resolve all forms.
  const B = {
    hips:  findBone(root, 'Hips'),
    spine: findBone(root, 'Spine'),
    s1:    findBone(root, 'Spine1'),
    s2:    findBone(root, 'Spine2'),
    neck:  findBone(root, 'Neck'),
    head:  findBone(root, 'Head'),
    lClav: findBone(root, 'LeftShoulder'),
    rClav: findBone(root, 'RightShoulder'),
    lArm:  findBone(root, 'LeftArm'),
    rArm:  findBone(root, 'RightArm'),
    lFore: findBone(root, 'LeftForeArm'),
    rFore: findBone(root, 'RightForeArm'),
    lHand: findBone(root, 'LeftHand'),
    rHand: findBone(root, 'RightHand'),
    lLeg:  findBone(root, 'LeftUpLeg'),
    rLeg:  findBone(root, 'RightUpLeg'),
    lCalf: findBone(root, 'LeftLeg'),
    rCalf: findBone(root, 'RightLeg'),
    lFoot: findBone(root, 'LeftFoot'),
    rFoot: findBone(root, 'RightFoot'),
    weaponSocket: root.getObjectByName('KYX_WeaponSocket_R'),
    supportSocket: root.getObjectByName('KYX_SupportSocket_L'),
    swordSocket: root.getObjectByName('KYX_SwordSocket_R'),
    backHolsterSocket: root.getObjectByName('KYX_BackHolsterSocket'),
  };

  // Lightweight boot jets. They live in character space (rather than under
  // the foot bones) so the flame always points down even while the jump pose
  // rotates the ankles. The foot bones only supply the two emitter positions.
  const _thrusterFx = new THREE.Group();
  _thrusterFx.name = 'KYX_BootThrusters';
  _thrusterFx.visible = false;
  const _thrusterOuterMat = new THREE.MeshBasicMaterial({
    color: 0xff7a20,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const _thrusterInnerMat = new THREE.MeshBasicMaterial({
    color: 0x8eefff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const _makeBootFlame = () => {
    const flame = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.22, 7), _thrusterOuterMat);
    outer.rotation.z = Math.PI;
    outer.position.y = -0.105;
    outer.frustumCulled = false;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.145, 6), _thrusterInnerMat);
    inner.rotation.z = Math.PI;
    inner.position.y = -0.064;
    inner.frustumCulled = false;
    flame.add(outer, inner);
    _thrusterFx.add(flame);
    return flame;
  };
  const _bootFlames = [_makeBootFlame(), _makeBootFlame()];
  const _bootBones = [B.lFoot, B.rFoot];
  const _bootWorld = new THREE.Vector3();
  group.add(_thrusterFx);

  // ── Weapon-hold references ──────────────────────────────────────────────────
  // Bake the idle clip's first frame into the bones once, and snapshot the arm
  // rotations. Holding poses are defined as offsets from this natural
  // arms-at-side stance (rather than the GLB's T-pose bind), so the same
  // offsets read correctly no matter which clip is playing underneath.
  mixer.update(0);
  const _armRef = {
    lArm:  B.lArm  ? B.lArm.quaternion.clone()  : null,
    rArm:  B.rArm  ? B.rArm.quaternion.clone()  : null,
    lFore: B.lFore ? B.lFore.quaternion.clone() : null,
    rFore: B.rFore ? B.rFore.quaternion.clone() : null,
  };
  const _E = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  // Two-handed rifle carry: weapon arm folds across the chest, support arm
  // reaches over toward the forend. Sword: blade arm bends to a low guard,
  // off-hand swings free for balance.
  // Axis map (probed on the Vanguard rig, right side; left mirrors Z):
  //   arm  X+ = flex forward/up/in    arm  Z+ = pull across the chest
  //   fore X+ = elbow flex up         fore Z+ = pull the hand inward
  const HOLD_POSES = {
    gun: {   // two-handed low-ready: trigger hand at the chest, SUPPORT hand reaches
             // forward onto the handguard. Upper arms hang low; the forearms flex
             // up so both hands meet the weapon in front of the chest.
      rArm:  _E(0.32, 0, 0.22),  rFore: _E(0.52, 0, 0.44),
      lArm:  _E(0.54, 0, -0.30), lFore: _E(0.74, 0, -0.44),
      w: { idle: 0.90, walk: 0.85, run: 0.70, air: 0.92 },
    },
    melee: { // relaxed low guard: blade arm bent forward at the side, off-hand free
      rArm:  _E(0.35, 0, 0.18),  rFore: _E(0.30, 0, 0.25),
      lArm:  null, lFore: null,  // free arm counter-swings for balance
      w: { idle: 0.70, walk: 0.58, run: 0.42, air: 0.80 },
    },
  };
  const _qHold = new THREE.Quaternion();
  // Blend a clip-posed bone toward ref*offset — damps the walk/run arm swing
  // into a believable carry without freezing it solid.
  const _holdBone = (bone, ref, off, w) => {
    if (!bone || !ref || !off || w <= 0) return;
    _qHold.copy(ref).multiply(off);
    bone.quaternion.slerp(_qHold, w);
  };
  let _weaponKind = null;   // null | 'gun' | 'melee'
  let _holdRunT   = 0;      // smoothed 0..1 run blend for the sprint tuck

  // Locomotion driver: choose the clip (with hysteresis to stop flicker) and
  // scale playback to the real movement speed so the feet track the ground and
  // don't slide. Extra state (accel, air time, strafe) feeds the procedural
  // layer for lean, launch/land bounce, etc.
  const _clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  let _locName    = 'idle';
  let _reportedSpeed = 0;
  let _targetTimeScale = baseTS;
  let _currentTimeScale = baseTS;
  let _targetStrideScale = 1;
  let _strideScale = 1;
  let _lastSpeed  = 0;
  let _accel      = 0;                     // smoothed dSpeed/dt for lean
  let _grounded   = true;
  let _airT       = 0;                     // seconds off the ground
  let _landT      = 0;                     // seconds since landing (landing squish)
  let _strafeLean = 0;                     // –1 (right) .. +1 (left)
  let _targetStrafeLean = 0;
  let _targetLowerYaw = 0;                 // legs follow travel while torso keeps aim
  let _lowerYaw = 0;
  let _reverseGait = false;
  let _forwardLean = 0;                    // 0..1 momentum lean forward
  let _fireRecoil = 0;                     // recoil kick amplitude, decays
  let _flinch     = { x: 0, y: 0, t: 0 };  // damage flinch, decays
  let _aimYaw     = 0;                     // desired upper-body yaw offset
  let _aimPitch   = 0;                     // desired head pitch offset
  let _sAimYaw    = 0;                     // smoothed
  let _sAimPitch  = 0;                     // smoothed
  let _idleGlanceT = 0;
  let _idleGlanceTarget = 0;               // occasional idle head yaw target
  let _idleGlanceCooldown = 3 + Math.random() * 4;
  let _jumpT      = 0;                      // seconds since the current jump launched
  let _teleportT  = 0;                      // teleport reform timer, decays
  const TP_DUR    = 0.42;                   // teleport reform duration (s)
  let _verticalVelocity = 0;
  let _targetCrouch = 0, _crouchT = 0;
  let _targetSlide = 0, _slideT = 0;
  let _reloadP = 0, _meleeSwing = 1;
  let _reloadPoseP = 0, _meleePoseP = 1;
  let _targetWeaponAim = 0, _weaponAim = 0;
  let _weaponMove = 0, _weaponRun = 0, _weaponFiring = 0, _weaponScoped = 0;
  const _actionLeft = { swap: 0, throw: 0 };
  const _actionPose = createHumanActionPose();
  const _deathPose = createHumanDeathPose();
  let _deathP = 0;
  let _deathSide = 1;

  const setLocomotion = (
    speed, grounded = true, sprinting = false, strafe = 0, dirF = 1, dirR = 0
  ) => {
    _reportedSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);
    const df = Number.isFinite(dirF) ? dirF : 1;
    const dr = Number.isFinite(dirR) ? dirR : 0;
    if (_reportedSpeed > 0.2) {
      // Backpedalling reverses the clip instead of twisting the pelvis 180°.
      // Hysteresis prevents the choice flickering while moving almost sideways.
      const travel = humanTravelPose(df, dr, _reverseGait);
      _reverseGait = travel.reverse;
      _targetLowerYaw = travel.yaw;
    } else {
      _targetLowerYaw = 0;
      _reverseGait = false;
    }
    // Air state overrides everything — bots normally pass grounded=true, but a
    // player-controlled or scripted character can hop by setting grounded=false.
    if (!grounded) {
      const takeoffMotion = _locName;
      const justTookOff = _grounded;
      if (_grounded) _jumpT = 0;   // just left the ground — start the jump clock
      _grounded = false;
      _locName = 'air';
      // Use a NEUTRAL (idle) leg base while airborne so the procedural jump pose
      // reads as a real jump — a push-off, an apex tuck, and a reach for the
      // landing — instead of a slow walk cycle treading the air.
      setMotion('idle', justTookOff
        ? humanMotionTransitionSeconds(takeoffMotion, 'air') : undefined);
      _targetTimeScale = baseTS;
      _targetStrideScale = 1;
    } else {
      const justLanded = !_grounded;
      if (!_grounded) { _landT = 0.24; _airT = 0; } // landing bounce
      _grounded = true;
      const name = selectHumanMotion(_reportedSpeed, sprinting, _locName);
      _locName = name;
      setMotion(name, justLanded
        ? humanMotionTransitionSeconds('air', name) : undefined);
      _targetTimeScale = targetHumanTimeScale(name, _reportedSpeed, baseTS)
        * (_reverseGait && name !== 'idle' ? -1 : 1);
      _targetStrideScale = targetHumanStrideScale(
        name, _reportedSpeed, _targetTimeScale, look.scale
      );
    }
    _targetStrafeLean = _clamp(strafe, -1, 1);
  };

  // Aim tracking: yaw twists the upper spine, pitch tilts the head.
  const setAim = (pitch, yaw) => {
    const aim = humanAimPose(pitch, yaw);
    _aimPitch = aim.pitch;
    _aimYaw = aim.yaw;
  };
  // Impulse hooks: fire recoil, damage flinch, jump launch.
  const triggerFire = (kick = 1) => { _fireRecoil = Math.max(_fireRecoil, 0.12 * kick); };
  const triggerHit  = (dx = 0, dy = 0) => { _flinch.x = dx * 0.18; _flinch.y = dy * 0.14; _flinch.t = 0.35; };
  const triggerJump = () => { _grounded = false; _airT = 0.001; _jumpT = 0; };
  // Teleport/blink reform: the body arrives compressed and braced, then springs
  // back to a full stance over TP_DUR — a quick recover that sells the blink.
  const triggerTeleport = () => { _teleportT = TP_DUR; };
  const setActionState = (state = {}) => {
    if (Number.isFinite(state.reload)) _reloadP = _clamp(state.reload, 0, 1);
    if (Number.isFinite(state.swing)) _meleeSwing = _clamp(state.swing, 0, 1);
    if (Number.isFinite(state.crouch)) _targetCrouch = _clamp(state.crouch, 0, 1);
    if (Number.isFinite(state.slide)) _targetSlide = _clamp(state.slide, 0, 1);
    if (Number.isFinite(state.vy)) _verticalVelocity = state.vy;
    if (Number.isFinite(state.aim)) {
      // Keep firearms in a readable combat-ready shoulder pose even when the
      // trigger is idle. Sprint/reload layers still lower and rotate the rifle,
      // while firing/ADS can complete the blend to a full aim pose.
      const combatReady = _weaponKind === 'gun' ? HUMAN_LOW_READY_AIM : 0;
      _targetWeaponAim = Math.max(combatReady, _clamp(state.aim, 0, 1));
    }
    if (Number.isFinite(state.move)) _weaponMove = _clamp(state.move, 0, 1);
    if (Number.isFinite(state.run)) _weaponRun = _clamp(state.run, 0, 1);
    if (Number.isFinite(state.firing)) _weaponFiring = _clamp(state.firing, 0, 1);
    if (Number.isFinite(state.scoped)) _weaponScoped = _clamp(state.scoped, 0, 1);
  };
  const triggerAction = (kind) => {
    if (kind === 'swap' || kind === 'throw') {
      _actionLeft[kind] = ACTION_TIME[kind];
    } else if (kind === 'flinch') {
      triggerHit(0.7, 0.8);
    }
  };
  const setDeathState = (progress = 0, side = 1) => {
    _deathP = _clamp(progress, 0, 1);
    _deathSide = side < 0 ? -1 : 1;
    if (_heldWeapon) _heldWeapon.visible = _deathP < 0.48;
  };

  // Stance offsets applied after mixer.update overwrites bones (per armor type).
  const poseOffsets = [];
  // Global posture correction: the Vanguard idle clip bakes a forward hunch
  // (rounded upper back + forward-jutting head). Straighten it once for EVERY
  // variant so the base stance stands tall. Negative X leans the spine back
  // upright; the neck pulls the head off its forward jut and the head levels
  // the gaze. Per-variant spineLean/headPitch below then read as relative
  // adjustments from this upright base (recon a touch more upright, heavy a
  // touch more lumbering) rather than stacking on top of the clip's hunch.
  const UPRIGHT = [
    [B.spine, -0.15],   // un-fold the hip: the deepest part of the clip's hunch
    [B.s1,    -0.15],
    [B.s2,    -0.09],
    [B.neck,  -0.18],   // pull the head off its forward jut
    [B.head,   0.07],   // re-level the gaze after the neck straightens
  ];
  for (const [bone, ax] of UPRIGHT)
    if (bone) poseOffsets.push({ bone, q: new THREE.Quaternion().setFromAxisAngle(_AX_X, ax) });

  if (B.s1 && motion.spineLean)
    poseOffsets.push({ bone: B.s1, q: new THREE.Quaternion().setFromAxisAngle(_AX_X, motion.spineLean) });
  if (B.head && motion.headPitch)
    poseOffsets.push({ bone: B.head, q: new THREE.Quaternion().setFromAxisAngle(_AX_X, motion.headPitch) });

  // Scratch quaternion pool — allocating per-frame in armorTick would thrash.
  const _q = [
    new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(),
    new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(),
    new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(),
  ];
  const _actionQuat = new THREE.Quaternion();
  const _actionEuler = new THREE.Euler();

  let armorT = 0;
  const _rootBaseY = root.position.y;
  const armorTick = (dt) => {
    // Presentation is allowed to catch up after a dropped frame, but never to
    // jump an entire pose in one render. Simulation/network time remains
    // untouched; this clamp only stabilizes the visible skeleton and weapon IK.
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    armorT += dt;
    const t = armorT;
    let bodyDrop = 0;
    root.position.y = _rootBaseY;
    _currentTimeScale = dampHumanTimeScale(_currentTimeScale, _targetTimeScale, dt);
    mixer.timeScale = 1;
    actions.idle?.setEffectiveTimeScale(baseTS);
    actions.walk?.setEffectiveTimeScale(_currentTimeScale);
    actions.run?.setEffectiveTimeScale(_currentTimeScale);
    _strideScale += (_targetStrideScale - _strideScale) * (1 - Math.exp(-8 * dt));
    _strafeLean += (_targetStrafeLean - _strafeLean) * (1 - Math.exp(-10 * dt));
    const gaitPhase = current && current !== actions.idle
      ? (current.time / Math.max(1e-5, current.getClip().duration)) * Math.PI * 2
      : t * 1.5;

    // Keep the head squashed even if an animation clip touches head scale.
    if (B.head && !authoredArmor) B.head.scale.copy(HEAD_SQUASH);

    // ── Animated armor pieces (visor blink, thruster pulse, plate sway) ──
    for (const a of armor.animated) {
      const an = a.anim;
      if (an.type === 'pulse' || an.type === 'thruster') {
        a.mat.emissiveIntensity = an.min + (an.max - an.min) * (0.5 + 0.5 * Math.sin(t * an.freq + (an.phase || 0)));
      } else if (an.type === 'blink') {
        a.mat.emissiveIntensity = Math.sin(t * an.freq + (an.phase || 0)) > 0.3 ? an.on : an.off;
      } else if (an.type === 'sway') {
        const ang = an.amp * Math.sin(t * an.freq + (an.phase || 0));
        a.mesh.quaternion.copy(a.baseQuat);
        if (an.axis === 'z') a.mesh.rotateZ(ang); else a.mesh.rotateX(ang);
      }
    }

    // ── Per-armor stance offsets (applied first so procedural layers stack on top)
    for (const p of poseOffsets) p.bone.quaternion.multiply(p.q);

    // ── Track state for lean/land/recoil layers ──
    const speedNow = _grounded ? _reportedSpeed : 0;
    _accel += ((speedNow - _lastSpeed) / Math.max(dt, 1e-3) - _accel) * Math.min(1, dt * 4);
    _lastSpeed = speedNow;
    if (!_grounded) { _airT += dt; _jumpT += dt; }
    if (_landT > 0) _landT = Math.max(0, _landT - dt);
    if (_fireRecoil > 0) _fireRecoil = Math.max(0, _fireRecoil - dt * 1.4);
    if (_flinch.t > 0) _flinch.t = Math.max(0, _flinch.t - dt);
    if (_teleportT > 0) _teleportT = Math.max(0, _teleportT - dt);
    for (const kind of ['swap', 'throw']) {
      if (_actionLeft[kind] > 0) _actionLeft[kind] = Math.max(0, _actionLeft[kind] - dt);
    }
    _crouchT += (_targetCrouch - _crouchT) * (1 - Math.exp(-12 * dt));
    _slideT += (_targetSlide - _slideT) * (1 - Math.exp(-16 * dt));
    _weaponAim += (_targetWeaponAim - _weaponAim) * (1 - Math.exp(-10 * dt));
    _reloadPoseP += (_reloadP - _reloadPoseP) * (1 - Math.exp(-22 * dt));
    _meleePoseP += (_meleeSwing - _meleePoseP) * (1 - Math.exp(-24 * dt));

    // Smooth the aim tracking so quick camera whips don't snap the spine.
    const aimEase = 1 - Math.exp(-8 * dt);
    _sAimYaw   += (_aimYaw   - _sAimYaw)   * aimEase;
    _sAimPitch += (_aimPitch - _sAimPitch) * aimEase;
    let lowerYawDelta = _targetLowerYaw - _lowerYaw;
    lowerYawDelta = THREE.MathUtils.euclideanModulo(lowerYawDelta + Math.PI, Math.PI * 2) - Math.PI;
    _lowerYaw += lowerYawDelta * (1 - Math.exp(-12 * dt));

    // Momentum lean: tilt forward when accelerating into a run, back when stopping.
    const targetFwd = _grounded ? _clamp(_accel * 0.02, -0.06, 0.09) : 0;
    _forwardLean += (targetFwd - _forwardLean) * (1 - Math.exp(-5 * dt));

    // ── Layer 1: aim tracking (spine1 yaw + head pitch) ──
    if (B.s1)   B.s1.quaternion.multiply(_q[0].setFromAxisAngle(_AX_Y, _sAimYaw * 0.55));
    if (B.s2)   B.s2.quaternion.multiply(_q[1].setFromAxisAngle(_AX_Y, _sAimYaw * 0.25));
    if (B.head) B.head.quaternion.multiply(_q[2].setFromAxisAngle(_AX_X, _sAimPitch * 0.7));
    if (B.head) B.head.quaternion.multiply(_q[3].setFromAxisAngle(_AX_Y, _sAimYaw   * 0.35));

    // Lower-body travel direction. The pelvis turns the running clips into the
    // resolved movement vector while the spine counter-turns to keep the chest,
    // rifle, and gaze on the aim line.
    if (Math.abs(_lowerYaw) > 0.001) {
      if (B.hips)  B.hips.quaternion.multiply(_q[4].setFromAxisAngle(_AX_Y, _lowerYaw));
      if (B.spine) B.spine.quaternion.multiply(_q[5].setFromAxisAngle(_AX_Y, -_lowerYaw * 0.28));
      if (B.s1)    B.s1.quaternion.multiply(_q[6].setFromAxisAngle(_AX_Y, -_lowerYaw * 0.42));
      if (B.s2)    B.s2.quaternion.multiply(_q[7].setFromAxisAngle(_AX_Y, -_lowerYaw * 0.30));
    }

    // Past the believable cadence cap, extend the authored stride at the
    // thighs. The sign is calibrated against the real Run clip so the planted
    // foot travels farther backwards; bending the calves here causes toe drag.
    // The KYX Blender clips already contain their complete leg arcs. Applying
    // the legacy Soldier thigh warp on top of them can over-rotate a planted
    // leg by hundreds of degrees at the loop seam, producing folded bots.
    if (!authoredArmor && _grounded
        && (_locName === 'walk' || _locName === 'run') && _strideScale > 1.001) {
      const stride = humanStrideWarpAngle(_locName, _strideScale, gaitPhase)
        * (1 - _slideT) * (1 - _crouchT * 0.45);
      if (B.lLeg)  B.lLeg.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X,  stride));
      if (B.rLeg)  B.rLeg.quaternion.multiply(_q[1].setFromAxisAngle(_AX_X, -stride));
    }

    // ── Layer 2: strafe lean (bank Z into direction of movement) ──
    if (B.spine && _grounded) {
      const bank = _strafeLean * 0.11;
      B.spine.quaternion.multiply(_q[4].setFromAxisAngle(_AX_Z, bank));
    }

    // ── Layer 3: momentum forward lean ──
    // Curve through the torso instead of hinging the whole upper body at the
    // waist. The head counter-rotation keeps the gaze stable through starts
    // and stops while the chest still visibly absorbs momentum.
    if (B.spine) B.spine.quaternion.multiply(_q[5].setFromAxisAngle(_AX_X, _forwardLean * 0.45));
    if (B.s1)    B.s1.quaternion.multiply(_q[6].setFromAxisAngle(_AX_X, _forwardLean * 0.35));
    if (B.s2)    B.s2.quaternion.multiply(_q[7].setFromAxisAngle(_AX_X, _forwardLean * 0.20));
    if (B.head)  B.head.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, -_forwardLean * 0.12));

    // ── Layer 4: fire recoil (spine kicks back, decays out) ──
    if (_fireRecoil > 0) {
      if (B.s1)   B.s1.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, -_fireRecoil));
      if (B.head) B.head.quaternion.multiply(_q[1].setFromAxisAngle(_AX_X, -_fireRecoil * 0.6));
    }

    // ── Layer 5: damage flinch (torso twists away from hit direction) ──
    if (_flinch.t > 0) {
      const w = _flinch.t / 0.35;   // 1 -> 0 over 0.35s
      const bend = Math.sin(w * Math.PI) * 0.8;  // soft ease-in/out
      if (B.spine) B.spine.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, -_flinch.y * bend));
      if (B.s2)    B.s2.quaternion.multiply(_q[1].setFromAxisAngle(_AX_Z,  _flinch.x * bend));
      if (B.head)  B.head.quaternion.multiply(_q[2].setFromAxisAngle(_AX_Z, _flinch.x * bend * 0.6));
    }

    // ── Layer 6: jump — a real three-phase jump keyed off the launch clock:
    //   push-off  (~0–0.13s): legs drive down, body stretches, arms swing up
    //   apex tuck (~0.10–0.5): knees gather up under the body, slight forward curl
    //   reach     (~0.4s+)   : legs extend back down, prepping for the landing
    if (!_grounded) {
      const push  = _clamp(_jumpT / 0.13, 0, 1) * (1 - _clamp((_jumpT - 0.13) / 0.12, 0, 1));
      const timedTuck = _clamp((_jumpT - 0.09) * 5.5, 0, 1)
        * (1 - _clamp((_jumpT - 0.5) * 2, 0, 0.75));
      const apexTuck = _clamp(1 - Math.abs(_verticalVelocity) / 5.5, 0, 1);
      const tuck = Math.max(timedTuck * 0.65, apexTuck);
      const reach = Math.max(
        _clamp((_jumpT - 0.4) * 3, 0, 0.9),
        _clamp(-_verticalVelocity / 8, 0, 0.9)
      );

      // Spine: brief stretch up on launch, small forward curl at the tuck.
      if (B.spine) B.spine.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, 0.10 * tuck - 0.05 * push));
      // Thighs (−X raises the knee): drive down on launch, gather up at apex,
      // extend down to reach for the ground. Legs slightly asymmetric = natural.
      const thighL = 0.12 * push - 0.62 * tuck + 0.34 * reach;
      const thighR = 0.12 * push - 0.46 * tuck + 0.28 * reach;
      if (B.lLeg) B.lLeg.quaternion.multiply(_q[1].setFromAxisAngle(_AX_X, thighL));
      if (B.rLeg) B.rLeg.quaternion.multiply(_q[2].setFromAxisAngle(_AX_X, thighR));
      // Knees bend deeply at the apex tuck, straighten to reach for the landing.
      const knee = 0.9 * tuck - 0.5 * reach;
      if (B.lCalf) B.lCalf.quaternion.multiply(_q[3].setFromAxisAngle(_AX_X, knee));
      if (B.rCalf) B.rCalf.quaternion.multiply(_q[4].setFromAxisAngle(_AX_X, knee * 0.85));
      // Free arms swing up on the push-off for lift; armed limbs stay on the
      // weapon (the hold layer re-plants them below).
      const armUp = 0.6 * push + 0.15 * tuck;
      if (B.lArm && _weaponKind !== 'gun') B.lArm.quaternion.multiply(_q[5].setFromAxisAngle(_AX_X, armUp));
      if (B.rArm && !_weaponKind)          B.rArm.quaternion.multiply(_q[6].setFromAxisAngle(_AX_X, armUp));
    }

    // ── Layer 7: landing squish (brief hip drop, decays) ──
    if (_landT > 0) {
      const w = _landT / 0.24;
      const drop = Math.sin((1 - w) * Math.PI) * 0.09;
      if (B.hips) {
        bodyDrop += drop;
        if (B.spine) B.spine.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X,  drop * 1.6));
        if (B.lLeg)  B.lLeg.quaternion.multiply(_q[1].setFromAxisAngle(_AX_X,  -drop * 2.2));
        if (B.rLeg)  B.rLeg.quaternion.multiply(_q[2].setFromAxisAngle(_AX_X,  -drop * 2.2));
      }
    }

    // ── Layer 7b: teleport reform — the body arrives compressed into a braced
    // crouch (knees bent, torso curled, arms thrown out to steady) and springs
    // back up to a full stance over TP_DUR. Sells the blink as a hard arrival. ──
    if (_teleportT > 0) {
      const p = 1 - _teleportT / TP_DUR;        // 0 (arrival) → 1 (recovered)
      const c = Math.max(0, 1 - p * 1.12);      // compression, strongest at arrival
      bodyDrop += c * 0.22;
      if (B.spine) B.spine.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, c * 0.30));
      if (B.s1)    B.s1.quaternion.multiply(_q[1].setFromAxisAngle(_AX_X, c * 0.15));
      if (B.lLeg)  B.lLeg.quaternion.multiply(_q[2].setFromAxisAngle(_AX_X, -c * 0.34));
      if (B.rLeg)  B.rLeg.quaternion.multiply(_q[3].setFromAxisAngle(_AX_X, -c * 0.34));
      if (B.lCalf) B.lCalf.quaternion.multiply(_q[4].setFromAxisAngle(_AX_X, c * 0.72));
      if (B.rCalf) B.rCalf.quaternion.multiply(_q[5].setFromAxisAngle(_AX_X, c * 0.72));
      // Arms fling out to brace; the weapon hand keeps its grip.
      const brace = c * 0.55;
      if (B.lArm)                  B.lArm.quaternion.multiply(_q[6].setFromAxisAngle(_AX_Z,  brace));
      if (B.rArm && !_weaponKind)  B.rArm.quaternion.multiply(_q[7].setFromAxisAngle(_AX_Z, -brace));
    }

    // ── Layer 8: rich idle life — breathing, weight shift, occasional glance ──
    // Crouch and slide are real silhouettes rather than a standing run clip
    // translated downward. The slide extends a lead leg and tucks the trail leg.
    const crouch = _crouchT * (1 - _slideT);
    if (crouch > 0.001 || _slideT > 0.001) {
      bodyDrop += crouch * 0.19 + _slideT * 0.30;
      if (B.spine) B.spine.quaternion.multiply(
        _q[0].setFromAxisAngle(_AX_X, crouch * 0.12 - _slideT * 0.20));
      if (B.lLeg) B.lLeg.quaternion.multiply(
        _q[1].setFromAxisAngle(_AX_X, -crouch * 0.32 + _slideT * 0.40));
      if (B.rLeg) B.rLeg.quaternion.multiply(
        _q[2].setFromAxisAngle(_AX_X, -crouch * 0.32 - _slideT * 0.78));
      if (B.lCalf) B.lCalf.quaternion.multiply(
        _q[3].setFromAxisAngle(_AX_X, crouch * 0.62 - _slideT * 0.28));
      if (B.rCalf) B.rCalf.quaternion.multiply(
        _q[4].setFromAxisAngle(_AX_X, crouch * 0.62 + _slideT * 1.05));
    }
    root.position.y = _rootBaseY - bodyDrop;

    if (_locName === 'idle') {
      // Two breathing frequencies layered for a natural cycle.
      const breathe = Math.sin(t * 1.5) * 0.014 + Math.sin(t * 2.7) * 0.005;
      if (B.s1) B.s1.quaternion.multiply(_bq1.setFromAxisAngle(_AX_X, breathe));
      // Slow hip weight shift left/right — sells "standing casually".
      if (B.hips) B.hips.quaternion.multiply(_q[0].setFromAxisAngle(_AX_Z, Math.sin(t * 0.5) * 0.020));
      // Head sways slowly and occasionally glances toward a target angle.
      _idleGlanceT += dt;
      if (_idleGlanceT > _idleGlanceCooldown) {
        _idleGlanceT = 0;
        _idleGlanceCooldown = 3 + Math.random() * 4;
        _idleGlanceTarget = (Math.random() - 0.5) * 0.5;   // ± ~28°
      }
      // Decay the glance target back to 0 over its dwell time.
      _idleGlanceTarget *= Math.max(0, 1 - dt * 0.3);
      if (B.head) B.head.quaternion.multiply(_bq2.setFromAxisAngle(
        _AX_Y,
        Math.sin(t * 0.55) * 0.05 + _idleGlanceTarget * 0.4
      ));
      // Subtle finger tap / hand adjust via forearm rotation.
      if (B.rFore) B.rFore.quaternion.multiply(_q[1].setFromAxisAngle(_AX_X, Math.sin(t * 1.8) * 0.010));
    }

    // ── Layer 9: locomotion accent — a tiny head bob at foot cadence for weight ──
    if (_grounded && (_locName === 'walk' || _locName === 'run')) {
      // EV.IO-style sprint reads as forward glide: feet still cycle, but the
      // head/visor does not bounce at the full running cadence.
      const bobY = Math.sin(gaitPhase * 2) * (_locName === 'run' ? 0.003 : 0.006);
      if (B.head) B.head.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, bobY));
    }

    // ── Layer 10: weapon hold — damp the clip's free arm swing into a real
    // carry. Applied last so it wins over the airborne flare/idle sway on the
    // limbs that own the weapon, while everything below the waist keeps the
    // full locomotion animation. ──
    if (_weaponKind) {
      _holdRunT += (((_grounded && _locName === 'run') ? 1 : 0) - _holdRunT)
        * (1 - Math.exp(-6 * dt));
    }
    if (_weaponKind === 'melee') {
      const pose = HOLD_POSES.melee;
      const w = !_grounded ? pose.w.air
              : _locName === 'run'  ? pose.w.run
              : _locName === 'walk' ? pose.w.walk
              : pose.w.idle;

      // Cadence sway + breathing keep the carry alive instead of frozen; a
      // sprint tuck drops the weapon toward the hip when running flat out.
      const alive   = _grounded && _locName !== 'idle'
                    ? Math.sin(gaitPhase * 2) * 0.045
                    : Math.sin(t * 1.5) * 0.015;
      const tuck    = _holdRunT * 0.22;                       // sprint: muzzle dips
      const landDip = _landT > 0 ? Math.sin((1 - _landT / 0.24) * Math.PI) * 0.12 : 0;

      _holdBone(B.rArm,  _armRef.rArm,  pose.rArm,  w);
      _holdBone(B.rFore, _armRef.rFore, pose.rFore, w);
      _holdBone(B.lArm,  _armRef.lArm,  pose.lArm,  w * 0.9);
      _holdBone(B.lFore, _armRef.lFore, pose.lFore, w * 0.9);
      if (B.rFore) B.rFore.quaternion.multiply(_q[0].setFromAxisAngle(_AX_X, alive + tuck + landDip));
    }
    if (_weaponKind === 'gun') {
      if (B.s1)    B.s1.quaternion.multiply(_q[2].setFromAxisAngle(_AX_Y, 0.10));
      if (B.spine) B.spine.quaternion.multiply(_q[3].setFromAxisAngle(_AX_X, 0.03));
      // Protract the support shoulder as a real two-handed stance does. The
      // raw Mixamo clip pins both clavicles square to the chest, shortening the
      // left arm by several visible centimetres and forcing its wrist target
      // to float off an outboard, body-clear rifle.
      if (B.lClav) B.lClav.quaternion.multiply(
        _q[4].setFromAxisAngle(_AX_X, -0.55)
      );
    }

    const actionProgress = (kind) => _actionLeft[kind] > 0
      ? 1 - _actionLeft[kind] / ACTION_TIME[kind] : 0;
    const swapP = actionProgress('swap');
    const throwP = actionProgress('throw');
    sampleHumanActionPose({
      reload: _weaponKind === 'gun' ? _reloadPoseP : 0,
      swing: _weaponKind === 'melee' ? _meleePoseP : 1,
      swap: swapP,
      throwP,
    }, _actionPose);
    const applyActionEuler = (bone, x, y, z) => {
      if (!bone || (!x && !y && !z)) return;
      bone.quaternion.multiply(_actionQuat.setFromEuler(_actionEuler.set(x, y, z)));
    };
    applyActionEuler(B.spine, _actionPose.torsoX, 0, _actionPose.torsoZ);
    if (_weaponKind === 'melee') {
      applyActionEuler(B.rArm, _actionPose.rArmX, _actionPose.rArmY, _actionPose.rArmZ);
      applyActionEuler(B.rFore, _actionPose.rForeX, 0, _actionPose.rForeZ);
      applyActionEuler(B.lArm, _actionPose.lArmX, _actionPose.lArmY, _actionPose.lArmZ);
      applyActionEuler(B.lFore, _actionPose.lForeX, 0, _actionPose.lForeZ);
    } else if (_weaponKind === 'gun' && _heldWeapon) {
      // A grenade temporarily releases the support hand. Otherwise both palms
      // are solved onto the moving rifle every frame.
      if (throwP > 0) {
        applyActionEuler(B.lArm, _actionPose.lArmX, _actionPose.lArmY, _actionPose.lArmZ);
        applyActionEuler(B.lFore, _actionPose.lForeX, 0, _actionPose.lForeZ);
      }
      const carrySway = _grounded && _locName !== 'idle'
        ? Math.sin(gaitPhase * 2) * 0.015
        : Math.sin(t * 1.5) * 0.012;
      const landDip = _landT > 0
        ? Math.sin((1 - _landT / 0.24) * Math.PI) * 0.10 : 0;
      applyHumanRifleCarry(group, B, _heldWeapon, {
        dt,
        aim: _weaponAim,
        reload: _reloadPoseP,
        swap: swapP,
        throwP,
        sprint: _holdRunT,
        move: _weaponMove,
        run: _weaponRun,
        firing: _weaponFiring,
        scoped: _weaponScoped,
        sway: carrySway - landDip,
        recoil: _fireRecoil,
        pitch: _sAimPitch,
      });
    }

    // Death is a whole-skeleton crumple, not a rigid root rotation. Apply it
    // last so it cleanly takes ownership from locomotion, aim, and rifle IK.
    if (_deathP > 0) {
      sampleHumanDeathPose(_deathP, _deathSide, _deathPose);
      applyActionEuler(B.hips,  _deathPose.hipsX,  0, _deathPose.hipsZ);
      applyActionEuler(B.spine, _deathPose.spineX, 0, _deathPose.spineZ);
      applyActionEuler(B.s1,    _deathPose.chestX, 0, _deathPose.chestZ);
      applyActionEuler(B.head,  _deathPose.headX,  0, _deathPose.headZ);
      applyActionEuler(B.rArm,  _deathPose.rArmX,  0, _deathPose.rArmZ);
      applyActionEuler(B.rFore, _deathPose.rForeX, 0, 0);
      applyActionEuler(B.lArm,  _deathPose.lArmX,  0, _deathPose.lArmZ);
      applyActionEuler(B.lFore, _deathPose.lForeX, 0, 0);
      applyActionEuler(B.rLeg,  _deathPose.rLegX,  0, _deathPose.rLegZ);
      applyActionEuler(B.rCalf, _deathPose.rCalfX, 0, 0);
      applyActionEuler(B.lLeg,  _deathPose.lLegX,  0, _deathPose.lLegZ);
      applyActionEuler(B.lCalf, _deathPose.lCalfX, 0, 0);
    }

    // Fire the boot jets for the entire airborne interval. Re-anchor after the
    // mixer and procedural jump layers so the flames stay under the animated
    // soles instead of lagging one frame behind them.
    _thrusterFx.visible = !_grounded && _deathP <= 0;
    if (_thrusterFx.visible) {
      group.updateMatrixWorld(true);
      const flicker = 0.88 + Math.sin(t * 47) * 0.10 + Math.sin(t * 73) * 0.04;
      _thrusterOuterMat.opacity = 0.68 + Math.sin(t * 39) * 0.10;
      _thrusterInnerMat.opacity = 0.86 + Math.sin(t * 51) * 0.08;
      for (let i = 0; i < _bootFlames.length; i++) {
        const flame = _bootFlames[i];
        const foot = _bootBones[i];
        flame.visible = !!foot;
        if (!foot) continue;
        foot.getWorldPosition(_bootWorld);
        group.worldToLocal(_bootWorld);
        flame.position.copy(_bootWorld);
        flame.position.y -= 0.035;
        flame.scale.set(1, flicker * (1 + Math.min(0.35, Math.abs(_verticalVelocity) * 0.018)), 1);
      }
    }
  };

  // ── Third-person weapon: firearms live in body space and drive a two-arm IK
  // solve; melee weapons stay parented to the right hand.
  let _heldWeapon = null;
  const attachWeapon = (weaponGroup, isMelee = false) => {
    if (_heldWeapon) { _heldWeapon.parent?.remove(_heldWeapon); _heldWeapon = null; }
    _weaponKind = null;
    if (!weaponGroup) return;
    _weaponKind = isMelee ? 'melee' : 'gun';
    weaponGroup.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    if (!isMelee) {
      weaponGroup.scale.setScalar(humanWeaponScale(weaponGroup));
      group.add(weaponGroup);
      _heldWeapon = weaponGroup;
      return;
    }
    const hand = B.rHand;
    if (!hand) return; // no hand bone — skip rather than float a gun at the origin
    // Mixamo armatures carry a tiny (~0.01) scale on the bones; a child of the
    // hand inherits it and a rifle collapses to millimetres. Counter-scale so
    // the weapon renders at world size, and express the grip offsets in world
    // units (local = world / boneScale).
    hand.updateWorldMatrix(true, false);
    const _ws = new THREE.Vector3();
    hand.getWorldScale(_ws);
    const inv = 1 / Math.max(1e-6, _ws.x);
    // Grip pose relative to the palm (world-unit offsets, tuned on the Vanguard rig).
    const isKnife = weaponGroup.userData.weaponId === 'knife';
    weaponGroup.position
      .set(isKnife ? 0.006 : 0.02, isKnife ? 0.018 : 0.06, isKnife ? -0.012 : 0.02)
      .multiplyScalar(inv);
    weaponGroup.rotation.set(Math.PI * 0.5, isKnife ? -0.12 : 0, Math.PI * 0.5);
    weaponGroup.scale.setScalar((isKnife ? 1.05 : 1.15) * inv);
    hand.add(weaponGroup);
    _heldWeapon = weaponGroup;
  };

  group.userData = {
    isHuman: true,
    mixer,
    actions,
    setMotion,
    setLocomotion,
    setActionState,
    triggerAction,
    setAim,          // (pitch, yaw) — spine twist + head tilt track camera aim
    triggerFire,     // (kick=1)     — brief recoil pulse when the character fires
    triggerHit,      // (dx, dy)     — damage flinch from a hit direction
    triggerJump,     // ()           — enters airborne state; setLocomotion(_,true,_) lands
    triggerTeleport, // ()           — plays the blink-arrival reform (crouch → recover)
    setDeathState,   // (0..1, side)  — absolute full-skeleton death crumple
    attachWeapon,    // (weaponGroup, isMelee) — hold a weapon in the right hand
    weaponSockets: {
      trigger: B.weaponSocket,
      support: B.supportSocket,
      sword: B.swordSocket,
      holster: B.backHolsterSocket,
    },
    armorTick,
    bodyMats,
    visorMats,
    armorMats: armor.materials,
    armorTypeId,
    baseBodyColor: look.body, // the variant's plate colour, used as tint anchor
    // Cached framing metrics (see measurement above).
    standHeight: _size.y || 1.8,
    feetY:       _box.min.y,
    centerX:     _ctr.x,
    centerZ:     _ctr.z,
    // No recolorable primary/secondary plates on the human; expose stubs so
    // applySkinToCharacter() stays a no-op-safe call.
    primaryMat:   bodyMats[0] || null,
    secondaryMat: bodyMats[0] || null,
  };

  if (skin) tintHumanSoldier(group, skin, armorSkin);
  return group;
}

// ── Procedural PBR detail textures (worn metal: albedo + normal + roughness) ──
// Adds real surface detail — panel grain, scratches, grime — so the armour reads
// as a textured plated suit instead of smooth plastic. Generated once, shared.
let _detailTex = null;
function _getDetailTex() {
  if (_detailTex) return _detailTex;
  const S = 1024;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const CELL = 128;                       // armour-plate cell size
  const rivets = [];                       // shared bolt positions for albedo+normal

  // ── Albedo: gunmetal plating with seams, rivets, greebles, grime, scratches ──
  const aC = mk(), a = aC.getContext('2d');
  a.fillStyle = '#3a3f45'; a.fillRect(0, 0, S, S);
  for (let i = 0; i < S * 10; i++) {       // brushed grain
    const y = Math.random() * S, x = Math.random() * S, w = 10 + Math.random() * 60;
    const v = 48 + Math.random() * 30;
    a.strokeStyle = `rgba(${v},${v + 4},${v + 9},0.09)`; a.lineWidth = 1;
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + w, y); a.stroke();
  }
  // plate panels: each cell slightly different shade for a paneled look
  for (let gx = 0; gx < S; gx += CELL)
    for (let gy = 0; gy < S; gy += CELL) {
      const v = 52 + Math.random() * 18;
      a.fillStyle = `rgba(${v},${v + 5},${v + 11},0.18)`;
      a.fillRect(gx + 3, gy + 3, CELL - 6, CELL - 6);
    }
  // recessed seam lines (dark) + highlight lip (light)
  a.lineWidth = 3;
  for (let g = 0; g <= S; g += CELL) {
    a.strokeStyle = 'rgba(12,13,15,0.7)';
    a.beginPath(); a.moveTo(g, 0); a.lineTo(g, S); a.stroke();
    a.beginPath(); a.moveTo(0, g); a.lineTo(S, g); a.stroke();
    a.strokeStyle = 'rgba(150,160,170,0.18)'; a.lineWidth = 1;
    a.beginPath(); a.moveTo(g + 2, 0); a.lineTo(g + 2, S); a.stroke();
    a.beginPath(); a.moveTo(0, g + 2); a.lineTo(S, g + 2); a.stroke();
    a.lineWidth = 3;
  }
  // rivets/bolts near seam corners + small greeble vents
  for (let gx = 0; gx < S; gx += CELL)
    for (let gy = 0; gy < S; gy += CELL) {
      for (const [ox, oy] of [[10, 10], [CELL - 10, 10], [10, CELL - 10], [CELL - 10, CELL - 10]]) {
        if (Math.random() < 0.5) continue;
        const x = gx + ox, y = gy + oy; rivets.push([x, y]);
        a.fillStyle = 'rgba(20,22,25,0.8)'; a.beginPath(); a.arc(x, y, 3.2, 0, Math.PI * 2); a.fill();
        a.fillStyle = 'rgba(170,178,188,0.7)'; a.beginPath(); a.arc(x - 0.8, y - 0.8, 1.6, 0, Math.PI * 2); a.fill();
      }
      if (Math.random() < 0.22) { // vent slats greeble
        a.fillStyle = 'rgba(14,15,18,0.6)';
        for (let s = 0; s < 4; s++) a.fillRect(gx + 30, gy + 40 + s * 7, CELL - 60, 3);
      }
    }
  for (let i = 0; i < 70; i++) {           // grime / oxidation
    const x = Math.random() * S, y = Math.random() * S, r = 30 + Math.random() * 120;
    const g = a.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(18,15,12,0.22)'); g.addColorStop(1, 'rgba(18,15,12,0)');
    a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, Math.PI * 2); a.fill();
  }
  for (let i = 0; i < 240; i++) {          // exposed-metal scratches
    const x = Math.random() * S, y = Math.random() * S, ang = Math.random() * Math.PI, len = 8 + Math.random() * 46;
    a.strokeStyle = `rgba(195,201,210,${0.08 + Math.random() * 0.2})`; a.lineWidth = Math.random() < 0.25 ? 1.6 : 0.7;
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); a.stroke();
  }

  // ── Normal: emboss the seams (grooves), rivets (bumps) and scratches ──
  const nC = mk(), n = nC.getContext('2d');
  n.fillStyle = 'rgb(128,128,255)'; n.fillRect(0, 0, S, S);
  for (let g = 0; g <= S; g += CELL) {     // seam grooves: dark/light edges = bevel
    n.strokeStyle = 'rgba(70,128,235,0.9)'; n.lineWidth = 3;
    n.beginPath(); n.moveTo(g, 0); n.lineTo(g, S); n.stroke();
    n.strokeStyle = 'rgba(186,128,235,0.9)';
    n.beginPath(); n.moveTo(g + 3, 0); n.lineTo(g + 3, S); n.stroke();
    n.strokeStyle = 'rgba(128,70,235,0.9)';
    n.beginPath(); n.moveTo(0, g); n.lineTo(S, g); n.stroke();
    n.strokeStyle = 'rgba(128,186,235,0.9)';
    n.beginPath(); n.moveTo(0, g + 3); n.lineTo(S, g + 3); n.stroke();
  }
  for (const [x, y] of rivets) {           // rivet bumps
    const g = n.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
    g.addColorStop(0, 'rgba(180,180,255,1)'); g.addColorStop(1, 'rgba(128,128,255,0)');
    n.fillStyle = g; n.beginPath(); n.arc(x, y, 4, 0, Math.PI * 2); n.fill();
  }
  for (let i = 0; i < 220; i++) {          // scratch grooves
    const x = Math.random() * S, y = Math.random() * S, ang = Math.random() * Math.PI, len = 8 + Math.random() * 40;
    n.strokeStyle = Math.random() < 0.5 ? 'rgba(150,150,255,0.45)' : 'rgba(106,106,255,0.45)';
    n.lineWidth = Math.random() < 0.3 ? 2 : 1;
    n.beginPath(); n.moveTo(x, y); n.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); n.stroke();
  }

  // ── Roughness: panels mid, seams matte, scratches/rivets shinier ──
  const rC = mk(), r = rC.getContext('2d');
  r.fillStyle = '#888'; r.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, rad = 30 + Math.random() * 110;
    const g = r.createRadialGradient(x, y, 0, x, y, rad);
    const dark = Math.random() < 0.5;
    g.addColorStop(0, dark ? 'rgba(60,60,60,0.5)' : 'rgba(205,205,205,0.4)');
    g.addColorStop(1, 'rgba(136,136,136,0)');
    r.fillStyle = g; r.beginPath(); r.arc(x, y, rad, 0, Math.PI * 2); r.fill();
  }
  r.strokeStyle = 'rgba(170,170,170,0.5)'; r.lineWidth = 3; // seams matte
  for (let g = 0; g <= S; g += CELL) {
    r.beginPath(); r.moveTo(g, 0); r.lineTo(g, S); r.stroke();
    r.beginPath(); r.moveTo(0, g); r.lineTo(S, g); r.stroke();
  }

  const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  _detailTex = { map: tex(aC, true), normalMap: tex(nC, false), roughnessMap: tex(rC, false) };
  return _detailTex;
}

function _applyArmorLook(bodyMats, visorMats, look) {
  for (const m of bodyMats) {
    // Match the imported arena: clean graphite albedo with stepped toon light,
    // no realistic fabric texture, scratches, normal map, or specular metal.
    m.map = null;
    m.color.setHex(0x30363c);
    m.needsUpdate = true;
  }
  for (const m of visorMats) {
    m.color.setHex(look.visor);
    m.emissive?.setHex?.(look.visor);
    m.emissiveIntensity = 0.48;
    m.needsUpdate = true;
  }
}

// ── Procedural armour pieces ─────────────────────────────────────────────────
// Each loadout type gets a distinct hard-surface silhouette (pauldrons, chest
// plates, packs, helmet add-ons) so ASSAULT / RECON / HEAVY / STEALTH read as
// genuinely different armour, not just recolours. Pieces are parented to the
// Mixamo skeleton bones so they move with the walk/run animation.
const _v = new THREE.Vector3();
const _vScale = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

// Attach `mesh` to `bone` but position/scale it in the model's world space (so
// geometry can be authored in metres regardless of the bone's 0.01 bind scale).
function _attachAtWorld(bone, mesh, wx, wy, wz, worldScale, quat) {
  bone.add(mesh);
  bone.updateWorldMatrix(true, false);
  const q = quat || new THREE.Quaternion();
  const desired = _m.compose(_v.set(wx, wy, wz), q, _vScale.set(worldScale, worldScale, worldScale));
  const local = _m2.copy(bone.matrixWorld).invert().multiply(desired);
  local.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.frustumCulled = false; // bone-driven bounds expand past the bind pose
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

// Per-armor motion character: animation playback speed + a small additive
// stance (spine lean / head pitch) applied on top of the base clip so each
// type MOVES differently, not just looks different.
const ARMOR_MOTION = {
  assault: { speed: 1.00, spineLean:  0.00, headPitch:  0.00 },
  recon:   { speed: 1.04, spineLean: -0.04, headPitch: -0.06 }, // upright, alert
  heavy:   { speed: 0.92, spineLean:  0.11, headPitch:  0.05 }, // weighty, not slow-motion
  stealth: { speed: 0.96, spineLean:  0.13, headPitch:  0.09 }, // low, prowling
};
const _AX_X = new THREE.Vector3(1, 0, 0);
const _AX_Y = new THREE.Vector3(0, 1, 0);
const _AX_Z = new THREE.Vector3(0, 0, 1);
const _bq1  = new THREE.Quaternion();
const _bq2  = new THREE.Quaternion();

// Returns { animated: [...] } — armour meshes that pulse / blink / sway every
// frame via the group's armorTick(dt).
function _buildArmorPieces(root, armorTypeId, look, armorSkin = null) {
  const bone = (n) => findBone(root, n);
  const s = look.scale || 1;

  // ── Materials ──────────────────────────────────────────────────────────────
  // Layered plate finish: a matte-metal base plate, near-black recessed joints, a
  // bright polished trim for edges/rails, and the variant's glowing accent. The
  // trim is what makes the suit read as authored hard-surface rather than a slab.
  const plateColor = armorSkin?.primary ?? look.body;
  const underColor = armorSkin?.secondary ?? 0x0d1016;
  const glowColor = armorSkin?.emissive ?? look.visor;
  const plate = new THREE.MeshToonMaterial({
    color: new THREE.Color(plateColor).multiplyScalar(0.92),
  });
  plate.userData.armorRole = 'plate';
  const readableUnder = new THREE.Color(underColor).lerp(new THREE.Color(0x303844), 0.28);
  const dark = new THREE.MeshToonMaterial({
    color: readableUnder.clone().multiplyScalar(0.72),
  });
  dark.userData.armorRole = 'dark';
  const trim = new THREE.MeshToonMaterial({
    color: new THREE.Color(plateColor).lerp(new THREE.Color(0xe8edf2), 0.58),
  });
  trim.userData.armorRole = 'trim';
  const accent = new THREE.MeshToonMaterial({
    color: glowColor, emissive: glowColor,
    emissiveIntensity: armorSkin?.emissiveIntensity ?? 0.52,
  });
  accent.userData.armorRole = 'accent';
  const cape = new THREE.MeshToonMaterial({
    color: readableUnder.clone().multiplyScalar(0.72),
    side: THREE.DoubleSide,
  });
  cape.userData.armorRole = 'dark';
  // Compact plate-coloured helmet shell over a recessed dark faceplate. The
  // shell joins the outer armor language while its small proportions avoid the
  // oversized round dome that made the previous body look toy-like.
  const helmetMat = new THREE.MeshToonMaterial({
    color: new THREE.Color(plateColor).multiplyScalar(0.88),
  });
  helmetMat.userData.armorRole = 'plate';
  // Near-black toon faceplate: one quiet value block instead of reflective glass.
  const visorMat = new THREE.MeshToonMaterial({
    color: 0x11161b,
  });
  visorMat.userData.armorRole = 'visor';

  // ── Geometry helpers ────────────────────────────────────────────────────────
  // Every plate is a *rounded* box: chamfered edges catch the light so the armour
  // reads as milled hard-surface instead of a Lego brick. Radius scales with the
  // smallest dimension and is clamped so thin rails stay valid.
  const box = (w, h, d) => {
    const r = Math.max(0.004, Math.min(0.03, Math.min(w, h, d) * 0.28));
    return new RoundedBoxGeometry(w, h, d, 3, r);
  };
  // Eight-corner faceted plate. Different top/bottom widths and depths create
  // the diagonal armor cuts that a rounded box cannot express.
  const taper = (topW, bottomW, h, topD, bottomD, topShiftX = 0) => {
    const ty = h * 0.5, by = -h * 0.5;
    const tw = topW * 0.5, bw = bottomW * 0.5;
    const td = topD * 0.5, bd = bottomD * 0.5;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -tw + topShiftX, ty, -td,  tw + topShiftX, ty, -td,
       tw + topShiftX, ty,  td, -tw + topShiftX, ty,  td,
      -bw, by, -bd,  bw, by, -bd,  bw, by, bd, -bw, by, bd,
    ], 3));
    geo.setIndex([
      0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]);
    geo.computeVertexNormals();
    return geo;
  };
  const sph = (r) => new THREE.SphereGeometry(r, 20, 14);
  const oct = (r) => new THREE.OctahedronGeometry(r);
  const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 12);
  const cone = (r, h) => new THREE.ConeGeometry(r, h, 10);
  const tiltBack = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0));
  const faceDisc = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  const chestLeft = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.09));
  const chestRight = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.09));

  // Helmet worn by EVERY variant — a full angular shell with an opaque faceplate,
  // vertical energy stripe, split mandible, side comms housings, crown rail, and
  // a neck gorget that visually seals it to the torso.
  const helmet = [
    // Compact faceted shell: broad enough to cover the source head without the
    // oversized round dome that previously made the model look toy-like.
    { bone: 'Head', geo: taper(0.155, 0.19, 0.205, 0.15, 0.18), mat: helmetMat, x: 0, y: 1.625, z: 0.005 },
    // Recessed dark faceplate across the front.
    { bone: 'Head', geo: taper(0.137, 0.112, 0.125, 0.035, 0.045), mat: visorMat, x: 0, y: 1.60, z: -0.095 },
    // Vertical identity stripe across the faceplate.
    { bone: 'Head', geo: box(0.029, 0.115, 0.018), mat: accent, x: 0, y: 1.62, z: -0.123,
      anim: { type: 'pulse', freq: 1.0, min: 0.7, max: 1.2 } },
    // Shell brow lip + chin guard capping the visor top and bottom.
    { bone: 'Head', geo: box(0.17, 0.038, 0.085), mat: helmetMat, x: 0, y: 1.677, z: -0.06 },
    { bone: 'Head', geo: box(0.15, 0.055, 0.10), mat: helmetMat, x: 0, y: 1.505, z: -0.052 },
    { bone: 'Head', geo: box(0.056, 0.020, 0.022), mat: accent, x: -0.043, y: 1.52, z: -0.115 },
    { bone: 'Head', geo: box(0.056, 0.020, 0.022), mat: accent, x:  0.043, y: 1.52, z: -0.115 },
    // Chin breather vent slit (bright detail).
    { bone: 'Head', geo: box(0.052, 0.022, 0.03), mat: trim, x: 0, y: 1.485, z: -0.108 },
    // Top crest ridge (shell colour, integrated).
    { bone: 'Head', geo: box(0.05, 0.04, 0.15), mat: plate, x: 0, y: 1.738, z: 0.0 },
    // Side comms housings + status lights.
    { bone: 'Head', geo: box(0.04, 0.09, 0.09), mat: dark, x: -0.105, y: 1.593, z: 0.005 },
    { bone: 'Head', geo: box(0.04, 0.09, 0.09), mat: dark, x:  0.105, y: 1.593, z: 0.005 },
    { bone: 'Head', geo: sph(0.010), mat: accent, x: -0.112, y: 1.615, z: -0.03,
      anim: { type: 'blink', freq: 3.5, on: 1.8, off: 0.15 } },
    { bone: 'Head', geo: sph(0.010), mat: accent, x:  0.112, y: 1.615, z: -0.03,
      anim: { type: 'blink', freq: 3.5, on: 1.8, off: 0.15, phase: Math.PI } },
    // Neck gorget (dark) — seals the helmet to the collar (neck bone ~1.453).
    { bone: 'Neck', geo: box(0.225, 0.08, 0.205), mat: dark, x: 0, y: 1.42, z: 0.02 },
  ];

  // Rarity finishes can carry an iconic helmet silhouette in addition to a
  // palette. These small hard-surface add-ons echo the readable motifs in
  // ev.io's character roster while staying on this rig and animation set.
  const theme = armorSkin?.theme;
  if (theme === 'ears') {
    const left = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.22));
    const right = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.22));
    helmet.push(
      { bone: 'Head', geo: cone(0.052, 0.19), mat: plate, x: -0.085, y: 1.77, z: 0.005, quat: left },
      { bone: 'Head', geo: cone(0.052, 0.19), mat: plate, x: 0.085, y: 1.77, z: 0.005, quat: right },
      { bone: 'Head', geo: cone(0.022, 0.12), mat: accent, x: -0.085, y: 1.775, z: -0.018, quat: left },
      { bone: 'Head', geo: cone(0.022, 0.12), mat: accent, x: 0.085, y: 1.775, z: -0.018, quat: right },
    );
  } else if (theme === 'horns') {
    const left = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0, 0.42));
    const right = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0, -0.42));
    helmet.push(
      { bone: 'Head', geo: cone(0.036, 0.18), mat: trim, x: -0.075, y: 1.74, z: -0.015, quat: left },
      { bone: 'Head', geo: cone(0.036, 0.18), mat: trim, x: 0.075, y: 1.74, z: -0.015, quat: right },
    );
  } else if (theme === 'crown') {
    helmet.push(
      { bone: 'Head', geo: box(0.025, 0.13, 0.07), mat: trim, x: -0.07, y: 1.755, z: 0.015 },
      { bone: 'Head', geo: box(0.025, 0.17, 0.07), mat: trim, x: 0, y: 1.775, z: 0.015 },
      { bone: 'Head', geo: box(0.025, 0.13, 0.07), mat: trim, x: 0.07, y: 1.755, z: 0.015 },
    );
  } else if (theme === 'bone') {
    helmet.push(
      { bone: 'Head', geo: box(0.035, 0.10, 0.035), mat: trim, x: -0.055, y: 1.525, z: -0.135 },
      { bone: 'Head', geo: box(0.035, 0.10, 0.035), mat: trim, x: 0.055, y: 1.525, z: -0.135 },
      { bone: 'Head', geo: box(0.105, 0.032, 0.035), mat: trim, x: 0, y: 1.465, z: -0.125 },
    );
  }

  // spec: { bone, geo, mat, x, y, z, quat?, anim? }
  //   anim: { type:'pulse'|'thruster'|'blink'|'sway', freq, ... }
  let specs = [];

  if (armorTypeId === 'recon') {
    specs = [
      { bone: 'Spine2', geo: box(0.26, 0.30, 0.07), mat: plate, x: 0, y: 1.28, z: -0.070 },
      { bone: 'Spine2', geo: box(0.045, 0.20, 0.03), mat: accent, x: 0, y: 1.28, z: -0.112,
        anim: { type: 'pulse', freq: 4.5, min: 0.4, max: 1.7 } },          // slim chest emitter
      { bone: 'LeftShoulder',  geo: box(0.13, 0.10, 0.15), mat: plate, x: -0.185, y: 1.45, z: 0.02 },
      { bone: 'RightShoulder', geo: box(0.115, 0.09, 0.13), mat: plate, x:  0.185, y: 1.45, z: 0.02 },
      { bone: 'Head', geo: cyl(0.007, 0.18), mat: dark, x: 0.10, y: 1.74, z: 0.05 },
      { bone: 'Head', geo: sph(0.013), mat: accent, x: 0.10, y: 1.83, z: 0.05,
        anim: { type: 'blink', freq: 5, on: 2.4, off: 0.1 } },            // antenna tip blink
      { bone: 'Spine2', geo: box(0.05, 0.05, 0.10), mat: accent, x: 0, y: 1.20, z: 0.115,
        anim: { type: 'pulse', freq: 4, min: 0.3, max: 1.6 } },           // back beacon
    ];
  } else if (armorTypeId === 'heavy') {
    specs = [
      { bone: 'Spine2', geo: box(0.40, 0.40, 0.18), mat: plate, x: 0, y: 1.28, z: -0.05 },
      { bone: 'Spine1', geo: box(0.34, 0.18, 0.14), mat: plate, x: 0, y: 1.14, z: -0.05 },
      { bone: 'Spine2', geo: box(0.07, 0.24, 0.04), mat: accent, x: 0, y: 1.28, z: -0.108,
        anim: { type: 'pulse', freq: 2.4, min: 0.5, max: 2.0 } },         // chest reactor strip
      { bone: 'LeftShoulder', geo: sph(0.135), mat: plate, x: -0.205, y: 1.46, z: 0.02 },
      { bone: 'RightShoulder', geo: sph(0.135), mat: plate, x: 0.205, y: 1.46, z: 0.02 },
      { bone: 'LeftShoulder', geo: box(0.10, 0.05, 0.10), mat: accent, x: -0.205, y: 1.55, z: 0.02,
        anim: { type: 'thruster', freq: 2.2, min: 0.6, max: 2.6 } },      // shoulder vents
      { bone: 'RightShoulder', geo: box(0.10, 0.05, 0.10), mat: accent, x: 0.205, y: 1.55, z: 0.02,
        anim: { type: 'thruster', freq: 2.2, min: 0.6, max: 2.6, phase: 1.0 } },
      { bone: 'Spine2', geo: box(0.32, 0.34, 0.20), mat: dark, x: 0, y: 1.27, z: 0.16 },
      { bone: 'Spine2', geo: box(0.07, 0.28, 0.06), mat: accent, x: 0, y: 1.27, z: 0.27,
        anim: { type: 'pulse', freq: 1.6, min: 0.5, max: 2.4 } },         // power core
      { bone: 'Neck', geo: box(0.30, 0.11, 0.25), mat: plate, x: 0, y: 1.42, z: 0.03 },
      { bone: 'LeftUpLeg', geo: box(0.15, 0.24, 0.17), mat: plate, x: -0.115, y: 0.92, z: -0.02 },
      { bone: 'RightUpLeg', geo: box(0.15, 0.24, 0.17), mat: plate, x: 0.115, y: 0.92, z: -0.02 },
      { bone: 'Spine2', geo: cyl(0.045, 0.12), mat: accent, x: -0.10, y: 1.15, z: 0.29,
        anim: { type: 'thruster', freq: 3, min: 0.4, max: 2.2 } },        // exhaust nozzles
      { bone: 'Spine2', geo: cyl(0.045, 0.12), mat: accent, x: 0.10, y: 1.15, z: 0.29,
        anim: { type: 'thruster', freq: 3, min: 0.4, max: 2.2, phase: 1.6 } },
    ];
  } else if (armorTypeId === 'stealth') {
    specs = [
      { bone: 'Spine2', geo: box(0.26, 0.32, 0.06), mat: plate, x: 0, y: 1.28, z: -0.070 },
      { bone: 'LeftShoulder', geo: oct(0.085), mat: dark, x: -0.185, y: 1.45, z: 0.02 },
      { bone: 'RightShoulder', geo: oct(0.085), mat: dark, x: 0.185, y: 1.45, z: 0.02 },
      { bone: 'Head', geo: box(0.185, 0.15, 0.14), mat: dark, x: 0, y: 1.565, z: 0.105, quat: tiltBack }, // hood
      { bone: 'Head', geo: box(0.15, 0.03, 0.12), mat: accent, x: 0, y: 1.50, z: 0.105,
        anim: { type: 'pulse', freq: 1.5, min: 0.12, max: 0.7 } },        // hood rim glow
      { bone: 'Spine2', geo: box(0.05, 0.42, 0.10), mat: dark, x: 0.07, y: 1.27, z: 0.13,
        anim: { type: 'sway', axis: 'x', amp: 0.06, freq: 1.6 } },        // back sheath
      { bone: 'Spine2', geo: box(0.03, 0.28, 0.03), mat: accent, x: 0, y: 1.28, z: -0.095,
        anim: { type: 'pulse', freq: 2.0, min: 0.15, max: 0.95 } },       // chest light strip
      { bone: 'Spine2', geo: box(0.32, 0.55, 0.02), mat: cape, x: 0, y: 1.02, z: 0.125,
        anim: { type: 'sway', axis: 'x', amp: 0.10, freq: 1.25 } },       // flowing cape
    ];
  } else {
    specs = [
      // Layered chest cuirass (Spine2 ~1.314): a main breastplate, an upper-chest
      // collar deck, and a polished sternum ridge with the glowing emitter set in.
      // Broad dark carrier plus separate angular plates: this gives the torso
      // the layered EV-style exosuit read without copying a proprietary mesh.
      { bone: 'Spine2', geo: taper(0.37, 0.29, 0.34, 0.13, 0.105), mat: dark, x: 0, y: 1.28, z: -0.135 },
      { bone: 'Spine2', geo: taper(0.155, 0.125, 0.16, 0.085, 0.095, -0.01), mat: plate, x: -0.085, y: 1.365, z: -0.225, quat: chestLeft },
      { bone: 'Spine2', geo: taper(0.155, 0.125, 0.16, 0.085, 0.095,  0.01), mat: plate, x:  0.085, y: 1.365, z: -0.225, quat: chestRight },
      { bone: 'Spine2', geo: taper(0.11, 0.075, 0.235, 0.07, 0.08), mat: plate, x: 0, y: 1.245, z: -0.225 },
      { bone: 'Spine1', geo: taper(0.18, 0.22, 0.085, 0.075, 0.09), mat: plate, x: 0, y: 1.105, z: -0.19 },
      { bone: 'Spine2', geo: box(0.032, 0.155, 0.022), mat: accent, x: 0, y: 1.285, z: -0.28,
        anim: { type: 'pulse', freq: 3.2, min: 0.5, max: 1.7 } },
      { bone: 'Spine2', geo: cyl(0.034, 0.026), mat: trim, x: -0.10, y: 1.34, z: -0.14, quat: faceDisc },
      { bone: 'Spine2', geo: cyl(0.034, 0.026), mat: trim, x:  0.10, y: 1.34, z: -0.14, quat: faceDisc },
      { bone: 'Spine2', geo: box(0.17, 0.022, 0.026), mat: trim, x: 0, y: 1.425, z: -0.125 },
      // Layered pauldrons (shoulder bone ~1.429): a rounded cap, a polished trim
      // lip, and a status beacon on the outer face.
      { bone: 'LeftShoulder',  geo: taper(0.19, 0.14, 0.125, 0.18, 0.14, -0.014), mat: plate, x: -0.19, y: 1.43, z: 0.01 },
      { bone: 'RightShoulder', geo: taper(0.19, 0.14, 0.125, 0.18, 0.14,  0.014), mat: plate, x:  0.19, y: 1.43, z: 0.01 },
      { bone: 'LeftShoulder',  geo: box(0.15, 0.024, 0.15), mat: trim,  x: -0.19, y: 1.49, z: 0.01 },
      { bone: 'RightShoulder', geo: box(0.15, 0.024, 0.15), mat: trim,  x:  0.19, y: 1.49, z: 0.01 },
      { bone: 'LeftShoulder',  geo: taper(0.145, 0.115, 0.09, 0.075, 0.06), mat: plate, x: -0.19, y: 1.43, z: 0.115 },
      { bone: 'RightShoulder', geo: taper(0.145, 0.115, 0.09, 0.075, 0.06), mat: plate, x:  0.19, y: 1.43, z: 0.115 },
      { bone: 'LeftShoulder', geo: box(0.035, 0.035, 0.035), mat: accent, x: -0.225, y: 1.48, z: -0.02,
        anim: { type: 'blink', freq: 4, on: 1.9, off: 0.2 } },            // shoulder beacons (alternating)
      { bone: 'RightShoulder', geo: box(0.035, 0.035, 0.035), mat: accent, x: 0.225, y: 1.48, z: -0.02,
        anim: { type: 'blink', freq: 4, on: 1.9, off: 0.2, phase: Math.PI } },
      { bone: 'Spine', geo: box(0.33, 0.09, 0.23), mat: dark, x: 0, y: 1.04, z: -0.01 },     // belt (Spine ~1.075)
      { bone: 'Spine', geo: box(0.35, 0.03, 0.25), mat: trim, x: 0, y: 1.085, z: -0.01 },    // belt trim lip
      { bone: 'Spine', geo: box(0.085, 0.10, 0.10), mat: plate, x: -0.135, y: 1.00, z: -0.025 },
      { bone: 'Spine', geo: box(0.085, 0.10, 0.10), mat: plate, x:  0.135, y: 1.00, z: -0.025 },
      // Split hip guards widen the silhouette without filling the flexible
      // groin/hip joints; each rides its own thigh through crouches and jumps.
      { bone: 'LeftUpLeg',  geo: taper(0.105, 0.075, 0.22, 0.085, 0.065, -0.008), mat: plate, x: -0.18, y: 0.94, z: 0.00 },
      { bone: 'RightUpLeg', geo: taper(0.105, 0.075, 0.22, 0.085, 0.065,  0.008), mat: plate, x:  0.18, y: 0.94, z: 0.00 },

      // Segmented limb armour keeps the black flex joints visible while giving
      // the forearms, thighs, knees, shins, and boots the same authored rhythm.
      { bone: 'LeftArm',  geo: box(0.135, 0.105, 0.105), mat: plate, x: -0.265, y: 1.445, z: 0.00 },
      { bone: 'RightArm', geo: box(0.135, 0.105, 0.105), mat: plate, x:  0.265, y: 1.445, z: 0.00 },
      { bone: 'LeftArm',  geo: box(0.06, 0.025, 0.022), mat: accent, x: -0.265, y: 1.445, z: -0.064 },
      { bone: 'RightArm', geo: box(0.06, 0.025, 0.022), mat: accent, x:  0.265, y: 1.445, z: -0.064 },
      { bone: 'LeftUpLeg',  geo: taper(0.14, 0.105, 0.285, 0.115, 0.09), mat: plate, x: -0.105, y: 0.82, z: -0.13 },
      { bone: 'RightUpLeg', geo: taper(0.14, 0.105, 0.285, 0.115, 0.09), mat: plate, x:  0.105, y: 0.82, z: -0.13 },
      { bone: 'LeftUpLeg',  geo: taper(0.11, 0.085, 0.24, 0.07, 0.06), mat: plate, x: -0.105, y: 0.80, z: 0.13 },
      { bone: 'RightUpLeg', geo: taper(0.11, 0.085, 0.24, 0.07, 0.06), mat: plate, x:  0.105, y: 0.80, z: 0.13 },
      { bone: 'LeftUpLeg',  geo: box(0.035, 0.20, 0.022), mat: accent, x: -0.105, y: 0.83, z: -0.108 },
      { bone: 'RightUpLeg', geo: box(0.035, 0.20, 0.022), mat: accent, x:  0.105, y: 0.83, z: -0.108 },
      { bone: 'LeftLeg',  geo: box(0.14, 0.105, 0.115), mat: trim, x: -0.10, y: 0.56, z: -0.055 },
      { bone: 'RightLeg', geo: box(0.14, 0.105, 0.115), mat: trim, x:  0.10, y: 0.56, z: -0.055 },
      { bone: 'LeftLeg',  geo: taper(0.13, 0.095, 0.31, 0.11, 0.085), mat: plate, x: -0.10, y: 0.35, z: -0.125 },
      { bone: 'RightLeg', geo: taper(0.13, 0.095, 0.31, 0.11, 0.085), mat: plate, x:  0.10, y: 0.35, z: -0.125 },
      { bone: 'LeftLeg',  geo: taper(0.10, 0.075, 0.25, 0.065, 0.055), mat: plate, x: -0.10, y: 0.34, z: 0.115 },
      { bone: 'RightLeg', geo: taper(0.10, 0.075, 0.25, 0.065, 0.055), mat: plate, x:  0.10, y: 0.34, z: 0.115 },
      { bone: 'LeftLeg',  geo: box(0.032, 0.245, 0.022), mat: accent, x: -0.10, y: 0.35, z: -0.108 },
      { bone: 'RightLeg', geo: box(0.032, 0.245, 0.022), mat: accent, x:  0.10, y: 0.35, z: -0.108 },
      { bone: 'LeftFoot',  geo: box(0.15, 0.105, 0.23), mat: dark, x: -0.10, y: 0.09, z: -0.03 },
      { bone: 'RightFoot', geo: box(0.15, 0.105, 0.23), mat: dark, x:  0.10, y: 0.09, z: -0.03 },
      { bone: 'LeftFoot',  geo: box(0.115, 0.035, 0.17), mat: plate, x: -0.10, y: 0.145, z: -0.055 },
      { bone: 'RightFoot', geo: box(0.115, 0.035, 0.17), mat: plate, x:  0.10, y: 0.145, z: -0.055 },
      // Compact, layered power pack: the waist and arms remain readable from
      // behind, and the selected plate colour now carries into the rear view.
      { bone: 'Spine2', geo: box(0.24, 0.29, 0.09), mat: dark, x: 0, y: 1.28, z: 0.255 },
      { bone: 'Spine2', geo: taper(0.105, 0.08, 0.255, 0.055, 0.045, -0.008), mat: plate, x: -0.082, y: 1.29, z: 0.325 },
      { bone: 'Spine2', geo: taper(0.105, 0.08, 0.255, 0.055, 0.045,  0.008), mat: plate, x:  0.082, y: 1.29, z: 0.325 },
      { bone: 'Spine2', geo: box(0.042, 0.25, 0.024), mat: dark, x: 0, y: 1.28, z: 0.36 },
      { bone: 'Spine2', geo: box(0.15, 0.025, 0.025), mat: trim, x: 0, y: 1.335, z: 0.36 },
      { bone: 'Spine2', geo: box(0.04, 0.025, 0.018), mat: accent, x: -0.04, y: 1.38, z: 0.375,
        anim: { type: 'pulse', freq: 1.4, min: 0.3, max: 1.2 } },
      { bone: 'Spine2', geo: box(0.04, 0.025, 0.018), mat: accent, x:  0.04, y: 1.38, z: 0.375,
        anim: { type: 'pulse', freq: 1.4, min: 0.3, max: 1.2, phase: Math.PI * 0.15 } },
    ];
  }

  specs = [...helmet, ...specs];

  const animated = [];
  const armorMaterials = new Set([plate, dark, trim, accent, cape, helmetMat, visorMat]);
  for (const sp of specs) {
    const b = bone(sp.bone);
    if (!b) continue;
    const mat = sp.anim ? sp.mat.clone() : sp.mat; // independent animation per piece
    armorMaterials.add(mat);
    const mesh = new THREE.Mesh(sp.geo, mat);
    _attachAtWorld(b, mesh, sp.x * s, sp.y * s, sp.z * s, s, sp.quat);
    if (sp.anim) {
      animated.push({ mesh, mat, anim: sp.anim, baseQuat: mesh.quaternion.clone() });
    }
  }

  // ── Forearm gauntlets + hand plates (bone-LOCAL attach) ─────────────────────
  // The world-space spec system above assumes the bind pose, but the arms are
  // posed well away from bind — so arm armour is attached directly in each
  // bone's LOCAL space, where the limb axis is a stable +Y (forearm→hand offset
  // is [0, +len, 0]). The plates then ride the forearm/hand in ANY pose. This
  // kits out the previously-bare arms so they read as armoured, not a base suit.
  const _armPlate = (foreName, handName) => {
    const fore = bone(foreName), hand = bone(handName);
    if (!fore || !hand) return;
    const L = hand.position.length() || 24;           // forearm length (bone-local units)
    const addTo = (parent, geo, mat, y, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, z);
      m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
    };
    // Wrapping gauntlet over the lower two-thirds of the forearm.
    addTo(fore, box(L * 0.32, L * 0.64, L * 0.32), plate, L * 0.55);
    // Dark wrist cuff where the gauntlet meets the hand (subtle groove, not a
    // bright band — keep the silhouette dark).
    addTo(fore, box(L * 0.40, L * 0.11, L * 0.40), dark,  L * 0.90);
    // Thin themed accent sliver on the outer forearm (matches the visor glow).
    addTo(fore, box(L * 0.10, L * 0.34, L * 0.345), accent, L * 0.55, -L * 0.02);
    // Elbow cap at the top of the forearm.
    addTo(fore, box(L * 0.34, L * 0.16, L * 0.34), plate, L * 0.10);
    // Knuckle plate riding the back of the hand toward the fingers.
    const hChild = hand.children.find(c => c.isBone);
    const hy = hChild ? hChild.position.length() * 0.5 : L * 0.16;
    addTo(hand, box(L * 0.30, L * 0.22, L * 0.34), plate, hy);
  };
  _armPlate('LeftForeArm', 'LeftHand');
  _armPlate('RightForeArm', 'RightHand');

  return { animated, materials: [...armorMaterials] };
}

// Cosmetic skin tint: recolours the armour plates toward the equipped skin
// while keeping the variant's glowing visor. Blends toward the variant base
// colour so equipped skins read as armour shades rather than flat solid blobs.
export function tintHumanSoldier(group, skin, armorSkin = null) {
  const mats = group.userData?.bodyMats;
  if (!mats || !mats.length) return;
  // "Default" means the authored model, not a gray cosmetic dye. Preserve the
  // source palette so the live player and bots match the inventory preview.
  if (!armorSkin && (!skin || skin.id === 'default')) return;
  const hex = armorSkin ? armorSkin.primary : skin?.primary;
  if (hex == null) return;
  const tint = new THREE.Color(hex);
  for (const m of mats) {
    if (armorSkin) {
      // The source GLB is a tactical soldier. Once an armor finish is equipped,
      // its fabric/albedo would show pockets and camouflage through the suit and
      // make the character read as an army model. Keep the normal detail but
      // turn the source surface into the finish's clean graphite flex layer;
      // the procedural hard plates remain the visible outer shell.
      m.map = null;
      m.color.copy(new THREE.Color(armorSkin.secondary)).lerp(new THREE.Color(0x4b5766), 0.42);
    } else if (m.map) {
      // Brighten toward the skin colour so light skins (white armour) read bright,
      // while keeping the texture detail (values can exceed 1 to lift the GLB grey).
      m.color.setRGB(0.45 + 0.7 * tint.r, 0.45 + 0.7 * tint.g, 0.45 + 0.7 * tint.b);
    } else {
      m.color.copy(tint).lerp(new THREE.Color(group.userData?.baseBodyColor ?? 0x5a7d35), 0.35);
    }
    m.needsUpdate = true;
  }
  if (armorSkin && group.userData?.armorMats) {
    const plate = new THREE.Color(armorSkin.primary);
    const under = new THREE.Color(armorSkin.secondary);
    const glow = new THREE.Color(armorSkin.emissive ?? armorSkin.primary);
    for (const m of group.userData.armorMats) {
      const role = m.userData?.armorRole;
      if (role === 'plate') m.color.copy(plate).multiplyScalar(0.92);
      else if (role === 'dark') {
        m.color.copy(under).lerp(new THREE.Color(0x303844), 0.28).multiplyScalar(0.72);
      }
      else if (role === 'trim') m.color.copy(plate).lerp(new THREE.Color(0xe8edf2), 0.58);
      else if (role === 'accent') {
        m.color.copy(glow);
        m.emissive?.copy?.(glow);
        m.emissiveIntensity = armorSkin.emissiveIntensity ?? 0.52;
      }
      m.needsUpdate = true;
    }
  }
}
