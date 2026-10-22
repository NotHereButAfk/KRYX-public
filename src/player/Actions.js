// ═══════════════════════════════════════════════════════════════════════════
// One-shot upper-body actions.
//
// The gait covers everything continuous — walking, running, crouching, jumping.
// This covers the things that HAPPEN: throwing a grenade, swapping weapons,
// taking a hit. Each is a clock started by an event and read back as a 0→1
// progress, so the pose is a pure function of that progress and every body
// plays it identically whether it is driven by local input, by a bot's own
// decisions, or by a network snapshot.
//
// Two of the actions already have a clock somewhere else and are NOT started
// here — a reload runs off the weapon's own reloadTimer, and a melee swing off
// its swingPhase. Those get passed in directly; duplicating their timing here
// would be a second source of truth that could drift out of step with the
// weapon that owns them.
//
// Where the pose actually gets applied:
//   · guns  — applyRifleCarry(), which owns both arms and the weapon transform
//   · melee — applyMeleeCarry(), below, which owns the same for a blade
// ═══════════════════════════════════════════════════════════════════════════

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How long each one-shot runs, in seconds.
export const ACTION_TIME = {
  throw: 0.62,      // wind up over the shoulder, whip forward, recover
  swap:  0.38,      // weapon out of frame and back
  flinch: 0.28,     // hit reaction
};

/**
 * Start a one-shot action on a rig. Safe to call every frame — re-triggering
 * restarts it, which is what you want when a second hit lands mid-flinch.
 * @param {object} rig
 * @param {'throw'|'swap'|'flinch'} kind
 */
export function triggerAction(rig, kind, seconds = ACTION_TIME[kind]) {
  if (!rig || !seconds) return;
  (rig._act || (rig._act = {}))[kind] = seconds;
}

const _out = { throw: 0, swap: 0, flinch: 0, any: 0 };

/**
 * Advance every running action and read them back as 0→1 progress.
 * 0 means "just started", 1 means "finished" — a pose keyed off this reads the
 * same at any frame rate, and a body that misses frames lands in the right
 * place rather than playing the whole thing in slow motion.
 * @returns {{throw:number, swap:number, flinch:number, any:number}} reused object
 */
export function tickActions(rig, dt) {
  _out.throw = _out.swap = _out.flinch = _out.any = 0;
  const a = rig && rig._act;
  if (!a) return _out;
  for (const kind of ['throw', 'swap', 'flinch']) {
    const left = a[kind];
    if (!left) continue;
    const next = left - dt;
    if (next <= 0) { a[kind] = 0; continue; }
    a[kind] = next;
    _out[kind] = 1 - next / ACTION_TIME[kind];
    _out.any = 1;
  }
  return _out;
}

/** True while anything one-shot is still playing. */
export function actionsBusy(rig) {
  const a = rig && rig._act;
  return !!(a && (a.throw > 0 || a.swap > 0 || a.flinch > 0));
}

// ── curve helpers ───────────────────────────────────────────────────────────
/** 0 → 1 → 0 over p ∈ [0,1]. The shape of anything that goes and comes back. */
export const bell = (p) => Math.sin(Math.PI * clamp01(p));
/** Sharp attack, slow release — a hit, a rack, a footfall. */
export const snap = (p) => {
  const x = clamp01(p);
  return x < 0.15 ? x / 0.15 : Math.pow(1 - (x - 0.15) / 0.85, 2);
};

// ── melee ───────────────────────────────────────────────────────────────────
// Wind up over the shoulder, chop straight down through the target, then make
// a slower recovery. Mirrors the shape of the first-person swing in
// WeaponSystem so the two views of the same blade agree.
const SWING_WIND = 0.30, SWING_CUT = 0.55;

// Rig metrics, matching RifleCarry — the same body.
const SHOULDER_Y = 1.76, SHOULDER_X = 0.27, UP_ARM = 0.48, FOREARM = 0.385;
// Blade pitch relative to the forearm. A grip is rigid, so the blade's angle is
// just the arm's total rotation plus this — calibrated so the guard pose comes
// out at the -0.70 the model was authored around.
const GRIP_PITCH = -1.80, GRIP_ROLL = 0.22;

// Arm keys as [shoulder, elbow]. Positive is forward for both: the shoulder
// swings the limb ahead of the body, the elbow folds the forearm up in front.
const GUARD = [-0.10, 1.20];    // blade up and ready across the chest
const WIND  = [-1.20, 1.90];    // cocked back over the shoulder
const CUT   = [ 0.55, 0.55];    // driven down and through, in front

// Where the hand ends up, walking shoulder → elbow → hand. Both joints pitch
// about X, so the arm stays in the sagittal plane and only y/z matter.
// Deriving the blade's position from this instead of keying it separately is
// what keeps it IN the hand: hand-keying both put the sword a forearm's length
// away from the arm swinging it.
const _hand = { y: 0, z: 0 };
function handAt(shoulder, elbow) {
  const total = shoulder + elbow;
  _hand.y = SHOULDER_Y - UP_ARM * Math.cos(shoulder) - FOREARM * Math.cos(total);
  _hand.z = -UP_ARM * Math.sin(shoulder) - FOREARM * Math.sin(total);
  return _hand;
}

