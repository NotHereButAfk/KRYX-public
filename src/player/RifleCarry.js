import * as THREE from 'three';
import { applyThrowArm } from './Actions.js';
// The figure the IK runs against. From Proportions.js, not a private copy —
// this file used to hold its own, which is fine right up until it changes.
import { SHOULDER_Y, SHOULDER_X, UP_ARM, FOREARM } from './Proportions.js';
import { weaponHandPose } from '../weapons/WeaponHandPoses.js';

const REACH = (UP_ARM + FOREARM) * 0.995;

// ═══════════════════════════════════════════════════════════════════════════
// Rifle carry — how a soldier actually holds the gun.
//
// Two hand-solved poses, blended by an `aim` weight (0 = relaxed, 1 = engaged):
//
//   PATROL  soldier's relaxed ready: buttstock retained at the right shoulder,
//           rifle diagonal across the chest, muzzle safely lowered, firing
//           hand at the pistol grip and support palm under the fore-end.
//   AIM     shouldered and level: stock in the shoulder, barrel straight down
//           the body's forward axis, support arm extended along the handguard.
//           What a bot/player snaps to the instant it engages.
//
// Both were solved with 2-bone IK against the low-poly rig (shoulder pivots at
// y=1.76 ±0.27, elbows at y=1.28, hands at y=0.895) so the right hand lands
// exactly on the pistol grip and the left hand on the handguard — the hands sit
// ON the weapon in both poses instead of near it.
//
// Body-local space: front = −Z, the model's right = +X, up = +Y. The weapon's
// muzzle is its own local −Z.
// ═══════════════════════════════════════════════════════════════════════════

// Grip points in weapon-local space (used by the solver; kept here as the
// contract the poses below were fitted to).
export const GRIP_LOCAL      = new THREE.Vector3(0, -0.12,  0.10);
// Mid-handguard, not the unreachable muzzle-side rail. On the correctly sized
// 1.82m chassis the old -0.28 target forced slideToReach() to pull the wrist
// 27cm back toward the magazine, which made the support hand look detached
// from the authored target. This point stays forward of the receiver and is
// reachable through the full carry/action sweep.
// The wrist belongs on the shooter-facing side of the handguard, not through
// its centreline.  That distinction matters once the complete gun is kept
// clear of the torso: a centreline target on an outboard rifle puts the
// support shoulder just beyond its reach, while the near-side surface is both
// reachable and where a real palm actually wraps the weapon.
export const HANDGUARD_LOCAL = new THREE.Vector3(-0.07, -0.02, -0.16);
// Where the support hand goes during a reload: under the receiver, on the
// magazine well, a little behind the handguard it just left.

// Both were additionally swept against the body's own collision volumes so the
// rifle rides clear of the chest instead of sinking into it — pose-lab.html
// ?sweep=patrol|aim reports the deepest penetration for a candidate, and these
// two measure ZERO against the torso/pelvis/head.
// The two carries were hand-solved against the previous, much larger figure
// (shoulders at 1.76, an 0.865m arm). Their ROTATIONS are scale-free and stand;
// their positions are carried onto the new arm by scaling about the shoulder
// line — the same place the carry's own swing pivots about — so the rifle sits
// at the same point on the chest relative to the arm holding it.
//
// Gun size is not derived from the body: a rifle is about 0.9m whoever is
// holding it. A few procedural assets were authored at first-person showcase
// size, however, so fitWeaponToWorldSize() corrects those to one fixed physical
// envelope before this body-independent carry solve runs.
const ARM_SCALE = (UP_ARM + FOREARM) / (0.48 + 0.385);
const onArm = (x, y, z) => new THREE.Vector3(
  x * ARM_SCALE, SHOULDER_Y + (y - 1.76) * ARM_SCALE, z * ARM_SCALE);
