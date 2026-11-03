export const SKIN_PRICES = Object.freeze({ common: 1000, rare: 1500, epic: 2000, legendary: 2500, mythic: 3000 });
export const REAL_MONEY_PURCHASES_ENABLED = false;
export function skinPrice(rarity) {
  if (!Object.hasOwn(SKIN_PRICES, rarity)) throw new Error('Unknown skin rarity');
  return SKIN_PRICES[rarity];
}
