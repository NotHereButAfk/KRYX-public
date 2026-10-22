// ═══════════════════════════════════════════════════════════════════════════
// Walk / run cycle for the low-poly rigs — one implementation shared by the
// bots and the third-person player body, so they can't drift apart.
//
// The stride is driven off a single phase `t`. Per leg (right runs half a cycle
// behind the left):
//
//   thigh   swings sin(t)
//   knee    flexes through the SWING half (cos(p) > 0) so the foot clears the
//           floor, and keeps a few degrees of bend in stance so it never locks
//   ankle   keeps the sole level with the ground through stance, kicks into a
//           toe-off at the end of it, then dorsiflexes to clear during swing
//
// Plus the two things that sell it from outside the legs, returned for the
// caller to apply to the body transform:
//
//   bob     the pelvis drops when the legs are at full spread (they physically
//           have to — without it the feet skate above the floor)
//   lean    into the run, scaled by speed
//
// and `swing`, the matching rifle pitch, phase-locked to the bob so the weapon
// rides the stride instead of floating (feed it to applyRifleCarry).
// ═══════════════════════════════════════════════════════════════════════════

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How long a triggered hop takes to play out, and the vertical speed it
// pretends to have. Roughly a real jump: 9.5 m/s under 20 m/s² is airborne for
// about 0.95s, and a blink should read as a shorter, sharper version of that.
export const HOP_SECONDS = 0.46;
const HOP_PEAK = 8.5;

/**
 * Play the whole jump arc without actually leaving the ground.
 *
 * A blink covers 22m between one frame and the next. The character arrives
 * grounded with no vertical speed, so nothing in the gait has any reason to
 * react and it just slides to the far end. Same for the teleport pads, which
 * put you down grounded by design. Call this and the body pushes off, tucks and
 * lands as if it had jumped there.
 *
 * @param {object} rig
 * @param {number} [seconds]
 */
export function triggerHop(rig, seconds = HOP_SECONDS) {
  if (!rig) return;
  rig._hopT = seconds;
  rig._hopFor = seconds;
  rig._airT = 0;
  rig._airLead = undefined;      // re-pick the leading leg from the live stride
}

// ── leg geometry ─────────────────────────────────────────────────────────────
// From Proportions.js, not copied. These used to be three private copies of the
// same figure — here, in RifleCarry, and in the skeleton — with nothing keeping
// them equal but the fact that nobody had touched them.
import {
  HIP_Y, KNEE_Y, ANKLE_Y, THIGH_L, SHIN_L, SOLE_Y, HEEL_Z, TOE_Z,
} from './Proportions.js';

// The two corners of the sole that can touch down, in ankle-local space.
const HEEL_Y = SOLE_Y, TOE_Y = SOLE_Y;

// A sole corner's position, walking the chain ankle → knee → hip → hip-yaw →
// body lean. The leg swings in a plane, so within it only y and z matter (every
// joint is a pitch about X); the hip yaw then turns that plane, and the body's
// lean — a pitch about the body's OWN x axis — mixes y with whatever is left
// pointing down z. Skipping the yaw there floats the feet by up to 8cm at a
// sprinting strafe, where the leg plane is turned 90° out of the lean's.
const _sole = { y: 0, z: 0 };
function solePos(py, pz, thigh, knee, ankle, lean, hipYaw = 0) {
  let y = py, z = pz, c, s;
  c = Math.cos(ankle); s = Math.sin(ankle);
  [y, z] = [y * c - z * s, y * s + z * c];
  y -= SHIN_L;
  c = Math.cos(knee); s = Math.sin(knee);
  [y, z] = [y * c - z * s, y * s + z * c];
  y -= THIGH_L;
  c = Math.cos(thigh); s = Math.sin(thigh);
  [y, z] = [y * c - z * s, y * s + z * c];
  y += HIP_Y;
  const zf = hipYaw ? z * Math.cos(hipYaw) : z;      // component still along body z
  _sole.y = y * Math.cos(lean) - zf * Math.sin(lean);
  _sole.z = y * Math.sin(lean) + zf * Math.cos(lean);
  return _sole;
}
function soleY(py, pz, thigh, knee, ankle, lean, hipYaw) {
  return solePos(py, pz, thigh, knee, ankle, lean, hipYaw).y;
}

