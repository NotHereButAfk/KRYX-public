/**
 * INVENTORY (ev.io-style) — simple tabs + card grid.
 *
 * Tabs: Character + 5 main weapons + Sword. Each tab shows a "Default" card
 * (base look) plus every skin for that item. Only ONE gun can be your main
 * weapon at a time — clicking any gun card (Default or a skin) sets that gun
 * as main and applies its skin. The EQUIPPED row shows the current character
 * skin + main weapon card.
 */
import { characterPortrait } from './CareerPreview.js';
import { THEMED_SKIN_CARDS } from './MarketPreview.js';
import { getSkin } from '../player/skins.js';
import { ARMOR_SKINS, RARITY_COLORS, getArmorSkin } from '../player/ArmorSkins.js';
import { MAIN_WEAPON_IDS, WEAPONS, isMainWeaponId } from '../weapons/weaponDefs.js';
import { ALL_WEAPON_SKINS as WEAPON_SKINS, getWeaponSkinsFor } from '../weapons/WeaponSkins.js';
import { Armory } from '../core/Armory.js';
import { Loadout } from '../core/Loadout.js';
import { EAccount } from '../core/EAccount.js';
import { Shop } from '../core/Shop.js';
import { UserAccount } from '../core/UserAccount.js';
import { warmWeaponThumbs, getWeaponThumb, renderWeaponSkinned } from './WeaponThumbnails.js';

// The five permanent weapon choices. Specials and heavies are collected from
// glowing pads during a live match, so they do not appear in this menu.
const EV_INVENTORY_LABELS = ['Auto Rifle', 'Hand Cannon', 'Burst Rifle', 'Sweeper', 'Laser Rifle'];
export const MAIN_GUNS = MAIN_WEAPON_IDS.map((id, index) => {
  const weapon = WEAPONS.find((w) => w.id === id);
  return { id, label: EV_INVENTORY_LABELS[index] || weapon?.name || id };
});
// Melee remains a separate equipment slot.
const MELEE = WEAPONS.filter(w => w.id === 'sword').map((w) => ({ id: w.id, label: 'Sword' }));

// Tab strip organised into labelled groups.
const TAB_GROUPS = [
  { label: null,    tabs: [{ id: 'character', label: 'Character' }] },
  { label: 'MAIN',  tabs: MAIN_GUNS },
  { label: 'MELEE', tabs: MELEE },
];
const TABS = TAB_GROUPS.flatMap((g) => g.tabs);
// ── helpers ──────────────────────────────────────────────────────────────────
const CHAR_SVG = `
  <svg viewBox="0 0 32 48" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <ellipse cx="16" cy="7" rx="5" ry="6" fill="rgba(0,0,0,0.55)"/>
    <rect x="9" y="14" width="14" height="14" rx="2" fill="rgba(0,0,0,0.45)"/>
    <rect x="3" y="14" width="5" height="11" rx="2" fill="rgba(0,0,0,0.4)"/>
    <rect x="24" y="14" width="5" height="11" rx="2" fill="rgba(0,0,0,0.4)"/>
    <rect x="9" y="29" width="5" height="13" rx="2" fill="rgba(0,0,0,0.45)"/>
    <rect x="18" y="29" width="5" height="13" rx="2" fill="rgba(0,0,0,0.45)"/>
    <rect x="10" y="11" width="12" height="4" rx="1" fill="rgba(0,207,255,0.6)"/>
  </svg>`;

function _hex(n) { return n.toString(16).padStart(6, '0'); }
function _grad(a, b) { return `linear-gradient(155deg, #${_hex(a >>> 0)}, #${_hex(b >>> 0)})`; }
function _darken(hex, f) {
  const r = Math.floor((hex >> 16 & 255) * f), g = Math.floor((hex >> 8 & 255) * f), b = Math.floor((hex & 255) * f);
  return (r << 16 | g << 8 | b) >>> 0;
}
function _clean(s) { return String(s || '').replace(/[^\x00-\x7F]+/g, '').trim() || String(s || ''); }

// Static skinned-weapon renders (dataURLs) keyed `${weaponId}:${skinId}`,
// cached so each card only pays its 3D render cost once per session.
const _thumbCache = new Map();

export class InventoryPanel {
  constructor(host) {
    this.host = host;
    this._tab = 'character';        // which tab is active
    this._renderToken = 0;          // cancels in-flight thumb pumps
    this._open = false;
    this._thumbsRequested = false;

    document.getElementById('inv-close-btn')?.addEventListener('click', () => {
      this.host._closeAllPanels();
    });
  }

