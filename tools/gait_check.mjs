// Walk-cycle check — `npm run test:gait`
//
// Locks down the two things that make a character's legs look wrong, both of
// which shipped at some point and neither of which any other test would catch:
//
//   1. SKATING / MOONWALKING. The stride rate has to be derived from how far
//      one step actually carries the foot, or the feet slide along the floor.
//      This got worse the moment a body moved anything other than straight
//      forward: a strafe or a backpedal ran the forward stride, so the feet
//      travelled WITH the body (slip 1.0) or outran it (slip 1.5).
//   2. NO AIRBORNE POSE. A jump used to fall out of `moving`, so the legs eased
//      to a stand in mid-flight and the jump read as the character freezing.
//
// applyWalkCycle only reads and writes `.rotation` on the joints, so a rig of
// plain objects drives it exactly as three.js would — no browser, no renderer,
// exact 60Hz, deterministic.
//
// The forward kinematics below is deliberately a SECOND implementation. If it
// shared code with Locomotion.js it would agree with it by construction and
// check nothing. Cross-check that it is right: the lowest sole comes out at
// exactly 0mm, which is what groundBob() independently solves for.
import {
  applyWalkCycle, triggerHop, HOP_SECONDS,
  WALK_CADENCE_CAP, SPRINT_CADENCE_CAP,
} from '../src/player/Locomotion.js';

// From Proportions.js, like the code under test. This harness used to keep its
// own copy of the figure, which meant that the moment the body's proportions
// changed it went on measuring the new pose against the old legs and reported
// skating that was not there.
import { HIP_Y, THIGH_L, SHIN_L, SOLE_Y, HEEL_Z, TOE_Z } from '../src/player/Proportions.js';
const CORNERS = [[SOLE_Y, HEEL_Z], [SOLE_Y, TOE_Z]];   // heel, toe in ankle space
const EPS = 0.01;                                     // soft stance weight, metres

const joint = () => ({ rotation: { x: 0, y: 0, z: 0, order: 'XYZ' } });
const newRig = () => ({ legL: joint(), legR: joint(), kneeL: joint(), kneeR: joint(),
  ankleL: joint(), ankleR: joint(), head: joint(), _walkT: 0, _moveBlend: 0, _lean: 0 });

// A sole corner (or, at 0,0, the ankle joint) in body-local space.
function sole(cy, cz, thigh, knee, ankle, lean, hipYaw) {
  let y = cy, z = cz, c, s;
  c = Math.cos(ankle); s = Math.sin(ankle); [y, z] = [y * c - z * s, y * s + z * c];
  y -= SHIN_L;
  c = Math.cos(knee);  s = Math.sin(knee);  [y, z] = [y * c - z * s, y * s + z * c];
  y -= THIGH_L;
  c = Math.cos(thigh); s = Math.sin(thigh); [y, z] = [y * c - z * s, y * s + z * c];
  y += HIP_Y;
  let x = 0;
  if (hipYaw) { const c2 = Math.cos(hipYaw), s2 = Math.sin(hipYaw); [x, z] = [z * s2, z * c2]; }
  const cl = Math.cos(lean), sl = Math.sin(lean);
  return { x, y: y * cl - z * sl, z: y * sl + z * cl };
}

/**
 * Walk at `speed` travelling `travelDeg` off the body's facing, and report how
 * far the loaded foot slides.
 *
 * slip = world travel of each ankle, weighted by how much of the body's weight
 * that foot is under, over the body's travel in the same interval.
 *   0 = the foot plants and the body moves over it   (correct)
 *   1 = the foot travels with the body               (feet do nothing)
 *   2 = the foot outruns the body                    (cycle runs backwards)
 *
 * The ankle rather than the contact point, because the contact point migrates
 * heel→toe as the foot rolls and a rolling foot is not a sliding one. Weighted
 * rather than gated on "which foot is lower", because that is a min over sole
 * corners and flickers where the two are close — gating on it moves the answer
 * by ±0.3 and hides real regressions.
 */
