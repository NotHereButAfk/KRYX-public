// ═══════════════════════════════════════════════════════════════════════════
// Body proportions — one source of truth for the figure everything is built on.
//
// These numbers used to be copied into three files: the skeleton in
// HeroBody.js, the ground solve in Locomotion.js, and the arm IK in
// RifleCarry.js. Nothing derived them from anything, so the only thing keeping
// them equal was that nobody had touched them. That is the same shape of bug
// that had the gun aiming 24° off the shot (three call sites, three opinions),
// so the figure lives here now and the other three import it.
//
// ─── WHY THESE NUMBERS ───────────────────────────────────────────────────────
// The body was a 2.21m figure — 7'3" — while Player.js puts your eyes at 1.70m.
// The character you saw was not the character you were: a third-person body
// whose eyes sat 28cm above your own, on stilt ankles 12.2% of its height off
// the floor where a human ankle is 3.9%, with arms 17% longer than human and a
// head big enough to make it six heads tall instead of seven and a half.
//
// So the figure is now built from standard adult anthropometry, expressed as
// fractions of stature, at the ONE stature that agrees with the game: eye
// height is 0.936 of stature. The shared 1.80m camera now gives a 1.923m
// figure, with the same anatomy for players and bots.
//
// Landmark fractions are the conventional ones (eye 0.936, shoulder 0.820,
// elbow 0.630, wrist 0.485, hip joint 0.530, knee 0.285, ankle 0.039). Widths
// are joint spacings, NOT body breadths — the femoral heads sit ~0.045H off the
// midline even though the hips measure twice that across the outside, and
// confusing the two is how you end up "fixing" a hip that was already right.
// ═══════════════════════════════════════════════════════════════════════════

/** Shared gameplay eye height. The figure is sized so its eyes land here. */
export { PLAYER_EYE_HEIGHT as EYE_HEIGHT } from '../sim/MovementConfig.js';
import { PLAYER_EYE_HEIGHT as EYE_HEIGHT } from '../sim/MovementConfig.js';

/** Stature: eye height is 0.936 of it. */
export const STATURE = +(EYE_HEIGHT / 0.936).toFixed(3);

/**
 * World presentation scale for human-controlled characters.
 *
 * Players, bots, gameplay capsules, and the first-person camera must describe
 * the same body.  Scaling only the rendered mesh made a 1.816 m character
 * appear 2.724 m tall while its eyes and collision capsule stayed at 1.70 m;
 * that is why first-person felt waist-high next to every other player.
 */
export const PLAYER_WORLD_MODEL_SCALE = 1.0;

const at = (frac) => +(frac * STATURE).toFixed(4);

// ── vertical landmarks ───────────────────────────────────────────────────────
export const CROWN_Y     = STATURE;
export const EYE_Y       = at(0.936);
export const CHIN_Y      = at(0.870);
export const SHOULDER_Y  = at(0.820);
export const ELBOW_Y     = at(0.630);
export const WRIST_Y     = at(0.485);
export const HIP_Y       = at(0.530);
export const KNEE_Y      = at(0.285);
export const ANKLE_Y     = at(0.039);

// ── spine chain, for a torso that deforms like a torso ───────────────────────
export const PELVIS_Y = at(0.550);
export const LUMBAR_Y = at(0.620);
export const THORAX_Y = at(0.720);
export const NECK_Y   = at(0.825);
export const HEAD_Y   = at(0.895);

// ── joint spacings (from the midline) ────────────────────────────────────────
export const SHOULDER_X = at(0.115);   // acromion
export const HIP_X      = at(0.045);   // femoral head, not hip breadth

// ── derived bone lengths ─────────────────────────────────────────────────────
export const UP_ARM  = +(SHOULDER_Y - ELBOW_Y).toFixed(4);
export const FOREARM = +(ELBOW_Y - WRIST_Y).toFixed(4);
export const THIGH_L = +(HIP_Y - KNEE_Y).toFixed(4);
export const SHIN_L  = +(KNEE_Y - ANKLE_Y).toFixed(4);

// ── foot ─────────────────────────────────────────────────────────────────────
// Foot length is ~0.152 of stature. The heel sits behind the ankle and the toe
// well ahead of it; these two corners are what Locomotion plants on the floor,
// in ANKLE-LOCAL space (so sole = −ANKLE_Y).
export const FOOT_LEN = at(0.152);
export const HEEL_Z   = +(FOOT_LEN * 0.22).toFixed(4);    // behind the ankle
export const TOE_Z    = -+(FOOT_LEN * 0.78).toFixed(4);   // ahead of it
export const SOLE_Y   = -ANKLE_Y;

/** Height above the feet at which a hit counts as a headshot. */
export const HEADSHOT_Y = +(((CHIN_Y + SHOULDER_Y) / 2)).toFixed(3);

// ── the figure this replaces ─────────────────────────────────────────────────
// Kept so the remap in HeroBody.js can carry the authored station tables over
// rather than every radius and height being retyped by hand.
export const LEGACY = {
  STATURE: 2.207, HIP_Y: 1.21, KNEE_Y: 0.62, ANKLE_Y: 0.27,
  SHOULDER_Y: 1.76, SHOULDER_X: 0.27, ELBOW_Y: 1.28, WRIST_Y: 0.895,
  PELVIS_Y: 1.06, LUMBAR_Y: 1.30, THORAX_Y: 1.52, NECK_Y: 1.72, HEAD_Y: 1.86,
  CHIN_Y: 1.838, CROWN_Y: 2.207, HIP_X: 0.11,
};

/**
 * Piecewise-linear remap from the old figure's heights onto the new one.
 *
 * Applied to the authored station tables so the anatomy that was shaped against
 * the old skeleton — the quad belly, the calf, the ribcage taper — lands in the
 * same place on the new one, instead of being uniformly squashed and every
 * muscle drifting off its joint.
 */
export function remapY(anchors) {
  const a = anchors.slice().sort((p, q) => p[0] - q[0]);
  return (y) => {
    if (y <= a[0][0]) return a[0][1] + (y - a[0][0]);
    for (let i = 0; i < a.length - 1; i++) {
      const [y0, n0] = a[i], [y1, n1] = a[i + 1];
      if (y <= y1) return n0 + (n1 - n0) * ((y - y0) / (y1 - y0));
    }
    const [yL, nL] = a[a.length - 1];
    return nL + (y - yL);
  };
}

/** How much to shrink girth by. Uniform: it preserves the shaping as authored. */
export const GIRTH = +(STATURE / LEGACY.STATURE).toFixed(4);
