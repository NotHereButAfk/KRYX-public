// Action animation check — `npm run test:actions`
//
// The rule this enforces: if it is an ACTION, it has to move the body. Every
// one of these shipped at some point doing nothing visible at all — a reload
// the character didn't react to, a sword lunge where the blade moved and the
// arms carried on swinging with the stride, a sprint-slide that ran the normal
// walk cycle at knee height.
//
// Each case drives the real pose function against a plain-object rig and
// measures how far the joints it is supposed to move actually moved, against a
// control rig doing the same thing WITHOUT the action. A pose that forgets to
// apply something scores zero and fails, which is exactly the bug class here —
// silence rather than a wrong number.
import { applyWalkCycle, groundPerCycle } from '../src/player/Locomotion.js';
import { applyRifleCarry } from '../src/player/RifleCarry.js';
import { triggerAction, tickActions, applyMeleeCarry, ACTION_TIME } from '../src/player/Actions.js';
import {
  createHumanActionPose,
  createHumanDeathPose,
  sampleHumanActionPose,
  sampleHumanDeathPose,
} from '../src/player/HumanActionMotion.js';

const JOINTS = ['legL', 'legR', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
                'armL', 'armR', 'elbowL', 'elbowR'];
// Enough of an Object3D for the pose code: the walk cycle writes rotation
// channels directly, the arm IK calls rotation.set() and copies a quaternion.
const joint = () => ({
  rotation: { x: 0, y: 0, z: 0, order: 'XYZ',
              set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
  quaternion: { x: 0, y: 0, z: 0, w: 1,
                copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; } },
});
const newRig = () => {
  const r = { _walkT: 0.6, _moveBlend: 0, _lean: 0 };
  for (const j of JOINTS) r[j] = joint();
  return r;
};
// A stand-in for the weapon Object3D: only position/rotation/quaternion are touched.
const newWeapon = () => ({
  position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
              copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } },
  rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
  quaternion: { x: 0, y: 0, z: 0, w: 1,
                copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; } },
});

// Shoulders are set by the IK as a quaternion and elbows as a hinge angle, so
// read both — sampling only rotation.x would score every gun action as zero.
const armPose = (rig) => JOINTS.filter((j) => j.startsWith('arm') || j.startsWith('elbow'))
  .flatMap((j) => { const o = rig[j];
    return [o.rotation.x, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]; });
const legPose = (rig) => JOINTS.filter((j) => j.startsWith('leg') || j.startsWith('knee') || j.startsWith('ankle'))
  .map((j) => rig[j].rotation.x);
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const wDiff = (a, b) => Math.max(
  Math.abs(a.position.x - b.position.x), Math.abs(a.position.y - b.position.y),
  Math.abs(a.position.z - b.position.z),
  Math.abs(a.quaternion.x - b.quaternion.x), Math.abs(a.quaternion.y - b.quaternion.y),
  Math.abs(a.quaternion.z - b.quaternion.z), Math.abs(a.quaternion.w - b.quaternion.w),
  Math.abs(a.rotation.x - b.rotation.x), Math.abs(a.rotation.z - b.rotation.z));

let failures = 0;
const results = [];
function record(name, moved, limit, what) {
  const ok = moved >= limit;
  if (!ok) failures++;
  results.push({ name, moved, limit, ok, what });
}

const dt = 1 / 60;

// The preferred rigged soldier has its own additive action layer. Each curve
// must visibly move, return to neutral, and remain continuous.
for (const [name, input, what] of [
  ['human reload', (p) => ({ reload: p }), 'support arm visits magazine and rack'],
  ['human swap', (p) => ({ swap: p }), 'both arms lower and recover'],
  ['human throw', (p) => ({ throwP: p }), 'off arm winds, releases, and recovers'],
  ['human melee', (p) => ({ swing: p }), 'weapon arm winds, cuts, and recovers'],
]) {
  const pose = createHumanActionPose();
  let peak = 0, worstStep = 0;
  let previous = null;
  for (let i = 0; i <= 120; i++) {
    sampleHumanActionPose(input(i / 120), pose);
    const values = Object.values(pose);
    peak = Math.max(peak, ...values.map(Math.abs));
    if (previous) {
      worstStep = Math.max(
        worstStep,
        ...values.map((v, j) => Math.abs(v - previous[j]))
      );
    }
    previous = values.slice();
  }
  record(name, peak, 0.3, what);
  const continuous = worstStep < 0.16;
  if (!continuous) failures++;
  results.push({
    name: `${name} — continuous`,
    moved: continuous ? 1 : 0,
    limit: 1,
    ok: continuous,
    what: `largest 1/120-step delta ${worstStep.toFixed(3)}rad`,
  });
  sampleHumanActionPose(input(1), pose);
  const neutral = Object.values(pose).every((v) => Math.abs(v) < 1e-9);
  if (!neutral) failures++;
  results.push({
    name: `${name} — neutral finish`,
    moved: neutral ? 1 : 0,
    limit: 1,
    ok: neutral,
    what: 'no end-of-action pose pop',
  });
}