const PATROL = {
  // Keep the receiver in the right shoulder pocket, not behind the sternum.
  // The old x=0.175 was only 12.3cm from the centreline on the current figure,
  // well inside its 20.9cm shoulder joint. From the gameplay camera the body
  // swallowed the whole rifle. This lands 6.5cm outboard of the shoulder while
  // the grip itself remains close to the trigger-side hand.
  wp: onArm(0.390, 1.500, -0.270),
  // Diagonal low-ready from the supplied soldier reference: the muzzle points
  // down and slightly across the body while the stock stays retained near the
  // shoulder. The hands remain model-specific and are IK-solved below.
  wr: new THREE.Euler(-0.620, 0.240, 0.100),
};
const AIM = {
  wp: onArm(0.390, 1.600, -0.230),
  wr: new THREE.Euler(-0.020, 0, 0),
};
// A soldier does not carry every firearm on the same line. Compact weapons
// stay tighter to the ribs, shotguns and precision rifles retain a longer
// shoulder pocket, support weapons sit a touch wider, and launchers ride high
// enough for the tube/sights to clear the pauldron. The same IK solver still
// lands both wrists on each weapon's authored grip points.
const COMPACT_PATROL = {
  wp: onArm(0.350, 1.520, -0.315),
  wr: new THREE.Euler(-0.500, 0.200, 0.080),
};
const COMPACT_AIM = {
  wp: onArm(0.350, 1.590, -0.280),
  wr: new THREE.Euler(-0.020, 0, 0),
};
const SHOTGUN_PATROL = {
  wp: onArm(0.405, 1.500, -0.275),
  wr: new THREE.Euler(-0.600, 0.220, 0.080),
};
const SHOTGUN_AIM = {
  wp: onArm(0.400, 1.600, -0.235),
  wr: new THREE.Euler(-0.020, 0, 0),
};
const SUPPORT_PATROL = {
  wp: onArm(0.425, 1.515, -0.285),
  wr: new THREE.Euler(-0.480, 0.160, 0.060),
};
const SUPPORT_AIM = {
  wp: onArm(0.390, 1.600, -0.230),
  wr: new THREE.Euler(-0.020, 0, 0),
};
const PRECISION_PATROL = {
  wp: onArm(0.405, 1.510, -0.285),
  wr: new THREE.Euler(-0.580, 0.180, 0.080),
};
const PRECISION_AIM = {
  wp: onArm(0.390, 1.600, -0.230),
  wr: new THREE.Euler(-0.020, 0, 0),
};
// Pistols do not have a stock to pin to the firing shoulder. A soldier brings
// both hands toward the centreline and extends the weapon in front of the
// chest, while the patrol pose retracts it into a compact low-ready position.
const PISTOL_PATROL = {
  wp: onArm(0.220, 1.545, -0.500),
  wr: new THREE.Euler(-0.340, 0.100, 0.060),
};
const PISTOL_AIM = {
  wp: onArm(0.075, 1.585, -0.690),
  wr: new THREE.Euler(-0.015, 0, 0),
};
const LAUNCHER_PATROL = {
  wp: onArm(0.425, 1.590, -0.255),
  wr: new THREE.Euler(-0.300, 0.120, 0.040),
};
const LAUNCHER_AIM = {
  wp: onArm(0.390, 1.600, -0.230),
  wr: new THREE.Euler(-0.020, 0, 0),
};
// Clearance belongs to the complete 1.14m rifle mesh, not just the receiver
// origin above. These two offsets seat the rear of the stock on the visible
// shoulder surface and keep the receiver in front of the chest.
const BASE_OUTBOARD = 0.032;
// The weapon origin is at the receiver, while a real M4 continues roughly
// 44.5cm back to its buttpad.  The previous 12cm nudge only cleared the
// receiver: the stock still ended behind the shoulder centre, so from the side
// and three-quarter views it visibly disappeared into the player model.  Seat
// the buttpad on the FRONT of the shoulder pocket instead.  Longer stocks add
// their measured excess in weaponClearance(), so this remains one shared rule
// for the full arsenal rather than another per-gun offset table.
const BODY_FORWARD_CLEARANCE = 0.330;
const REFERENCE_STOCK_BACK = 0.445;
const REFERENCE_HALF_WIDTH = 0.052;
// Fixed world-size target for procedural meshes whose authored showcase size
// is longer than a person can shoulder. This is independent of character
// stature: it corrects the weapon asset once instead of scaling guns to bodies.
const WORLD_STOCK_BACK = 0.380;
// Procedural guns were originally authored as menu/showcase pieces, so stock
// length alone is not enough to normalize them: stockless pistols/SMGs and
// tall sci-fi receivers can remain enormous even when max.z looks harmless.
// These are complete real-world envelopes in metres. Scaling is uniform so
// barrels, grips and sights keep their authored proportions.
const WORLD_LENGTH_BY_ID = Object.freeze({
  sidearm: 0.30, magnum: 0.34,
  uzi: 0.48, needler: 0.54, plasmarifle: 0.65,
  levershotgun: 0.90, energyshotgun: 0.88,
  m4: 0.90, m16: 1.07, rifle: 0.88,
  lmg: 0.98,
  boltsniper: 1.02, battlerifle: 0.98, dmr: 0.98,
  rpg: 1.00, fuelrod: 0.82, concussion: 0.78,
});
const WORLD_HEIGHT_BY_CARRY = Object.freeze({
  pistol: 0.25, compact: 0.28, shotgun: 0.30, rifle: 0.34,
  support: 0.36, precision: 0.36, launcher: 0.30,
});

