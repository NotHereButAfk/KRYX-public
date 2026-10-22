import { getWeapon, canAimWeapon } from '../weapons/weaponDefs.js';
import { FIRE_SPRINT_RECOVERY } from '../sim/MovementConfig.js';

// Shared desktop/mobile sprint intent. Keeping this in one place prevents the
// legacy controller, deterministic bridge, and authoritative client from
// disagreeing about which Shift key runs.
export function sprintRequested(input, forwardAmount, weaponBlocked = false, sidewaysAmount = 0) {
  if (weaponBlocked) return false;
  return input.isDown('ShiftLeft') || input.isDown('ShiftRight')
    || (input.isMobile && forwardAmount >= 0 && (forwardAmount > 0 || Math.abs(sidewaysAmount) > 0));
}

const CROUCH_KEYS = ['ControlLeft', 'ControlRight'];

export function crouchRequested(input) {
  return CROUCH_KEYS.some(code => input.isDown(code));
}

export function consumeSlidePress(input) {
  // C is a tap action; holding it never turns walking into a crouch.
  return input.consumeJustPressed('KeyC');
}

// Five-slot reference layout: Q blink, G smoke, U frag, V planted bomb, E blast.
export function consumeThrowable(input) {
  if (input.consumeJustPressed('KeyU')) return 'frag';
  if (input.consumeJustPressed('KeyV')) return 'timebomb';
  if (input.consumeJustPressed('KeyE')) return 'impulse';
  if (input.consumeJustPressed('KeyG')) return 'smoke';
  if (input.consumeJustPressed('KeyF')) return 'smoke';
  return null;
}

// Firing or aiming a firearm cancels sprint before movement is simulated.
// Keep the weapon shouldered while held and briefly through shot recovery.
export function updateWeaponSprintBlock(player, input, weaponId, dt) {
  const weapon = getWeapon(weaponId);
  player._weaponSprintRecovery = weapon && weapon.kind !== 'melee' && !player.isDead
    ? ((input.mouseDown || (input.rightMouseDown && canAimWeapon(weapon))) ? FIRE_SPRINT_RECOVERY : Math.max(0, (player._weaponSprintRecovery || 0) - dt)) : 0;
  player.weaponSprintBlocked = player._weaponSprintRecovery > 0;
  if (player.weaponSprintBlocked) player.isSprinting = false;
}