// How much ground ONE step actually covers.
//
// This is the number the whole cycle hangs off: the stride rate is set so the
// body travels exactly this far per half cycle, which is what keeps the planted
// foot still. Get it wrong and the feet skate.
//
// It has to be MEASURED from the pose rather than solved from the extremes, and
// the thing to measure is the ANKLE — the foot as a rigid body — across the
// interval that foot is bearing weight. A planted foot travels backwards under
// the body by exactly the ground the body covers, so that displacement IS the
// step.
//
// Not the contact point, which is the tempting choice and the wrong one: it
// migrates heel→toe as the ankle rolls, jumping between sole corners. A rolling
// foot is not a sliding one — a wheel's contact point advances along the ground
// too — so tracking it both adds jumps that aren't slip and makes the answer
// depend on how finely you sample. The ankle moves continuously and doesn't.
//
// The previous analytic version took the contact point's front-to-back RANGE
// over stance, which ignored that the point doubles back as the ankle
// dorsiflexes to clear. That overstated the step, set the stride too slow, and
// left the feet skating at ~45% of body speed at a walk.
const STEP_SAMPLES = 128;
const _stepCache = new Map();

// Arena movement is several times faster than a human body of this scale can
// cover with a physically planted stride. Driving phase from distance alone
// made the legs cycle at 12.7 steps/s while walking and 27.2 while sprinting.
// Keep distance-lock at ordinary speeds, then cap the visual cadence at a
// readable athletic rate. The remaining game-space travel is intentionally
// represented as stylised speed instead of turning the character into a
// treadmill. Exported so the gait regression test guards the feel directly.
export const WALK_CADENCE_CAP = 1.85;   // cycles/s = 3.7 footfalls/s
export const SPRINT_CADENCE_CAP = 2.35; // cycles/s = 4.7 footfalls/s
function groundPerStep(amp, kAmp, kneeBase, cHip, run, lean) {
  // Depends only on the pose parameters, which change slowly — quantize and
  // cache so this doesn't run a full sweep on every frame of every body.
  const key = `${amp.toFixed(3)}|${kAmp.toFixed(3)}|${kneeBase.toFixed(3)}|${cHip.toFixed(3)}|${run.toFixed(2)}|${lean.toFixed(2)}`;
  const hit = _stepCache.get(key);
  if (hit !== undefined) return hit;

  // Pose of the left leg at a given phase.
  const leg = (p) => {
    const thigh = amp * Math.sin(p) + cHip;
    const knee  = -kAmp * Math.max(0, Math.cos(p)) + kneeBase;
    return { thigh, knee, ank: ankleAngle(thigh, knee, p, run) };
  };
  const lowestSole = (p) => {
    const { thigh, knee, ank } = leg(p);
    return Math.min(solePos(HEEL_Y, HEEL_Z, thigh, knee, ank, lean).y,
                    solePos(TOE_Y,  TOE_Z,  thigh, knee, ank, lean).y);
  };
  const ankleZ = (p) => {
    const { thigh, knee, ank } = leg(p);
    return solePos(0, 0, thigh, knee, ank, lean).z;
  };

  // Integrate the left ankle's backward travel, weighted by how much of the
  // body's weight that foot is under, across one whole cycle. Each foot has
  // exactly one stance per cycle, so that integral IS one step.
  //
  // Weighted rather than gated at the stance boundary: "which foot is lower" is
  // a min over sole corners, so it is not smooth, it crosses zero more than
  // twice, and picking a crossing to integrate between swung the answer by 2.5x
  // on a lean change of 0.03 rad. A soft weight over the last centimetre of
  // height difference has no boundary to pick and no flicker to be caught by.
  const EPS = 0.01;
  let step = 0;
  for (let i = 0; i < STEP_SAMPLES; i++) {
    const p  = (i / STEP_SAMPLES) * Math.PI * 2;
    const dp = (Math.PI * 2) / STEP_SAMPLES;
    const w  = 1 / (1 + Math.exp(-(lowestSole(p + Math.PI) - lowestSole(p)) / EPS));
    step += w * (ankleZ(p + dp) - ankleZ(p));    // forward is -Z, backwards is +z
  }
  step = Math.max(0.12, step);
  if (_stepCache.size < 512) _stepCache.set(key, step);
  return step;
}

