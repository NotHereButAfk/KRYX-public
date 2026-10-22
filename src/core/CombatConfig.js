// Shared health regeneration contract for local and authoritative matches.
// Damage restarts the five-second delay; surviving players then recover at a
// steady rate until full health. Dead players never regenerate.
export const HEALTH_REGEN_DELAY = 5;
export const HEALTH_REGEN_RATE = 10;

// Shared shield-pickup contract. A shield stack lasts for one life, absorbs
// damage before health, and can be built up by revisiting loot pads.
export const SHIELD_PER_STACK = 30;
export const MAX_SHIELD_STACKS = 5;
export const MAX_PICKUP_SHIELD = SHIELD_PER_STACK * MAX_SHIELD_STACKS;
export const SHIELD_REGEN_RATE = 6;
export const SHIELD_REGEN_DELAY = 3;

export function addShieldStack(currentShield, currentMax, amount = SHIELD_PER_STACK) {
  const safeShield = Math.max(0, Number(currentShield) || 0);
  const safeMax = Math.max(0, Number(currentMax) || 0);
  const nextMax = Math.min(MAX_PICKUP_SHIELD, safeMax + Math.max(0, amount));
  const gained = nextMax - safeMax;
  return {
    shield: Math.min(nextMax, safeShield + gained),
    maxShield: nextMax,
    gained,
    stacks: Math.ceil(nextMax / SHIELD_PER_STACK),
  };
}
