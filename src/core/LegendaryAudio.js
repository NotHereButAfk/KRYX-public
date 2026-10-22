import { WEAPON_SKINS } from '../../server/weaponskins.mjs';
import { renderSound } from './SoundEffects.js';
const skins = new Map(WEAPON_SKINS.filter(s => s.rarity === 'legendary').map(s => [s.shootSound, s]));
const accents = ['fire','water','garden','toxic','neko'];
export function createLegendaryShot(soundId, sampleRate) {
  const skin = skins.get(soundId);
  if (!skin) return null;
  const style = (skin.legendaryStyle || 0) % accents.length;
  const report = renderSound(skin.weaponId, sampleRate, style % 4);
  const accent = renderSound(accents[style], sampleRate, style % 4);
  const data = new Float32Array(Math.max(report.length, accent.length));
  let peak = 0;
  for (let i=0;i<data.length;i++) {
    data[i] = (report[i] || 0) * .85 + (accent[i] || 0) * .22;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  // Preserve the weapon's report under its collectible accent; reserve headroom.
  if (peak) for (let i=0;i<data.length;i++) data[i] *= .58 / peak;
  return data;
}