// Each gun shares the same grip coordinate system, but its authored stock and
// receiver have different dimensions. Measure those dimensions once from the
// real mesh so long/thick guns receive the additional clearance they need.
// This avoids another table of values that silently becomes stale when a model
// changes. Empty test stand-ins intentionally get the M4 reference dimensions.
const _bounds = new THREE.Box3();
const _partBounds = new THREE.Box3();
const _invWeapon = new THREE.Matrix4();
const _partToWeapon = new THREE.Matrix4();
function measureWeaponBounds(weapon) {
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
  return _bounds;
}

// Correct only oversized authored assets to a fixed physical stock envelope.
// This is deliberately not proportional to the player model: every chassis
// and every network peer sees the same world-size firearm.
function fitWeaponToWorldSize(weapon) {
  if (!weapon?.userData || weapon.userData.rifleWorldScaleApplied) return;
  const measured = measureWeaponBounds(weapon);
  const stockBack = measured.isEmpty() ? REFERENCE_STOCK_BACK : Math.max(0.001, measured.max.z);
  const size = measured.getSize(new THREE.Vector3());
  const handPose = weaponHandPose(weapon);
  const targetLength = WORLD_LENGTH_BY_ID[weapon.userData.weaponId];
  const targetHeight = WORLD_HEIGHT_BY_CARRY[handPose.carry];
  const stockScale = WORLD_STOCK_BACK / stockBack;
  const lengthScale = targetLength && size.z > 0.001 ? targetLength / size.z : 1;
  const heightScale = targetHeight && size.y > 0.001 ? targetHeight / size.y : 1;
  const scale = THREE.MathUtils.clamp(
    Math.min(stockScale, lengthScale, heightScale, 1), 0.45, 1,
  );
  weapon.scale.multiplyScalar(scale);
  weapon.userData.rifleWorldScale = scale;
  weapon.userData.rifleWorldScaleApplied = true;
  weapon.updateMatrix();
  weapon.updateMatrixWorld(true);
}

function weaponClearance(weapon) {
  if (!weapon) return { forward: 0, outboard: 0 };
  // Lightweight action/unit probes pass a transform-only stand-in. They have
  // no mesh to measure and intentionally use the reference dimensions.
  if (!weapon.userData || typeof weapon.traverse !== 'function'
      || typeof weapon.updateWorldMatrix !== 'function')
    return { forward: 0, outboard: 0 };
  fitWeaponToWorldSize(weapon);
  if (weapon.userData.rifleCarryClearance) return weapon.userData.rifleCarryClearance;
  const measured = measureWeaponBounds(weapon);
  const scaleX = Math.abs(weapon.scale.x || 1);
  const scaleZ = Math.abs(weapon.scale.z || 1);
  const back = measured.isEmpty() ? REFERENCE_STOCK_BACK : measured.max.z * scaleZ;
  const halfWidth = measured.isEmpty() ? REFERENCE_HALF_WIDTH
    : Math.max(Math.abs(measured.min.x), Math.abs(measured.max.x)) * scaleX;
  const result = {
    forward: Math.max(0, back - REFERENCE_STOCK_BACK),
    // Preserve the same body-facing inner edge as the reference rifle.  Half
    // compensation still let broad launcher receivers consume the shoulder.
    outboard: Math.max(0, halfWidth - REFERENCE_HALF_WIDTH),
  };
  weapon.userData.rifleCarryClearance = result;
  return result;
}