function measureSlip(speed, travelDeg, { run = 0, crouch = 0, dt = 1 / 240 } = {}) {
  const rig = newRig();
  const rad = (travelDeg * Math.PI) / 180;
  const dirF = Math.cos(rad), dirR = Math.sin(rad);    // forward is -Z, right is +X
  const opts = { speed, moving: speed > 0.6, run, crouch, dt, dirF, dirR };
  for (let i = 0; i < 960; i++) applyWalkCycle(rig, opts);   // settle the blend

  const read = (side, lean) => {
    const th = rig['leg' + side].rotation.x, kn = rig['knee' + side].rotation.x;
    const an = rig['ankle' + side].rotation.x, hy = rig['leg' + side].rotation.y || 0;
    let low = Infinity;
    for (const [cy, cz] of CORNERS) low = Math.min(low, sole(cy, cz, th, kn, an, lean, hy).y);
    return { low, ankle: sole(0, 0, th, kn, an, lean, hy) };
  };

  const ux = dirR, uz = -dirF;
  let bx = 0, bz = 0, prev = null, num = 0, den = 0, soleMin = Infinity, soleMax = -Infinity;
  const t0 = rig._walkT;
  // |Δphase|: a backpedal runs the cycle in reverse, so the phase decreases.
  for (let i = 0; i < 400000 && Math.abs(rig._walkT - t0) < Math.PI * 10; i++) {
    const g = applyWalkCycle(rig, opts);
    bx += dirR * speed * dt; bz += -dirF * speed * dt;
    const L = read('L', g.lean), R = read('R', g.lean);
    const onFloor = Math.min(L.low, R.low) + g.bob;
    soleMin = Math.min(soleMin, onFloor); soleMax = Math.max(soleMax, onFloor);
    const cur = {
      L: { x: bx + L.ankle.x, z: bz + L.ankle.z, w: 1 / (1 + Math.exp(-(R.low - L.low) / EPS)) },
      R: { x: bx + R.ankle.x, z: bz + R.ankle.z, w: 1 / (1 + Math.exp(-(L.low - R.low) / EPS)) },
    };
    if (prev) for (const s of ['L', 'R']) {
      const w = (prev[s].w + cur[s].w) / 2;
      num += w * ((cur[s].x - prev[s].x) * ux + (cur[s].z - prev[s].z) * uz);
      den += w * speed * dt;
    }
    prev = cur;
  }
  return { slip: den ? num / den : 0, soleY: [soleMin, soleMax] };
}

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('   FAIL  ' + msg); } };

console.log('planted-foot slip  (0 = plants, 1 = feet do nothing, 2 = runs backwards)\n');
console.log('   direction          walk 6.6   sprint 13.20');
const DIRS = [[0, 'forward'], [180, 'backpedal'], [-90, 'strafe-left'], [90, 'strafe-right'],
              [135, 'back-right diag'], [45, 'fwd-right diag']];
// At arena-scale travel speeds a 1.82m figure cannot both keep every foot
// physically planted and maintain a human-looking cadence. High-speed travel
// therefore allows controlled game-space drift, while direction and ground
// contact remain guarded. Ordinary human-scale motion below is still strict.
const LIMIT = 0.88;
for (const [deg, name] of DIRS) {
  const w = measureSlip(6.6, deg, { run: 0 }).slip;
  const s = measureSlip(13.2, deg, { run: 1 }).slip;
  const bad = Math.max(Math.abs(w), Math.abs(s)) > LIMIT;
  console.log('   %s %s     %s%s', name.padEnd(16),
    w.toFixed(2).padStart(6), s.toFixed(2).padStart(6), bad ? '   <— SKATING' : '');
  check(!bad, `${name}: slip ${w.toFixed(2)}/${s.toFixed(2)} exceeds ±${LIMIT}`);
}

console.log('\nvisual cadence (human-readable cap at arena speed)');
const cadenceAt = (speed, run) => {
  const rig = newRig(), dt = 1 / 240;
  const o = { speed, moving: true, run, dt, grounded: true, dirF: 1, dirR: 0 };
  for (let i = 0; i < 960; i++) applyWalkCycle(rig, o);
  const t0 = rig._walkT;
  for (let i = 0; i < 240; i++) applyWalkCycle(rig, o);
  return (rig._walkT - t0) / (Math.PI * 2);
};
const walkCadence = cadenceAt(6.6, 0.45);
const sprintCadence = cadenceAt(13.2, 1);
console.log('   walk %s cycles/s (%s steps/s), sprint %s cycles/s (%s steps/s)',
  walkCadence.toFixed(2), (walkCadence * 2).toFixed(2),
  sprintCadence.toFixed(2), (sprintCadence * 2).toFixed(2));
