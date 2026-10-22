import { getArmorSkin } from '../player/ArmorSkins.js';
const _KEY     = 'sio_shop';
const _EQ_KEY  = 'sio_armor_skin';
const STARTER  = 500; // coins new players start with

function _load() {
  try { return JSON.parse(localStorage.getItem(_KEY) || `{"coins":${STARTER},"owned":[]}`); }
  catch { return { coins: STARTER, owned: [] }; }
}
function _save(d) { localStorage.setItem(_KEY, JSON.stringify(d)); }

export const Shop = {
  getCoins()  { return _load().coins; },
  getOwned()  { return (_load().owned || []).filter(id => getArmorSkin(id)); },
  isOwned(id) { return !!getArmorSkin(id) && this.getOwned().includes(id); },

  addCoins(n) {
    const d = _load();
    d.coins = (d.coins || 0) + n;
    _save(d);
    return d.coins;
  },

  buy(skinId, price) {
    if (skinId !== '__bp_premium__') return { ok: false, err: 'Skin purchases with in-game currency are no longer available' };
    const d = _load();
    if (d.owned.includes(skinId)) return { ok: false, err: 'Already owned' };
    if ((d.coins || 0) < price)   return { ok: false, err: 'Not enough coins' };
    d.coins -= price;
    d.owned.push(skinId);
    _save(d);
    return { ok: true, remaining: d.coins };
  },

  unlock(skinId) {
    const d = _load();
    if (!d.owned.includes(skinId)) {
      d.owned.push(skinId);
      _save(d);
    }
  },

  // Retired finishes fall back to the current unpainted model.
  getEquipped() {
    try {
      const stored = localStorage.getItem(_EQ_KEY);
      if (stored && this.isOwned(stored)) return stored;
      localStorage.setItem(_EQ_KEY, '');
      return null;
    } catch { return null; }
  },
  equip(skinId) { if (!skinId || this.isOwned(skinId)) localStorage.setItem(_EQ_KEY, skinId || ''); },
  unequip() { localStorage.setItem(_EQ_KEY, ''); },
};