/**
 * Arms and blade for a melee weapon.
 *
 * The counterpart to applyRifleCarry: it owns armL/armR/elbowL/elbowR AND the
 * weapon transform for this body, so nothing else should pose them. A blade is
 * held in one hand and swung, rather than gripped by both and aimed, so there
 * is no IK here — both the arm and the weapon are keyed off the same phase,
 * which is what keeps the blade in the hand through the arc.
 *
 * @param {object} rig  { armL, armR, elbowL, elbowR }
 * @param {THREE.Object3D} weapon
 * @param {object} o  { swing 0..1 (1 = idle, <1 = mid-attack), moving, phase,
 *                      run, dt, throwP, flinch }
 */
export function applyMeleeCarry(rig, weapon, o = {}) {
  if (!rig) return;
  const dt = o.dt ?? 1 / 60;
  const t  = o.phase || 0;
  const k  = Math.min(1, dt * 14);
  const ease = (j, tgt) => { if (j) j.rotation.x += (tgt - j.rotation.x) * k; };

  // Resting / travelling arms: the off hand swings with the stride, the blade
  // hand stays up and ready.
  let aR = GUARD[0], eR = GUARD[1], aL = 0, eL = -0.18;
  if (o.moving) {
    const sw = Math.sin(t) * (0.55 + 0.30 * clamp01(o.run || 0));
    aL = -sw * 0.60; eL = -0.28 - 0.22 * Math.max(0, -Math.cos(t));
  } else {
    aL = Math.sin(t * 0.28) * 0.05;
  }

  // The attack. `swing` counts 0 → 1 across the whole strike.
  const s = o.swing;
  const lerp2 = (a, b, k) => { aR = a[0] + (b[0] - a[0]) * k; eR = a[1] + (b[1] - a[1]) * k; };
  if (s !== undefined && s < 1) {
    if (s < SWING_WIND) {
      lerp2(GUARD, WIND, s / SWING_WIND);
    } else if (s < SWING_CUT) {
      const c = (s - SWING_WIND) / (SWING_CUT - SWING_WIND);
      lerp2(WIND, CUT, c * c * (3 - 2 * c));         // the cut — fast, eased
    } else {
      const r = (s - SWING_CUT) / (1 - SWING_CUT);
      lerp2(CUT, GUARD, r * r * (3 - 2 * r));        // recover, slower
    }
    // The strike is the fastest thing the body does; easing toward it at 14/s
    // smears it into a wave. Snap the blade arm, keep the off arm eased.
    if (rig.armR)   rig.armR.rotation.x = aR;
    if (rig.elbowR) rig.elbowR.rotation.x = eR;
  } else {
    ease(rig.armR, aR); ease(rig.elbowR, eR);
    // Read back what the ease actually reached, so the blade sits in the hand
    // as it is NOW rather than where it is heading.
    if (rig.armR)   aR = rig.armR.rotation.x;
    if (rig.elbowR) eR = rig.elbowR.rotation.x;
  }
  ease(rig.armL, aL); ease(rig.elbowL, eL);

  // A grenade goes in the off hand, so it reads even with a blade drawn.
  if (o.throwP) applyThrowArm(rig, o.throwP);
  if (o.flinch) {
    const f = snap(o.flinch) * 0.30;
    if (rig.armR) rig.armR.rotation.x -= f;
    if (rig.armL) rig.armL.rotation.x -= f * 0.6;
  }

  // Blade goes wherever the hand went, angled by the same total arm rotation —
  // a grip is rigid, so that IS the blade's pitch.
  if (weapon) {
    const h = handAt(aR, eR);
    weapon.position.set(SHOULDER_X, h.y, h.z);
    weapon.rotation.set(aR + eR + GRIP_PITCH, 0, GRIP_ROLL);
  }
}

// ── grenade ─────────────────────────────────────────────────────────────────
// Over the shoulder and away. Applied to the LEFT arm, so a rifle stays in the
// right hand and the carry underneath it survives the throw.
const THROW_WIND = 0.34;

/** @param {number} p 0→1 progress through the throw */
export function applyThrowArm(rig, p) {
  if (!rig || !rig.armL) return;
  let arm, elbow;
  if (p < THROW_WIND) {
    const w = p / THROW_WIND;
    const e = w * w;                                  // slow load, then commit
    arm = -0.10 - 1.95 * e; elbow = -0.20 - 1.55 * e;
  } else {
    const r = (p - THROW_WIND) / (1 - THROW_WIND);
    const e = r < 0.32 ? (r / 0.32) * (r / 0.32) : 1 - Math.pow(1 - (r - 0.32) / 0.68, 3);
    arm = -2.05 + 2.60 * e; elbow = -1.75 + 1.55 * e;
  }
  rig.armL.rotation.x = arm;
  if (rig.elbowL) rig.elbowL.rotation.x = elbow;
}
