import { getArmorSkin } from '../player/ArmorSkins.js';
const _KEY       = 'sio_bp';
const XP_PER_TIER = 500;
const TOTAL_TIERS  = 30;
const PREMIUM_COST = 1000;

// ── Reward schedule ──────────────────────────────────────────────────────────
// Each entry: { tier, free: Reward, premium: Reward }
// Reward: { type: 'coins'|'skin', amount?, id? }

const FREE_SKINS    = ['ash','forest','cobalt','venom','arctic_f','sand_king'];
const PREMIUM_SKINS = ['khaki','slate','rust','crimson_f','midnight_f','inferno',
                        'glacial','phantom','wraith','aurum','obsidian','aurora','neon','void'];

export const BP_TIERS = (() => {
  let fi = 0, pi = 0;
  return Array.from({ length: TOTAL_TIERS }, (_, i) => {
    const t = i + 1;
    const freeIsSkin    = [5,10,15,20,25,30].includes(t);
    const premiumIsSkin = [1,3,6,9,12,15,17,20,22,24,26,28,30].includes(t);
    return {
      tier: t,
      free:    freeIsSkin    ? { type:'skin', id: FREE_SKINS[fi++]    } : { type:'coins', amount: t<=10?100:t<=20?150:200 },
      premium: premiumIsSkin ? { type:'skin', id: PREMIUM_SKINS[pi++] } : { type:'coins', amount: t<=10?200:t<=20?300:400 },
    };
  }).map(entry => {
    for (const track of ['free', 'premium']) {
      if (entry[track].type === 'skin' && !getArmorSkin(entry[track].id))
        entry[track] = { type: 'coins', amount: track === 'free' ? 500 : 1000 };
    }
    return entry;
  });
})();

function _load() {
  try { return JSON.parse(localStorage.getItem(_KEY) || '{"xp":0,"premium":false,"claimed":[]}'); }
  catch { return { xp: 0, premium: false, claimed: [] }; }
}
function _save(d) { localStorage.setItem(_KEY, JSON.stringify(d)); }

export const BattlePass = {
  getData()     { return _load(); },
  getTier()     { return Math.min(TOTAL_TIERS, Math.floor(_load().xp / XP_PER_TIER) + 1); },
  getXPInTier() { return _load().xp % XP_PER_TIER; },
  hasPremium()  { return _load().premium; },
  TOTAL_TIERS,
  XP_PER_TIER,
  PREMIUM_COST,

  addXP(amount) {
    const prevTier = BattlePass.getTier();
    const d = _load();
    d.xp = (d.xp || 0) + amount;
    _save(d);
    return { newTier: BattlePass.getTier(), leveledUp: BattlePass.getTier() > prevTier };
  },

  unlockPremium() {
    const d = _load();
    if (d.premium) return { ok: false, err: 'Already owned' };
    d.premium = true;
    _save(d);
    return { ok: true };
  },

  isClaimed(tier, track) {
    return _load().claimed.includes(`${tier}_${track}`);
  },

  claimReward(tier, track) {
    if (!Number.isInteger(tier) || tier < 1 || tier > TOTAL_TIERS || !['free','premium'].includes(track)) return { ok: false, err: 'Invalid reward' };
    const d     = _load();
    const key   = `${tier}_${track}`;
    if (d.claimed.includes(key))                           return { ok: false, err: 'Already claimed' };
    if (BattlePass.getTier() < tier)                       return { ok: false, err: 'Not reached yet' };
    if (track === 'premium' && !d.premium)                 return { ok: false, err: 'Premium required' };
    d.claimed.push(key);
    _save(d);
    return { ok: true, reward: BP_TIERS[tier - 1][track] };
  },

  getClaimableCount() {
    const d    = _load();
    const tier = BattlePass.getTier();
    let n = 0;
    for (let t = 1; t <= tier; t++) {
      if (!d.claimed.includes(`${t}_free`))                                    n++;
      if (d.premium && !d.claimed.includes(`${t}_premium`))                    n++;
    }
    return n;
  },
};
