// One shared schedule for the client and authoritative reward service.
// Versioned keys keep former credit-track claims separate from these skins.
export const BP_SEASON = 'free-v2';
export const BP_XP_PER_TIER = 500;
export const BP_TOTAL_TIERS = 30;
export const BP_MILESTONES = Object.freeze([
  [5, 'remake_110'], [10, 'remake_154'], [15, 'remake_107'],
  [20, 'remake_205'], [25, 'remake_105'], [30, 'remake_181'],
].map(([tier, id]) => Object.freeze({
  tier, id, key: `${BP_SEASON}:${tier}`, type: 'skin', xp: (tier - 1) * BP_XP_PER_TIER,
})));

export function battlePassXP(stats = {}) {
  const count = value => Number.isSafeInteger(Number(value)) ? Math.max(0, Number(value)) : 0;
  return Math.min(Number.MAX_SAFE_INTEGER, count(stats.kills) * 25 + count(stats.games) * 100);
}

export function battlePassProgress(data = {}) {
  const xp = Number.isFinite(data.xp) ? Math.max(0, data.xp) : 0;
  const keys = new Set(Array.isArray(data.claimed) ? data.claimed : []);
  const tier = Math.min(BP_TOTAL_TIERS, Math.floor(xp / BP_XP_PER_TIER) + 1);
  const rewards = BP_MILESTONES.map(reward => ({ ...reward, reached: xp >= reward.xp, claimed: keys.has(reward.key) }));
  return {
    xp, tier, xpInTier: xp % BP_XP_PER_TIER, complete: tier === BP_TOTAL_TIERS,
    rewards, claimed: rewards.filter(reward => reward.claimed).length,
    claimable: rewards.filter(reward => reward.reached && !reward.claimed).length,
    next: rewards.find(reward => !reward.claimed) || rewards[rewards.length - 1],
  };
}
