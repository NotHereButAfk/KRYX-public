import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { SOLE_Y, HEEL_Z, TOE_Z } from './Proportions.js';

const URL = '/vendor/quaternius/universal-animation-library.glb';
const CLIPS = {
  idle: 'Idle_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  crouchIdle: 'Crouch_Idle_Loop',
  crouchMove: 'Crouch_Fwd_Loop',
  jumpStart: 'Jump_Start',
  air: 'Jump_Loop',
  jumpLand: 'Jump_Land',
};

const GAIT_STATES = new Set(['jog', 'sprint', 'crouchMove']);
const ONE_SHOTS = new Set(['jumpStart', 'jumpLand']);
const LOWER_BODY_BONES = new Set([
  'thighL', 'kneeL', 'ankleL',
  'thighR', 'kneeR', 'ankleR',
]);
const _sole = new THREE.Vector3();
const _groupInverse = new THREE.Matrix4();
const _bodyRotation = new THREE.Euler(0, 0, 0, 'YXZ');

// Target HeroBody bone -> Quaternius source bone. The source contains extra
// twist/finger/toe bones; the game rig intentionally retargets only the joints
// that deform its connected mesh. RifleCarry takes ownership of both arms after
// locomotion is sampled, keeping every weapon locked to its two contact points.
const BONE_MAP = {
  root: 'root', hips: 'DEF-hips', spine: 'DEF-spine001', chest: 'DEF-spine003',
  neck: 'DEF-neck', head: 'DEF-head',
  shoulderL: 'DEF-upper_armL', elbowL: 'DEF-forearmL', handL: 'DEF-handL',
  shoulderR: 'DEF-upper_armR', elbowR: 'DEF-forearmR', handR: 'DEF-handR',
  thighL: 'DEF-thighL', kneeL: 'DEF-shinL', ankleL: 'DEF-footL',
  thighR: 'DEF-thighR', kneeR: 'DEF-shinR', ankleR: 'DEF-footR',
};

let source = null;
let loading = false;
let retargeted = null;
const pending = new Set();

// Quaternius' library is authored Z-up and carries that conversion as a
// constant -90-degree X rotation on its skeleton root. HeroBody is already
// Y-up. Retargeting that root track therefore lays the entire bot on its side
// while the child bones continue playing a valid walk cycle. Root motion is
// owned by the game simulation, so keep the target skeleton's upright rest
// transform and retain only the articulated body tracks.
export function stripRetargetedRootMotion(clip) {
  if (!clip?.tracks) return clip;
  clip.tracks = clip.tracks.filter((track) =>
    !/^\.bones\[root\]\.(?:position|quaternion|scale)$/.test(track.name));
  clip.resetDuration?.();
  return clip;
}

/**
 * Keep the imported performance where this rig can reproduce it faithfully.
 *
 * Game movement owns translation and RifleCarry/Actions own the upper body.
 * Retargeting source hip translation onto a differently proportioned skeleton
 * was the cause of the old seated/sideways bots, while imported shoulders made
 * the IK solver start from contact points that no longer matched the visible
 * chest. The six leg rotations are the actual authored gait; the stable torso,
 * arms and weapon are layered by the game after this clip is sampled.
 */
export function prepareRetargetedLocomotionClip(clip) {
  stripRetargetedRootMotion(clip);
  if (!clip?.tracks) return clip;
  clip.tracks = clip.tracks.filter((track) => {
    const match = /^\.bones\[([^\]]+)\]\.quaternion$/.exec(track.name);
    return !!match && LOWER_BODY_BONES.has(match[1]);
  });
  clip.resetDuration?.();
  return clip;
}

/** Resolve a forward animation into the travel plane, including backpedal. */
export function authoredTravelDirection(dirF = 1, dirR = 0) {
  let yaw = Math.atan2(-(dirR || 0), dirF || 0);
  let playbackSign = 1;
  if (yaw > Math.PI / 2) { yaw -= Math.PI; playbackSign = -1; }
  else if (yaw < -Math.PI / 2) { yaw += Math.PI; playbackSign = -1; }
  return { yaw, playbackSign };
}

function posedGroundOffset(group, rig, lean, roll) {
  if (!group || !rig?.ankleL || !rig?.ankleR) return 0;
  // The mixer only writes local bone rotations. Refresh the hierarchy once,
  // then remove the character's world transform from the sampled sole points.
  group.updateWorldMatrix(true, false);
  _groupInverse.copy(group.matrixWorld).invert();
  _bodyRotation.set(lean, 0, roll, 'YXZ');
  let floor = Infinity;
  for (const ankle of [rig.ankleL, rig.ankleR]) {
    ankle.updateWorldMatrix(true, false);
    for (const z of [HEEL_Z, TOE_Z]) {
      _sole.set(0, SOLE_Y, z)
        .applyMatrix4(ankle.matrixWorld)
        .applyMatrix4(_groupInverse)
        .applyEuler(_bodyRotation);
      floor = Math.min(floor, _sole.y);
    }
  }
  return Number.isFinite(floor) ? -floor : 0;
}

