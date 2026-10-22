// Per-main-gun cosmetics. Retired and incompatible finishes fall back to Default.
import { getWeaponSkin, isSkinForWeapon } from '../weapons/WeaponSkins.js';
import { getWeapon } from '../weapons/weaponDefs.js';

const _KEY = 'sio_armory';

function _load() {
  try { return JSON.parse(localStorage.getItem(_KEY) || '{}'); }
  catch { return {}; }
}
function _save(d) { localStorage.setItem(_KEY, JSON.stringify(d)); }

export const Armory = {
  // Only the five main guns have purchasable finishes.
  canSkin(weaponId) {
    return weaponId === 'sword' || getWeapon(weaponId)?.category === 'main';
  },

  getSkinId(weaponId, isSword = false) {
    // No catalog default any more — an unset weapon simply has no skin (null).
    if (!this.canSkin(weaponId)) return null;
    const skinId = _load()[weaponId] || null;
    if (!isSkinForWeapon(weaponId, skinId)) return null;
    return this.ownsSkin(skinId) ? skinId : null;
  },

  // True only if the player has explicitly equipped a skin for this weapon
  // (vs. the implicit default) — used to decide whether to show it skinned.
  hasSkin(weaponId) {
    return this.canSkin(weaponId) && !!this.getSkinId(weaponId);
  },

  // ── ownership (gun + sword skins) ────────────────────────────────────────
  // The player's owned weapon/sword skin IDs. New accounts start with an
  // empty list, so the inventory only shows Default. Skins get added here
  // through the shop, battle pass, drops, etc.
  ownedSkins() {
    const d = _load();
    return Array.isArray(d.__owned) ? d.__owned.filter(id => getWeaponSkin(id)) : [];
  },
  ownsSkin(skinId) {
    return !!getWeaponSkin(skinId) && this.ownedSkins().includes(skinId);
  },
  grantSkin(skinId) {
    const d = _load();
    if (!Array.isArray(d.__owned)) d.__owned = [];
    if (!d.__owned.includes(skinId)) { d.__owned.push(skinId); _save(d); }
  },

  equipSkin(weaponId, skinId) {
    if (!this.canSkin(weaponId) || !this.ownsSkin(skinId)) return;   // extras/melee stay default
    if (!isSkinForWeapon(weaponId, skinId)) return;
    const d = _load();
    d[weaponId] = skinId;
    _save(d);
  },

  // Remove a weapon's skin so it shows its default (raw) look.
  clearSkin(weaponId) {
    const d = _load();
    delete d[weaponId];
    _save(d);
  },

  // Returns Map<weaponId, { skin, isSword }>  for all weapons in loadout.
  buildSkinMap(weapons) {
    const map = new Map();
    for (const w of weapons) {
      const saved = this.getSkinId(w.id);
      const skinId = w.category === 'main' && !isSkinForWeapon(w.id, saved) ? null : saved;
      map.set(w.id, { skin: skinId ? getWeaponSkin(skinId) : null, isSword: false });
    }
    return map;
  },
};
