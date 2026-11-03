import { skinPrice } from '../src/core/SkinPrices.js';
import { ARMOR_SKINS } from './characterskins.mjs';
import { SWORD_SKINS } from './swordskins.mjs';
import { WEAPON_SKINS } from './weaponskins.mjs';
export const STORE_ITEMS = [
  ...[...WEAPON_SKINS, ...SWORD_SKINS].map(({id,name,rarity}) => ({id,name,rarity,kind:'weapon',priceE:String(skinPrice(rarity))})),
  ...ARMOR_SKINS.map(({id,name,rarity}) => ({id,name,rarity,kind:'character',priceE:String(skinPrice(rarity))})),
];
