// Playback calibration measured from public/kyx-locomotion.glb. At 1x playback the
// planted feet travel beneath the body at roughly these world speeds.
export const HUMAN_CLIP_SPEED = Object.freeze({
  walk: 1.70,
  run: 4.28,
});

// The Walk and Run clips do not put the same planted foot at the same
// normalized time. These origins are measured from both ToeBase contact minima
// in public/kyx-locomotion.glb (right contact averaged with left contact minus 0.5).
// Convert through this shared contact phase when changing clips so a planted
// foot stays planted through the crossfade.
export const HUMAN_PHASE_ORIGIN = Object.freeze({
  walk: 0.70278,
  run: 0.68472,
});

// Additive upper-leg rotation needed once cadence reaches its believable cap.
// These gains are measured against public/kyx-locomotion.glb: the negative sine sign
// extends each planted foot's rearward travel. Calf warping is intentionally
// omitted because it shortens that travel and pushes the toes through the floor.
export const HUMAN_STRIDE_WARP = Object.freeze({
  walk: 0.50,
  run: 0.71,
});

// Airborne motion is procedural, layered over the neutral clip. Leaving a
// 0.34s Run->Idle crossfade active after takeoff visibly cycles the legs for a
// third of the jump, so air gets a decisive transition. Landing is a little
// softer to absorb contact before the grounded gait resumes.
export function humanMotionTransitionSeconds(fromMotion, toMotion) {
  if (toMotion === 'air') return 0.055;
  if (fromMotion === 'air') return 0.12;
  const fades = {
    idleToWalk: 0.22, walkToRun: 0.36, runToWalk: 0.34,
    walkToIdle: 0.30, idleToRun: 0.38, runToIdle: 0.38,
  };
  const key = `${fromMotion}To${toMotion.charAt(0).toUpperCase()}${toMotion.slice(1)}`;
  return fades[key] ?? 0.2;
}

const wrapPhase = (phase) => {
  const wrapped = phase % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

export function mapHumanMotionPhase(phase, fromMotion, toMotion) {
  const value = Number.isFinite(phase) ? wrapPhase(phase) : 0;
  if (fromMotion === toMotion) return value;
  const fromOrigin = HUMAN_PHASE_ORIGIN[fromMotion];
  const toOrigin = HUMAN_PHASE_ORIGIN[toMotion];
  // Idle is not a cyclic gait. Entering or leaving it deliberately starts the
  // destination at frame zero rather than carrying an unrelated idle phase.
  if (fromOrigin === undefined || toOrigin === undefined) return 0;
  return wrapPhase(value - fromOrigin + toOrigin);
}

export function selectHumanMotion(speed, sprinting = false, current = 'idle') {
  // Sprint intent cannot force a running clip when collision resolution says
  // the body did not move (for example, holding Shift+W into a wall).
  if (sprinting && speed > 0.55) return 'run';
  if (current === 'run') {
    if (speed > 3.55) return 'run';
  } else if (speed > 4.05) {
    return 'run';
  }
  if (speed > (current === 'idle' ? 0.55 : 0.32)) return 'walk';
  return 'idle';
}

export function targetHumanTimeScale(motion, speed, characterScale = 1) {
  if (motion === 'walk') {
    return characterScale * Math.max(0.55, Math.min(1.70, speed / HUMAN_CLIP_SPEED.walk));
  }
  if (motion === 'run') {
    // A full ground-match at the 13.2 m/s sci-fi sprint would require 3x+
    // playback and read like a cartoon. Cap cadence at a believable five-ish
    // steps/second; the remaining speed is expressed as a longer powered stride.
    return characterScale * Math.max(0.72, Math.min(1.38, speed / HUMAN_CLIP_SPEED.run));
  }
  return characterScale;
}

// Once cadence reaches its believable cap, lengthen the stride instead of
// spinning the legs faster. This is a target for the additive thigh layer
// in HumanSoldier; 1 means the authored clip needs no warping.
export function targetHumanStrideScale(motion, speed, timeScale, modelScale = 1) {
  const clipSpeed = HUMAN_CLIP_SPEED[motion];
  if (!clipSpeed || speed <= 0) return 1;
  const delivered = clipSpeed * Math.abs(timeScale) * Math.max(0.01, modelScale);
  return Math.max(1, Math.min(motion === 'run' ? 2.04 : 1.6,
    speed / Math.max(0.01, delivered)));
}

export function humanStrideWarpAngle(motion, strideScale, gaitPhase) {
  const gain = HUMAN_STRIDE_WARP[motion] || 0;
  if (!gain || strideScale <= 1) return 0;
  return -Math.sin(gaitPhase) * (strideScale - 1) * gain;
}

export function dampHumanTimeScale(current, target, dt, response = 9) {
  return target + (current - target) * Math.exp(-response * Math.max(0, dt));
}

// Anatomical upper-body aim limits. Network yaw can legitimately cross the
// ±π seam while the body is still catching up; feeding that raw delta into the
// spine lets the chest rotate almost 180° and makes the torso look detachable.
// The remaining turn belongs to the character root, not the ribcage.
export function humanAimPose(pitch = 0, yaw = 0) {
  const safePitch = Number.isFinite(pitch) ? pitch : 0;
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  const wrappedYaw = ((safeYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2)
    % (Math.PI * 2) - Math.PI;
  return {
    pitch: Math.max(-0.78, Math.min(0.78, safePitch)),
    yaw: Math.max(-0.62, Math.min(0.62, wrappedYaw)),
  };
}

// Convert resolved travel in body space into the lower-body yaw and playback
// direction used by the Soldier rig. Keeping this pure makes the lateral
// forward/back crossover measurable instead of relying on an eyeballed pose.
export function humanTravelPose(dirF = 1, dirR = 0, wasReverse = false) {
  const forward = Number.isFinite(dirF) ? dirF : 1;
  const right = Number.isFinite(dirR) ? dirR : 0;
  const reverse = wasReverse ? forward <= 0.20 : forward < -0.20;
  const denominator = Math.max(1e-5, reverse ? -forward : forward);
  const yaw = Math.atan2(-right, denominator);
  return {
    reverse,
    yaw: Math.max(-Math.PI * 0.52, Math.min(Math.PI * 0.52, yaw)),
  };
}
