import { playDesignedSound } from './SoundEffects.js';
export const WEAPON_SIGNATURES = Object.freeze({
  m4: 'rifle crack and muzzle blast', magnum: 'heavy revolver report',
  battlerifle: 'three-round crack', energyshotgun: 'belt-fed clatter',
  plasmarifle: 'capacitor discharge', uzi: 'compact bolt snap',
  levershotgun: 'wide blast and pump', rpg: 'launch and motor roar',
  concussion: 'hollow tube and drum latch',
});
export function playWeaponSignature(audio, id, rounds = 3) { playDesignedSound(audio, id, rounds); }
export function playBladeSlice(audio, variant = 0) { playDesignedSound(audio, 'slice'); }
export function playBladeImpact(audio, surface = 'armor') { playDesignedSound(audio, surface === 'metal' ? 'blade-metal' : 'blade-armor'); }
export function playBlastImpact(audio, kind = 'rocket') { playDesignedSound(audio, kind === 'grenade' ? 'grenade-blast' : 'rocket-blast'); }
