import * as THREE from 'three';
import { weaponHandPose } from '../weapons/WeaponHandPoses.js';

// Body-local weapon poses. The muzzle is model-local -Z and the soldier faces
// body-local -Z, so AIM is nearly identity. PATROL matches the supplied real
// soldier reference: stock retained at the shoulder, receiver at the lower
// chest, firing hand on the grip, support hand under the fore-end, and muzzle
// carried safely down and across the body.
const PATROL_Q = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-0.620, 0.280, 0.120)
);
// A shouldered long gun toes inward a few degrees: the butt stays out in the
// right shoulder pocket while the muzzle converges on the body's sight line.
// Dead-zero yaw drove the broad bolt-rifle stock through slim armor variants.
const AIM_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.020, 0.075, 0));

// Assault/Idle shoulder midpoint after HumanSoldier's production UPRIGHT and
// gun-stance layers, averaged over the real Idle clip. Weapon poses are kept as
// offsets from this point so crouch/stance/armor scaling cannot leave the fixed
// body-space rifle behind while the shoulders move.
const SHOULDER_REF = new THREE.Vector3(-0.05476, 1.37841, 0.04928);
const BASE_ARM_REACH = 0.47268;
// Receiver offsets from the live shoulder midpoint. The earlier values were
// inherited from the old 2.2m procedural figure: on the 1.8m Soldier they put
// the receiver 10-16cm ABOVE the shoulders, drove the stock through the head,
// and made both forearms cover the face. Keep low-ready below the shoulder and
// let a full aim rise only to the shoulder pocket.
// The receiver remains just below the shoulder midpoint. The stronger pitch
// raises the stock into the shoulder pocket and drops the muzzle; lowering the
// entire weapon as well would pull long-gun fore-ends beyond the support arm.
const PATROL_OFFSET = new THREE.Vector3(0.28, -0.14, -0.12);
const AIM_OFFSET = new THREE.Vector3(0.28, -0.05, -0.20);
// Seat the rear of the production stock on the front of the shoulder pocket.
// The stock geometry extends behind the receiver origin. Without this common
// forward offset a weapon can look clear by its transform while the actual
// stock mesh still crosses the Soldier's shoulder.
const BODY_FORWARD_CLEARANCE = 0.21;

// A normal soldier does not hold a sidearm, an SMG, an LMG, and a launcher as
// if they were the same M4. These families preserve the shared wrist IK while
// giving each mass/stock type its own low-ready and shouldered silhouette.
function carryPose(family, patrolEuler, aimEuler, patrolOffset, aimOffset, forward) {
  return Object.freeze({
    family,
    patrolQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(...patrolEuler)),
    aimQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(...aimEuler)),
    patrolOffset: new THREE.Vector3(...patrolOffset),
    aimOffset: new THREE.Vector3(...aimOffset),
    forward,
  });
}

const CARRY_RIFLE = Object.freeze({
  family: 'rifle', patrolQ: PATROL_Q, aimQ: AIM_Q,
  patrolOffset: PATROL_OFFSET, aimOffset: AIM_OFFSET,
  forward: BODY_FORWARD_CLEARANCE,
});
const CARRY_COMPACT = carryPose('compact', [-0.45, 0.22, 0.10], [-0.02, 0.06, 0],
  [0.27, -0.11, -0.10], [0.27, -0.04, -0.18], 0.20);
const CARRY_SHOTGUN = carryPose('shotgun', [-0.58, 0.24, 0.10], [-0.02, 0.07, 0],
  [0.28, -0.13, -0.12], [0.28, -0.05, -0.20], 0.20);
const CARRY_SUPPORT = carryPose('support', [-0.42, 0.18, 0.06], [-0.02, 0.06, 0],
  [0.30, -0.10, -0.11], [0.30, -0.03, -0.18], 0.22);
const CARRY_PRECISION = carryPose('precision', [-0.50, 0.20, 0.08], [-0.02, 0.06, 0],
  [0.29, -0.11, -0.13], [0.29, -0.04, -0.20], 0.22);
const CARRY_PISTOL = carryPose('pistol', [-0.16, 0.04, 0], [-0.01, 0.02, 0],
  [0.10, -0.07, -0.23], [0.10, -0.02, -0.29], 0.08);
