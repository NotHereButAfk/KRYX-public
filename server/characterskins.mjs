import { REMADE_CHARACTERS } from './remadecollection.mjs';


export const RARITY_SHIELD = { common: 20, epic: 60, legendary: 80, mythic: 100 };

// Only the current Reforged collection is available to buy or equip.
export const ARMOR_SKINS = [...REMADE_CHARACTERS];

// Re-exported from the shared rarity module so every cosmetic system agrees.


export function getArmorSkin(id) {
  return ARMOR_SKINS.find(s => s.id === id) || null;
}
