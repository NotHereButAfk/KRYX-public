import { Shop } from './Shop.js';
import { BP_MILESTONES, BP_TOTAL_TIERS, BP_XP_PER_TIER, battlePassProgress } from '../sim/BattlePassCatalog.js';

const KEY = 'sio_bp';
const usesServer = () => typeof location !== 'undefined' && !['localhost', '127.0.0.1'].includes(location.hostname);
const account = () => typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('sio_session');
let serverState = null, serverAccount = null, revision = 0;

function localData() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    return {
      ...data,
      xp: Number.isFinite(data.xp) ? Math.max(0, data.xp) : 0,
      claimed: Array.isArray(data.claimed) ? [...new Set(data.claimed.filter(key => typeof key === 'string'))] : [],
    };
  } catch { return { xp: 0, claimed: [] }; }
}

function activeData() {
  if (!usesServer()) return localData();
  return account() === serverAccount && serverState ? serverState : { xp: 0, claimed: [] };
}

async function request(path, body) {
  const owner = account(), requestRevision = ++revision;
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedUsername: owner }) } : {}),
  });
  const data = await response.json();
  if (account() !== owner) return { ok: false, err: 'Account changed. Open the battle pass again.' };
  if (!response.ok || data.error) return { ok: false, err: data.error || 'Battle pass is temporarily unavailable.' };
  if (!owner || owner === '__guest__' || data.owner?.username?.toLowerCase() !== owner.toLowerCase()) {
    return { ok: false, err: 'Your account changed in another tab. Sign in again to view this battle pass.' };
  }
  if (body) {
    // A newer GET may have read before this claim committed. Keep every
    // confirmed grant and invalidate pending pre-commit snapshots.
    revision++;
    const sameIdentity = serverAccount === owner && serverState?.ownerId === data.owner.id && serverState?.season === data.season;
    const previous = sameIdentity ? serverState : { xp: 0, claimed: [] };
    serverState = { xp: Math.max(data.xp, previous.xp), claimed: [...new Set([...previous.claimed, ...data.claimed])], ownerId: data.owner.id, season: data.season };
    serverAccount = owner;
  } else if (requestRevision === revision) {
    serverState = { xp: data.xp, claimed: data.claimed, ownerId: data.owner.id, season: data.season };
    serverAccount = owner;
  }
  // Confirmed server entitlements stay usable until the full account refresh.
  for (const skin of data.ownedSkins || []) if (skin.kind === 'character') Shop.unlock(skin.id);
  return { ok: true, ...data };
}

export { BP_MILESTONES };
export const BattlePass = {
  TOTAL_TIERS: BP_TOTAL_TIERS,
  XP_PER_TIER: BP_XP_PER_TIER,
  PREMIUM_COST: 0,
  hasPremium() { return true; },
  unlockPremium() { return { ok: true }; },
  usesServer,
  getData: activeData,
  getProgress() { return battlePassProgress(activeData()); },
  getTier() { return this.getProgress().tier; },
  getXPInTier() { return this.getProgress().xpInTier; },
  getClaimableCount() { return this.getProgress().claimable; },
  isClaimed(tier) { return this.getProgress().rewards.find(reward => reward.tier === tier)?.claimed || false; },

  addXP(amount) {
    const before = this.getTier();
    // Live progression uses authoritative recorded eliminations and matches.
    // Old browser XP is retained but never uploaded as evidence for a grant.
    if (!usesServer() && Number.isFinite(amount) && amount > 0) {
      const data = localData();
      data.xp += amount;
      localStorage.setItem(KEY, JSON.stringify(data));
    }
    return { newTier: this.getTier(), leveledUp: this.getTier() > before };
  },

  async refresh() {
    if (!usesServer()) return { ok: true };
    try { return await request('/api/battlepass'); }
    catch { return { ok: false, err: 'Unable to load your battle pass. Try again.' }; }
  },

  async claimReward(tier) { return this.claimRewards(tier); },
  async claimRewards(tier = null) {
    if (tier !== null && !BP_MILESTONES.some(reward => reward.tier === tier)) return { ok: false, err: 'Unknown reward.' };
    if (usesServer()) {
      try { return await request('/api/battlepass/claim', tier === null ? { all: true } : { tier }); }
      catch { return { ok: false, err: 'Unable to claim rewards. Try again.' }; }
    }
    const data = localData();
    const rewards = battlePassProgress(data).rewards.filter(reward => (tier === null || reward.tier === tier) && reward.reached && !reward.claimed);
    if (!rewards.length) return { ok: false, err: 'No rewards are ready to claim.' };
    for (const reward of rewards) {
      Shop.unlock(reward.id);
      data.claimed.push(reward.key);
    }
    localStorage.setItem(KEY, JSON.stringify(data));
    return { ok: true, granted: rewards.map(({ tier, id }) => ({ tier, id })) };
  },
};