const CARRY_LAUNCHER = carryPose('launcher', [-0.20, 0.12, 0.04], [-0.01, 0.05, 0],
  [0.32, -0.02, -0.10], [0.32, 0.00, -0.18], 0.20);

const HUMAN_CARRY_BY_ID = Object.freeze({
  sidearm: CARRY_PISTOL, magnum: CARRY_PISTOL,
  uzi: CARRY_COMPACT, needler: CARRY_COMPACT, plasmarifle: CARRY_COMPACT,
  levershotgun: CARRY_SHOTGUN, energyshotgun: CARRY_SHOTGUN,
  lmg: CARRY_SUPPORT,
  boltsniper: CARRY_PRECISION, battlerifle: CARRY_PRECISION, dmr: CARRY_PRECISION,
  rpg: CARRY_LAUNCHER, fuelrod: CARRY_LAUNCHER, concussion: CARRY_LAUNCHER,
});

function humanCarryPose(weapon) {
  return HUMAN_CARRY_BY_ID[weapon?.userData?.weaponId] || CARRY_RIFLE;
}

// WeaponModels are authored around a 1.05-1.15m showcase silhouette. That is
// useful in the loadout turntable, but full size made an M4 longer than the
// Soldier could physically shoulder and put its stock through the deltoid.
// Long/heavy firearms stay at 0.65 so their stocks and receivers do not overrun
// the Soldier's shoulder pocket. Compact/default guns receive a larger scale
// below: at 0.65 they technically cleared the torso, but the oversized Mixamo
// gloves hid most of the gun and made it read as embedded in the model. Both
// weapon geometry and local grip targets inherit the selected scale.
export const HUMAN_WEAPON_SCALE = 0.65;
const HUMAN_WEAPON_SCALES = Object.freeze({
  sidearm: 0.78,
  uzi: 0.78,
  m4: 0.80,
});

// Compact/default guns need enough size to remain readable between the
// Soldier's large gloves. Long and heavy weapons retain the proven 0.65 scale
// so their stocks and receivers do not overrun the shoulder pocket.
export function humanWeaponScale(weaponOrId) {
  const id = typeof weaponOrId === 'string'
    ? weaponOrId : weaponOrId?.userData?.weaponId;
  return HUMAN_WEAPON_SCALES[id] ?? HUMAN_WEAPON_SCALE;
}

// Idle third person is a low-ready carry, not a permanent 68% ADS pose. Export
// the contract so the production controller and QA measure the same posture.
export const HUMAN_LOW_READY_AIM = 0.18;

export const HUMAN_GRIP_LOCAL = new THREE.Vector3(0, -0.12, 0.10);
// This is a wrist-bone target behind the visible contact patch. The modeled
// palm and fingers extend forward from it onto the receiver-side handguard,
// keeping the two-handed hold reachable throughout the locomotion clips.
export const HUMAN_HANDGUARD_LOCAL = new THREE.Vector3(-0.08, -0.02, 0.15);
// Wrist target on the left face of the common magazine, rather than its
// bottom-centre. The X clearance places the palm around the mag body.
export const HUMAN_MAG_LOCAL = new THREE.Vector3(-0.08, -0.15, 0.02);

// Resolve contacts from the displayed mesh, including imported-pack overrides.
// Wrist targets sit just behind the palm contact; using one M4 target for every
// model made otherwise accurate IK grab empty space on pickups and sidearms.
export function humanHandContacts(weapon) {
  if (weapon.userData.humanHandContacts) return weapon.userData.humanHandContacts;
  const pose = weaponHandPose(weapon);
  return weapon.userData.humanHandContacts = {
    trigger: new THREE.Vector3(...pose.trigger),
    // Model markers locate the closed palm; the third-person hand bone is at
    // the wrist, 10 cm behind it. Preserve that real hand length in world space.
    support: new THREE.Vector3(...pose.support).add(new THREE.Vector3(0, -0.015,
      pose.carry === 'pistol' ? 0 : (0.10 / humanWeaponScale(weapon))
        // The larger rocket tube uses the rear support section on this rig;
        // reaching for its muzzle pulled the entire launcher into the shoulder.
        + (weapon.userData.weaponId === 'rpg' && weapon.userData.modelSource === 'blender-arsenal' ? .45 : 0))),
    reload: new THREE.Vector3(...pose.reload),
  };
}