  async open() {
    this._open = true;
    const revision = this._openRevision = (this._openRevision || 0) + 1;
    const user = this.host._currentUser;
    if (user && user !== '__guest__') await UserAccount.restore();
    if (!this._open || revision !== this._openRevision || user !== this.host._currentUser) return;
    if (UserAccount.current() !== user) { this.host.setUsername(UserAccount.current()); return; }
    EAccount.refresh();
    if (!this._thumbsRequested) {
      this._thumbsRequested = true;
      warmWeaponThumbs(() => { _thumbCache.clear(); if (this._open) { this._renderEquipped(); this._renderGrid(); } });
    }
    // Sync display name into the header.
    const nameEl = document.getElementById('inv-username');
    const u = this.host._currentUser;
    if (nameEl) {
      nameEl.textContent = (u && u !== '__guest__') ? UserAccount.getDisplayName(u) : (u === '__guest__' ? 'guest' : 'Recruit');
    }
    // Migrate older saves that equipped a special before those became pickups.
    if (!isMainWeaponId(Loadout.getGun())) Loadout.setGun(MAIN_GUNS[0].id);

    this._renderMeta();
    this._renderTabs();
    this._renderEquipped();
    this._renderGrid();
  }

  close() {
    this._open = false;
    this._renderToken++;
  }

  refreshAll() { if (this._open) this.open(); }

  // ── header meta ────────────────────────────────────────────────────────────

  _renderMeta() {
    const bal = document.getElementById('inv-balance');
    if (bal) EAccount.render();
    const nw = document.getElementById('inv-networth');
    if (nw) {
      const owned = ARMOR_SKINS.filter((s) => Shop.isOwned(s.id));
      nw.textContent = owned.reduce((t, s) => t + (s.price || 0), 0).toLocaleString();
    }
  }

  // ── tab strip ──────────────────────────────────────────────────────────────

  _renderTabs() {
    const tabs = document.getElementById('inv-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    for (const group of TAB_GROUPS) {
      if (group.label) {
        const gl = document.createElement('span');
        gl.className = 'inv-tab-group';
        gl.textContent = group.label;
        tabs.appendChild(gl);
      }
      for (const t of group.tabs) {
        const b = document.createElement('button');
        b.className = 'inv-tab' + (t.id === this._tab ? ' active' : '');
        b.textContent = t.label;
        b.addEventListener('click', () => {
          if (this._tab === t.id) return;
          this._tab = t.id;
          tabs.querySelectorAll('.inv-tab').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          this._renderGrid();
        });
        tabs.appendChild(b);
      }
    }
  }

  // ── EQUIPPED row (character + main weapon) ─────────────────────────────────

  _renderEquipped() {
    const row = document.getElementById('inv-equipped');
    if (!row) return;
    row.innerHTML = '';

    // Character card — shows the equipped armor finish (or Default look).
    const armorSkinId = Shop.getEquipped();
    const armorSkin   = getArmorSkin(armorSkinId);
    const playerSkin  = getSkin(this.host.selectedSkinId);
    const portrait=document.getElementById('inv-profile-picture');
    if(portrait){
      const fallback='/assets/anime-skin-cards/remake_84.webp';
      const source=armorSkin ? (THEMED_SKIN_CARDS[armorSkin.id] || '/assets/character-skins/'+armorSkin.id+'.png') : fallback;
      portrait.onerror=()=>{portrait.onerror=null;portrait.src=fallback;};
      if (armorSkin) portrait.src=source; else portrait.removeAttribute('src');
      portrait.alt=(armorSkin?.name || 'Default')+' character artwork';
      if (!armorSkin) characterPortrait(playerSkin, this.host.selectedArmorId).then(src => { if (!Shop.getEquipped()) portrait.src = src; }).catch(() => {});
    }
    if (armorSkin) {
      row.appendChild(this._characterCard(armorSkin, /*equipped=*/true));
    } else {
      row.appendChild(this._defaultCharacterCard(playerSkin, /*equipped=*/true));
    }

    // Equipped skin for each EV-style weapon category.
    for (const choice of [{ id: Loadout.getGun() }, { id: Loadout.getMelee() }]) {
      const gunDef = WEAPONS.find((w) => w.id === choice.id);
      if (!gunDef) continue;
      const isMelee = gunDef.kind === 'melee';
      const skinId = Armory.hasSkin(gunDef.id) ? Armory.getSkinId(gunDef.id, isMelee) : null;
      const skin = skinId ? WEAPON_SKINS.find((s) => s.id === skinId) : null;
      row.appendChild(this._weaponCard(gunDef, skin, /*equipped=*/true));
    }
    [...row.children].forEach((card, i) => {
      const label = document.createElement('div'); label.className = 'inv-slot-label';
      label.textContent = ['CHARACTER', 'MAIN GUN', 'SWORD'][i]; card.prepend(label);
    });
  }