// How far to drop the body so whichever sole corner is lowest sits ON the floor.
// Solving this instead of hand-tuning a bob curve means the feet plant correctly
// at ANY stride amplitude or lean — no constant to re-tune per speed.
function groundBob(thighL, kneeL, ankleL, thighR, kneeR, ankleR, lean, hipYaw = 0) {
  let lo = Infinity;
  for (const [th, kn, an] of [[thighL, kneeL, ankleL], [thighR, kneeR, ankleR]]) {
    lo = Math.min(lo, soleY(HEEL_Y, HEEL_Z, th, kn, an, lean, hipYaw),
                      soleY(TOE_Y,  TOE_Z,  th, kn, an, lean, hipYaw));
  }
  return -lo;
}

// The three airborne key poses, per leg, as [thigh, knee, ankle] — positive
// ankle is toes up. Leading leg and trailing leg are separate: a jump with both
// legs doing the same thing is a cartoon.
//                            thigh   knee  ankle
const TUCK_LEAD   = [  0.80, -1.45,  0.02];
const TUCK_TRAIL  = [ -0.36, -0.60,  0.12];
const REACH_LEAD  = [  0.18, -0.20,  0.36];
const REACH_TRAIL = [ -0.14, -0.32,  0.30];
const EXT_LEAD    = [ -0.26, -0.12, -0.44];   // toes pointed, driving off the floor
const EXT_TRAIL   = [ -0.50, -0.08, -0.36];
const _poseLead = [0, 0, 0], _poseTrail = [0, 0, 0];

// reach →(up)→ tuck, then →(push)→ extend, written into `out`.
function blendPose(out, reach, tuck, up, ext, push) {
  for (let i = 0; i < 3; i++) {
    const arc = reach[i] + (tuck[i] - reach[i]) * up;
    out[i] = arc + (ext[i] - arc) * push;
  }
}

/**
 * Ground covered per full cycle by ANY two-legged pose built from the same
 * hip→knee→ankle chain, measured the way groundPerStep measures the player's:
 * each ankle's travel while its own foot is bearing weight.
 *
 * Exported because the zombies need it and were skating badly without it —
 * their phase advanced at a fixed rate per second with no reference to how fast
 * they were actually moving, so the feet slid ~70% of the way. Their rig has
 * different proportions and a completely different (deliberately asymmetric,
 * limping) cycle, so what is shared is the measurement, not the pose.
 *
 * @param {object} g  { hipY, thigh, shin, soleY, heelZ, toeZ } leg geometry
 * @param {(p:number)=>number[]} poseAt  phase → [thighL,kneeL,ankleL,thighR,kneeR,ankleR]
 * @param {number} [samples]
 * @returns {number} metres per full cycle (both steps)
 */
export function groundPerCycle(g, poseAt, samples = 128) {
  const EPS = 0.01;                       // soft stance weight, metres
  // Sole corner (or, at cy=cz=0, the ankle) for one leg.
  const at = (cy, cz, thigh, knee, ankle) => {
    let y = cy, z = cz, c, s;
    c = Math.cos(ankle); s = Math.sin(ankle); [y, z] = [y * c - z * s, y * s + z * c];
    y -= g.shin;
    c = Math.cos(knee);  s = Math.sin(knee);  [y, z] = [y * c - z * s, y * s + z * c];
    y -= g.thigh;
    c = Math.cos(thigh); s = Math.sin(thigh); [y, z] = [y * c - z * s, y * s + z * c];
    return { y: y + g.hipY, z };
  };
  const legOf = (q, i) => {
    const th = q[i], kn = q[i + 1], an = q[i + 2];
    const h = at(g.soleY, g.heelZ, th, kn, an), t = at(g.soleY, g.toeZ, th, kn, an);
    return { low: Math.min(h.y, t.y), az: at(0, 0, th, kn, an).z };
  };
  const dp = (Math.PI * 2) / samples;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const p = i * dp;
    const a = poseAt(p), b = poseAt(p + dp);
    const aL = legOf(a, 0), aR = legOf(a, 3), bL = legOf(b, 0), bR = legOf(b, 3);
    const wL = 1 / (1 + Math.exp(-(aR.low - aL.low) / EPS));
    total += wL * (bL.az - aL.az) + (1 - wL) * (bR.az - aR.az);
  }
  return Math.max(0.15, total);
}