// A human elimination bends the skeleton itself. It must be continuous,
// mirrored by fall side, deterministic across sampling rates, and remain in
// the final crumpled pose rather than snapping back to neutral.
{
  const sampleAt = (p, side = 1) => Object.values(sampleHumanDeathPose(p, side));
  let peak = 0, worstStep = 0;
  let previous = sampleAt(0);
  for (let i = 1; i <= 120; i++) {
    const values = sampleAt(i / 120);
    peak = Math.max(peak, ...values.map(Math.abs));
    worstStep = Math.max(worstStep, ...values.map((v, j) => Math.abs(v - previous[j])));
    previous = values;
  }
  record('human death crumple', peak, 0.65, 'hips, spine, head, arms and legs collapse');
  const continuous = worstStep < 0.08;
  if (!continuous) failures++;
  results.push({
    name: 'human death — continuous', moved: continuous ? 1 : 0, limit: 1, ok: continuous,
    what: `largest 1/120-step delta ${worstStep.toFixed(3)}rad`,
  });
  const left = sampleHumanDeathPose(1, -1);
  const right = sampleHumanDeathPose(1, 1);
  const centralZ = ['hipsZ', 'spineZ', 'chestZ', 'headZ', 'rLegZ', 'lLegZ'];
  const mirrored = centralZ.every((key) => Math.abs(left[key] + right[key]) < 1e-12)
    && Math.abs(left.rArmZ + right.lArmZ) < 1e-12
    && Math.abs(left.lArmZ + right.rArmZ) < 1e-12;
  if (!mirrored) failures++;
  results.push({
    name: 'human death — mirrored sides', moved: mirrored ? 1 : 0, limit: 1, ok: mirrored,
    what: 'left/right falls are exact mirrors',
  });
}

// ── gun actions: reload / swap / flinch / throw ─────────────────────────────
// Each drives applyRifleCarry against a control with the action left out, so
// what is measured is the action's own contribution and nothing else.
for (const [name, key, what] of [
  ['reload',        'reload', 'weapon rolls over, support hand goes to the mag'],
  ['weapon swap',   'swap',   'weapon drops out of frame and comes back'],
  ['damage flinch', 'flinch', 'weapon dips, arms follow'],
  ['grenade throw', 'throwP', 'off arm winds up and lobs'],
]) {
  const rig = newRig(), ctrl = newRig();
  const w = newWeapon(), wc = newWeapon();
  let armMoved = 0, weaponMoved = 0;
  for (let i = 0; i <= 30; i++) {
    const p = i / 30;                              // 0 → 1 through the action
    applyRifleCarry(rig,  w,  0.2, dt, { swing: 0, kick: 0, [key]: p });
    applyRifleCarry(ctrl, wc, 0.2, dt, { swing: 0, kick: 0 });
    armMoved = Math.max(armMoved, maxDiff(armPose(rig), armPose(ctrl)));
    weaponMoved = Math.max(weaponMoved, wDiff(w, wc));
  }
  record(name, Math.max(armMoved, weaponMoved), 0.10, what);
  // A gun action that only moves the weapon and leaves the hands behind is
  // worse than none — the arms are IK'd onto it and must come along.
  record(name + ' — hands follow', armMoved, 0.05, 'arms track the weapon');
}