const REFERENCE_STOCK_BACK = 0.445;
const _bounds = new THREE.Box3();
const _partBounds = new THREE.Box3();
const _invWeapon = new THREE.Matrix4();
const _partToWeapon = new THREE.Matrix4();
function weaponGeometryClearance(weapon) {
  if (!weapon?.traverse) return { forward: 0 };
  if (weapon.userData.humanCarryClearance) return weapon.userData.humanCarryClearance;
  weapon.updateWorldMatrix(true, true);
  _bounds.makeEmpty();
  _invWeapon.copy(weapon.matrixWorld).invert();
  weapon.traverse((part) => {
    if (!part.isMesh || !part.geometry) return;
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    _partToWeapon.multiplyMatrices(_invWeapon, part.matrixWorld);
    _partBounds.copy(part.geometry.boundingBox).applyMatrix4(_partToWeapon);
    _bounds.union(_partBounds);
  });
  const stockBack = _bounds.isEmpty() ? REFERENCE_STOCK_BACK : _bounds.max.z;
  const result = {
    forward: Math.max(0, stockBack - REFERENCE_STOCK_BACK) * Math.abs(weapon.scale.z || 1),
  };
  weapon.userData.humanCarryClearance = result;
  return result;
}

const V = Array.from({ length: 32 }, () => new THREE.Vector3());
const Q = Array.from({ length: 12 }, () => new THREE.Quaternion());
const E = new THREE.Euler();

function smoothstep(v) {
  const x = THREE.MathUtils.clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
}

function worldPosition(object, out) {
  const e = object.matrixWorld.elements;
  return out.set(e[12], e[13], e[14]);
}

// Return the post-pose shoulder midpoint in body space and the rig's scale
// relative to the calibrated 47.268cm assault arms. HumanSoldier calls the
// carry after every posture/action layer, so this is the authoritative frame.
function shoulderAnchor(body, rig, out) {
  if (!rig.lArm || !rig.rArm || !rig.lFore || !rig.rFore || !rig.lHand || !rig.rHand) {
    out.copy(SHOULDER_REF);
    return 1;
  }
  body.updateMatrixWorld(true);
  const lShoulder = worldPosition(rig.lArm, V[19]);
  const lElbow = worldPosition(rig.lFore, V[20]);
  const lHand = worldPosition(rig.lHand, V[21]);
  const rShoulder = worldPosition(rig.rArm, V[22]);
  const rElbow = worldPosition(rig.rFore, V[23]);
  const rHand = worldPosition(rig.rHand, V[24]);
  out.addVectors(lShoulder, rShoulder).multiplyScalar(0.5);
  body.worldToLocal(out);
  const reach = (
    lShoulder.distanceTo(lElbow) + lElbow.distanceTo(lHand)
    + rShoulder.distanceTo(rElbow) + rElbow.distanceTo(rHand)
  ) * 0.5;
  return Number.isFinite(reach) && reach > 1e-5 ? reach / BASE_ARM_REACH : 1;
}

function armReach(arm, forearm, hand) {
  if (!arm || !forearm || !hand) return 0;
  const shoulder = worldPosition(arm, V[26]);
  const elbow = worldPosition(forearm, V[27]);
  const wrist = worldPosition(hand, V[28]);
  return shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
}

function keepTriggerGripReachable(body, weapon, shoulderBone, reach, localTarget = humanHandContacts(weapon).trigger) {
  if (!shoulderBone || reach <= 1e-5) return;
  body.updateMatrixWorld(true);
  const target = V[26].copy(localTarget).applyMatrix4(weapon.matrixWorld);
  const shoulder = worldPosition(shoulderBone, V[27]);
  const towardShoulder = V[28].subVectors(shoulder, target);
  const distance = towardShoulder.length();
  const limit = reach * 0.97;
  if (distance <= limit || distance < 1e-6) return;
  towardShoulder.multiplyScalar((distance - limit) / distance);
  body.getWorldQuaternion(Q[6]).invert();
  towardShoulder.applyQuaternion(Q[6]);
  body.getWorldScale(V[29]);
  weapon.position.add(V[30].set(
    towardShoulder.x / Math.max(1e-6, V[29].x),
    towardShoulder.y / Math.max(1e-6, V[29].y),
    towardShoulder.z / Math.max(1e-6, V[29].z),
  ));
  return true;
}