  // ── main grid (Default + skin cards for the active tab) ────────────────────

  _renderGrid() {
    const grid = document.getElementById('inv-grid');
    if (!grid) return;
    grid.innerHTML = '';
    this._renderToken++;
    const token = this._renderToken;

    if (this._tab === 'character') {
      this._renderCharacterGrid(grid);
      return;
    }
    const gun = WEAPONS.find((w) => w.id === this._tab);
    if (!gun) return;
    const isMelee = gun.kind === 'melee';

    // Default card — the raw weapon with no skin. Always shown.
    grid.appendChild(this._weaponCard(gun, null, this._isEquipped(gun.id, null), () => {
      this._equipWeapon(gun, null);
    }));

    // Skins are for the always-equipped items only (main guns + sword) —
    // everything else shows just Default.
    if (!Armory.canSkin(gun.id)) return;

    // Only the skins the player OWNS for this weapon. New accounts have
    // none — the tab shows just Default until skins are earned/bought.
    // ONE shared catalog: the sword wears the same 40 finishes as the guns.
    // The sword has its own independent equipped slot but intentionally uses
    // the same purchased finish catalog. Main guns remain restricted to their
    // authored five-skin sets so choosing a finish never swaps the gun shape.
    const catalog = getWeaponSkinsFor(gun.id);
    const owned = catalog.filter((s) => Armory.ownsSkin(s.id));
    const jobs = [];
    for (const s of owned) {
      const card = this._weaponCard(gun, s, this._isEquipped(gun.id, s.id), () => {
        this._equipWeapon(gun, s.id);
      });
      grid.appendChild(card);
      const img = card.querySelector('.inv-card-img');
      if (img) jobs.push({ img, gun, skin: s });
    }
    this._pumpThumbs(token, jobs);
  }

  _renderCharacterGrid(grid) {
    // Default (no armor finish) — shows base soldier.
    const playerSkin = getSkin(this.host.selectedSkinId);
    grid.appendChild(
      this._defaultCharacterCard(playerSkin, !Shop.getEquipped(), () => this._equipCharacter(null))
    );
    // Only the armor finishes the player OWNS. Nothing to buy here — the
    // store is the store; this is just what the player has.
    for (const s of ARMOR_SKINS.filter((s) => Shop.isOwned(s.id))) {
      grid.appendChild(this._characterCard(s, Shop.getEquipped() === s.id, () => this._equipCharacter(s)));
    }
  }

  // ── equip actions ──────────────────────────────────────────────────────────

  _equipWeapon(gun, skinId) {
    if (skinId && (!Armory.ownsSkin(skinId) || !getWeaponSkinsFor(gun.id).some(s => s.id === skinId))) return;
    if (gun.kind === 'melee') {
      Loadout.setMelee(gun.id);
    } else {
      if (!isMainWeaponId(gun.id)) return;
      Loadout.setGun(gun.id); // this becomes the player's main
    }
    if (skinId) Armory.equipSkin(gun.id, skinId);
    else Armory.clearSkin(gun.id);
    this.host.onArmoryChanged?.();
    this._renderEquipped();
    this._renderGrid();
  }

  _equipCharacter(skin) {
    if (skin && !Shop.isOwned(skin.id)) return;
    if (!skin) {
      Shop.unequip();
      this.host.onArmorSkinEquipped?.(null);
    } else {
      Shop.equip(skin.id);
      this.host.onArmorSkinEquipped?.(skin.id);
    }
    this.host._updateArmorPreview();
    this._renderEquipped();
    this._renderGrid();
  }

  _isEquipped(weaponId, skinId) {
    const isMelee = WEAPONS.find((w) => w.id === weaponId)?.kind === 'melee';
    const curMain = isMelee ? Loadout.getMelee() : Loadout.getGun();
    if (curMain !== weaponId) return false;
    const curSkin = Armory.hasSkin(weaponId) ? Armory.getSkinId(weaponId, isMelee) : null;
    return curSkin === (skinId ?? null);
  }

  // ── card builders ──────────────────────────────────────────────────────────

