// Stable client-facing module; the deploy server consumes the same canonical
// values from CombatConfig.js, which already exists on protected VPS installs.
export {
  SHIELD_PER_STACK,
  MAX_SHIELD_STACKS,
  MAX_PICKUP_SHIELD,
  SHIELD_REGEN_RATE,
  SHIELD_REGEN_DELAY,
  addShieldStack,
} from './CombatConfig.js';