// ── melee swing ─────────────────────────────────────────────────────────────
{
  const rig = newRig(), ctrl = newRig();
  const w = newWeapon(), wc = newWeapon();
  let armMoved = 0, bladeMoved = 0;
  for (let i = 0; i <= 30; i++) {
    const p = i / 30;
    applyMeleeCarry(rig,  w,  { swing: p, moving: false, phase: 0.6, run: 0, dt });
    applyMeleeCarry(ctrl, wc, { swing: 1, moving: false, phase: 0.6, run: 0, dt });
    armMoved = Math.max(armMoved, maxDiff(armPose(rig), armPose(ctrl)));
    bladeMoved = Math.max(bladeMoved, wDiff(w, wc));
  }
  record('melee swing', armMoved, 0.8, 'arm drives the strike');
  record('melee swing — blade follows', bladeMoved, 0.5, 'blade tracks the arm');

  // "The blade moved" is not enough — it moved plenty while sitting a forearm's
  // length away from the arm swinging it, because the two were keyed
  // separately. Walk the arm to the hand independently and check the blade is
  // actually there. Same rig metrics as RifleCarry; both joints pitch about X.
  const SH_Y = 1.76, UP = 0.48, FORE = 0.385;
  let worstGap = 0;
  for (let i = 0; i <= 30; i++) {
    const p = i / 30;
    applyMeleeCarry(rig, w, { swing: p, moving: false, phase: 0.6, run: 0, dt });
    const a = rig.armR.rotation.x, e = rig.elbowR.rotation.x, tot = a + e;
    const hy = SH_Y - UP * Math.cos(a) - FORE * Math.cos(tot);
    const hz = -UP * Math.sin(a) - FORE * Math.sin(tot);
    worstGap = Math.max(worstGap, Math.hypot(w.position.y - hy, w.position.z - hz));
  }
  const inHand = worstGap < 0.05;
  if (!inHand) failures++;
  results.push({ name: 'melee swing — blade in hand', moved: inHand ? 1 : 0, limit: 1, ok: inHand,
                 what: inHand ? 'grip holds through the arc'
                              : `blade is ${worstGap.toFixed(2)}m from the hand` });
}

// ── slide ───────────────────────────────────────────────────────────────────
{
  const rig = newRig(), ctrl = newRig();
  const o = { speed: 9.6, moving: true, run: 1, dt };
  for (let i = 0; i < 120; i++) { applyWalkCycle(rig, o); applyWalkCycle(ctrl, o); }
  let legMoved = 0, leanMoved = 0;
  for (let i = 0; i < 40; i++) {
    const g = applyWalkCycle(rig, { ...o, slide: 1 });
    const c = applyWalkCycle(ctrl, o);
    legMoved = Math.max(legMoved, maxDiff(legPose(rig), legPose(ctrl)));
    leanMoved = Math.max(leanMoved, Math.abs(g.lean - c.lean));
  }
  record('slide', legMoved, 0.8, 'lead leg out, trailing leg folded under');
  record('slide — torso tips back', leanMoved, 0.15, 'body leans over the trailing leg');
}

// ── one-shot clocks ─────────────────────────────────────────────────────────
{
  const rig = newRig();
  triggerAction(rig, 'throw');
  const seen = [];
  for (let i = 0; i < Math.ceil(ACTION_TIME.throw / dt) + 10; i++) {
    seen.push(tickActions(rig, dt).throw);
  }
  const ran = seen.filter((v) => v > 0).length;
  const rose = seen.every((v, i) => i === 0 || v === 0 || seen[i - 1] === 0 || v >= seen[i - 1]);
  const ended = seen[seen.length - 1] === 0;
  record('throw clock runs', ran / 60, ACTION_TIME.throw * 0.8, `${ran} frames`);
  if (!rose) { failures++; results.push({ name: 'throw clock is monotonic', moved: 0, limit: 1, ok: false, what: 'progress went backwards' }); }
  if (!ended) { failures++; results.push({ name: 'throw clock ends', moved: 0, limit: 1, ok: false, what: 'never finished' }); }

  // Re-triggering mid-action restarts it — a second hit during a flinch.
  triggerAction(rig, 'flinch');
  for (let i = 0; i < 8; i++) tickActions(rig, dt);
  const mid = tickActions(rig, dt).flinch;
  triggerAction(rig, 'flinch');
  const after = tickActions(rig, dt).flinch;
  if (!(after < mid)) {
    failures++;
    results.push({ name: 'flinch restarts', moved: 0, limit: 1, ok: false,
                   what: `re-trigger did not reset (${mid.toFixed(2)} → ${after.toFixed(2)})` });
  } else {
    results.push({ name: 'flinch restarts', moved: 1, limit: 1, ok: true, what: 'a second hit resets it' });
  }
}