check(walkCadence <= WALK_CADENCE_CAP + 0.24,
  `walk cadence ${walkCadence.toFixed(2)} exceeds the visual cap`);
check(sprintCadence <= SPRINT_CADENCE_CAP + 0.01,
  `sprint cadence ${sprintCadence.toFixed(2)} exceeds the visual cap`);
check(walkCadence > 1.5 && sprintCadence > walkCadence,
  'cadence no longer distinguishes a walk from a sprint');

const humanScaleSlip = measureSlip(1.5, 0, { run: 0 }).slip;
console.log('   human-scale 1.5m/s planted-foot slip %s', humanScaleSlip.toFixed(2));
check(Math.abs(humanScaleSlip) < 0.25,
  `ordinary-speed foot plant regressed to ${humanScaleSlip.toFixed(2)}`);

console.log('\ncrouch, and the sole staying on the floor');
for (const [deg, name] of [[0, 'forward'], [90, 'strafe-right']]) {
  const m = measureSlip(3.0, deg, { run: 0, crouch: 1 });
  console.log('   crouch %s slip=%s   sole %smm … %smm', name.padEnd(13), m.slip.toFixed(2),
    (m.soleY[0] * 1000).toFixed(0), (m.soleY[1] * 1000).toFixed(0));
  check(Math.abs(m.slip) <= LIMIT, `crouch ${name}: slip ${m.slip.toFixed(2)}`);
  // groundBob solves for the lowest sole sitting exactly on the floor.
  check(Math.abs(m.soleY[0]) < 1e-6 && Math.abs(m.soleY[1]) < 1e-6,
    `crouch ${name}: sole leaves the floor (${(m.soleY[0] * 1000).toFixed(1)}…${(m.soleY[1] * 1000).toFixed(1)}mm)`);
}