// ── where the gun POINTS ─────────────────────────────────────────────────────
// The AIM pose carries 0.020 rad of its own muzzle droop. `aimPitch` is given
// against the true horizon — the angle the shot actually leaves at — so that
// droop has to be cancelled or every body in the game aims 1.15° under its own
// bullets. Callers pass the look/shot pitch and nothing else: the conversion
// lives here so the local body, the network avatars and the bots cannot drift
// apart, which is exactly what happened when each owned its own constant (bots
// held the rifle dead level at every angle; the other two showed 62% of the
// real pitch and were up to 24° out).
const AIM_BASE_PITCH = -0.020;
// Bound on the pose, matched to the player's own look clamp (Player.js stops
// at PI/2 - 0.05) so nothing inside the reachable range is ever cut short. It
// can safely be this wide: measured across the full sweep, both hands stay on
// the gun to 0.00 cm and the rifle never crosses the torso, because the
// shouldered carry already rides outboard of it on the right shoulder. The
// 0.95 rad ceiling this replaces was not protecting against anything.
export const AIM_PITCH_LIMIT = Math.PI / 2 - 0.05;   // ~87.1°, Player.js's own clamp

// Elbow swivel about the shoulder→hand axis: where the elbow sits on the cone
// of valid solutions. Tuned to drop the trigger elbow down/back against the
// ribs and swing the support elbow out under the handguard.
const SWIVEL_R = -0.82, SWIVEL_L = 0.70;

const carryProfile = (patrol, aim) => ({
  patrol,
  aim,
  qPatrol: new THREE.Quaternion().setFromEuler(patrol.wr),
  qAim: new THREE.Quaternion().setFromEuler(aim.wr),
});
const ROCKET_SHOULDER_PROFILE = carryProfile(
  { wp: onArm(.360, 1.92, -.255), wr: new THREE.Euler(-.025, .025, .015) },
  { wp: onArm(.360, 1.92, -.230), wr: new THREE.Euler(-.020, 0, 0) },
);
const CARRY_PROFILES = {
  rifle: carryProfile(PATROL, AIM),
  compact: carryProfile(COMPACT_PATROL, COMPACT_AIM),
  shotgun: carryProfile(SHOTGUN_PATROL, SHOTGUN_AIM),
  support: carryProfile(SUPPORT_PATROL, SUPPORT_AIM),
  precision: carryProfile(PRECISION_PATROL, PRECISION_AIM),
  pistol: carryProfile(PISTOL_PATROL, PISTOL_AIM),
  launcher: carryProfile(LAUNCHER_PATROL, LAUNCHER_AIM),
};
const _q       = new THREE.Quaternion();
const _qSwing  = new THREE.Quaternion();
const _qArm    = new THREE.Quaternion();
const _qAct    = new THREE.Quaternion();
const _eAct    = new THREE.Euler();
const _pos     = new THREE.Vector3();
const _T       = new THREE.Vector3();
const _gripLocal = new THREE.Vector3();
const _supportLocal = new THREE.Vector3();
const _reloadLocal = new THREE.Vector3();
const _supportStow = new THREE.Vector3(-0.10, 1.24, -0.24);
const _d       = new THREE.Vector3();
const _h       = new THREE.Vector3();
const _AX_X    = new THREE.Vector3(1, 0, 0);

// Two-bone IK onto a hand target. The elbow is a hinge on the limb's local X,
// the shoulder is a free rotation, and `swivel` picks a point on the cone of
// otherwise-equivalent elbow placements.
function solveArm(shoulder, elbow, sx, T, swivel) {
  if (!shoulder || !elbow) return;
  _d.set(T.x - sx, T.y - SHOULDER_Y, T.z);
  const D = Math.min(_d.length(), REACH);
  if (D < 1e-5) return;
  _d.normalize();
  const c = Math.max(-1, Math.min(1,
    (D * D - UP_ARM * UP_ARM - FOREARM * FOREARM) / (2 * UP_ARM * FOREARM)));
  const bend = Math.acos(c);                       // + folds the forearm forward
  // Where the hand sits in shoulder-local space for that bend, before the
  // shoulder rotates: straight down the limb axis, swung forward by the elbow.
  _h.set(0, -UP_ARM - FOREARM * Math.cos(bend), -FOREARM * Math.sin(bend)).normalize();
  _qArm.setFromUnitVectors(_h, _d);
  if (swivel) _qArm.premultiply(_qSwing.setFromAxisAngle(_d, swivel));
  shoulder.quaternion.copy(_qArm);
  elbow.rotation.set(bend, 0, 0);
}

