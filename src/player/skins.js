// Character body-tint catalog. Emptied — there are no selectable player skins.
// A single hardcoded default keeps the base soldier rendering; it is NOT part
// of the catalog array, so it never shows up in any shop / inventory skin list.
import { REMADE_CHARACTERS } from '../../server/remadecollection.mjs';
export const SKINS = [];

const DEFAULT_SKIN = { id: 'default', name: 'Default', primary: 0x596775, secondary: 0x202832 };

export function getSkin(id) {
  return SKINS.find((s) => s.id === id) || DEFAULT_SKIN;
}

// Same published body and rig as the player, with neutral bot-only materials.
export const BOT_SKIN = Object.freeze({...REMADE_CHARACTERS.find(s => s.id === 'remake_229')});