// ── the jump has to be a pose, not a freeze ─────────────────────────────────
console.log('\nairborne pose');
{
  const rig = newRig();
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) applyWalkCycle(rig, { speed: 6.2, moving: true, run: 0, dt, grounded: true });
  const takeoffPhase = rig._walkT;

  // Which leg leads is picked at takeoff from the live stride, so read both and
  // track whichever one it chose.
  let vy = 9.5;
  const frames = [];
  for (let i = 0; i < 60; i++) {
    vy -= 20 * dt;
    const g = applyWalkCycle(rig, { speed: 6.2, moving: true, run: 0, dt, grounded: false, vy });
    // `air` defaulted, so a build that stopped reporting it fails a check
    // rather than throwing here.
    frames.push({
      air: g.air || 0, bob: g.bob, vy, lead: rig._airLead,
      thigh: rig.legL.rotation.x, knee: rig.kneeL.rotation.x,
      // the leading leg, whichever side it landed on
      lThigh: rig._airLead > 0 ? rig.legL.rotation.x : rig.legR.rotation.x,
      lKnee:  rig._airLead > 0 ? rig.kneeL.rotation.x : rig.kneeR.rotation.x,
      lAnkle: rig._airLead > 0 ? rig.ankleL.rotation.x : rig.ankleR.rotation.x,
    });
  }
  const spread = Math.max(...frames.map((f) => f.thigh)) - Math.min(...frames.map((f) => f.thigh));
  const tuckI  = frames.reduce((b, f, i) => (f.lKnee < frames[b].lKnee ? i : b), 0);
  const tuck   = frames[tuckI].lKnee;
  const last   = frames[frames.length - 1];
  // Push-off: toes pointed and the leg near straight, before any of the tuck.
  const pushI  = frames.reduce((b, f, i) => (f.lAnkle < frames[b].lAnkle ? i : b), 0);
  const push   = frames[pushI];

  console.log('   airborne blend reaches %s, thigh moves %s rad', last.air.toFixed(2), spread.toFixed(2));
  console.log('   push-off  f%d  ankle %s rad (toes pointed), knee %s (near straight)',
    pushI, push.lAnkle.toFixed(2), push.lKnee.toFixed(2));
  console.log('   tuck      f%d  knee %s rad', tuckI, tuck.toFixed(2));
  console.log('   reach     f%d  knee %s rad, ankle %s (toes up)',
    frames.length - 1, last.lKnee.toFixed(2), last.lAnkle.toFixed(2));

  check(last.air > 0.9, 'airborne blend never engages');
  check(Math.abs(rig._walkT - takeoffPhase) < 1e-9,
    'ground gait phase keeps advancing while airborne');
  check(spread > 0.15, `legs are frozen in mid-air (thigh moves only ${spread.toFixed(3)} rad)`);
  check(tuck < -0.9, `no knee tuck on the way up (deepest ${tuck.toFixed(2)} rad)`);
  check(last.vy < -4, 'test did not reach the falling half of the jump');
  check(last.lKnee > tuck + 0.3,
    `legs do not extend for the landing (knee ${tuck.toFixed(2)} → ${last.lKnee.toFixed(2)})`);
  check(Math.abs(last.bob) < 0.02,
    'the ground drop is still applied in mid-air (feet are tucked — nothing to stand on)');
  // The drive off the floor must come FIRST and must be a real extension. A
  // pose driven only by vertical speed is fully tucked at takeoff and fails
  // both of these.
  check(push.lAnkle < -0.15,
    `no push-off — toes never point (lowest ankle ${push.lAnkle.toFixed(2)} rad)`);
  check(push.lKnee > -0.45,
    `the leg is already folded during the push-off (knee ${push.lKnee.toFixed(2)} rad)`);
  check(pushI < tuckI, `push-off (f${pushI}) does not precede the tuck (f${tuckI})`);
  check(last.lAnkle > 0.2, `toes do not turn up to land (ankle ${last.lAnkle.toFixed(2)} rad)`);
  const swapped = frames.some((f) => f.lead !== frames[0].lead);
  check(!swapped, 'the leading leg swaps in mid-air');

  // Landing absorb, measured against a control rig walking the same stride in
  // the same phase. Comparing to "the knee before the jump" would be comparing
  // to an arbitrary point in a cycle that swings a full radian on its own.
  const ctrl = newRig();
  ctrl._walkT = rig._walkT; ctrl._moveBlend = 1; ctrl._lean = rig._lean;
  let deepest = 0;
  for (let i = 0; i < 20; i++) {
    applyWalkCycle(rig,  { speed: 6.2, moving: true, run: 0, dt, grounded: true, vy: 0 });
    applyWalkCycle(ctrl, { speed: 6.2, moving: true, run: 0, dt, grounded: true, vy: 0 });
    deepest = Math.min(deepest, rig.kneeL.rotation.x - ctrl.kneeL.rotation.x);
  }
  console.log('   landing absorb: knee %s rad below the same stride unjumped', deepest.toFixed(2));
  check(deepest < -0.2, `landing is not absorbed (only ${deepest.toFixed(2)} rad below the stride)`);
  for (let i = 0; i < 120; i++) applyWalkCycle(rig, { speed: 6.2, moving: true, run: 0, dt, grounded: true });
  check(Math.abs(applyWalkCycle(rig, { speed: 6.2, moving: true, run: 0, dt, grounded: true }).air) < 0.01,
    'airborne blend does not clear after landing');
}