// Rotate a bone in world space so its child segment follows `desiredDirection`,
// then convert the result back into the bone's parent-local quaternion.
function pointBoneAt(bone, child, desiredDirection) {
  if (!bone || !child || !bone.parent) return;
  const from = worldPosition(bone, V[0]);
  const to = worldPosition(child, V[1]);
  const currentDirection = V[2].subVectors(to, from);
  if (currentDirection.lengthSq() < 1e-10 || desiredDirection.lengthSq() < 1e-10) return;
  currentDirection.normalize();
  desiredDirection.normalize();

  bone.getWorldQuaternion(Q[0]);
  Q[1].setFromUnitVectors(currentDirection, desiredDirection);
  Q[2].copy(Q[1]).multiply(Q[0]);
  bone.parent.getWorldQuaternion(Q[3]).invert();
  bone.quaternion.copy(Q[3].multiply(Q[2]));
}

// Generic two-bone solve against the actual Mixamo segment lengths and current
// clip pose. Unlike hard-coded Euler offsets, this survives every locomotion
// frame and keeps both palms on the weapon.
function solveArm(body, arm, forearm, hand, targetWorld, side) {
  if (!arm || !forearm || !hand) return;
  // Only this limb changes during IK. Updating the whole character here also
  // traverses the other arm, legs, armor and weapon three times per arm/frame.
  arm.updateWorldMatrix(true, true);
  const shoulder = worldPosition(arm, V[3]);
  const elbowNow = worldPosition(forearm, V[4]);
  const handNow = worldPosition(hand, V[5]);
  const upper = shoulder.distanceTo(elbowNow);
  const lower = elbowNow.distanceTo(handNow);
  const toTarget = V[6].subVectors(targetWorld, shoulder);
  let distance = toTarget.length();
  if (upper < 1e-5 || lower < 1e-5 || distance < 1e-5) return;
  distance = Math.min(distance, (upper + lower) * 0.995);
  const direction = toTarget.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const centre = V[7].copy(direction).multiplyScalar(along).add(shoulder);

  // Elbows prefer down and away from the ribs. Build that pole in body-local
  // coordinates, transform it into world space, and remove its component along
  // the shoulder→hand line.
  // Soldier low-ready keeps both elbows below the shoulder line and close to
  // the ribs. The old wide pole produced a conspicuous chicken-wing firing arm
  // even though the wrists were numerically attached to the gun.
  const pole = V[8].set(side * 0.45, -1.00, 0.12).transformDirection(body.matrixWorld);
  pole.addScaledVector(direction, -pole.dot(direction));
  if (pole.lengthSq() < 1e-8) pole.set(side, -0.5, 0);
  pole.normalize();
  const elbowTarget = V[9].copy(centre).addScaledVector(pole, height);

  pointBoneAt(arm, forearm, V[10].subVectors(elbowTarget, shoulder));
  arm.updateWorldMatrix(true, true);
  const elbow = worldPosition(forearm, V[11]);
  pointBoneAt(forearm, hand, V[12].subVectors(targetWorld, elbow));
  forearm.updateWorldMatrix(true, true);
}

/**
 * Place a rifle in body space, then solve the real Mixamo arms onto its grip.
 * The weapon is the source of truth, so recoil/reload/swap cannot detach hands.
 */