// ── the zombie shamble ──────────────────────────────────────────────────────
// Different rig, different (deliberately limping) cycle, same requirement: the
// legs have to cover the ground the body travels. This measures the pose itself
// — how much ground one cycle delivers — because the zombie's phase is advanced
// by distance, so given a sane number here the feet plant by construction. It
// shipped delivering 4% of what it needed.
{
  const ZG = { hipWeak: 0.45, hipStrong: 0.62, kneeWeak: 0.55, kneeStrong: 0.70 };
  const ZL = { hipY: 1.06, thigh: 0.48, shin: 0.42, soleY: -0.102, toeZ: -0.10, heelZ: 0.18 };
  const shamble = (S) => (p) => [
    -Math.sin(p) * ZG.hipWeak * S,  -Math.max(0, -Math.cos(p)) * ZG.kneeWeak * S,   -Math.sin(p) * 0.08,
     Math.sin(p) * ZG.hipStrong * S, -Math.max(0, Math.cos(p)) * ZG.kneeStrong * S,  Math.sin(p) * 0.10,
  ];
  for (const [name, stride, speed] of [['shambler', 1.0, 1.95], ['runner', 0.85, 3.22], ['brute', 1.30, 1.40]]) {
    const per = groundPerCycle(ZL, shamble(stride));
    const cadence = speed / per;                    // cycles per second
    // Legs that deliver almost nothing per cycle force an absurd cadence; the
    // shipped pose needed 4.3 cycles/s at a walk and ran at 0.5.
    const ok = per > 0.4 && cadence < 6;
    if (!ok) failures++;
    results.push({ name: `zombie ${name}`, moved: per, limit: 0.4, ok,
                   what: `${per.toFixed(2)}m per cycle → ${cadence.toFixed(1)} cycles/s at ${speed} m/s` });
  }
  // End-to-end: advance the phase by distance the way Zombie._animate does and
  // measure what the planted foot actually does, at a true 60Hz. The in-game
  // reading is useless here — headless runs the sim at a couple of frames a
  // second and a shambler cycles twice a second, so any two samples straddle
  // most of a stride.
  {
    const S = 1.0, speed = 1.95, dt = 1 / 60;
    const perCycle = groundPerCycle(ZL, shamble(S));
    const pose = shamble(S);
    const at = (cy, cz, th, kn, an) => {
      let y = cy, z = cz, c, s;
      c = Math.cos(an); s = Math.sin(an); [y, z] = [y * c - z * s, y * s + z * c];
      y -= ZL.shin;
      c = Math.cos(kn); s = Math.sin(kn); [y, z] = [y * c - z * s, y * s + z * c];
      y -= ZL.thigh;
      c = Math.cos(th); s = Math.sin(th); [y, z] = [y * c - z * s, y * s + z * c];
      return { y: y + ZL.hipY, z };
    };
    let phase = 0, bz = 0, prev = null, num = 0, den = 0;
    for (let i = 0; i < 1200; i++) {
      const dist = speed * dt;
      bz -= dist;                                   // forward is -Z
      phase += ((Math.PI * 2) / perCycle) * dist;
      const q = pose(phase);
      const leg = (o) => {
        const th = q[o], kn = q[o + 1], an = q[o + 2];
        return { low: Math.min(at(ZL.soleY, ZL.heelZ, th, kn, an).y,
                               at(ZL.soleY, ZL.toeZ, th, kn, an).y),
                 az: bz + at(0, 0, th, kn, an).z };
      };
      const L = leg(0), R = leg(3);
      const cur = { L, R };
      if (prev && i > 120) for (const k of ['L', 'R']) {
        const other = k === 'L' ? 'R' : 'L';
        const w = 1 / (1 + Math.exp(-((prev[other].low + cur[other].low)
                                    - (prev[k].low + cur[k].low)) / 0.02));
        num += w * -(cur[k].az - prev[k].az);       // travel along -Z
        den += w * dist;
      }
      prev = cur;
    }
    const slip = den ? num / den : 1;
    const ok = Math.abs(slip) < 0.25;
    if (!ok) failures++;
    results.push({ name: 'zombie planted-foot slip', moved: slip, limit: 0.25, ok,
                   what: ok ? 'feet plant, body moves over them'
                            : `slides ${(slip * 100).toFixed(0)}% of the way` });
  }

  // A knee that folds forwards, or bends through the stance instead of the
  // swing, is what made the shipped cycle net out to nothing.
  const shipped = (p) => [
    -Math.sin(p) * 0.18,  Math.max(0, Math.sin(p)) * 0.28, -Math.sin(p) * 0.08,
     Math.sin(p) * 0.30,  Math.max(0, -Math.sin(p)) * 0.38, Math.sin(p) * 0.10,
  ];
  const old = groundPerCycle(ZL, shipped);
  results.push({ name: 'zombie knee phasing', moved: old < 0.4 ? 1 : 0, limit: 1, ok: old < 0.4,
                 what: `the knees-through-stance version nets ${old.toFixed(2)}m — kept as a guard` });
  if (!(old < 0.4)) failures++;
}

// ── report ──────────────────────────────────────────────────────────────────
console.log('every action has to move the body — measured against the same');
console.log('pose with the action left out\n');
const pad = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const amt = r.moved >= 1 && r.limit === 1 ? '     ' : r.moved.toFixed(2).padStart(5);
  console.log('   %s %s %s   %s', r.ok ? ' ok ' : 'FAIL', r.name.padEnd(pad), amt, r.what);
}
console.log(failures ? `\n${failures} FAILED` : '\nall action checks passed');
process.exit(failures ? 1 : 0);