function sourceSkeleton(scene) {
  const bones = [];
  scene.traverse((node) => { if (node.isBone) bones.push(node); });
  return bones.length ? new THREE.Skeleton(bones) : null;
}

function makeRetargeted(targetMesh) {
  if (retargeted || !source) return retargeted;
  const skeleton = sourceSkeleton(source.scene);
  if (!skeleton) return null;
  const byName = new Map(source.animations.map((clip) => [clip.name, clip]));
  retargeted = {};
  for (const [state, clipName] of Object.entries(CLIPS)) {
    const clip = byName.get(clipName);
    if (!clip) continue;
    retargeted[state] = prepareRetargetedLocomotionClip(retargetClip(targetMesh, skeleton, clip, {
      names: BONE_MAP,
      hip: 'DEF-hips',
      hipInfluence: new THREE.Vector3(0, 0, 0),
      preserveBonePositions: true,
      useFirstFramePosition: false,
      fps: 30,
    }));
  }
  targetMesh.skeleton.pose();
  return retargeted;
}

function install(group) {
  const mesh = group?.userData?.meshes?.[0];
  const rig = group?.userData?.rig;
  if (!mesh || !rig || rig.universalAnimator) return rig?.universalAnimator || null;
  const clips = makeRetargeted(mesh);
  if (!clips) return null;

  const mixer = new THREE.AnimationMixer(mesh);
  const actions = {};
  for (const [state, clip] of Object.entries(clips)) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(ONE_SHOTS.has(state) ? THREE.LoopOnce : THREE.LoopRepeat,
      ONE_SHOTS.has(state) ? 1 : Infinity);
    action.clampWhenFinished = ONE_SHOTS.has(state);
    actions[state] = action;
  }
  let activeName = 'idle';
  let active = actions.idle;
  active?.play();
  let playback = 1;
  let wasGrounded = true;
  let airTime = 0;
  let landTime = 0;

  const transitionTo = (nextName) => {
    const next = actions[nextName] || actions.idle;
    if (!next || next === active) return;
    const phase = active.time / Math.max(0.001, active.getClip().duration);
    next.reset();
    if (GAIT_STATES.has(nextName) && GAIT_STATES.has(activeName)) {
      next.time = phase * next.getClip().duration;
    }
    next.play();
    active.crossFadeTo(next, ONE_SHOTS.has(nextName) ? 0.09 : 0.14, false);
    active = next;
    activeName = nextName;
  };

  const animator = {
    source: 'Quaternius Universal Animation Library Standard',
    update(dt, o = {}) {
      if (!active || !(dt > 0)) return null;
      // There is no authored slide in this pack. Let the complete planted slide
      // pose in Locomotion own that state instead of pretending crouch-run is a
      // slide and cycling the feet underneath it.
      if ((o.slide || 0) > 0.08) return null;

      // Blink/teleport arrivals trigger the same leg arc even though the
      // simulation deliberately keeps them grounded.
      rig._hopT = Math.max(0, (rig._hopT || 0) - dt);
      const hopping = rig._hopT > 0;
      const grounded = o.grounded !== false && !hopping;
      if (!grounded) {
        if (wasGrounded) airTime = 0;
        airTime += dt;
        landTime = 0;
      } else if (!wasGrounded) {
        landTime = Math.max(0.20, (actions.jumpLand?.getClip().duration || 0.3) * 0.72);
        airTime = 0;
      }

      let nextName;
      if (!grounded) {
        const startWindow = Math.max(0.10,
          (actions.jumpStart?.getClip().duration || 0.24) * 0.72);
        nextName = airTime < startWindow && (hopping || (o.vy || 0) > -0.5)
          ? 'jumpStart' : 'air';
      }
      else if (landTime > 0) nextName = 'jumpLand';
      else if ((o.crouch || 0) > 0.28) nextName = o.moving ? 'crouchMove' : 'crouchIdle';
      else if (!o.moving || (o.speed || 0) < 0.18) nextName = 'idle';
      else nextName = o.sprint ? 'sprint' : 'jog';
      transitionTo(nextName);
      wasGrounded = grounded;
      landTime = Math.max(0, landTime - dt);

      // Match cadence to actual travel speed. This avoids the old fast-feet /
      // slow-body skating while preserving the authored jog and sprint shape.
      let targetPlayback = 1;
      if (activeName === 'jog') targetPlayback = THREE.MathUtils.clamp((o.speed || 0) / 6.6, 0.72, 1.18);
      if (activeName === 'sprint') targetPlayback = THREE.MathUtils.clamp((o.speed || 0) / 13.2, 0.78, 1.16);
      if (activeName === 'crouchMove') targetPlayback = THREE.MathUtils.clamp((o.speed || 0) / 3.7, 0.7, 1.15);
      playback += (targetPlayback - playback) * (1 - Math.exp(-10 * dt));
      const travel = authoredTravelDirection(o.dirF, o.dirR);
      active.setEffectiveTimeScale(playback * (GAIT_STATES.has(activeName) ? travel.playbackSign : 1));
      mixer.update(Math.min(dt, 0.1));

      // The library has forward clips. Rotate the authored leg planes toward
      // actual travel, and play them backward for retreat, reproducing the
      // directional lower-body layer used by arena shooters without twisting
      // the shouldered weapon away from the player's aim.
      const moving = !!o.moving && grounded;
      const targetLegYaw = moving ? travel.yaw : 0;
      rig._authoredLegYaw = (rig._authoredLegYaw || 0)
        + (targetLegYaw - (rig._authoredLegYaw || 0)) * (1 - Math.exp(-12 * dt));
      for (const leg of [rig.legL, rig.legR]) leg?.rotateY(rig._authoredLegYaw);

      rig._authoredMoveBlend = (rig._authoredMoveBlend || 0)
        + ((moving ? 1 : 0) - (rig._authoredMoveBlend || 0)) * (1 - Math.exp(-10 * dt));
      const moveBlend = rig._authoredMoveBlend;
      const run = THREE.MathUtils.clamp(o.run || 0, 0, 1);
      const crouch = THREE.MathUtils.clamp(o.crouch || 0, 0, 1);
      const forward = o.dirF === undefined ? 1 : o.dirF;
      const leanTarget = -(0.022 + 0.055 * run) * moveBlend * forward - 0.045 * crouch;
      rig._authoredLean = (rig._authoredLean || 0)
        + (leanTarget - (rig._authoredLean || 0)) * (1 - Math.exp(-7 * dt));
      const phase = (active.time / Math.max(0.001, active.getClip().duration)) * Math.PI * 2;
      const weight = moveBlend * Math.sin(phase) * (grounded ? 1 : 0.25);
      const roll = weight * (0.008 + 0.006 * run);
      const sway = weight * (0.005 + 0.003 * run);
      if (rig.head) rig.head.rotation.z = -roll * 0.5;
      const lean = rig._authoredLean;
      // A running clip can briefly have both feet above its bind-pose floor.
      // Driving the whole character root down until one foot touches turns that
      // flight frame into a visible floor/map penetration and makes the camera
      // feel jittery when following the body. Collision owns the root; retain
      // only a restrained, damped presentation offset from the sampled pose.
      const rawBob = grounded ? posedGroundOffset(group, rig, lean, roll) : 0;
      const bobLimitDown = crouch > 0.28 ? -0.22 : -0.035;
      const targetBob = THREE.MathUtils.clamp(rawBob, bobLimitDown, 0.055);
      rig._authoredBob = (rig._authoredBob || 0)
        + (targetBob - (rig._authoredBob || 0)) * (1 - Math.exp(-14 * dt));

      return {
        bob: rig._authoredBob,
        lean,
        roll,
        sway,
        phase,
        air: grounded ? 0 : 1,
        swing: moveBlend * -(0.022 + 0.014 * run) * Math.cos(phase * 2)
          + (1 - moveBlend) * Math.sin(phase * 0.28) * 0.012,
        authored: true,
        state: activeName,
      };
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(mesh); },
  };
  rig.universalAnimator = animator;
  group.userData.animationSource = animator.source;
  return animator;
}

export function attachUniversalAnimator(group) {
  if (!group?.userData?.isHero) return null;
  if (source) return install(group);
  pending.add(group);
  return null;
}

/** Sample the authored rig when ready; callers retain procedural fallback. */
export function applyUniversalLocomotion(rig, options = {}) {
  return rig?.universalAnimator?.update(options.dt ?? 1 / 60, options) || null;
}

export function preloadUniversalAnimations(onReady) {
  if (source) { onReady?.(); return; }
  if (loading) return;
  loading = true;
  new GLTFLoader().load(URL, (gltf) => {
    source = gltf;
    loading = false;
    for (const group of pending) install(group);
    pending.clear();
    onReady?.();
  }, undefined, (error) => {
    loading = false;
    console.warn('[animations] Universal Animation Library unavailable; using procedural fallback.', error);
  });
}

export function universalAnimationStatus() {
  return { ready: !!source, clipCount: source?.animations?.length || 0, pending: pending.size };
}