export function applyHumanRifleCarry(body, rig, weapon, state = {}) {
  if (!body || !weapon || !rig) return;
  const aim = THREE.MathUtils.clamp(state.aim || 0, 0, 1);
  const reload = THREE.MathUtils.clamp(state.reload || 0, 0, 1);
  const swap = THREE.MathUtils.clamp(state.swap || 0, 0, 1);
  const sprint = THREE.MathUtils.clamp(
    Math.max(state.sprint || 0, state.run || 0), 0, 1,
  );
  const move = THREE.MathUtils.clamp(state.move || 0, 0, 1);
  const scoped = THREE.MathUtils.clamp(state.scoped || 0, 0, 1);
  const firing = THREE.MathUtils.clamp(state.firing || 0, 0, 1);
  const combat = Math.max(scoped, firing);
  const sprintCarry = sprint * (1 - combat);
  const movingFire = move * firing * (1 - scoped);
  const recoil = Math.max(0, state.recoil || 0);
  const reloadBell = reload > 0 ? Math.sin(Math.PI * reload) : 0;
  const swapBell = swap > 0 ? Math.sin(Math.PI * swap) : 0;
  const rack = reload > 0 ? Math.exp(-Math.pow((reload - 0.70) / 0.055, 2)) : 0;
  const carry = humanCarryPose(weapon);
  const authoredKyx = !!body.getObjectByName?.('KYX_HelmetShell');
  weapon.userData.humanCarryFamily = carry.family;

  const anchor = V[18];
  const rigScale = shoulderAnchor(body, rig, anchor);
  const geometryClearance = weaponGeometryClearance(weapon);
  weapon.position.copy(anchor).add(
    V[25].lerpVectors(carry.patrolOffset, carry.aimOffset, aim).multiplyScalar(rigScale)
  );
  const scaleClearance = Math.max(0, Math.abs(weapon.scale.z || 1) - 0.65)
    * REFERENCE_STOCK_BACK;
  weapon.position.z -= carry.forward + scaleClearance + geometryClearance.forward;
  weapon.position.z -= 0.075 * Math.sin(Math.PI * aim) * rigScale;
  weapon.quaternion.slerpQuaternions(carry.patrolQ, carry.aimQ, aim);
  if (carry.family !== 'pistol') {
    // Toe the fore-end inward while retaining the stock outside the shoulder.
    // The aim pose straightens most of this cross-chest carry.
    Q[4].setFromAxisAngle(V[13].set(0, 1, 0), 0.40 * (1 - aim * 0.75));
    weapon.quaternion.premultiply(Q[4]);
  }

  // Same common-mode vertical follow as the procedural third-person rig:
  // looking pitch moves the shouldered weapon and both IK arms as one unit.
  const lookPitch = aim * THREE.MathUtils.clamp(state.pitch || 0, -0.95, 0.95) * 0.62;
  // PATROL is already a genuine low-ready. Dynamic actions only need a small
  // additional tuck; retaining the old high-ready correction here doubled the
  // drop, overextended the support arm on long rifles, and hid the gun against
  // the thighs during sprint/swap.
  const compactAction = carry.family === 'pistol' || carry.family === 'launcher';
  const carrySway = (state.sway || 0)
    * (1 - 0.78 * movingFire) * (1 - 0.92 * scoped);
  const carryPitch = lookPitch + carrySway
    - sprintCarry * (compactAction ? 0.08 : 0.12)
    - reloadBell * (compactAction ? 0.12 : 0.22)
    - swapBell * (compactAction ? 0.22 : 0.30)
    - recoil * 0.10 - rack * 0.08;
  weapon.position.y += (movingFire * 0.014 + scoped * 0.025) * rigScale;
  weapon.position.z -= (movingFire * 0.010 + scoped * 0.018) * rigScale;
  if (reloadBell || swapBell) {
    // Roll the magazine toward the support shoulder. The opposite sign presents
    // it body-right and puts the target beyond the real Mixamo arm's reach.
    Q[4].setFromEuler(E.set(
      reloadBell * 0.30 - swapBell * 0.68,
      0,
      -reloadBell * 0.84 + swapBell * 0.28
    ));
    weapon.quaternion.multiply(Q[4]);
    weapon.position.y -= (reloadBell * 0.13 + swapBell * 0.25) * rigScale;
    // Keep long KYX weapons beside the anatomical chest during the magazine
    // seat; the legacy rig needed a deeper inward sweep because its torso and
    // shoulder spacing were different.
    weapon.position.x -= reloadBell * (authoredKyx ? 0.025 : 0.05) * rigScale;
  }
  if (rack) weapon.position.z += rack * 0.045 * rigScale;
  if (recoil) weapon.position.z += recoil * 0.035 * rigScale;
  if (carryPitch) {
    Q[5].setFromAxisAngle(V[13].set(1, 0, 0), carryPitch);
    const dy = weapon.position.y - anchor.y;
    const dz = weapon.position.z - anchor.z;
    const cs = Math.cos(carryPitch), sn = Math.sin(carryPitch);
    weapon.position.y = anchor.y + dy * cs - dz * sn;
    weapon.position.z = anchor.z + dy * sn + dz * cs;
    weapon.quaternion.premultiply(Q[5]);
  }

  // Static aim/low-ready already place the trigger grip within reach. Dynamic
  // run/reload layers can add several centimetres; recover only that excess
  // before smoothing instead of letting the arm stop short of the pistol grip.
  keepTriggerGripReachable(
    body,
    weapon,
    rig.rArm,
    armReach(rig.rArm, rig.rFore, rig.rHand),
  );

  // Smooth the one authoritative rifle transform before solving either arm.
  // The hands are then IK'd to the exact displayed pose, so animation clips,
  // network snapshots and aim/reload edges cannot make them swim off the gun.
  // A missing/large dt is a deliberate snap for deterministic probes, spawns
  // and teleports.
  const dt = state.dt || 0;
  const smoothing = weapon.userData.humanRifleCarrySmoothing ||= {
    initialized: false,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
  if (!smoothing.initialized || !(dt > 0) || dt > 0.2) {
    smoothing.position.copy(weapon.position);
    smoothing.quaternion.copy(weapon.quaternion);
    smoothing.initialized = true;
  } else {
    smoothing.position.lerp(weapon.position, 1 - Math.exp(-24 * dt));
    smoothing.quaternion.slerp(weapon.quaternion, 1 - Math.exp(-30 * dt)).normalize();
    weapon.position.copy(smoothing.position);
    weapon.quaternion.copy(smoothing.quaternion);
  }

  const contacts = humanHandContacts(weapon);
  const supportLocal = V[15].copy(contacts.support);
  if (reload > 0) {
    const inT = smoothstep(reload / 0.28);
    const outT = smoothstep((reload - 0.74) / 0.26);
    supportLocal.lerp(contacts.reload, inT * (1 - outT));
  }
  if (!(state.throwP > 0)) {
    // Keep the gun between both hands. Pulling an unreachable support target
    // toward the shoulder leaves that hand floating beside the receiver.
    const rightReach = armReach(rig.rArm, rig.rFore, rig.rHand);
    const leftReach = armReach(rig.lArm, rig.lFore, rig.lHand);
    for (let pass = 0; pass < 8; pass++) {
      const leftMoved = keepTriggerGripReachable(body, weapon, rig.lArm, leftReach, supportLocal);
      const rightMoved = keepTriggerGripReachable(body, weapon, rig.rArm, rightReach);
      if (!leftMoved && !rightMoved) break;
    }
  }
  (weapon.userData.humanSupportLocal ||= new THREE.Vector3()).copy(supportLocal);
  body.updateMatrixWorld(true);
  const gripWorld = V[14].copy(contacts.trigger).applyMatrix4(weapon.matrixWorld);
  solveArm(body, rig.rArm, rig.rFore, rig.rHand, gripWorld, 1);

  // During a reload the support hand moves decisively to the magazine, seats
  // it, then returns. A grenade throw owns that arm instead of the handguard.
  if (!(state.throwP > 0)) {
    body.updateMatrixWorld(true);
    const supportWorld = V[16].copy(supportLocal).applyMatrix4(weapon.matrixWorld);
    solveArm(body, rig.lArm, rig.lFore, rig.lHand, supportWorld, -1);
  }
}

export function humanRifleGripError(rig, weapon) {
  if (!rig || !weapon) return { right: Infinity, left: Infinity };
  const grip = V[14].copy(humanHandContacts(weapon).trigger).applyMatrix4(weapon.matrixWorld);
  const support = V[15].copy(
    weapon.userData.humanSupportLocal || humanHandContacts(weapon).support
  ).applyMatrix4(weapon.matrixWorld);
  return {
    right: rig.rHand ? worldPosition(rig.rHand, V[16]).distanceTo(grip) : Infinity,
    left: rig.lHand ? worldPosition(rig.lHand, V[17]).distanceTo(support) : Infinity,
  };
}