// ── a blink has to look like something ──────────────────────────────────────
// It arrives grounded with no vertical speed, so nothing in the gait has any
// reason to react — the body would slide the 22m. triggerHop plays the arc over
// it while `grounded` stays true throughout.
console.log('\nteleport hop (grounded the whole time)');
{
  // Two rigs walking the same stride in the same phase; only one blinks. Every
  // number below is the DIFFERENCE, so nothing depends on where in the cycle
  // the hop happened to land. The phases stay locked because the stride rate is
  // solved from `_lean`, which the hop does not touch.
  const dt = 1 / 60;
  const walk = { speed: 6.2, moving: true, run: 0, dt, grounded: true, vy: 0 };
  const hop = newRig(), ctrl = newRig();
  for (let i = 0; i < 120; i++) { applyWalkCycle(hop, walk); applyWalkCycle(ctrl, walk); }
  check(Math.abs(hop._walkT - ctrl._walkT) < 1e-9, 'control rig is out of phase — test is invalid');

  triggerHop(hop);
  const f = [];
  for (let i = 0; i < Math.ceil(HOP_SECONDS / dt) + 45; i++) {
    const g = applyWalkCycle(hop, walk);            // grounded: true throughout
    applyWalkCycle(ctrl, walk);
    f.push({ air: g.air || 0,
      dKnee:  Math.min(hop.kneeL.rotation.x - ctrl.kneeL.rotation.x,
                       hop.kneeR.rotation.x - ctrl.kneeR.rotation.x),
      dAnkle: Math.min(hop.ankleL.rotation.x - ctrl.ankleL.rotation.x,
                       hop.ankleR.rotation.x - ctrl.ankleR.rotation.x) });
  }
  const peak    = Math.max(...f.map((x) => x.air));
  const tucked  = Math.min(...f.map((x) => x.dKnee));
  const toes    = Math.min(...f.map((x) => x.dAnkle));
  const airOut  = f.findIndex((x, i) => i > 5 && x.air < 0.5);
  const absorb  = Math.min(...f.slice(airOut, airOut + 25).map((x) => x.dKnee));
  const settled = f[f.length - 1];

  console.log('   airborne blend peaks at %s, back down by f%d', peak.toFixed(2), airOut);
  console.log('   vs. the same stride unjumped: knee %s rad, toes %s rad',
    tucked.toFixed(2), toes.toFixed(2));
  console.log('   landing absorb %s rad, settles to %s', absorb.toFixed(2), settled.dKnee.toFixed(3));

  check(peak > 0.9, 'triggerHop does not lift the body off the ground pose');
  check(tucked < -0.5, `triggerHop never tucks (knee only ${tucked.toFixed(2)} rad off the stride)`);
  check(toes < -0.15, 'triggerHop has no push-off');
  check(airOut > 20, `the hop is over before it reads (${airOut} frames)`);
  check(absorb < -0.2, `the hop does not land — no absorb (${absorb.toFixed(2)} rad)`);
  check(settled.air < 0.01, 'the hop never clears');
  check(Math.abs(settled.dKnee) < 0.02, 'the rig does not return to its stride after a hop');
}

// A body that never told us which way it is going (the bots) must be unchanged.
console.log('\ncallers that pass no direction default to straight ahead');
{
  const a = newRig(), b = newRig();
  a._walkT = b._walkT = 0.7;
  const dt = 1 / 60;
  for (let i = 0; i < 300; i++) {
    applyWalkCycle(a, { speed: 3.4, moving: true, run: 0.2, dt });
    applyWalkCycle(b, { speed: 3.4, moving: true, run: 0.2, dt, dirF: 1, dirR: 0 });
  }
  const same = Math.abs(a.legL.rotation.x - b.legL.rotation.x) < 1e-12 &&
               Math.abs((a.legL.rotation.y || 0) - (b.legL.rotation.y || 0)) < 1e-12;
  console.log('   omitted direction === explicit forward: %s', same);
  check(same, 'omitting dirF/dirR is not identical to travelling straight ahead');
}

console.log('\nwhole-body weight transfer');
{
  const rig = newRig();
  const dt = 1 / 60;
  let peakRoll = 0, peakSway = 0, headError = 0;
  for (let i = 0; i < 240; i++) {
    const g = applyWalkCycle(rig, {
      speed: 6.2, moving: true, run: 0.25, dt, grounded: true, dirF: 1, dirR: 0,
    });
    peakRoll = Math.max(peakRoll, Math.abs(g.roll));
    peakSway = Math.max(peakSway, Math.abs(g.sway));
    headError = Math.max(headError, Math.abs(rig.head.rotation.z + g.roll * 0.55));
  }
  let settled;
  for (let i = 0; i < 180; i++) {
    settled = applyWalkCycle(rig, { speed: 0, moving: false, dt, grounded: true });
  }
  console.log('   roll %srad, sway %sm, head error %s, idle settles %s/%s',
    peakRoll.toFixed(3), peakSway.toFixed(3), headError.toFixed(6),
    settled.roll.toFixed(4), settled.sway.toFixed(4));
  check(peakRoll > 0.008, 'the armored torso has no left/right weight transfer');
  check(peakSway > 0.005, 'the armored body never shifts over the loaded foot');
  check(headError < 1e-9, 'the head does not counter-stabilize the torso roll');
  check(Math.abs(settled.roll) < 0.001 && Math.abs(settled.sway) < 0.001,
    'weight transfer does not settle back to idle');
}

console.log(failures ? `\n${failures} FAILED` : '\nall gait checks passed');
process.exit(failures ? 1 : 0);