function scaledWeaponLocal(out, local, weapon) {
  out.copy(local);
  if (weapon?.scale) out.multiply(weapon.scale);
  return out;
}

// A long handguard can sit past the support arm's reach and leave the hand
// hovering off its front end.
//
// A real shooter answers this by gripping FURTHER BACK, so that is what happens
// here: the support target slides along the weapon's own axis, toward the stock,
// until it is inside the arm's reach. The hand stays on the handguard — just at
// the part of it the arm can actually hold. Automatic, and right for every gun
// in the arsenal rather than tuned for one.
const _axis = new THREE.Vector3();
function slideToReach(T, sx) {
  _d.set(T.x - sx, T.y - SHOULDER_Y, T.z);
  const D2 = _d.lengthSq(), R = REACH * 0.97;
  if (D2 <= R * R) return;
  _axis.set(0, 0, 1).applyQuaternion(_q);          // weapon's own +Z, toward the stock
  const b = _d.dot(_axis);
  const disc = b * b - D2 + R * R;
  if (disc < 0) return;                            // unreachable at any grip point
  // NEAREST intersection, not the far one. Both roots are positive here (the
  // axis points away from the shoulder), and taking the larger slides the hand
  // straight past the weapon and out the other side — 88cm off the gun.
  const s0 = -b - Math.sqrt(disc);
  T.addScaledVector(_axis, s0 > 0 ? s0 : -b + Math.sqrt(disc));
}

/**
 * Place the rifle, then solve both arms onto it.
 *
 * The weapon transform is the single source of truth: it is interpolated
 * between the two carries and then the hands are IK'd onto the grip and the
 * handguard every frame. That means the hands are exactly on the gun at any
 * blend value, any stride phase, any recoil state — there is no pose pair to
 * drift apart, which is what happens if you interpolate arms and weapon
 * separately along their own paths.
 *
 * `swing` is the life in the pose — breathing at rest, the rifle riding the
 * stride while moving. It rotates the rifle about the shoulder line, and the
 * arms simply follow it.
 *
 * @param {object} rig     { armL, armR, elbowL, elbowR } limb pivots
 * @param {THREE.Object3D} weapon  the weapon model parented to the body (or null)
 * @param {number} aim     0 = patrol carry, 1 = shouldered and aiming
 * @param {number} dt      frame delta (seconds) — unused, kept for callers
 * @param {object} [o]     { aimPitch, swing, kick, reload, swap, flinch, throwP,
 *                           move, run, firing, scoped, smooth }
 *   `aimPitch` is where this body is SHOOTING, in radians against the horizon
 *   (positive up) — pass the look pitch, or for a bot the elevation of the ray
 *   it actually fires. Shouldered, the muzzle comes out on exactly that angle.
 *   Do not pre-scale it; the shoulder blend, the body's own lean (`bodyPitch`,
 *   pass whatever you set on the body's rotation.x) and the pose's droop are
 *   all handled here.
 *   reload/swap/flinch/throwP are 0→1 action progresses. They move the WEAPON
 *   (and, for a reload, the support hand's target on it) — never the arms
 *   directly, because the arms are IK'd onto wherever the weapon ends up and
 *   posing them here as well would just fight that solve.
 */
