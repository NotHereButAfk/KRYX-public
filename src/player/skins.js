// Player defaults use the current Reforged catalog. Retired body-tint IDs map
// to Default Reforged; selectable cosmetics are exposed by ArmorSkins.
import { REMADE_CHARACTERS } from '../../server/remadecollection.mjs';
export const SKINS = [];

const DEFAULT_SKIN = Object.freeze({ ...REMADE_CHARACTERS.find(s => s.id === 'remake_84'), id: 'default', price: 0 });

export function getSkin(id) {
  return SKINS.find((s) => s.id === id) || DEFAULT_SKIN;
}

// Same published body and rig as the player, with neutral bot-only materials.
export const BOT_SKIN = Object.freeze({...REMADE_CHARACTERS.find(s => s.id === 'remake_229')});