  _cardBase({ bg, rarity, equipped, name, onClick }) {
    const card = document.createElement('div');
    card.className = 'inv-item' + (equipped ? ' equipped' : '');
    if (rarity) card.dataset.rarity = rarity;
    card.style.background = bg;
    if (rarity && RARITY_COLORS[rarity]) card.style.setProperty('--rar', RARITY_COLORS[rarity]);

    const nm = document.createElement('div');
    nm.className = 'inv-item-name';
    nm.textContent = name;
    card.appendChild(nm);
    if (equipped) {
      const badge = document.createElement('span'); badge.className = 'inv-selection-label';
      badge.textContent = '✓ EQUIPPED'; card.appendChild(badge);
    }
    if (onClick) {
      card.setAttribute('role', 'button'); card.tabIndex = 0;
      card.setAttribute('aria-pressed', String(!!equipped));
      card.setAttribute('aria-label', `${equipped ? 'Equipped' : 'Equip'} ${name}`);
      card.addEventListener('click', onClick);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    }
    return card;
  }

  _weaponCard(gun, skin, equipped, onClick) {
    const isMelee = gun.kind === 'melee';
    // Branch on the skin's SHAPE, not the weapon: the sword wears gun skins
    // (body/accent) now; only legacy sword-catalog entries carry .blade.
    const bg = skin
      ? (skin.blade !== undefined
          ? _grad(skin.blade ?? 0x8090a0, skin.guard ?? 0x303840)
          : _grad(skin.body  ?? 0x556070, skin.accent ?? 0x202830))
      : _grad(gun.color || 0x2a3040, _darken(gun.color || 0x2a3040, 0.4));
    const card = this._cardBase({
      bg, rarity: skin?.rarity, equipped, onClick,
      name: skin ? _clean(skin.name) : (TABS.find(t=>t.id===gun.id)?.label || gun.name),
    });
    const weaponLabel = document.createElement('div');
    weaponLabel.className = 'inv-weapon-name'; weaponLabel.textContent = gun.name;
    card.appendChild(weaponLabel);
    card.dataset.weaponId = gun.id; card.dataset.skinId = skin?.id || 'default';
    const img = document.createElement('div');
    img.className = 'inv-card-img';
    const cachedKey = skin ? `${gun.id}:${skin.id}` : `${gun.id}:__def__`;
    const cached = _thumbCache.get(cachedKey);
    const fallback = getWeaponThumb(gun.id);
    if (cached) img.style.backgroundImage = `url(${cached})`;
    else {
      // Render defaults from the current model, just like equipped skins.
      const rendered = renderWeaponSkinned(gun, skin);
      if (rendered) { _thumbCache.set(cachedKey, rendered); img.style.backgroundImage = `url(${rendered})`; }
      else if (fallback) img.style.backgroundImage = `url(${fallback})`;
    }
    card.insertBefore(img, card.firstChild);
    return card;
  }

  _characterCard(armorSkin, equipped, onClick) {
    const bg = _grad(armorSkin.primary, armorSkin.secondary);
    const card = this._cardBase({
      bg, rarity: armorSkin.rarity, equipped, onClick,
      name: _clean(armorSkin.name),
    });
    const fig = document.createElement('div');
    fig.className = 'inv-card-fig';
    const image = document.createElement('img');
    image.src = THEMED_SKIN_CARDS[armorSkin.id] || `/assets/character-skins/${armorSkin.id}.png`;
    image.alt = armorSkin.name;
    image.style.cssText = 'width:100%;height:100%;object-fit:contain';
    fig.appendChild(image);
    card.insertBefore(fig, card.firstChild);
    return card;
  }

  _defaultCharacterCard(playerSkin, equipped, onClick) {
    const bg = _grad(playerSkin.primary, playerSkin.secondary);
    const card = this._cardBase({
      bg, rarity: null, equipped, onClick,
      name: 'Default',
    });
    const fig = document.createElement('div');
    fig.className = 'inv-card-fig';
    const image = document.createElement('img');
    image.alt = 'Default player character';
    characterPortrait(playerSkin, this.host.selectedArmorId).then(src => { image.src = src; }).catch(() => { image.alt = 'Character preview unavailable'; });
    image.style.cssText = 'width:100%;height:100%;object-fit:contain'; fig.appendChild(image);
    card.insertBefore(fig, card.firstChild);
    return card;
  }

  // Progressive real-render pipeline: a few skinned renders per frame, cached.
  _pumpThumbs(token, jobs) {
    const pump = () => {
      if (token !== this._renderToken) return;
      let n = 0;
      while (jobs.length && n < 3) {
        const j = jobs.shift();
        const key = `${j.gun.id}:${j.skin.id}`;
        let src = _thumbCache.get(key);
        if (!src) {
          try { src = renderWeaponSkinned(j.gun, j.skin); } catch { src = null; }
          if (src) _thumbCache.set(key, src);
        }
        if (src) j.img.style.backgroundImage = `url(${src})`;
        n++;
      }
      if (jobs.length) requestAnimationFrame(pump);
    };
    if (jobs.length) requestAnimationFrame(pump);
  }
}
