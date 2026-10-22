// Shared stamina contract for the legacy controller, deterministic prediction,
// and authoritative server. Sprinting stops at the existing 2-point reserve,
// so the original usable duration was (100 - 2) / 28 = 3.5s. The
// player now receives exactly seven additional seconds without changing the
// familiar 0-100 HUD scale or regeneration behavior.
export const STAMINA_MAX = 100;
export const PLAYER_SPRINT_SECONDS = ((STAMINA_MAX - 2) / 28) + 7;
// Tiny epsilon keeps the quantized 20 Hz authority from granting an extra
// 50ms tick when the meter lands microscopically above the 2-point cutoff.
export const STAMINA_DRAIN = ((STAMINA_MAX - 2) / PLAYER_SPRINT_SECONDS) + 1e-4;
export const STAMINA_REGEN = 14;
export const STAMINA_REGEN_DELAY = 1.2;

// Shared player/bot pace approved in the footwork preview.
export const WALK_SPEED = 7.2;
export const BACKWARD_WALK_MULT = .5;
export const SPRINT_MULT = 11.2 / WALK_SPEED;
export const PLAYER_EYE_HEIGHT = 1.8;
// KYX jump tuning: 20% more ballistic height at unchanged gravity.
export const JUMP_SPEED = 13.8 * Math.sqrt(1.2);
export const SLIDE_LAUNCH_SPEED = WALK_SPEED * SPRINT_MULT * 1.65;

// Firearm trigger recovery keeps sprint from restarting between shots.
export const FIRE_SPRINT_RECOVERY = 0.4;

// Bots and players share the approved travel speed and stride cadence.
export const BOT_MOVEMENT_SCALE = 1;