export function applyRifleCarry(rig, weapon, aim, dt, o = {}) {
  fitWeaponToWorldSize(weapon);
  const handPose = weaponHandPose(weapon);
  const carryFamily = CARRY_PROFILES[handPose.carry] ? handPose.carry : 'rifle';
  const profile = weapon?.userData?.weaponId === 'rpg' ? ROCKET_SHOULDER_PROFILE : CARRY_PROFILES[carryFamily];
  const pistolCarry = carryFamily === 'pistol';
  const a    = Math.max(0, Math.min(1, aim));
  // Locomotion/combat poses are blended as independent weights instead of
  // swapping meshes. This preserves one authoritative weapon transform and
  // lets the arm IK keep both palms attached throughout every transition.
  const move = THREE.MathUtils.clamp(o.move || 0, 0, 1);
  const scoped = THREE.MathUtils.clamp(o.scoped || 0, 0, 1);
  const firing = THREE.MathUtils.clamp(o.firing || 0, 0, 1);
  const combat = Math.max(scoped, firing);
  const sprint = THREE.MathUtils.clamp(o.run || 0, 0, 1) * (1 - combat);
  const movingFire = move * firing * (1 - scoped);
  const walk = move * (1 - sprint) * (1 - combat);
  const kick = o.kick || 0;
  const reload = o.reload || 0, swap = o.swap || 0, flinch = o.flinch || 0;
  // 0 → 1 → 0 shapes for the actions that go somewhere and come back.
  const reloadB = reload > 0 ? Math.sin(Math.PI * reload) : 0;
  const swapB   = swap   > 0 ? Math.sin(Math.PI * swap)   : 0;
  // A hit is sharp on and slow off, not symmetric.
  const flinchB = flinch > 0
    ? (flinch < 0.15 ? flinch / 0.15 : Math.pow(1 - (flinch - 0.15) / 0.85, 2)) : 0;
  // Working the bolt, a third of the way through the reload.
  const rack = reload > 0 ? Math.exp(-Math.pow((reload - 0.62) / 0.06, 2)) : 0;

  // Where the shot is going. Scaled by the shoulder blend, because a patrol
  // carry is not aimed at anything — at a = 1 the muzzle lands exactly on
  // `aimPitch`, and it fades out as the rifle comes down off the shoulder.
  // `bodyPitch` comes back out because the weapon hangs off the body and
  // inherits its run lean; without that the muzzle sits up to 9° off at a
  // sprinting lean while the shot still leaves along the camera.
  const aimPitch = Math.max(-AIM_PITCH_LIMIT,
    Math.min(AIM_PITCH_LIMIT, (o.aimPitch || 0) - (o.bodyPitch || 0)));

  // Everything that moves the rifle without changing the grip rides this one
  // common-mode shoulder pitch: the aim itself, idle breathing / stride, recoil,
  // and a lift through the middle of the patrol→aim blend (a straight
  // interpolation drags the buttstock through the right pec on the way across).
  // Walking lets the low-ready rifle ride lightly with the stride. Sprinting
  // tucks it down and inward. Shooting on the move and scoped movement keep
  // the upper body stabilized, leaving only a small amount of gait motion.
  const gaitSwing = (o.swing || 0)
    * (1 - 0.78 * movingFire)
    * (1 - 0.92 * scoped);
  const swing = (aimPitch - AIM_BASE_PITCH) * a
    + gaitSwing
    - kick * 0.10 + 0.16 * Math.sin(Math.PI * a)
    // Muzzle drops while the hands are busy, and again when hit.
    - 0.34 * reloadB - 0.55 * swapB - 0.30 * flinchB - 0.10 * rack;

  _pos.lerpVectors(profile.patrol.wp, profile.aim.wp, a);
  if (weapon?.userData?.weaponId === 'rpg') _pos.z += .25 - .24 * reloadB - .22 * THREE.MathUtils.clamp(aimPitch / .65, 0, 1);
  // Bow the path forward through the middle of the blend so the buttstock
  // swings around the right pec rather than straight through it. Free to do
  // now that the hands are IK'd to wherever the rifle ends up.
  _pos.z -= 0.075 * Math.sin(Math.PI * a);
  _pos.z += kick * 0.03;                           // recoil shoves it back
  // Four readable silhouettes from the same correctly-sized weapon model:
  // low-ready walk, tucked sprint, braced moving fire, tight scoped shoulder.
  _pos.y -= walk * 0.012;
  _pos.z += sprint * (pistolCarry ? 0.025 : 0.040);
  _pos.y += movingFire * 0.016 + scoped * 0.030;
  _pos.z -= movingFire * 0.012 + scoped * 0.020;
  // Slerp (not euler-lerp) between the two carries — the patrol pose is a
  // large compound rotation and euler blending swings it through junk.
  _q.slerpQuaternions(profile.qPatrol, profile.qAim, a);

  // Reload rolls the receiver up toward the body so the mag well faces the
  // support hand; a swap drops the whole weapon out of frame and brings it
  // back. Both are rotations about the weapon's own axes, applied before the
  // shoulder swing so they read as the wrists working rather than the torso.
  if (reloadB || swapB) {
    // Roll the magazine well TOWARD the support hand during reload. The old
    // positive roll presented it to the body's right side, leaving the left
    // arm as much as 43 cm short even though the weapon itself looked clear.
    _qAct.setFromEuler(_eAct.set(0.30 * reloadB - 0.70 * swapB, 0,
                                -0.85 * reloadB + 0.30 * swapB));
    _q.multiply(_qAct);
    // The patrol pose already sits at lower-chest height. A deep second drop
    // during swap put long-gun fore-ends beyond the support arm's reach, so the
    // swap now folds the weapon inward and only dips it enough to read clearly.
    _pos.y -= 0.13 * reloadB + (pistolCarry ? 0.24 : 0.08) * swapB;
    _pos.x -= 0.05 * reloadB;
    // Once the muzzle is lowered there is room to bring the action back into
    // reach without returning the stock to its firing-height shoulder pocket.
    _pos.z += 0.08 * reloadB + 0.12 * swapB;
  }
  if (rack) _pos.z += 0.045 * rack;                // the bolt going back

  if (swing) {
    // Rigid rotation about the X axis through the shoulder line (y=SHOULDER_Y,
    // z=0), so the rifle pivots where the arms are anchored.
    _qSwing.setFromAxisAngle(_AX_X, swing);
    const dy = _pos.y - SHOULDER_Y, dz = _pos.z;
    const cs = Math.cos(swing), sn = Math.sin(swing);
    _pos.y = SHOULDER_Y + dy * cs - dz * sn;
    _pos.z = dy * sn + dz * cs;
    _q.premultiply(_qSwing);
  }

  // The transform origin sits near the receiver, but the production rifle
  // continues another 44.5 cm toward the stock. Clearing only that origin let
  // the butt and rear receiver live inside the shoulder even though every
  // origin/hand assertion passed. Seat the complete mesh on the FRONT surface
  // of the shoulder pocket. Both hands are solved after this offset, so they
  // move with the rifle instead of being left behind.
  const geometryClearance = weaponClearance(weapon);
  // Keep a visible shoulder pocket even while aiming uphill.  Letting this
  // reach zero pulled the wide launcher/sniper receivers back through the
  // deltoid at the top of the pitch sweep.
  const aimOutboard = a * (0.025 + 0.025
    * (1 - THREE.MathUtils.clamp(aimPitch / 0.65, 0, 1)));
  if (pistolCarry) {
    _pos.x += 0.018 + 0.030 * (1 - a) + 0.035 * swapB;
    _pos.z -= 0.075;
  } else {
    _pos.x += BASE_OUTBOARD + geometryClearance.outboard + aimOutboard + 0.055 * swapB;
    _pos.z -= BODY_FORWARD_CLEARANCE + geometryClearance.forward;
  }

  // Network snapshots, animation state edges and coarse frame pacing can move
  // the desired carry by several centimetres in one tick. Smooth the single
  // source-of-truth weapon pose first, then solve both arms against that exact
  // displayed pose below. Smoothing arms and gun independently would make the
  // hands visibly swim off the grip.
  if (weapon && o.smooth) {
    const state = weapon.userData.rifleCarrySmoothing ||= {
      initialized: false,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    };
    if (!state.initialized || !(dt > 0) || dt > 0.2) {
      state.position.copy(_pos);
      state.quaternion.copy(_q);
      state.initialized = true;
    } else {
      // A fast critically-damped-looking response: quick enough for gunplay,
      // continuous enough that aim/reload/swap edges do not pop the model.
      const positionAlpha = 1 - Math.exp(-22 * dt);
      const rotationAlpha = 1 - Math.exp(-26 * dt);
      state.position.lerp(_pos, positionAlpha);
      state.quaternion.slerp(_q, rotationAlpha).normalize();
    }
    _pos.copy(state.position);
    _q.copy(state.quaternion);
  }

  if (weapon) { weapon.position.copy(_pos); weapon.quaternion.copy(_q); }

  if (rig) {
    solveArm(rig.armR, rig.elbowR,  SHOULDER_X,
             scaledWeaponLocal(_T, _gripLocal.set(...handPose.trigger), weapon)
               .applyQuaternion(_q).add(_pos), pistolCarry ? -0.18 : SWIVEL_R);
    // The support hand leaves the handguard for the magazine and comes back.
    // Held at the mag through the middle of the reload rather than sliding
    // continuously, so it reads as two moves — strip, seat — not one smear.
    if (reload > 0) {
      // Follow the same smooth out-and-back envelope as the gun. The previous
      // amplified curve snapped fully to the magazine by 20% progress, before
      // the weapon had rolled far enough toward the support hand.
      const hold = Math.sin(Math.PI * Math.min(1, reload));
      _supportLocal.set(...handPose.support);
      if (!pistolCarry) {
        _supportLocal.x = HANDGUARD_LOCAL.x;
        _supportLocal.y = HANDGUARD_LOCAL.y;
      }
      // Long fore-ends are gripped at the rear handguard when the forward
      // authored point would lock the elbow. The palm remains on the rail.
      _supportLocal.z = Math.max(_supportLocal.z, -0.18);
      _T.copy(_supportLocal).lerp(_reloadLocal.set(...handPose.reload), hold);
    } else {
      _T.set(...handPose.support);
      if (!pistolCarry) {
        _T.x = HANDGUARD_LOCAL.x;
        _T.y = HANDGUARD_LOCAL.y;
      }
      _T.z = Math.max(_T.z, -0.18);
    }
    // Wider guns have been moved farther right to clear their complete mesh.
    // Offset the support grip by the same amount toward the shooter so the
    // palm stays on the near face instead of being dragged out of arm reach.
    const supportNearFace = pistolCarry ? 0
      : geometryClearance.outboard + (BASE_OUTBOARD - 0.020);
    _T.x -= supportNearFace / Math.max(0.001, Math.abs(weapon?.scale?.x || 1));
    if (weapon?.scale) _T.multiply(weapon.scale);
    _T.applyQuaternion(_q).add(_pos);
    if (swapB && !pistolCarry) {
      // A soldier does not keep the support palm glued to a disappearing
      // fore-end. Release it toward the vest while the firing hand controls the
      // weapon, then reacquire the handguard as the new gun rises.
      _T.lerp(_supportStow, swapB);
    } else {
      slideToReach(_T, -SHOULDER_X);
    }
    // Keep the exact displayed grip available to geometry probes and visual
    // diagnostics.  This is body-local, matching the skeletal rig.
    if (weapon?.userData)
      (weapon.userData.rifleSupportTarget ||= new THREE.Vector3()).copy(_T);
    solveArm(rig.armL, rig.elbowL, -SHOULDER_X, _T, pistolCarry ? -0.12 : SWIVEL_L);
    // A grenade goes in the off hand, overriding the support grip entirely —
    // it has to be applied last or the IK above would put the hand back.
    if (o.throwP) applyThrowArm(rig, o.throwP);
  }
}

/** The neutral (un-animated) transform, for attaching a freshly built weapon. */
export function restRifleTransform(weapon) {
  fitWeaponToWorldSize(weapon);
  const handPose = weaponHandPose(weapon);
  const carryFamily = CARRY_PROFILES[handPose.carry] ? handPose.carry : 'rifle';
  const profile = weapon?.userData?.weaponId === 'rpg' ? ROCKET_SHOULDER_PROFILE : CARRY_PROFILES[carryFamily];
  if (carryFamily === 'pistol') {
    weapon.position.copy(profile.patrol.wp);
    weapon.position.x += 0.048;
    weapon.position.z -= 0.075;
    weapon.quaternion.copy(profile.qPatrol);
    return;
  }
  const geometryClearance = weaponClearance(weapon);
  weapon.position.copy(profile.patrol.wp);
  weapon.position.x += BASE_OUTBOARD + geometryClearance.outboard;
  weapon.position.z -= BODY_FORWARD_CLEARANCE + geometryClearance.forward;
  weapon.quaternion.copy(profile.qPatrol);
}
