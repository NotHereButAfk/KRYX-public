// Shared rarity system used by weapon skins, sword skins and armor skins.
// Ordered weakest → strongest. Each tier has a UI colour and a glow strength
// used for swatch borders / box-shadows.

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

export const RARITY_COLORS = {
  common:    '#9aabb8',
  rare:      '#3a9bff',
  epic:      '#b14df0',
  legendary: '#f5a623',
  mythic:    '#ff2e63',
};

// Relative glow intensity for swatch styling (0 = none, 1 = max).
export const RARITY_GLOW = {
  common:    0.0,
  rare:      0.4,
  epic:      0.7,
  legendary: 0.9,
  mythic:    1.0,
};

export function rarityRank(r) {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 ? 0 : i;
}

export function rarityColor(r) {
  return RARITY_COLORS[r] || RARITY_COLORS.common;
}

// Sort a copy of skins strongest-first (mythic → common), stable within a tier.
export function sortByRarityDesc(skins) {
  return skins
    .map((s, i) => [s, i])
    .sort((a, b) => (rarityRank(b[0].rarity) - rarityRank(a[0].rarity)) || (a[1] - b[1]))
    .map(([s]) => s);
}
