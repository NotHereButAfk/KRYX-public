// Skins never change combat stats. They only change the post-kill reward
// multiplier. A player may equip one player skin, one main-gun skin and one
// sword skin; the highest rarity among those three determines the multiplier.
export const KILL_MULTIPLIER = {
  common: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

// Formatted perk description string for a given skin rarity (for shop/inventory tooltips)
export function describePerk(rarity) {
  return `${KILL_MULTIPLIER[rarity] || 1}× reward multiplier while equipped`;
}
