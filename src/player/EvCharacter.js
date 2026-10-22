import { prepareDeathBody } from './DeathBody.js';
import {createBodyDynamics} from './BodyDynamics.js';
import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import { createFootPlanting } from './FootPlanting.js';
import { jumpAirPose, jumpLandingDuration, isJumpImpulse } from './JumpMotion.js';
import {SWORD_EDGE_ROLL, swordSwingPose} from '../weapons/SwordMotion.js';
import * as THREE from 'three';
import { createJumpJets } from '../effects/JumpJets.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { STATURE } from './Proportions.js';
import { weaponHandPose } from '../weapons/WeaponHandPoses.js';
import { disposeModel } from '../core/ModelResources.js';
import { setupEvCosmetics } from './EvCosmetics.js';
import { createHumanDeathPose, sampleHumanDeathPose } from './HumanActionMotion.js';

// One native skeleton and the thirteen actions exported from the supplied blend.
// Every instance owns its bones, mixer and materials; geometry stays shared.
let template = null;
let pending = null;
export function isEvCharacterReady() { return !!template; }
export function preloadEvCharacter(onLoad) {
  if (isCrazyGames()) { onLoad?.(false); return Promise.resolve(false); }
  if (template) { onLoad?.(true); return Promise.resolve(true); }
  pending ??= new GLTFLoader().loadAsync('/ev-default.glb?v=forged-1')
    .then((gltf) => { installEvCharacter(gltf); return true; })
    .catch((error) => { console.warn('[EV character]', error.message); return false; })
    .finally(() => { pending = null; });
  return pending.then((ready) => { onLoad?.(ready); return ready; });
}

export function installEvCharacter(gltf) {
  if (gltf.animations.length !== 13) throw new Error('EV character needs all 13 actions');
  const root = gltf.scene;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(gltf.animations[0]).play();
  mixer.update(0);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (o.isSkinnedMesh) box.union(new THREE.Box3().setFromObject(o, true));
    if (o.isMesh) o.geometry.userData.shared = true;
  });
  // Armor silhouettes may extend past the head; retain the published rig size.
  const scale = STATURE / (root.userData.rigBounds?.height ?? (box.max.y - box.min.y));
  const clips = gltf.animations.map((clip) => clip.clone());
  // The physics capsule already supplies the jump arc. Remove only the extra
  // showcase lift, preserving the source takeoff, tucked legs and landing pose.
  const jumpRoot = clips[12].tracks.find((t) => t.name === 'Bip001_Pelvis.position');
  for (let i = 0; i < jumpRoot.times.length; i++) {
    const t = jumpRoot.times[i];
    if (t > 0.48 && t < 1.46) jumpRoot.values[i * 3 + 1] -= 0.55 * Math.sin(Math.PI * (t - 0.48) / 0.98);
  }
  // Measure stance travel from the actual ankle tracks; never guess cadence
  // from the animation's name or the game's much faster capsule speed.
  const speeds = {}, footFloors = {};
  for (const index of [1, 2, 4, 5, 9, 10]) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clips[index]).play();
    const samples = [];
    const foot = root.getObjectByName('Bip001_L_Foot');
    for (let f = 0; f <= 96; f++) {
      action.time = clips[index].duration * f / 96;
      mixer.update(0); root.updateMatrixWorld(true);
      samples.push(foot.getWorldPosition(new THREE.Vector3()));
    }
    const floor = Math.min(...samples.map((p) => p.y));
    footFloors[index] = (floor - (root.userData.rigBounds?.minY ?? box.min.y)) * scale;
    const velocities = samples.slice(1).flatMap((p, i) => {
      const v = -(p.z - samples[i].z) * 96 / clips[index].duration * scale;
      return p.y < floor + 0.09 && v > 0.1 ? [v] : [];
    }).sort((a, b) => a - b);
    if (!velocities.length) throw new Error(`No planted stance in ${clips[index].name}`);
    speeds[index] = velocities[Math.floor(velocities.length / 2)];
  }
  mixer.stopAllAction();
  mixer.clipAction(clips[0]).play(); mixer.update(0);
  template = { root, clips, scale, feet: root.userData.rigBounds?.minY ?? box.min.y, speeds, footFloors };
}

const V = Array.from({ length: 12 }, () => new THREE.Vector3());
const Q = Array.from({ length: 8 }, () => new THREE.Quaternion());
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const clamp = THREE.MathUtils.clamp;
const ease = (a, b, dt, rate = 14) => a + (b - a) * (1 - Math.exp(-rate * dt));
// Hand-local +Y follows the fingers; they curl toward -Z. Keep those axes
// relative to the gun after arm IK, rather than inheriting the elbow's roll.
const SUPPORT_GRIP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)))
  .premultiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 4));
const TRIGGER_GRIP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));

function orientGrip(hand, weapon, localRotation) {
  const parent = hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  hand.quaternion.copy(parent.multiply(weapon.getWorldQuaternion(new THREE.Quaternion())).multiply(localRotation));
  hand.updateWorldMatrix(false, true);
}

function rotateWorld(bone, quaternion) {
  bone.getWorldQuaternion(Q[5]);
  bone.parent.getWorldQuaternion(Q[6]).invert();
  bone.quaternion.copy(Q[6].multiply(Q[5].premultiply(quaternion)));
  bone.updateWorldMatrix(false, true);
}