// Frame-rate-independent ease toward a target on one channel.
function ease(joint, tgt, k) {
  if (joint) joint.rotation.x += (tgt - joint.rotation.x) * k;
}

// Where the ankle has to be for the sole to sit flat on the ground, given how
// far the rest of the leg has rotated away from vertical.
function ankleAngle(thigh, knee, p, run) {
  const stance  = Math.max(0, -Math.cos(p));         // 1 through mid-stance
  const flat    = -(thigh + knee);                   // cancel the leg's rotation
  const clear   = 0.20;                              // toes up to clear in swing
  // Late stance (leg behind AND still planted) is the push-off.
  const toeOff  = -Math.max(0, -Math.sin(p)) * Math.max(0, -Math.cos(p));
  return stance * flat + (1 - stance) * clear + toeOff * (0.45 + 0.45 * run);
}

/**
 * Drive a rigged body's legs, and report what the torso should do.
 *
 * @param {object} rig  { legL, legR, kneeL, kneeR, ankleL, ankleR }
 * @param {object} o    { speed (m/s), moving, run (0=walk … 1=sprint),
 *                        crouch (0..1), dt, dirF, dirR, grounded, vy }
 *   The stride PHASE is owned here and derived from `speed` — callers must not
 *   advance their own clock, or the feet skate. Read it back as `.phase`.
 *
 *   dirF/dirR are the direction of travel in the BODY's own frame — the
 *   components of the velocity along the body's forward (-Z) and right (+X)
 *   axes, normalised. They default to straight ahead, which is right for
 *   anything that always faces where it is going (the bots do). A player does
 *   NOT: they strafe and backpedal while still facing their aim, and without
 *   this the legs run a forward stride while the body slides sideways or
 *   backwards — the feet then travel with the body instead of planting.
 *
 *   grounded/vy drive the airborne pose. With no jump pose at all the legs just
 *   ease to a stand mid-flight, so a jump reads as the character freezing.
 *
 * @returns {{bob:number, lean:number, swing:number, phase:number}}
 *   bob   metres to drop the body by (≤ 0)
 *   lean  radians for the body's local pitch (already eased — ASSIGN it, do
 *         not ease it again, or it stops agreeing with `bob`)
 *   swing radians of common-mode shoulder pitch for the rifle carry
 */
export function applyWalkCycle(rig, o = {}) {
  if (!rig) return { bob: 0, lean: 0, swing: 0, phase: 0 };
  const dt     = o.dt ?? 1 / 60;
  const run    = clamp01(o.run || 0);
  const speed  = Math.max(0, o.speed || 0);
  const moving = !!o.moving;
  if (rig._walkT === undefined) rig._walkT = Math.random() * Math.PI * 2;

  // ── which way is this body actually travelling, relative to its facing ─────
  // Turn that into a yaw for the hips plus a direction for the stride. Past
  // ±90° the legs would have to twist further than a hip goes, so the stride
  // runs in reverse against a mirrored yaw instead — which is exactly what a
  // backpedal is.
  let dirF = o.dirF, dirR = o.dirR;
  if (dirF === undefined && dirR === undefined) { dirF = 1; dirR = 0; }
  else { dirF = dirF || 0; dirR = dirR || 0; }
  let legYaw = 0, strideSign = 1;
  if (moving && (dirF || dirR)) {
    // The leg swings along its own -Z; after a hip yaw θ that points along
    // (-sinθ, -cosθ). Matching it to the travel (dirR, -dirF) gives θ below —
    // note the negated dirR, which is what makes a strafe plant rather than
    // stride the wrong way along the same axis.
    legYaw = Math.atan2(-dirR, dirF);
    if (legYaw > Math.PI / 2)       { legYaw -= Math.PI; strideSign = -1; }
    else if (legYaw < -Math.PI / 2) { legYaw += Math.PI; strideSign = -1; }
  }
  rig._legYaw = (rig._legYaw || 0) + (legYaw - (rig._legYaw || 0)) * Math.min(1, dt * 10);

  // Crouching just means deeper knees and a hip tuck. The body height falls out
  // of the ground solve below on its own — no separate crouch offset to keep in
  // sync, which is the whole reason the drop is solved rather than tuned.
  const crouch = clamp01(o.crouch || 0);
  const cKnee  = -1.05 * crouch;
  const cHip   =  0.55 * crouch;

  // A longer stride lets the capped cadence still read as fast travel. These
  // remain comfortably inside the hip range and retain the same knee/ankle
  // ground solve, so crouch, jump, slide, and weapon layers stay independent.
  const amp  = 0.58 + 0.42 * run;   // thigh swing
  const kAmp = 0.95 + 0.55 * run;   // knee flex through the swing phase

  // ── Lock the stride to the ground ──────────────────────────────────────────
  // The cycle rate is DERIVED from how far one step actually carries the foot,
  // so the planted foot stays put in the world while the body moves over it.
  // Picking a rate independently (which every caller used to do) makes the feet
  // skate — at 6.2 m/s the legs were cancelling only 22% of the body's motion,
  // which reads exactly like moonwalking.
  // Measured against last frame's lean — it is eased and moves slowly, and
  // using it here keeps the step solve ahead of the pose that consumes it.
  const step = groundPerStep(amp, kAmp, -0.10 + cKnee, cHip, run, rig._lean || 0);
  // Freeze the ground cycle while airborne. The jump pose owns the legs until
  // contact; advancing a hidden walk underneath it makes the feet switch phase
  // during the blend and on the first landing frame.
  const airborne = o.grounded === false;
  const distanceCycles = Math.max(speed, 0.4) / (step * 2);
  const cadenceCap = WALK_CADENCE_CAP
    + (SPRINT_CADENCE_CAP - WALK_CADENCE_CAP) * run;
  const targetCadence = Math.min(distanceCycles, cadenceCap);
  if (rig._gaitCadence === undefined) rig._gaitCadence = targetCadence;
  const cadenceEase = 1 - Math.exp(-9 * dt);
  rig._gaitCadence += (targetCadence - rig._gaitCadence) * cadenceEase;
  rig._walkT += moving && !airborne
    ? strideSign * (Math.PI * 2 * rig._gaitCadence) * dt
    : airborne ? 0 : dt * 1.2;
  const t = rig._walkT;

  // Blend between standing and striding, then ASSIGN. The stride must not be
  // run through a per-frame ease: easing a sinusoid attenuates and phase-shifts
  // it, so the realized step comes out ~16% shorter than the one the rate was
  // solved for, and the feet skate again. Only the stand↔stride transition is
  // smoothed, which is the part that actually needs it.
  rig._moveBlend = (rig._moveBlend || 0) + ((moving ? 1 : 0) - (rig._moveBlend || 0)) * (1 - Math.exp(-9 * dt));
  const mb = rig._moveBlend;
  const mix = (a, b) => a + (b - a) * mb;

  // A compact combat-ready base: knees unlocked, hips slightly forward and
  // ankles loaded. It removes the mannequin-straight idle while blending into
  // the exact same planted walk/run cycle.
  const ready = rig.readyStance || 0;
  const sThigh = 0.045 + ready * 0.055 + cHip;
  const sKnee = -0.15 - ready * 0.11 + cKnee;
  const sAnk = 0.055 + ready * 0.035 + 0.5 * crouch;
  const wThighL =  amp * Math.sin(t) + cHip;
  const wThighR = -amp * Math.sin(t) + cHip;
  const wKneeL  = -kAmp * Math.max(0,  Math.cos(t)) - 0.10 + cKnee;
  const wKneeR  = -kAmp * Math.max(0, -Math.cos(t)) - 0.10 + cKnee;

  let thighL = mix(sThigh, wThighL), thighR = mix(sThigh, wThighR);
  let kneeL  = mix(sKnee,  wKneeL),  kneeR  = mix(sKnee,  wKneeR);
  let ankleL = mix(sAnk, ankleAngle(wThighL, wKneeL, t,            run));
  let ankleR = mix(sAnk, ankleAngle(wThighR, wKneeR, t + Math.PI,  run));

  // ── airborne ───────────────────────────────────────────────────────────────
  // A jump used to fall out of `moving`, so the legs simply eased to a stand in
  // mid-flight and the character froze. It needs a pose — and specifically it
  // needs THREE, in sequence, rather than one blend driven by vertical speed:
  //
  //   EXTEND  the drive off the floor. Legs straight, toes pointed. This one
  //           has to run off its own clock, because vertical speed is at its
  //           maximum here and cannot tell the push-off apart from the rise —
  //           a pose that is purely a function of vy is already fully tucked
  //           the instant it leaves the ground, which skips the push entirely
  //           and reads like the character was yanked upward on a wire.
  //   TUCK    knees come up as the body rises.
  //   REACH   legs unfold and the toes turn up to meet the floor.
  //
  // A hop can also be played without leaving the ground at all — triggerHop().
  rig._hopT = Math.max(0, (rig._hopT || 0) - dt);
  const hopping = rig._hopT > 0;
  const airTarget = (o.grounded === false || hopping) ? 1 : 0;
  const prevAir = rig._air || 0;
  // Fast in, slower out: a push-off is not a gradual thing, but the recovery on
  // the far side of a landing is.
  rig._air = prevAir + (airTarget - prevAir) * Math.min(1, dt * (airTarget ? 40 : 12));
  // Landing: fires on the transition back to the ground, decays away.
  if (airTarget === 0 && prevAir > 0.5) rig._land = 1;
  rig._land = Math.max(0, (rig._land || 0) - dt * 4);
  rig._airT = airTarget ? (rig._airT || 0) + dt : 0;
  const air = rig._air;
  const absorb = (rig._land || 0) * (rig._land || 0);   // sharp at touchdown

  if (air > 0.001) {
    // A triggered hop has no real vertical speed, so it plays the arc off the
    // clock instead — full up at the start, full down at the end.
    const vy = hopping
      ? HOP_PEAK * (2 * (rig._hopT / (rig._hopFor || HOP_SECONDS)) - 1)
      : (o.vy || 0);
    // -1 falling … +1 rising, against a typical jump rather than the actual
    // one, so a long fall doesn't wind the pose past its extreme.
    // Saturating below the peak speed, so the tuck is at full depth for most of
    // the rise instead of only at the one instant vy is at its maximum — which
    // is the instant the push-off owns anyway.
    const up   = clamp01((Math.max(-1, Math.min(1, vy / 6.5)) + 1) / 2);
    // Held flat for the first 50ms, then let go quickly. Without the plateau the
    // decay overlaps the airborne blend still fading in, the two dilute each
    // other, and the extension only reaches about half strength — the push-off
    // stops reading. Decaying slowly is just as bad the other way: it bleeds a
    // straight leg into the tuck and costs it a quarter of its depth.
    const push = Math.exp(-Math.max(0, rig._airT - 0.05) / 0.07);

    // Whichever leg was forward at takeoff stays forward. You leave the ground
    // off one foot, and a running jump that swaps legs in mid-air reads as a
    // stumble.
    if (rig._airLead === undefined || prevAir < 0.02) {
      rig._airLead = Math.sin(t) >= 0 ? 1 : -1;
    }

    blendPose(_poseLead,  REACH_LEAD,  TUCK_LEAD,  up, EXT_LEAD,  push);
    blendPose(_poseTrail, REACH_TRAIL, TUCK_TRAIL, up, EXT_TRAIL, push);
    const pL = rig._airLead > 0 ? _poseLead : _poseTrail;
    const pR = rig._airLead > 0 ? _poseTrail : _poseLead;

    const a = (base, jump) => base + (jump - base) * air;
    thighL = a(thighL, pL[0] + cHip);  thighR = a(thighR, pR[0] + cHip);
    kneeL  = a(kneeL,  pL[1] + cKnee); kneeR  = a(kneeR,  pR[1] + cKnee);
    ankleL = a(ankleL, pL[2]);         ankleR = a(ankleR, pR[2]);
    rig._airPush = push;
  } else {
    rig._airPush = 0;
  }
  if (absorb > 0.001) {
    kneeL  -= 0.55 * absorb; kneeR  -= 0.55 * absorb;
    thighL += 0.22 * absorb; thighR += 0.22 * absorb;
    ankleL += 0.18 * absorb; ankleR += 0.18 * absorb;
  }

  // ── slide ──────────────────────────────────────────────────────────────────
  // A sprint-slide used to run the ordinary stride, so the character sprinted
  // along at knee height with its legs still cycling. It is a held pose, not a
  // cycle: lead leg thrown out straight in front, trailing leg folded under,
  // body low and tipped back over it. The height falls out of the ground solve
  // on its own — the folded leg is what puts the hips down there.
  rig._slide = (rig._slide || 0) + (clamp01(o.slide || 0) - (rig._slide || 0)) * Math.min(1, dt * 11);
  const slide = rig._slide;
  if (slide > 0.001) {
    if (rig._slideLead === undefined || slide < 0.02) {
      rig._slideLead = Math.sin(t) >= 0 ? 1 : -1;
    }
    const s = (base, tgt) => base + (tgt - base) * slide;
    const leadT = 1.02, leadK = -0.16, leadA = 0.30;   // out in front, heel down
    const trailT = 0.10, trailK = -1.90, trailA = -0.10;  // folded under the hips
    if (rig._slideLead > 0) {
      thighL = s(thighL, leadT + cHip);  kneeL = s(kneeL, leadK);  ankleL = s(ankleL, leadA);
      thighR = s(thighR, trailT + cHip); kneeR = s(kneeR, trailK); ankleR = s(ankleR, trailA);
    } else {
      thighR = s(thighR, leadT + cHip);  kneeR = s(kneeR, leadK);  ankleR = s(ankleR, leadA);
      thighL = s(thighL, trailT + cHip); kneeL = s(kneeL, trailK); ankleL = s(ankleL, trailA);
    }
  }

  if (rig.legL)   rig.legL.rotation.x   = thighL;
  if (rig.legR)   rig.legR.rotation.x   = thighR;
  if (rig.kneeL)  rig.kneeL.rotation.x  = kneeL;
  if (rig.kneeR)  rig.kneeR.rotation.x  = kneeR;
  if (rig.ankleL) rig.ankleL.rotation.x = ankleL;
  if (rig.ankleR) rig.ankleR.rotation.x = ankleR;

  // Point the hips down the direction of travel. Order matters: the leg has to
  // swing in its own plane and THEN be yawed into place, which is Y-before-X in
  // three.js Euler terms ('YXZ' composes as Ry·Rx·Rz).
  const hipYaw = rig._legYaw * (1 - air);
  for (const leg of [rig.legL, rig.legR]) {
    if (!leg) continue;
    if (leg.rotation.order !== 'YXZ') leg.rotation.order = 'YXZ';
    leg.rotation.y = hipYaw;
  }

  // Negative = forward. Kept shallow: a walk barely leans, only a real sprint
  // pitches in noticeably. Scaled by how much of the travel is actually forward,
  // so a backpedal doesn't lean into the direction it is retreating from. Eased
  // HERE rather than by the caller, because the ground solve below has to run
  // against the lean that actually gets applied — solving for the target while
  // the body eases toward it drifts the feet.
  // The torso follows the legs, or the landing reads as a knee bend bolted onto
  // a rigid mannequin: pitch into the compression on touchdown, and tip back a
  // little over the drive off the floor. Not eased — both are already smooth
  // curves of their own, and easing them would lag the legs they belong to.
  const leanTarget = -0.065 * ready
    + (-(0.03 + 0.13 * run) * mb * (moving ? dirF : 1)) - 0.10 * crouch;
  rig._lean = (rig._lean || 0) + (leanTarget - (rig._lean || 0)) * Math.min(1, dt * 6);
  // Slide tips the torso BACK over the trailing leg (positive = back here).
  const lean = rig._lean - 0.16 * absorb + 0.09 * air * rig._airPush + 0.30 * slide;
  // Airborne the feet are tucked, so there is no ground contact to solve for —
  // fade the drop out, or the body would sink to keep the raised soles at zero.
  const bob = groundBob(thighL, kneeL, ankleL, thighR, kneeR, ankleR, lean, hipYaw) * (1 - air);

  // A planted gait also transfers weight left↔right. Keep this restrained: it
  // is enough to stop the hard-surface chassis reading as a rigid mannequin,
  // without moving the visual body far enough to undo the solved foot plant.
  // The head counters part of the roll like a real stabilized gaze.
  const weight = mb * Math.sin(t) * (1 - 0.55 * air) * (1 - slide);
  const roll = weight * (0.010 + 0.008 * run);
  const sway = weight * (0.006 + 0.004 * run);
  if (rig.head) rig.head.rotation.z = -roll * 0.55;

  return {
    bob, lean, roll, sway, phase: t, air,
    // Rifle lifts as the pelvis drops (i.e. away from the chest, not into it),
    // fading to a breathing idle when standing.
    swing: mb * -(0.028 + 0.022 * run) * Math.cos(t * 2)
         + (1 - mb) * Math.sin(t * 0.28) * 0.018,
  };
}