// Preserve the clip's elbow/knee pole while solving a target in world space.
// This works with the imported bone axes without retargeting any Euler angles.
export function solveChain(a, b, c, target, poleTarget = null) {
  const start = a.getWorldPosition(V[0]);
  const middle = b.getWorldPosition(V[1]);
  const end = c.getWorldPosition(V[2]);
  const l1 = start.distanceTo(middle), l2 = middle.distanceTo(end);
  const axis = V[3].subVectors(target, start);
  const distance = clamp(axis.length(), 0.001, l1 + l2 - 0.0001);
  axis.normalize();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const pole = V[4].subVectors(poleTarget || middle, start);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const knee = V[5].copy(start).addScaledVector(axis, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  const from = V[6].subVectors(middle, start).normalize();
  const to = V[7].subVectors(knee, start).normalize();
  rotateWorld(a, Q[0].setFromUnitVectors(from, to));
  b.getWorldPosition(middle); c.getWorldPosition(end);
  rotateWorld(b, Q[0].setFromUnitVectors(
    from.subVectors(end, middle).normalize(), to.subVectors(target, middle).normalize()));
}

// Move the complete carry into the intersection of both arms' reach. Clamping
// only the elbow leaves the palm floating off a gun during jump/fall clips.
function fitTwoHandCarry(weapon, bones, contact, supportSlide = 1) {
  weapon.updateWorldMatrix(true, false);
  const origin = weapon.getWorldPosition(new THREE.Vector3());
  const constraints = ['R', 'L'].map((side, i) => {
    const shoulder = bones[`Bip001_${side}_UpperArm`].getWorldPosition(new THREE.Vector3());
    const elbow = bones[`Bip001_${side}_Forearm`].getWorldPosition(new THREE.Vector3());
    const hand = bones[`Bip001_${side}_Hand`].getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3(...(i ? contact.support : contact.trigger))
      .applyMatrix4(weapon.matrixWorld).sub(origin);
    if (i && supportSlide > 0 && weapon.userData.weaponId !== 'rpg') {
      const reach = (shoulder.distanceTo(elbow) + elbow.distanceTo(hand)) * .98;
      const back = new THREE.Vector3(0, 0, 1).transformDirection(weapon.matrixWorld);
      const fromShoulder = origin.clone().add(offset).sub(shoulder);
      const along = fromShoulder.dot(back);
      const discriminant = along * along - fromShoulder.lengthSq() + reach * reach;
      if (fromShoulder.lengthSq() > reach * reach && discriminant >= 0) {
        offset.addScaledVector(back, clamp(-along - Math.sqrt(discriminant), 0,
          Math.max(0, contact.trigger[2] - contact.support[2] - .06) * supportSlide));
      }
    }
    return { center: shoulder.clone().sub(offset), radius: (shoulder.distanceTo(elbow) + elbow.distanceTo(hand)) * .98, minRadius: Math.abs(shoulder.distanceTo(elbow) - elbow.distanceTo(hand)) + .005 };
  });
  const delta = new THREE.Vector3();
  for (let i = 0; i < 16; i++) {
    let changed = false;
    for (const { center, radius, minRadius } of constraints) {
      delta.subVectors(origin, center);
      if (delta.lengthSq() > radius * radius) {
        origin.copy(center).add(delta.setLength(radius)); changed = true;
      } else if (delta.lengthSq() < minRadius * minRadius) {
        if (delta.lengthSq() < 1e-10) delta.set(0, 0, -1);
        origin.copy(center).add(delta.setLength(minRadius)); changed = true;
      }
    }
    if (!changed) break;
  }
  weapon.position.copy(weapon.parent.worldToLocal(origin));
  weapon.updateWorldMatrix(true, true);
  const trigger = new THREE.Vector3(...contact.trigger).applyMatrix4(weapon.matrixWorld);
  solveChain(bones.Bip001_R_UpperArm, bones.Bip001_R_Forearm, bones.Bip001_R_Hand, trigger);
}

export function buildEvCharacter(skin = null, armorSkin = null) {
  if (!template) return null;
  const group = new THREE.Group();
  group.name = 'EV default operative';
  const model = cloneSkeleton(template.root);
  // Blender's -Y exports as +Z. The game and all weapon aim use -Z.
  model.rotation.y = Math.PI;
  model.scale.setScalar(template.scale);
  model.position.y = -template.feet * template.scale;
  group.add(model);
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.castShadow = o.receiveShadow = true;
    o.frustumCulled = false;
    if (o.isSkinnedMesh) o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
  });
  const jumpJets = createJumpJets(group, bones);
  let thrustRemaining = 0;
  let runLean = 0;
  let slideBlend = 0;
  const pelvis = bones.Bip001_Pelvis;
  const chest = bones.Bip001_Spine1;
  const slideFeet = ['L', 'R'].map(side => ({
    side,
    rotation: bones[`Bip001_${side}_Foot`].getWorldQuaternion(new THREE.Quaternion()),
    position: new THREE.Vector3(), target: new THREE.Vector3(), pole: new THREE.Vector3(),
    before: new THREE.Quaternion(), desired: new THREE.Quaternion(),
  }));
  const slidePosition = new THREE.Vector3(), slideFrame = new THREE.Quaternion();
  const slideAxis = new THREE.Vector3(), slideRotation = new THREE.Quaternion(), slideLean = new THREE.Quaternion();
  const rifle = model.getObjectByName('Auto_Rifle_-_root');
  const cosmetics = setupEvCosmetics(group, model, bones);
  const muzzle = model.getObjectByName('BIND_BULLET');
  rifle.traverse((o) => { o.userData.noHit = true; });
  const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.10),
    new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.raycast = () => {};
  flash.userData.noHit = true;
  muzzle.add(flash); flash.visible = false;
  const footPlanting = createFootPlanting(group, bones, solveChain);
  // Three's mixer skips writes for unchanged tracks. Restore its last clean
  // output before evaluating so procedural leg/aim/IK offsets cannot accumulate.
  const clipPose = Object.values(bones).map(bone => ({bone,
    position:bone.position.clone(), quaternion:bone.quaternion.clone(), scale:bone.scale.clone()}));
  const native = new THREE.AnimationMixer(model);
  const actions = template.clips.map((clip) => native.clipAction(clip).play().setEffectiveWeight(0));
  actions[0].setEffectiveWeight(1);
  const state = { speed: 0, grounded: true, sprint: false, dirF: 1, dirR: 0,
    crouch: 0, firing: 0, reload: 0, swing: 1, vy: 0, slide: 0 };
  let current = 0, wasGrounded = true, wasCrouched = false, gaitPhase = 0;
  let landingDuration = 0.30, fallSpeed = 0;
  let transition = 0, landing = 0, fireHold = 0, flashTime = 0;
  let pitch = 0, yaw = 0, smoothPitch = 0, smoothYaw = 0, travelYaw = 0, backpedalling = false;
  let externalWeapon = null, externalMuzzle = null, melee = false, shot = 0, actionTime = 0, actionKind = '';
  let death = 0, deathSide = 1, deathTime = 0;
  const deathStartPose = new Map();
  const bodyDynamics = createBodyDynamics();
  let previousJumpVy = 0, previousAirJump = 0;
  const carryRotation = new THREE.Quaternion();
  const carryLocal = new THREE.Quaternion();
  const carryEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const carryHand = new THREE.Vector3();
  const carryForward = new THREE.Vector3();
  const deathBase = new Map();
  const deathPose = createHumanDeathPose();
  const weaponSocket = new THREE.Group();
  // A carry socket under the body cannot be twisted by either arm's IK.
  group.add(weaponSocket);
  const rifleMeshes = [];
  rifle.traverse((o) => { if (o.isMesh && o !== flash) rifleMeshes.push(o); });
  const cycles = (i) => [4, 5, 10].includes(i) ? 2 : 1;
  const ud = group.userData = {
    isHuman: true, isEvCharacter: true, armorTypeId: 'vanguard',
    standHeight: STATURE, feetY: 0, centerX: 0, centerZ: 0, headshotY: 1.56,
    bones, animationMixer: native, animationActions: actions, measuredSpeeds: template.speeds,
    primaryMat: cosmetics.primary, bodyMats: cosmetics.materials, applyFinish: cosmetics.apply,
    setLocomotion(speed, grounded = true, sprint = false, strafe = 0, dirF = 1, dirR = 0, travelDistance = null) {
      Object.assign(state, { speed: Math.max(0, speed), grounded, sprint, dirF, dirR, travelDistance });
    },
    setMotion(name) { Object.assign(state, { speed: name === 'run' ? 5 : name === 'walk' ? 2 : 0, grounded: true, sprint: name === 'run' }); },
    setActionState(value) { Object.assign(state, value); },
    getMuzzleWorldPosition(out) {
      if (melee || state.zombieReach || death > 0) return null;
      const tip = externalWeapon ? externalMuzzle : muzzle;
      if (!tip) return null;
      tip.updateWorldMatrix(true, false);
      return tip.getWorldPosition(out);
    },
    setAim(p, y = 0) { pitch = clamp(p || 0, -1.1, 1.1); yaw = clamp(y || 0, -0.65, 0.65); },
    triggerFire(amount = 1) { fireHold = 0.16; flashTime = 0.045; shot = Math.min(1.5, amount); },
    triggerAction(name) { actionKind = name; actionTime = 0.5; },
    triggerHit() { actionKind = 'hit'; actionTime = 0.3; },
    triggerJump() { landing = 0.25; },
    triggerTeleport() {
      footPlanting.reset();
      death = 0; rifle.visible = true; weaponSocket.visible = true;
      for (const [bone, pose] of deathBase) {
        bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
      }
      fireHold = flashTime = shot = transition = landing = actionTime = 0;
      thrustRemaining = slideBlend = runLean = 0; jumpJets.update(0, 0);
      pitch = yaw = smoothPitch = smoothYaw = travelYaw = 0; backpedalling = false;
      bodyDynamics.reset();
      fallSpeed = previousJumpVy = previousAirJump = 0;
      travelSpeed = 0; state.speed = 0; state.sprint = false; state.dirF = 1; state.dirR = 0; state.travelDistance = null;
      state.crouch = state.firing = state.reload = state.slide = 0;
      state.swing = 1; state.vy = 0; state.airJumpUsed = 0;
      state.grounded = wasGrounded = true; wasCrouched = false;
      current = 0; gaitPhase = 0;
      actions.forEach((a, i) => { a.time = 0; a.enabled = i === 0; a.setEffectiveWeight(i === 0 ? 1 : 0); });
      flash.visible = false;
      tick(0);
    },
    setDeathState(value, side = 1, elapsed = null) {
      if (death <= 0 && value > 0) {
        deathStartPose.clear();
        for (const bone of Object.values(bones)) deathStartPose.set(bone, {
          position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
        });
        footPlanting.reset();
      }
      if (death > 0 && value <= 0) ud.triggerTeleport();
      death = clamp(value, 0, 1); deathSide = side;
      deathTime = Number.isFinite(elapsed) ? elapsed : death * 1.2;
    },
    attachWeapon(weapon, isMelee = false) {
      if (externalWeapon && externalWeapon !== weapon) disposeModel(externalWeapon);
      externalWeapon = externalMuzzle = null; melee = isMelee; flash.position.set(0, 0, 0);
      const useNative = !weapon || (weapon.userData.weaponId === 'm4' && weapon.userData.modelSource !== 'reference' && weapon.userData.modelSource !== 'blender-arsenal' && !weapon.userData.referenceRevision);
      rifleMeshes.forEach((o) => { o.visible = useNative; });
      if (useNative) { if (weapon) disposeModel(weapon); return; }
      externalWeapon = weapon;
      externalMuzzle = weapon.getObjectByName('muzzle') || weapon.getObjectByName('BIND_BULLET');
      if (!externalMuzzle) weapon.traverse(o => { if (!externalMuzzle && /^muzzle_point/.test(o.name)) externalMuzzle = o; });
      // Anchor replacement geometry to the native right wrist at
      // the trigger marker. Other loadout weapons remain visible and animated.
      weaponSocket.add(weapon);
      weapon.rotation.set(isMelee ? 1.35 : 0, 0, isMelee ? SWORD_EDGE_ROLL - 0.04 : 0);
      weapon.scale.setScalar(1);
      const contact = weaponHandPose(weapon).trigger;
      weaponSocket.updateWorldMatrix(true, false);
      const wrist = weaponSocket.worldToLocal(bones.Bip001_R_Hand.getWorldPosition(new THREE.Vector3()));
      weapon.position.copy(wrist).sub(V[0].fromArray(contact).multiply(weapon.scale).applyEuler(weapon.rotation));
      weapon.traverse((o) => { o.userData.noHit = true; });
    },
  };
  let travelSpeed = 0;
  function tick(dt) {
    dt = clamp(dt, 0, 0.1);
    if (death > 0) {
      // Start from the exact living pose, release the grip, then settle. The
      // mixer stops owning the limbs on death; no continuing walk or aim IK.
      const release = clamp(deathTime / 0.30, 0, 1);
      const blend = release * release * (3 - 2 * release);
      for (const [bone, pose] of deathBase) {
        const start = deathStartPose.get(bone) || pose;
        bone.position.lerpVectors(start.position, pose.position, blend);
        bone.quaternion.slerpQuaternions(start.quaternion, pose.quaternion, blend);
        bone.scale.lerpVectors(start.scale, pose.scale, blend);
      }
      const pose = sampleHumanDeathPose(death, deathSide, deathPose, deathTime);
      group.updateWorldMatrix(true, true);
      const frame = group.getWorldQuaternion(new THREE.Quaternion());
      const x = X.clone().applyQuaternion(frame), z = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
      const parts = [
        ['Pelvis', 'hips'], ['Spine', 'spine'], ['Spine1', 'chest'], ['Head', 'head'],
        ['R_UpperArm', 'rArm'], ['L_UpperArm', 'lArm'], ['R_Forearm', 'rFore'], ['L_Forearm', 'lFore'],
        ['R_Thigh', 'rLeg'], ['L_Thigh', 'lLeg'], ['R_Calf', 'rCalf'], ['L_Calf', 'lCalf'],
        ['R_Foot', 'rFoot'], ['L_Foot', 'lFoot'], ['R_Hand', 'rHand'], ['L_Hand', 'lHand'],
      ];
      for (const [name, key] of parts) {
        const bone = bones[`Bip001_${name}`];
        rotateWorld(bone, Q[0].setFromAxisAngle(x, pose[`${key}X`] || 0));
        rotateWorld(bone, Q[0].setFromAxisAngle(z, pose[`${key}Z`] || 0));
      }
      // The armed idle has one foot far forward. Release that stance as the
      // body lands, otherwise its bent leg remains suspended above the corpse.
      // A shallow, asymmetric leg rest keeps connected knees without locking
      // them to the last running frame or stretching the bone chain.
      const legRelease = clamp((deathTime - 0.25) / 0.85, 0, 1);
      const legBlend = legRelease * legRelease * (3 - 2 * legRelease);
      for (const side of ['L', 'R']) {
        const sign = side === 'R' ? 1 : -1;
        const foot = bones[`Bip001_${side}_Foot`];
        const calf = bones[`Bip001_${side}_Calf`];
        const target = group.worldToLocal(foot.getWorldPosition(V[8]));
        target.lerp(V[10].set(sign * .24, .09, side === 'R' ? .18 : .13), legBlend);
        group.localToWorld(target);
        const pole = group.worldToLocal(calf.getWorldPosition(V[9]));
        pole.lerp(V[10].set(sign * .25, .55, -.18), legBlend);
        group.localToWorld(pole);
        solveChain(bones[`Bip001_${side}_Thigh`], calf, foot, target, pole);
      }
      rifle.visible = weaponSocket.visible = deathTime < 0.12; flash.visible = false;
      fireHold = flashTime = shot = actionTime = 0;
      thrustRemaining = 0; jumpJets.update(dt, 0);
      ud.activeAnimation = 'Death';
      return;
    }
    // Live bodies advance their gait by rendered displacement, not a damped
    // speed estimate. Accumulated distance also survives animation LOD skips.
    // Static inventory previews can still supply a speed without moving root.
    if (state.travelDistance !== null && Number.isFinite(state.travelDistance) && dt > 0) {
      // Network interpolation can deliver tiny/zero steps between snapshots.
      // Keep a continuous stride through those gaps instead of blending idle
      // into every other frame of a sideways chase.
      const measuredSpeed = Math.max(0, state.travelDistance / dt);
      travelSpeed += (measuredSpeed - travelSpeed) * (1 - Math.exp(-24 * dt));
      state.speed = travelSpeed;
      state.travelDistance = 0;
    }
    slideBlend = ease(slideBlend, state.slide && state.grounded ? 1 : 0, dt, 12);
    const slidePose = slideBlend > 0.001;
    const crouched = state.crouch > 0.5 || slidePose;
    const moving = state.speed > 0.35;
    const firing = !melee && state.reload <= 0 && (state.firing > 0 || fireHold > 0);
    const airPose = jumpAirPose(state.grounded, state.vy);
    if (isJumpImpulse(state.grounded, wasGrounded, state.vy, previousJumpVy)
      || (!state.grounded && (state.airJumpUsed || 0) > previousAirJump)) thrustRemaining = 0.24;
    previousJumpVy = state.vy;
    previousAirJump = state.grounded ? 0 : (state.airJumpUsed || 0);
    if (state.grounded) thrustRemaining = 0;
    else thrustRemaining = Math.max(0, thrustRemaining - dt);
    if (!state.grounded) fallSpeed = Math.max(fallSpeed, -state.vy);
    if (state.grounded && !wasGrounded) {
      landingDuration = jumpLandingDuration(fallSpeed);
      landing = landingDuration;
      fallSpeed = 0;
    }
    if (crouched !== wasCrouched && !moving) transition = 0.40;
    wasCrouched = crouched; wasGrounded = state.grounded;
    // A slide has a stable low silhouette, never a fast crouch-walking cycle.
    let target = slidePose ? (firing ? 8 : 7)
      : crouched ? (moving ? (firing ? 10 : 9) : (firing ? 8 : 7))
      : moving ? (firing ? 5 : 2)
        : firing ? 3 : 0;
    if (transition > 0 && !moving && !slidePose) target = crouched ? 6 : 11;
    if (!state.grounded || landing > 0) target = 12;
    const previous = actions[current];
    if (target !== current) {
      const a = actions[target];
      a.time = [6, 11, 12].includes(target) ? 0
        : previous.time / previous.getClip().duration * cycles(current) % 1 * a.getClip().duration / cycles(target);
      current = target;
    }
    const base = target;
    const reference = template.speeds[base];
    // Match cadence to actual travel, including firing and strafing.
    // Slowing this clock independently makes planted feet skate.
    const stride = 1;
    const animationSpeed = state.speed;
    const cadence = reference ? animationSpeed / reference : 1;
    let desiredTravel = moving ? -Math.atan2(state.dirR, state.dirF) : 0;
    // Avoid flipping the leg cycle 180 degrees when a strafing bot
    // jitters either side of exactly lateral travel.
    if (!moving) backpedalling = false;
    else if (state.dirF < -.3) backpedalling = true;
    else if (state.dirF > .1) backpedalling = false;
    const backwards = backpedalling;
    if (backwards) desiredTravel += desiredTravel > 0 ? -Math.PI : Math.PI;
    desiredTravel = travelYaw + Math.atan2(Math.sin(desiredTravel-travelYaw), Math.cos(desiredTravel-travelYaw));
    travelYaw = ease(travelYaw, desiredTravel, dt, 18);
    // All blended leg clips must describe the same footfall. Firing clips
    // contain two cycles while ordinary locomotion contains one, and walk/run
    // durations differ. Advancing every action by the same time scale lets
    // their feet drift apart during transitions even if steady gait is correct.
    if (reference && moving) gaitPhase = THREE.MathUtils.euclideanModulo(
      gaitPhase + dt * cadence * cycles(base) / template.clips[base].duration * (backwards ? -1 : 1), 2);
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const weight = ease(a.getEffectiveWeight(), i === target ? 1 : 0, dt, slidePose ? 10 : 18);
      a.enabled = i === target || weight > 0.0001;
      a.setEffectiveWeight(a.enabled ? weight : 0);
      const locomotion = template.speeds[i] > 0;
      a.setEffectiveTimeScale(1);
      a.paused = locomotion || [6, 11, 12].includes(i) || (slidePose && [7, 8].includes(i));
      if (locomotion) a.time = (gaitPhase % cycles(i)) * a.getClip().duration / cycles(i);
      if (slidePose && [7, 8].includes(i)) a.time = 0.35;
    }
    if (target === 6 || target === 11) actions[target].time = (1 - transition / 0.40) * 0.75;
    if (target === 12) actions[12].time = !state.grounded
      ? airPose.clipTime
      : 1.80 + (1 - landing / landingDuration) * 0.52;
    for (const pose of clipPose) {
      pose.bone.position.copy(pose.position);pose.bone.quaternion.copy(pose.quaternion);pose.bone.scale.copy(pose.scale);
    }
    native.update(dt);
    for (const pose of clipPose) {
      pose.position.copy(pose.bone.position);pose.quaternion.copy(pose.bone.quaternion);pose.scale.copy(pose.bone.scale);
    }
    group.updateWorldMatrix(true, true);
    // Aim rotates the complete upper-body chain, including both hands and gun.
    // Network aim is already interpolated. Do not leave the barrel behind
    // its shot direction by easing aim a second time during fire.
    smoothPitch = state.firing ? pitch : ease(smoothPitch, pitch, dt);
    smoothYaw = state.firing ? yaw : ease(smoothYaw, yaw, dt);
    group.getWorldQuaternion(Q[1]);
    const bodyAxis = V[8].copy(Y).applyQuaternion(Q[1]);
    // Thighs are children of Spine in this rig. Counter-rotate only Spine1
    // and above, otherwise keeping the torso aimed also cancels leg travel.
    const chestWorld = chest.getWorldQuaternion(Q[2]).clone();
    rotateWorld(pelvis, Q[0].setFromAxisAngle(bodyAxis, travelYaw));
    chest.parent.getWorldQuaternion(Q[3]).invert();
    chest.quaternion.copy(Q[3].multiply(chestWorld));
    chest.updateWorldMatrix(false, true);
    // Keep the authored leg reach. Stretching the stride pushed the knees
    // through full extension and made the IK bend direction snap each step.
    if (!state.grounded) {
      // Tuck both feet up/back on ascent without moving the gameplay capsule.
      const tuck = airPose.tuck;
      const backwards = new THREE.Vector3(0, 0, 0.07 * tuck).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
      for (const side of ['L', 'R']) {
        const foot = bones[`Bip001_${side}_Foot`];
        const targetFoot = foot.getWorldPosition(new THREE.Vector3()).add(backwards);
        targetFoot.y += 0.16 * tuck;
        solveChain(bones[`Bip001_${side}_Thigh`], bones[`Bip001_${side}_Calf`], foot, targetFoot);
      }
    }
    // Distance-matched clips retain world anchors through grounded stance.
    footPlanting.update(state.grounded && moving && !backwards && !slidePose && reference > 0, template.footFloors[base]);
    // Keep a soft knee through running stance; never force the calf into a
    // straight line just to reach an overextended step. Preserve ankle height.
    if (state.grounded && moving && !crouched && !backwards) for (const side of ['L', 'R']) {
      const thigh = bones['Bip001_' + side + '_Thigh'], calf = bones['Bip001_' + side + '_Calf'], foot = bones['Bip001_' + side + '_Foot'];
      const hip = thigh.getWorldPosition(new THREE.Vector3()), knee = calf.getWorldPosition(new THREE.Vector3()), ankle = foot.getWorldPosition(new THREE.Vector3());
      const a = hip.distanceTo(knee), b = knee.distanceTo(ankle);
      const reach = Math.sqrt(a*a + b*b + 2*a*b*Math.cos(8*Math.PI/180));
      const offset = ankle.clone().sub(hip), horizontal = Math.hypot(offset.x, offset.z);
      const allowed = Math.sqrt(Math.max(0, reach*reach - offset.y*offset.y));
      if(horizontal > allowed && horizontal > .0001){
        ankle.x = hip.x + offset.x * allowed/horizontal; ankle.z = hip.z + offset.z * allowed/horizontal;
        const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
        solveChain(thigh, calf, foot, ankle);
        foot.parent.getWorldQuaternion(Q[3]).invert();foot.quaternion.copy(Q[3].multiply(footQ));
      }
    }
    if (slidePose) {
      // Lower the hips, extend the lead leg and fold the trailing knee. Targets
      // live in travel space, so a sideways slide does not twist either leg.
      // Apply before weapon carry: the existing wrist IK follows the lowered
      // shoulders and keeps both palms on the same gun contacts.
      // Preserve the clip's foot height before lowering the pelvis; blending
      // from its translated feet would briefly push the boots underground.
      for (const footPose of slideFeet) {
        const foot = bones[`Bip001_${footPose.side}_Foot`];
        foot.getWorldPosition(footPose.position); foot.getWorldQuaternion(footPose.before);
      }
      group.worldToLocal(pelvis.getWorldPosition(slidePosition));
      slidePosition.y += (0.43 - slidePosition.y) * slideBlend;
      pelvis.position.copy(pelvis.parent.worldToLocal(group.localToWorld(slidePosition)));
      pelvis.updateWorldMatrix(false, true);
      slideFrame.setFromAxisAngle(Y, travelYaw);
      group.getWorldQuaternion(slideRotation);
      slideAxis.copy(X).applyQuaternion(slideRotation);
      rotateWorld(chest, slideLean.setFromAxisAngle(slideAxis, 0.18 * slideBlend));
      for (const footPose of slideFeet) {
        const lead = footPose.side === 'R';
        const foot = bones[`Bip001_${footPose.side}_Foot`];
        footPose.target.set(lead ? 0.17 : -0.22, 0.16, lead ? -0.76 : 0.14).applyQuaternion(slideFrame);
        footPose.pole.set(lead ? 0.20 : -0.38, lead ? 0.45 : 0.18, -0.38).applyQuaternion(slideFrame);
        group.localToWorld(footPose.target); group.localToWorld(footPose.pole);
        footPose.target.lerpVectors(footPose.position, footPose.target, slideBlend);
        group.worldToLocal(footPose.target);
        // A rolling walk-foot needs toe clearance while its sole settles flat.
        footPose.target.y = Math.max(footPose.target.y, 0.16 + 0.10 * (1 - slideBlend));
        group.localToWorld(footPose.target);
        solveChain(bones[`Bip001_${footPose.side}_Thigh`], bones[`Bip001_${footPose.side}_Calf`], foot, footPose.target, footPose.pole);
        footPose.desired.copy(slideRotation).multiply(slideFrame).multiply(footPose.rotation);
        footPose.before.slerp(footPose.desired, slideBlend);
        foot.parent.getWorldQuaternion(footPose.desired).invert();
        foot.quaternion.copy(footPose.desired.multiply(footPose.before));
        foot.updateWorldMatrix(false, true);
      }
    }
    const actionPulse = actionTime > 0 ? Math.sin(actionTime / 0.5 * Math.PI) : 0;
    const reload = Math.sin(clamp(state.reload, 0, 1) * Math.PI);
    const swingPhase = clamp(state.swing, 0, 1);
    const swordPose = swordSwingPose(swingPhase);
    const bodyYaw=group.rotation.y, sinYaw=Math.sin(bodyYaw), cosYaw=Math.cos(bodyYaw);
    const response=bodyDynamics.step({
      vx:state.speed*(-sinYaw*state.dirF+cosYaw*state.dirR),
      vz:state.speed*(-cosYaw*state.dirF-sinYaw*state.dirR),
      yaw:bodyYaw,grounded:state.grounded,vy:state.vy
    },dt);
    // Only the upper-body chain yields to inertia. Feet retain the solved
    // ground contacts and weapon hands are fitted afterwards. Fire keeps aim exact.
    const bodyWeight=firing?0:1;
    if(response.drop){
      const chestPosition=chest.getWorldPosition(V[11]);chestPosition.y+=response.drop;
      chest.position.copy(chest.parent.worldToLocal(chestPosition));chest.updateWorldMatrix(false,true);
    }
    rotateWorld(chest,Q[0].setFromAxisAngle(bodyAxis,response.twist*bodyWeight));
    rotateWorld(chest,Q[0].setFromAxisAngle(V[7].set(0,0,1).applyQuaternion(Q[1]),response.roll*bodyWeight));
    ud.bodyDynamics={...response};
    // Hinge the upper body as one unit; do not curl individual spine joints.
    runLean = ease(runLean, state.sprint && moving && state.grounded && !crouched ? -.14 : 0, dt, 8);
    rotateWorld(chest, Q[0].setFromAxisAngle(V[8].copy(X).applyQuaternion(Q[1]), runLean));
    ud.runLean = runLean;
    const actionPitch = reload * -0.35 + (actionKind === 'hit' ? -0.12 : -0.25) * actionPulse;
    rotateWorld(chest, Q[0].setFromAxisAngle(bodyAxis, smoothYaw));
    rotateWorld(chest, Q[0].setFromAxisAngle(V[8].copy(X).applyQuaternion(Q[1]), smoothPitch + actionPitch + shot * 0.018 + response.pitch * bodyWeight));
    if (externalWeapon) {
      if (melee) {
        // Carry the hilt through the chop instead of rotating a rifle grip.
        const sword = externalWeapon.userData.weaponId === 'sword';
        const hand = group.localToWorld(new THREE.Vector3((sword ? 0.08 : 0.30) + swordPose.x, (sword ? 1.24 : 1.30) + swordPose.y, (sword ? -0.48 : -0.36) + swordPose.z));
        solveChain(bones.Bip001_R_UpperArm, bones.Bip001_R_Forearm, bones.Bip001_R_Hand, hand);
        const guard = group.localToWorld(new THREE.Vector3(-0.24, 1.05, -0.16));
        solveChain(bones.Bip001_L_UpperArm, bones.Bip001_L_Forearm, bones.Bip001_L_Hand, guard);
      }
      const authoredContact = weaponHandPose(externalWeapon);
      const contact = authoredContact.characterSupport
        ? { ...authoredContact, support: authoredContact.characterSupport } : authoredContact;
      // Enter and leave a reload with the palm still on the gun. The old
      // binary target jumped straight to the magazine and skipped reach fitting.
      const reloadBlend = !melee && state.reload > 0
        ? THREE.MathUtils.smoothstep(state.reload, 0, .25)
          * (1 - THREE.MathUtils.smoothstep(state.reload, .75, 1)) : 0;
      const supportContact = reloadBlend > 0
        ? new THREE.Vector3(...contact.support).lerp(new THREE.Vector3(...contact.reload), reloadBlend).toArray()
        : contact.support;
      weaponSocket.updateWorldMatrix(true, false);
      group.getWorldQuaternion(carryRotation);
      carryEuler.set(melee ? 1.35 + swordPose.pitch : smoothPitch + shot * 0.018 + airPose.weaponPitch,
        smoothYaw, melee ? SWORD_EDGE_ROLL - 0.04 : 0);
      carryRotation.multiply(carryLocal.setFromEuler(carryEuler));
      weaponSocket.getWorldQuaternion(carryLocal).invert();
      externalWeapon.quaternion.copy(carryLocal.multiply(carryRotation));
      if (!melee && externalWeapon.userData.weaponId !== 'rpg') {
        // The native rifle clip tucks its wrist behind the authored replacement
        // grips. Bring the whole carry forward, including the trigger arm;
        // moving only the model would leave the hand behind inside the stock.
        bones.Bip001_R_Hand.getWorldPosition(carryHand);
        carryHand.add(carryForward.set(0, airPose.weaponY, -0.085).applyQuaternion(carryRotation));
        solveChain(bones.Bip001_R_UpperArm, bones.Bip001_R_Forearm, bones.Bip001_R_Hand, carryHand);
      }
      const wrist = weaponSocket.worldToLocal(bones.Bip001_R_Hand.getWorldPosition(V[0]));
      externalWeapon.position.copy(wrist).sub(V[1].fromArray(contact.trigger).multiply(externalWeapon.scale).applyQuaternion(externalWeapon.quaternion));
      if (externalWeapon.userData.weaponId === 'rpg') {
        // Seat the rear saddle on the animated right shoulder, then solve both
        // wrists to the launcher rather than letting a rifle clip drive the tube.
        const shoulder = bones.Bip001_R_UpperArm.getWorldPosition(new THREE.Vector3());
        shoulder.add(new THREE.Vector3(0.035, 0.045, 0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())));
        const saddle = new THREE.Vector3(0, -.018, .14).multiply(externalWeapon.scale).applyQuaternion(externalWeapon.quaternion);
        externalWeapon.position.copy(weaponSocket.worldToLocal(shoulder)).sub(saddle);
        externalWeapon.updateWorldMatrix(true, true);
        const trigger = new THREE.Vector3(...contact.trigger).applyMatrix4(externalWeapon.matrixWorld);
        solveChain(bones.Bip001_R_UpperArm, bones.Bip001_R_Forearm, bones.Bip001_R_Hand, trigger);
      }
      externalWeapon.updateWorldMatrix(true, true);
      if (!melee && contact.supportVisible !== false) {
        fitTwoHandCarry(externalWeapon, bones, { ...contact, support: supportContact }, 1 - reloadBlend);
      }
      if (melee && externalWeapon.userData.weaponId === 'sword') {
        fitTwoHandCarry(externalWeapon, bones, contact);
        // Stack the second palm below the blade hand on the same moving hilt.
        const support = new THREE.Vector3(...contact.support).applyMatrix4(externalWeapon.matrixWorld);
        solveChain(bones.Bip001_L_UpperArm, bones.Bip001_L_Forearm, bones.Bip001_L_Hand, support);
      }
      if (!melee && contact.supportVisible !== false) {
        const support = new THREE.Vector3(...supportContact)
          .applyMatrix4(externalWeapon.matrixWorld);
        if (reloadBlend < 1 && externalWeapon.userData.weaponId !== 'rpg') {
          // Let the support palm slide back along the underside of the gun
          // when the authored fore-end exceeds this character's arm reach.
          const shoulder = bones.Bip001_L_UpperArm.getWorldPosition(V[0]);
          const elbow = bones.Bip001_L_Forearm.getWorldPosition(V[1]);
          const hand = bones.Bip001_L_Hand.getWorldPosition(V[2]);
          const reach = (shoulder.distanceTo(elbow)+elbow.distanceTo(hand)) * 0.98;
          const back = V[3].set(0,0,1).applyQuaternion(carryRotation);
          const offset = V[4].subVectors(support,shoulder);
          const along = offset.dot(back);
          const discriminant = along*along - offset.lengthSq() + reach*reach;
          if (offset.lengthSq() > reach*reach && discriminant >= 0) {
            const shift = clamp(-along-Math.sqrt(discriminant),0,
              Math.max(0,contact.trigger[2]-supportContact[2]-0.06) * (1 - reloadBlend));
            support.addScaledVector(back,shift);
          }
        }
        solveChain(bones.Bip001_L_UpperArm, bones.Bip001_L_Forearm, bones.Bip001_L_Hand, support);
      }
      if (!melee) {
        orientGrip(bones.Bip001_R_Hand, externalWeapon, TRIGGER_GRIP);
        if (contact.supportVisible !== false) orientGrip(bones.Bip001_L_Hand, externalWeapon, SUPPORT_GRIP);
      }
    }
    // Unarmed Survival enemies reach forward with the same bot skeleton.
    if (state.zombieReach) {
      for (const [side, x] of [['R', .23], ['L', -.23]]) {
        const reach = group.localToWorld(new THREE.Vector3(x, 1.42, -.66));
        solveChain(bones['Bip001_' + side + '_UpperArm'], bones['Bip001_' + side + '_Forearm'], bones['Bip001_' + side + '_Hand'], reach);
      }
      if (externalWeapon) externalWeapon.visible = false;
      rifle.visible = false;
      flashTime = 0;
    }
    ud.activeAnimation = state.slide && slideBlend > 0.5 ? 'Slide' : template.clips[target].name;
    ud.slideBlend = slideBlend;
    jumpJets.update(dt, thrustRemaining);
    ud.animationCadence = cadence; ud.strideScale = stride;
    ud.headshotY = group.worldToLocal(bones.Bip001_Head.getWorldPosition(V[9])).y - 0.02;
    if (externalMuzzle) flash.position.copy(muzzle.worldToLocal(externalMuzzle.getWorldPosition(V[10])));
    flash.visible = flashTime > 0 && !melee;
    flashTime = Math.max(0, flashTime - dt); fireHold = Math.max(0, fireHold - dt);
    transition = Math.max(0, transition - dt); landing = Math.max(0, landing - dt);
    shot *= Math.exp(-24 * dt); actionTime = Math.max(0, actionTime - dt);
  }
  ud.mixer = { update: tick };
  tick(0);
  for (const bone of Object.values(bones)) deathBase.set(bone, {
    position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
  });
  cosmetics.apply(skin, armorSkin);
  prepareDeathBody(group);
  return group;
}
