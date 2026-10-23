import './battlepass.css';
import './career.css';
import './controls.css';
import { openTournamentPanel, openCommunityProfile } from './TournamentPanel.js';
import { setMarketPreview, skinArtwork } from './MarketPreview.js';
import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import { EAccount } from '../core/EAccount.js';
import { mobileIcon } from './MobileIcons.js';
import { getSkin } from '../player/skins.js';
import { loadArmorType } from '../player/ArmorTypes.js';
import { ARMOR_SKINS, RARITY_ORDER, RARITY_COLORS, getArmorSkin } from '../player/ArmorSkins.js';
import { ALL_WEAPON_SKINS as WEAPON_SKINS, getWeaponIdForSkin } from '../weapons/WeaponSkins.js';
import { UserAccount } from '../core/UserAccount.js';
import { openAchievementPanel } from './AchievementPanel.js';
import { Shop } from '../core/Shop.js';
import { Armory } from '../core/Armory.js';
import { describePerk } from '../core/RarityPerks.js';
import { BattlePass } from '../core/BattlePass.js';
import { GameSettings, DEFAULTS, CROSSHAIR_COLORS } from '../core/GameSettings.js';
import { GAME_MODES } from '../core/GameModes.js';
import { Achievements } from '../core/Achievements.js';
import { CareerPreview } from './CareerPreview.js';
import { ArmorPreviewRenderer } from './ArmorPreviewRenderer.js';
import { InventoryPanel, MAIN_GUNS } from './InventoryPanel.js';
import { WEAPONS } from '../weapons/weaponDefs.js';
import { warmWeaponThumbs, renderWeaponSkinned } from './WeaponThumbnails.js';
import { openSolanaCheckout } from '../payments/SolanaCheckout.js';

// Shop card previews use the same weapon-render pipeline as the inventory:
// each gun-skin card shows one of the 5 main guns wearing the finish.
const _SHOP_GUN = () => WEAPONS.find((w) => w.id === 'm4') || WEAPONS.find((w) => w.kind !== 'melee');
const _shopThumbCache = new Map();  // `${weaponId}:${skinId}` -> dataURL

const SHOP_CHAR_SVG = `
  <svg viewBox="0 0 32 48" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <ellipse cx="16" cy="7" rx="5" ry="6" fill="rgba(0,0,0,0.55)"/>
    <rect x="9" y="14" width="14" height="14" rx="2" fill="rgba(0,0,0,0.45)"/>
    <rect x="3" y="14" width="5" height="11" rx="2" fill="rgba(0,0,0,0.4)"/>
    <rect x="24" y="14" width="5" height="11" rx="2" fill="rgba(0,0,0,0.4)"/>
    <rect x="9" y="29" width="5" height="13" rx="2" fill="rgba(0,0,0,0.45)"/>
    <rect x="18" y="29" width="5" height="13" rx="2" fill="rgba(0,0,0,0.45)"/>
    <rect x="10" y="11" width="12" height="4" rx="1" fill="rgba(0,207,255,0.6)"/>
  </svg>`;

function _rank(k) {
  if (k >= 100) return 'LEGEND';
  if (k >= 50)  return 'ELITE';
  if (k >= 25)  return 'VETERAN';
  if (k >= 10)  return 'SOLDIER';
  if (k >= 1)   return 'GRUNT';
  return 'RECRUIT';
}
function _fmt(s) { return s > 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s}s`; }

// Achievement category icons (cyan stroke)
const ICON_ACH = {
  kills: '<svg viewBox="0 0 24 24" fill="none" stroke="#5fe9ff" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>',
  games: '<svg viewBox="0 0 24 24" fill="none" stroke="#5fe9ff" stroke-width="1.6"><rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 12h3M8.5 10.5v3"/><circle cx="16" cy="11.5" r="1"/><circle cx="18.5" cy="13.5" r="1"/></svg>',
  score: '<svg viewBox="0 0 24 24" fill="none" stroke="#5fe9ff" stroke-width="1.6"><path d="M12 2l2.9 6 6.6.6-5 4.3 1.5 6.5L12 16.9 5.9 19.4 7.4 12.9l-5-4.3 6.6-.6z"/></svg>',
  kd:    '<svg viewBox="0 0 24 24" fill="none" stroke="#5fe9ff" stroke-width="1.6"><path d="M12 2l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V5z"/><path d="M9 12l2 2 4-4"/></svg>',
};

export class MenuUI {
  constructor({ mobile = false } = {}) {
    document.getElementById('nm-back')?.addEventListener('click', () => this._closeAllPanels());
    // Top-nav elements
    this.topNav      = document.getElementById('top-nav');
    this.mobileNavToggle = document.getElementById('nav-mobile-toggle');
    this.centerPlay  = document.getElementById('center-play');
    this._homeMap = document.getElementById('home-map');
    this._homeMode = document.getElementById('home-mode');
    this._homeCapacity = document.getElementById('home-capacity');

    // Panels
    this._activePanel = null;

    // Inputs / buttons in panels
    this.nameInput     = document.getElementById('player-name');
    this.skinGrid      = document.getElementById('skin-grid');
    this.playBtn       = document.getElementById('play-btn');

    // Pause / game-over
    this.pauseMenu     = document.getElementById('pause-menu');
    this.gameoverMenu  = document.getElementById('gameover-menu');
    this.resumeBtn     = document.getElementById('resume-btn');
    this.quitBtn       = document.getElementById('quit-btn');
    this.restartBtn    = document.getElementById('restart-btn');
    this.menuBtn       = document.getElementById('menu-btn');
    this.gameoverStats = document.getElementById('gameover-stats');

    this.selectedSkinId   = getSkin().id;   // catalog is empty; falls back to the built-in default
    this.selectedArmorId  = loadArmorType();
    this.selectedModeId   = 'deathmatch';
    this._currentUser     = null;
    this._preview         = null;
    this._armorPreview    = null;

    // Callback: called when armor type changes so Game.js can rebuild preview
    this.onArmorChanged = null; // (armorTypeId) => void

    // Armory state
    this._armoryWeaponId   = null;
    this._armoryIsSword    = false;
    this._armoryHoverSkin  = null;
    this._armorySelectedId = null;

    // Callbacks
    this.onPlay               = null; // (name, skinId, modeId) => void
    this.onResume             = null;
    this.onQuit               = null;
    this.onRestart            = null;
    this.onBackToMenu         = null;
    this.onLogout             = null;
    this.onArmoryChanged      = null;
    this.onSettingsSaved      = null;
    this.onArmorSkinEquipped  = null; // (skinId) => void
    this.onLoginRequest       = null; // () => void — open the login page

    this.inventory = new InventoryPanel(this);   // Inventory v3 (loadout hub)
    // Weapon thumbnails are expensive WebGL renders. Defer their model fetches
    // and PNG encoding until the player actually opens Inventory or Shop.
    this._weaponThumbsRequested = false;
    this._buildModeCards();
    this._buildSettings();
    this._mobileHome = null;
    if (mobile) this._buildMobileHome();
    this._wireNav();
    // Apply saved accessibility prefs at boot so the crosshair/HUD/motion
    // settings take effect immediately, not only after opening Settings.
    GameSettings.load();
    this._loadSettings();
  }

  // ── Nav wiring ──────────────────────────────────────────────────────────────

  _buildMobileHome() {
    document.body.classList.add('mobile-ui');
    const home = document.createElement('div');
    home.id = 'mobile-home';
    home.className = 'hidden';
    home.innerHTML = `<div class="mobile-home-content"><div class="mobile-home-icons">
      <button type="button" data-panel="abilities" aria-label="Abilities">${mobileIcon('abilities')}</button>
      <button type="button" data-panel="loadout" aria-label="Character and loadout">${mobileIcon('profile')}</button>
      <button type="button" data-panel="settings" aria-label="Settings">${mobileIcon('settings')}</button>
      </div><button type="button" id="mobile-play">TAP TO PLAY</button></div>
      <div class="home-only home-arena"><span class="home-caption">ARENA OVERVIEW</span><strong id="mobile-home-map">THE ARENA</strong><span id="mobile-home-capacity">Up to 8 players</span></div>`;
    document.getElementById('app').appendChild(home);
    this._mobileHomeMap = home.querySelector('#mobile-home-map');
    this._mobileHomeCapacity = home.querySelector('#mobile-home-capacity');
    home.querySelector('#mobile-play').addEventListener('click', () => {
      if (this._mobileResume) this.onResume?.();
      else this.playBtn.click();
    });
    // Keep the rest of the desktop navigation reachable through More.
    const more = document.querySelector('#panel-more .more-grid');
    for (const [panel, label] of [['modes', 'GAME MODES'], ['profile', 'PROFILE'], ['shop', 'SHOP'], ['battlepass', 'BATTLE PASS'], ['tournaments', 'TOURNAMENTS'], ['party', 'PARTY']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'profile-menu-item';
      button.dataset.panel = panel; button.textContent = label;
      if (['profile', 'shop', 'battlepass', 'party'].includes(panel)) button.dataset.gated = '1';
      more?.appendChild(button);
    }
    this._mobileHome = home;
  }

  _showMobileHome(show, resume = false) {
    if (!this._mobileHome) return;
    this._mobileResume = resume;
    this._mobileHome.querySelector('#mobile-play').textContent = resume ? 'TAP TO RESUME' : 'TAP TO PLAY';
    this._mobileHome.classList.toggle('hidden', !show);
    document.body.classList.toggle('mobile-home-visible', show);
  }

  setHomeScene(active, details = null) {
    if (this._homeAttract !== active) {
      this._homeAttract = active;
      document.body.classList.toggle('home-attract', active);
    }
    if (!active || !details) return;
    // Only touch the DOM when the rendered arena or selected mode changes.
    for (const [node, value] of [
      [this._homeMap, details.mapName],
      [this._homeMode, details.modeName],
      [this._homeCapacity, `Up to ${details.capacity} players`],
      [this._mobileHomeMap, details.mapName],
      [this._mobileHomeCapacity, `${details.modeName} · Up to ${details.capacity} players`],
    ]) {
      if (node && node.textContent !== value) node.textContent = value;
    }
  }

  _wireNav() {
    const closeMobileNav = () => {
      this.topNav?.classList.remove('mobile-open');
      this.mobileNavToggle?.setAttribute('aria-expanded', 'false');
      if (this.mobileNavToggle) this.mobileNavToggle.textContent = 'MENU';
    };
    this.mobileNavToggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = this.topNav.classList.toggle('mobile-open');
      this.mobileNavToggle.setAttribute('aria-expanded', String(open));
      this.mobileNavToggle.textContent = open ? 'CLOSE' : 'MENU';
      if (!open) this._closeAllDropdowns();
    });

    const startGame = (modeId) => {
      const name = this.nameInput.value.trim() || 'Recruit';
      if (modeId) this.selectedModeId = modeId === 'survival' ? 'deathmatch' : modeId;
      this._closeAllPanels();
      this._closeAllDropdowns();
      closeMobileNav();
      this.onPlay?.(name, this.selectedSkinId, this.selectedModeId, this.selectedArmorId);
    };

    // Center CLICK TO PLAY — starts last selected mode
    this.playBtn?.addEventListener('click', () => startGame());

    // Generic dropdown toggles: any .nav-dd-btn opens its `#dd-<data-dd>` menu.
    document.querySelectorAll('.nav-dd-btn').forEach((btn) => {
      const dd = document.getElementById('dd-' + btn.dataset.dd);
      if (!dd) return;
      btn.setAttribute('aria-controls', dd.id);
      btn.setAttribute('aria-expanded', 'false');
      const openDropdown = () => {
        this._closeAllDropdowns();
        this._closeAllPanels();
        dd.classList.remove('hidden');
        btn.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      };
      const items = () => [...dd.querySelectorAll('button:not(:disabled), a[href]')]
        .filter((item) => item.getClientRects().length && item.getAttribute('aria-disabled') !== 'true');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !dd.classList.contains('hidden');
        if (open) this._closeAllDropdowns();
        else openDropdown();
      });
      btn.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          openDropdown();
          const targets = items();
          targets[event.key === 'ArrowUp' ? targets.length - 1 : 0]?.focus();
        } else if (event.key === 'Escape' && !dd.classList.contains('hidden')) {
          event.preventDefault();
          event.stopPropagation();
          this._closeAllDropdowns();
        }
      });
      dd.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this._closeAllDropdowns();
          btn.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const targets = items();
        if (!targets.length) return;
        event.preventDefault();
        event.stopPropagation();
        const current = targets.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + targets.length) % targets.length;
        targets[next].focus();
      });
      dd.parentElement.addEventListener('focusout', (event) => {
        if (!dd.parentElement.contains(event.relatedTarget)) this._closeAllDropdowns();
      });
    });

    // Mode option buttons — select mode and start immediately (open to guests).
    document.querySelectorAll('.mode-option[data-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns();
        closeMobileNav();
        startGame(btn.dataset.mode);
      });
    });

    // Panel-opening buttons. Items marked data-gated require a real account —
    // logged-out / guest users get redirected to the login page instead.
    document.querySelectorAll('[data-panel]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns();
        closeMobileNav();
        if (btn.dataset.gated && !this._isRegistered()) {
          this.onLoginRequest?.();
          return;
        }
        this._togglePanel(btn.dataset.panel);
      });
    });

    // Every page needs an exit now that its top navigation is hidden.
    document.querySelectorAll('.nav-panel').forEach(panel => {
      if (panel.querySelector('[data-close-panel], #inv-close-btn, #nm-back')) return;
      const close = document.createElement('button');
      close.className = 'page-close'; close.textContent = '×';
      close.type = 'button';
      close.setAttribute('aria-label', 'Close page');
      close.setAttribute('data-close-panel', ''); panel.prepend(close);
    });
    document.querySelectorAll('[data-close-panel]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this._closeAllPanels();
      });
    });

    const importFile = document.getElementById('settings-import-file');
    document.getElementById('settings-export-btn')?.addEventListener('click', () => {
      const settings = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, GameSettings.get(key)]));
      const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'kryx-settings.json';
      link.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById('settings-import-btn')?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async () => {
      const file = importFile.files?.[0];
      if (!file) return;
      try {
        const incoming = JSON.parse(await file.text());
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('Invalid settings');
        for (const key of Object.keys(DEFAULTS)) {
          if (Object.prototype.hasOwnProperty.call(incoming, key)) GameSettings.set(key, incoming[key]);
        }
        this._loadSettings();
        this.onSettingsSaved?.(GameSettings.snapshot());
      } catch {
        document.getElementById('settings-save-btn').textContent = 'INVALID SETTINGS FILE';
      }
      importFile.value = '';
    });
    document.getElementById('settings-defaults-btn')?.addEventListener('click', () => {
      for (const [key, value] of Object.entries(DEFAULTS)) GameSettings.set(key, value);
      this._loadSettings();
      this.onSettingsSaved?.(GameSettings.snapshot());
    });

    document.getElementById('feedback-save-btn')?.addEventListener('click', () => {
      const field = document.getElementById('feedback-text');
      const status = document.getElementById('feedback-status');
      const message = field?.value.trim() || '';
      if (!message) {
        if (status) status.textContent = 'Write a message first.';
        return;
      }
      try {
        const items = JSON.parse(localStorage.getItem('kyx_feedback') || '[]');
        items.push({ message, createdAt: new Date().toISOString() });
        localStorage.setItem('kyx_feedback', JSON.stringify(items.slice(-20)));
        field.value = '';
        if (status) status.textContent = 'Saved on this device. Thank you.';
      } catch {
        if (status) status.textContent = 'Could not save feedback on this device.';
      }
    });

    // External account/legal pages can return directly to this menu without a
    // second standalone tournaments document.
    if (['tournaments','profile'].includes(new URLSearchParams(location.search).get('panel'))) {
      queueMicrotask(() => this._togglePanel(new URLSearchParams(location.search).get('panel')));
    }

    // Auth control (right-side menu). "login" is a plain link to /login; the
    // logout button clears the session and drops back to spectating.
    document.getElementById('nav-logout-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onLogout?.();
    });

    // Click outside closes any open dropdown / panel. Use composedPath (snapshotted
    // at dispatch) so a click that rebuilds panel content mid-handler — detaching
    // its own target — isn't mistaken for an outside click.
    document.addEventListener('click', (e) => {
      const path = e.composedPath();
      const has = (sel) => path.some((n) => n.nodeType === 1 && n.matches?.(sel));
      if (!has('.nav-dd-wrap')) this._closeAllDropdowns();
      if (!has('#top-nav')) closeMobileNav();
      if (this._activePanel && !has('.nav-panel') && !has('[data-panel]')) {
        this._closeAllPanels();
      }
    });

    // Pause / gameover buttons
    this.resumeBtn.addEventListener('click',  () => this.onResume?.());
    this.quitBtn.addEventListener('click',    () => this.onQuit?.());
    this.restartBtn.addEventListener('click', () => this.onRestart?.());
    this.menuBtn.addEventListener('click',    () => this.onBackToMenu?.());
    document.getElementById('profile-logout-btn').addEventListener('click', () => this.onLogout?.());
  }

  // True only when a real (non-guest) account is signed in.
  _isRegistered() {
    return !!this._currentUser && this._currentUser !== '__guest__';
  }

  _closeAllDropdowns() {
    document.querySelectorAll('.nav-dd').forEach((d) => d.classList.add('hidden'));
    document.querySelectorAll('.nav-dd-btn').forEach((b) => {
      b.classList.remove('open');
      b.setAttribute('aria-expanded', 'false');
    });
  }

  _togglePanel(id) {
    if (isCrazyGames() && ['loadout', 'shop', 'battlepass', 'party', 'tournaments'].includes(id)) return;
    if (this._activePanel === id) {
      this._closeAllPanels();
      return;
    }
    this._closeAllPanels();
    this._activePanel = id;
    this._mobileHome?.classList.add('panel-open');
    document.getElementById('panel-' + id)?.classList.remove('hidden');
    // Light the owning nav control (a dropdown parent or a direct nav item).
    const opener = document.querySelector(`[data-panel="${id}"]`);
    opener?.classList.add('active');
    opener?.closest('.nav-dd-wrap')?.querySelector('.nav-dd-btn')?.classList.add('nav-dd-active');

    if (id === 'loadout') {
      this.inventory.open();
      this._startArmorPreview();
      this.onLoadoutOpen?.();
    }
    if (id === 'profile') { this._renderProfile(); openCommunityProfile(); }
    if (id === 'tournaments') openTournamentPanel();
    if (id === 'achievements') this._renderAchievements();
    if (id === 'rankings')    this._renderRankings();
    if (id === 'settings')    this._loadSettings();
    if (id === 'shop')        this._renderShop();
    if (id === 'battlepass')  this._renderBattlePass();
  }

  _closeAllPanels() {
    if (this._activePanel === 'loadout') {
      this._armorPreview?.stop();
      this.inventory?.close();
      this.onLoadoutClose?.();
    }
    if (this._activePanel === 'profile') {
      this._profilePreview?.stop();
    }
    this._activePanel = null;
    this._mobileHome?.classList.remove('panel-open');
    document.querySelectorAll('.nav-panel').forEach((p) => p.classList.add('hidden'));
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.nav-dd-btn').forEach((b) => b.classList.remove('nav-dd-active'));
  }

  // ── Live 3D armor preview ─────────────────────────────────────────────────────

  _startArmorPreview() {
    const canvas = document.getElementById('armor-preview-canvas');
    if (!canvas) return;
    if (!this._armorPreview) this._armorPreview = new ArmorPreviewRenderer(canvas);
    this._updateArmorPreview();
    this._armorPreview.start();
  }

  _updateArmorPreview() {
    if (!this._armorPreview) return;
    const playerSkin = getSkin(this.selectedSkinId);
    const armorSkin  = getArmorSkin(Shop.getEquipped());
    this._armorPreview.loadArmor(playerSkin, this.selectedArmorId, armorSkin);
  }

  // ── Mode cards ─────────────────────────────────────────────────────────────

  _buildModeCards() {
    const container = document.getElementById('mode-cards');
    GAME_MODES.filter(mode => mode.id !== 'survival').forEach((mode) => {
      const card = document.createElement('div');
      card.className = 'mode-card' + (mode.id === this.selectedModeId ? ' selected' : '');
      card.style.setProperty('--mode-color', mode.color);
      card.innerHTML = `
        <div class="mode-icon">${mode.icon}</div>
        <div class="mode-body">
          <div class="mode-name">${mode.name}${mode.comingSoon ? ' <span class="mode-soon">SOON</span>' : ''}</div>
          <div class="mode-tag">${mode.tag}</div>
          <div class="mode-desc">${mode.desc}</div>
        </div>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedModeId = mode.id;
      });
      container.appendChild(card);
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  _buildSettings() {
    const sens = document.getElementById('set-sens');
    const fov  = document.getElementById('set-fov');
    const vol  = document.getElementById('set-vol');

    const update = (el, valId, fmt) => {
      const v       = document.getElementById(valId);
      const refresh = () => { v.textContent = fmt(parseFloat(el.value)); };
      el.addEventListener('input', refresh);
      refresh();
    };
    update(sens, 'set-sens-val', (v) => `${(v / 100).toFixed(1)}×`);
    update(fov,  'set-fov-val',  (v) => `${v}°`);
    update(vol,  'set-vol-val',  (v) => `${Math.round(v)}%`);

    // Render-quality buttons (mutually exclusive within their own group).
    document.querySelectorAll('#quality-btns .quality-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#quality-btns .quality-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Invert-look toggle (its own NORMAL/INVERTED pair).
    document.querySelectorAll('#invert-btns .invert-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#invert-btns .invert-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Accessibility segmented groups — generic single-select within each group,
    // with a live preview so changes are visible before saving.
    const segGroup = (sel) => document.querySelectorAll(sel).forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.parentElement.querySelectorAll('.quality-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._previewAccessibility();
      });
    });
    ['#xhair-shape-btns .xhair-shape', '#xhair-color-btns .xhair-color',
     '#cblind-btns .cblind', '#reduce-motion-btns .rmotion', '#reduce-flash-btns .rflash',
     '#contrast-btns .hcontrast', '#hitsound-btns .hitsound'].forEach(segGroup);
    const hs = document.getElementById('set-hudscale');
    if (hs) update(hs, 'set-hudscale-val', (v) => `${Math.round(v)}%`);
    hs?.addEventListener('input', () => this._previewAccessibility());

    const apply = () => {
      if (this._loadingSettings) return;
      const s = {
        sensitivity: parseFloat(sens.value) / 100,
        fov:         parseInt(fov.value),
        volume:      parseFloat(vol.value) / 100,
        quality:     document.querySelector('#quality-btns .quality-btn.active')?.dataset.q || 'medium',
        invertY:     document.querySelector('#invert-btns .invert-btn.active')?.dataset.inv === 'on',
      };
      GameSettings.set('sensitivity', s.sensitivity);
      GameSettings.set('fov',         s.fov);
      GameSettings.set('volume',      s.volume);
      GameSettings.set('quality',     s.quality);
      GameSettings.set('invertY',     s.invertY);

      // accessibility
      const pick = (sel, attr) => document.querySelector(sel + ' .quality-btn.active')?.dataset[attr];
      const on = (sel) => pick(sel, 'on') === 'on';
      GameSettings.set('crosshairStyle', pick('#xhair-shape-btns', 'xh') || 'cross');
      GameSettings.set('crosshairColor', pick('#xhair-color-btns', 'xc') || 'white');
      GameSettings.set('colorblind',     pick('#cblind-btns', 'cb') || 'none');
      GameSettings.set('hudScale',       parseInt(document.getElementById('set-hudscale').value) / 100);
      GameSettings.set('reduceMotion',   on('#reduce-motion-btns'));
      GameSettings.set('reduceFlashes',  on('#reduce-flash-btns'));
      GameSettings.set('highContrast',   on('#contrast-btns'));
      GameSettings.set('hitSound',       on('#hitsound-btns'));
      this._previewAccessibility();

      this.onSettingsSaved?.(GameSettings.snapshot());
      const btn = document.getElementById('settings-save-btn');
      btn.textContent = 'SAVED ✓';
      clearTimeout(this._settingsStatusTimer);
      this._settingsStatusTimer = setTimeout(() => { btn.textContent = 'SAVE SETTINGS'; }, 1400);
    };
    document.getElementById('settings-save-btn').addEventListener('click', apply);
    document.querySelectorAll('#panel-settings input[type=range]').forEach(el => el.addEventListener('input', apply));
    document.querySelectorAll('#panel-settings .quality-btn').forEach(el => el.addEventListener('click', apply));
  }

  _loadSettings() {
    this._loadingSettings = true;
    GameSettings.load();
    const sens = document.getElementById('set-sens');
    const fov  = document.getElementById('set-fov');
    const vol  = document.getElementById('set-vol');
    sens.value = Math.round(GameSettings.get('sensitivity') * 100);
    fov.value  = GameSettings.get('fov');
    vol.value  = Math.round(GameSettings.get('volume') * 100);
    sens.dispatchEvent(new Event('input'));
    fov.dispatchEvent(new Event('input'));
    vol.dispatchEvent(new Event('input'));
    const q = GameSettings.get('quality');
    document.querySelectorAll('#quality-btns .quality-btn').forEach((b) => b.classList.toggle('active', b.dataset.q === q));
    const inv = GameSettings.get('invertY') ? 'on' : 'off';
    document.querySelectorAll('#invert-btns .invert-btn').forEach((b) => b.classList.toggle('active', b.dataset.inv === inv));

    // accessibility state → controls
    const setSeg = (sel, attr, val) => document.querySelectorAll(sel + ' .quality-btn')
      .forEach((b) => b.classList.toggle('active', b.dataset[attr] === val));
    const onOff = (v) => (v ? 'on' : 'off');
    setSeg('#xhair-shape-btns', 'xh', GameSettings.get('crosshairStyle'));
    setSeg('#xhair-color-btns', 'xc', GameSettings.get('crosshairColor'));
    setSeg('#cblind-btns', 'cb', GameSettings.get('colorblind'));
    setSeg('#reduce-motion-btns', 'on', onOff(GameSettings.get('reduceMotion')));
    setSeg('#reduce-flash-btns', 'on', onOff(GameSettings.get('reduceFlashes')));
    setSeg('#contrast-btns', 'on', onOff(GameSettings.get('highContrast')));
    setSeg('#hitsound-btns', 'on', onOff(GameSettings.get('hitSound')));
    const hs = document.getElementById('set-hudscale');
    if (hs) { hs.value = Math.round(GameSettings.get('hudScale') * 100); hs.dispatchEvent(new Event('input')); }
    this._previewAccessibility();
    this._loadingSettings = false;
  }

  // Apply accessibility settings to the live DOM. Reads the CURRENTLY SELECTED
  // buttons (not saved state) so the settings panel previews instantly; called
  // again after save so it also reflects a persisted change. Everything hangs
  // off <html> data-attributes + CSS vars so style.css drives the visuals and
  // the in-match HUD/crosshair pick them up with no per-frame cost.
  _previewAccessibility() {
    const root = document.documentElement;
    const pick = (sel, attr, def) =>
      document.querySelector(sel + ' .quality-btn.active')?.dataset[attr] ?? def;
    const on = (sel) => pick(sel, 'on', 'off') === 'on';
    const shape = pick('#xhair-shape-btns', 'xh', GameSettings.get('crosshairStyle'));
    const color = pick('#xhair-color-btns', 'xc', GameSettings.get('crosshairColor'));
    const cb    = pick('#cblind-btns', 'cb', GameSettings.get('colorblind'));
    const scaleEl = document.getElementById('set-hudscale');
    const scale = scaleEl ? parseInt(scaleEl.value) / 100 : GameSettings.get('hudScale');
    root.dataset.xhair = shape;
    root.dataset.xhairColor = color;
    root.dataset.colorblind = cb;
    root.dataset.reduceMotion = on('#reduce-motion-btns') ? '1' : '0';
    root.dataset.reduceFlashes = on('#reduce-flash-btns') ? '1' : '0';
    root.dataset.contrast = on('#contrast-btns') ? '1' : '0';
    root.style.setProperty('--hud-scale', String(scale));
    root.style.setProperty('--xhair-color', CROSSHAIR_COLORS[color] || CROSSHAIR_COLORS.cyan);
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  // Drives the right-side vertical menu. A real account shows its name + coins
  // + logout; a guest or logged-out spectator shows the green "login" link.
  setUsername(username) {
    this._currentUser = username;
    const registered = !!username && username !== '__guest__';

    const nameEl    = document.getElementById('nav-username');
    const loginLink = document.getElementById('nav-login-link');
    const registerLink = document.getElementById('nav-register-link');
    const account   = document.getElementById('nav-account');

    if (nameEl) {
      nameEl.textContent = username ? UserAccount.getDisplayName(username) : 'guest';
    }
    loginLink?.classList.toggle('hidden', registered);
    registerLink?.classList.toggle('hidden', registered);
    account?.classList.toggle('hidden', !registered);

    // A guest / logged-out user must not keep an account-only panel open.
    if (!registered && (this._activePanel && this._activePanel !== 'settings')) {
      this._closeAllPanels();
    }
    this._refreshCoins();
  }

  _refreshCoins() {
    const el = document.getElementById('nav-coins');
    EAccount.render();
    EAccount.refresh();
  }

  async _renderProfile() {
    const u       = this._currentUser;
    if(u && u !== '__guest__') await UserAccount.restore();
    if(u !== this._currentUser)return;
    if (UserAccount.current() !== u) { this.setUsername(UserAccount.current()); return; }
    const isGuest = !u || u === '__guest__';
    const name    = u ? UserAccount.getDisplayName(u) : 'GUEST';
    const stats   = isGuest ? { kills: 0, deaths: 0, score: 0, games: 0 } : UserAccount.getStats(u);
    const kills   = stats.kills  || 0;
    const deaths  = stats.deaths || 0;
    const score   = stats.score  || 0;
    const games   = stats.games  || 0;
    const kd      = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('profile-username', name);
    set('ps-kills', kills);
    set('ps-deaths', deaths);
    set('ps-kd', kd);

    set('ps-score', score.toLocaleString());
    set('ps-games', games);

    set('ps-rank', _rank(kills));
    set('ps-balance', EAccount.loaded ? Number(EAccount.balance).toFixed(2)+' K' : 'Sign in to earn K');

    const logout = document.getElementById('profile-logout-btn');
    if (logout) logout.style.display = isGuest ? 'none' : 'block';

    this._startProfilePreview();
    await EAccount.refresh();
    try {
      const progress = isGuest ? null : await Achievements.load();
      if (u !== this._currentUser) return;
      const seconds = Math.max(0, Math.floor(Number(progress?.stats.bestSurvivalSeconds) || 0));
      const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
      set('ps-survival', progress ? duration : '—');
      set('career-stats-status', progress ? 'Lifetime totals · Recorded in signed-in matches' : 'Sign in to save your career stats.');
    } catch {
      set('ps-survival', '—');
      set('career-stats-status', 'Detailed stats are temporarily unavailable. Reopen this page to refresh.');
    }
  }

  // ── Achievements (ev.io-style tiered challenges) ────────────────────────────
  _renderAchievements() {
    openAchievementPanel(this._currentUser);
  }

  // ── Rankings (all players by kills) ────────────────────────────────────────
  _renderRankings() {
    const tbody = document.getElementById('rnk-rows');
    if (!tbody) return;
    tbody.innerHTML = '';
    const db = JSON.parse(localStorage.getItem('sio_accounts') || '{"accounts":{}}');
    const players = Object.values(db.accounts || {}).map(a => ({
      name: a.displayName || '???',
      kills: a.stats?.kills || 0,
      deaths: a.stats?.deaths || 0,
      score: a.stats?.score || 0,
      games: a.stats?.games || 0,
    }));
    players.sort((a, b) => b.kills - a.kills || b.score - a.score);
    const currentUser = this._currentUser;
    players.forEach((p, i) => {
      const tr = document.createElement('tr');
      const isYou = currentUser && p.name.toLowerCase() === currentUser.toLowerCase();
      if (isYou) tr.classList.add('rnk-you');
      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
      const cell = (value, className = '') => {
        const td = document.createElement('td');
        if (className) td.className = className;
        td.textContent = value;
        tr.appendChild(td);
        return td;
      };
      cell(i + 1, 'rnk-rank');
      const nameCell = cell(p.name, 'rnk-name');
      if (isYou) {
        const badge = document.createElement('span');
        badge.className = 'rnk-you-tag';
        badge.textContent = 'YOU';
        nameCell.append(' ', badge);
      }
      cell(p.kills);
      cell(p.deaths);
      cell(kd);
      cell(p.score.toLocaleString());
      cell(p.games);
      tbody.appendChild(tr);
    });
    if (!players.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" style="text-align:center;color:#5a6a80;padding:24px">No players yet</td>';
      tbody.appendChild(tr);
    }
  }

  // Dedicated full-body character render on the profile (the equipped soldier).
  _startProfilePreview() {
    const canvas = document.getElementById('profile-char-canvas');
    if (!canvas) return;

    const playerSkin = getSkin(this.selectedSkinId);
    const armorSkin  = getArmorSkin(Shop.getEquipped());
    document.getElementById('profile-skin-name').textContent = armorSkin?.name || playerSkin.name;
    document.getElementById('profile-skin-rarity').textContent = armorSkin?.rarity || 'Starter';
    this._profilePreview?.stop();
    let image = document.getElementById('profile-skin-artwork');
    if (!image) { image = new Image(); image.id = 'profile-skin-artwork'; canvas.after(image); }
    canvas.style.display = 'none';
    image.src = skinArtwork(armorSkin || playerSkin);
    image.alt = armorSkin?.name || playerSkin.name;
    image.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
  }

  // ── Visibility helpers ─────────────────────────────────────────────────────

  _chrome(show) {
    ['nav-side', 'share-game'].forEach((id) => {
      document.getElementById(id)?.classList.toggle('hidden', !show);
    });
  }

  showMain() {
    document.body.classList.add('menu-blurred');
    if (this.playBtn) this.playBtn.textContent = 'CLICK TO PLAY';
    this._showMobileHome(true, false);
    this.topNav.classList.remove('hidden');
    this.centerPlay.classList.remove('hidden');
    this._chrome(true);
  }

  hideMain() {
    document.body.classList.remove('menu-blurred');
    this._showMobileHome(false, false);
    this.topNav.classList.add('hidden');
    this.centerPlay.classList.add('hidden');
    this._chrome(false);
    this._closeAllPanels();
  }

  // Esc during a match opens the full nav GUI (Loadout / Shop / Settings /
  // Profile / …) — the same menu as the main screen. No paused box; click any
  // nav item to change loadout, then click Resume to capture the mouse again.
  showPause() {
    document.body.classList.add('menu-blurred');
    if (this.playBtn) this.playBtn.textContent = 'CLICK TO RESUME';
    this.centerPlay.classList.remove('hidden');
    this._showMobileHome(true, true);
    this.topNav.classList.remove('hidden');
    this._chrome(true);
  }
  hidePause() {
    document.body.classList.remove('menu-blurred');
    this.centerPlay.classList.add('hidden');
    this._showMobileHome(false, false);
    this._chrome(false);
    this.topNav.classList.add('hidden');
    this._closeAllPanels();
  }

  showGameOver(stats, title = 'YOU DIED') {
    document.getElementById('gameover-title').textContent = title;
    this.gameoverStats.innerHTML = `
      <div>KILLS<span>${stats.kills}</span></div>
      <div>SCORE<span>${stats.score}</span></div>
      <div>TIME<span>${_fmt(stats.time)}</span></div>`;
    this.gameoverMenu.classList.remove('hidden');
    this._refreshCoins();
  }
  hideGameOver() { this.gameoverMenu.classList.add('hidden'); }

  // ── Shop ───────────────────────────────────────────────────────────────────

  _nightMarketGunFor(skinId) {
    const id = getWeaponIdForSkin(skinId);
    return id ? { id } : null;
  }

  async _loadNightMarket() {
    if (this._nmLoading) return;
    this._nmLoading = true;
    try {
      const response = await fetch('/api/store/night-market', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Night Market unavailable');
      const market = await response.json();
      if (!Array.isArray(market.items) || market.items.length !== 5 || !Number.isFinite(market.resetsAt)) throw new Error('Invalid market');
      this._nightMarket = market;
      this._nmDeadline = performance.now() + Math.max(0, market.resetsAt - market.serverTime);
      this._nmError = false;
    } catch { this._nmError = true; }
    finally { this._nmLoading = false; }
    this._renderShop();
  }

  _startNightMarketTimer() {
    if (this._nmInterval) return;
    this._nmInterval = setInterval(() => {
      if (this._activePanel !== 'shop') return;
      const el = document.getElementById('nm-timer');
      if (!this._nightMarket) return;
      const secs = Math.max(0, Math.ceil((this._nmDeadline - performance.now()) / 1000));
      if (el) el.textContent = `Refreshes in ${Math.floor(secs / 86400)}d ${Math.floor(secs % 86400 / 3600)}h ${Math.floor(secs % 3600 / 60)}m ${secs % 60}s`;
      if (!secs) {
        this._nightMarket = null;
        this._nmError = false;
        this._renderShop();
      }
    }, 1000);
  }

  _renderShop() {
    this._refreshCoins();


    const authWall  = document.getElementById('shop-auth-wall');
    const content   = document.getElementById('shop-content');
    const root      = document.getElementById('shop-grid-root');
    if (!root) return;

    const isGuest = !this._currentUser || this._currentUser === '__guest__';
    if (isGuest) {
      authWall?.classList.remove('hidden');
      content?.classList.add('hidden');
      return;
    }
    authWall?.classList.add('hidden');
    content?.classList.remove('hidden');

    if (!this._weaponThumbsRequested) {
      this._weaponThumbsRequested = true;
      warmWeaponThumbs(() => { if (this._activePanel === 'shop') this._renderShop(); });
    }

    this._startNightMarketTimer();
    if (!this._nightMarket) {
      root.textContent = this._nmError ? 'Night Market unavailable. Try again.' : 'Loading weekly offers…';
      if (this._nmError) {
        const retry = document.createElement('button'); retry.textContent = 'Retry';
        retry.onclick = () => { this._nmError = false; this._loadNightMarket(); };
        root.appendChild(retry);
      } else this._loadNightMarket();
      return;
    }
    if (performance.now() >= this._nmDeadline) {
      this._nightMarket = null; this._renderShop(); return;
    }
    this._renderShopGrid(root);
  }

  _renderShopGrid(root) {
    root.innerHTML = '';
    const equippedArmor = Shop.getEquipped();

    // Every rarity has a default price; armor skins override with their own.
    const RARITY_PRICE = { common: 20, rare: 30, epic: 40, legendary: 60, mythic: 80 };
    const priceOf = (skin) => RARITY_PRICE[skin.rarity || 'common'] ?? 20;

    const _hex6 = n => n.toString(16).padStart(6, '0');

    // Skin cards that need real 3D-rendered previews are queued here and drop
    // in progressively (a few per frame) after the initial render.
    const previewJobs = [];

    // kind: 'character' | 'weapon' (including sword skins)
    const makeCard = (skin, kind) => {
      const rarity  = skin.rarity || 'common';
      const color   = RARITY_COLORS[rarity];
      const price   = priceOf(skin);
      const isCharacter = kind === 'character';
      const owned   = isCharacter ? Shop.isOwned(skin.id) : Armory.ownsSkin(skin.id);
      const isEquip = isCharacter && equippedArmor === skin.id;

      const card = document.createElement('div');
      card.className = 'shop-skin-card' + (isEquip ? ' equipped' : owned ? ' owned' : '');
      card.dataset.rarity = rarity;
      card.style.setProperty('--item-accent', color || '#9db7ce');

      // Swatch
      const swatch = document.createElement('div');
      swatch.className = 'shop-swatch';
      const inner = document.createElement('div');
      inner.className = 'shop-swatch-inner';
      const c1 = isCharacter ? _hex6(skin.primary) : _hex6(skin.body ?? skin.blade ?? 0x2a2a2a);
      const c2 = isCharacter ? _hex6(skin.secondary) : _hex6(skin.accent ?? skin.guard ?? 0x111111);
      inner.style.background = `radial-gradient(ellipse at 50% 35%, #${c1}65, transparent 72%), linear-gradient(150deg, #162334, #${c2}35 150%)`;
      if (skin.emissive) {
        const gc = '#' + _hex6(skin.emissive);
        inner.style.boxShadow = `inset 0 0 20px ${gc}55`;
      }
      swatch.appendChild(inner);

      // Preview: for armor a themed character silhouette; for weapon/sword a
      // real skinned-model render (dropped in progressively — see below).
      // `showcase` is hoisted so the name section below can label the card
      // with the actual gun it's shown on.
      let showcase = null;
      const preview = document.createElement('button');
      preview.className = 'shop-preview';
      if (isCharacter) {
        preview.classList.add('shop-preview-char');
        setMarketPreview(preview, `/assets/character-skins/${skin.id}.png`, skin);
      } else {
        preview.classList.add('shop-preview-weapon');
        // Gun skins are a shared finish usable on any main gun — show a real,
        // stable-for-the-day gun wearing it rather than always the Auto Rifle.
        const gunInfo = kind === 'weapon' ? this._nightMarketGunFor(skin.id) : null;
        const gun = gunInfo ? WEAPONS.find((w) => w.id === gunInfo.id) : null;
        showcase = gun || _SHOP_GUN();
        if (showcase) {
          const key = `${showcase.id}:${skin.id}`;
          const cached = _shopThumbCache.get(key);
          if (skin.thumbnail) setMarketPreview(preview, skin.thumbnail + '?v=20261004-material-fit', skin);
          else if (cached) setMarketPreview(preview, cached, skin);
          else previewJobs.push({ el: preview, gun: showcase, skin, key });
        }
      }
      swatch.appendChild(preview);

      // Rarity ribbon
      const ribbon = document.createElement('span');
      ribbon.className = 'shop-rarity-ribbon';
      ribbon.style.color = color;
      ribbon.style.borderLeft = `2px solid ${color}`;
      ribbon.textContent = rarity.toUpperCase();
      swatch.appendChild(ribbon);

      // Kind badge (WEAPON / SWORD / ARMOR) top-right
      const kindBadge = document.createElement('span');
      kindBadge.className = 'shop-kind-badge';
      kindBadge.textContent = isCharacter ? 'CHARACTER' : showcase?.id === 'sword' ? 'SWORD' : 'GUN';
      swatch.appendChild(kindBadge);

      // Status badge
      if (isEquip || owned) {
        const badge = document.createElement('span');
        badge.className = 'shop-status-badge';
        badge.style.color = isEquip ? '#00cfff' : '#4a8aaa';
        badge.textContent = isEquip ? '✓ EQUIPPED' : 'OWNED';
        swatch.appendChild(badge);
      }
      card.appendChild(swatch);

      // Card body
      const body = document.createElement('div');
      body.className = 'shop-card-body';
      const nameEl = document.createElement('div');
      nameEl.className = 'shop-skin-name';
      const weaponLabel = document.createElement('div');
      weaponLabel.className = 'shop-weapon-label';
      weaponLabel.textContent = isCharacter ? 'PLAYER SKIN' : (showcase?.name || 'Weapon').toUpperCase();
      nameEl.textContent = skin.name;
      nameEl.title = skin.name;
      body.appendChild(nameEl);
      const rarityEl = document.createElement('div');
      rarityEl.className = 'shop-skin-rarity';
      rarityEl.textContent = rarity.toUpperCase();
      body.append(rarityEl, weaponLabel);
      const perkEl = document.createElement('div');
      perkEl.className = 'shop-perk-line';
      const features = { common: 'Color finish', rare: 'Custom textured finish', epic: 'Textured finish · Animated glow', legendary: 'Detailed animated finish · Kill animation', mythic: 'Animated energy finish · Kill animation' };
      perkEl.textContent = skin.model ? (isCharacter ? 'Custom armor design' : 'Custom weapon design') + (skin.animated ? ' - Animated finish' : '') : features[rarity] || 'Cosmetic finish';
      if (skin.shootSound) perkEl.textContent += ' · Custom firing sound';
      if (!isCharacter) {
        const compatibility = document.createElement('div');
        compatibility.className = 'shop-compatibility';
        compatibility.textContent = `For ${showcase?.name || 'this weapon'} only`;
        body.appendChild(compatibility);
      }
      body.appendChild(perkEl);
      if (skin.shootSound) {
        const sound = document.createElement('button');
        sound.className = 'shop-btn shop-btn-sound';
        sound.textContent = '▶ Preview firing sound';
        sound.addEventListener('click', async e => {
          e.stopPropagation();
          try {
            const { createLegendaryShot } = await import('../core/LegendaryAudio.js');
            const Context = window.AudioContext || window.webkitAudioContext;
            this._shopAudio ||= new Context();
            await this._shopAudio.resume();
            const samples = createLegendaryShot(skin.shootSound, this._shopAudio.sampleRate);
            if (!samples) return;
            this._shopSound?.stop();
            const buffer = this._shopAudio.createBuffer(1, samples.length, this._shopAudio.sampleRate);
            buffer.copyToChannel(samples, 0);
            const source = this._shopAudio.createBufferSource(), gain = this._shopAudio.createGain();
            gain.gain.value = .25; source.buffer = buffer;
            source.connect(gain); gain.connect(this._shopAudio.destination);
            source.onended = () => { source.disconnect(); gain.disconnect(); if (this._shopSound === source) this._shopSound = null; };
            this._shopSound = source; source.start();
          } catch { sound.textContent = 'Sound unavailable'; }
        });
        body.appendChild(sound);
      }
      card.appendChild(body);

      // CTA
      const ctaWrap = document.createElement('div');
      ctaWrap.className = 'shop-card-cta';
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      if (isEquip) {
        btn.classList.add('shop-btn-equip');
        btn.textContent = 'EQUIPPED';
        btn.disabled = true;
      } else if (owned) {
        if (isCharacter) {
          btn.classList.add('shop-btn-owned');
          btn.textContent = 'EQUIP';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            Shop.equip(skin.id);
            this.onArmorSkinEquipped?.(skin.id);
            this._renderShop();
          });
        } else {
          // Weapon/sword skins equip inside the Inventory (they attach to a
          // specific gun there) — the shop just marks them OWNED.
          btn.classList.add('shop-btn-owned');
          btn.textContent = 'IN INVENTORY';
          btn.disabled = true;
        }
      } else {
        btn.classList.add('shop-btn-buy');
        const priceLine = document.createElement('div');
        priceLine.className = 'shop-price-line';
        priceLine.textContent = `$${price.toFixed(2)} USD`;
        const alternative = document.createElement('span');
        alternative.textContent = 'Pay with SOL / USDC';
        priceLine.appendChild(alternative);
        ctaWrap.appendChild(priceLine);
        btn.textContent = 'VIEW PURCHASE OPTIONS';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openSolanaCheckout({ skinId: skin.id, name: skin.name, kind, price, onComplete: () => this._renderShop() });
        });
      }
      ctaWrap.appendChild(btn);
      card.appendChild(ctaWrap);
      return card;
    };

    const offers = this._nightMarket?.items || [];
    const catalog = [...ARMOR_SKINS, ...WEAPON_SKINS];
    const grid = document.createElement('div');
    grid.className = 'shop-skin-grid';
    for (const offer of offers) {
      const skin = catalog.find(s => s.id === offer.id);
      if (skin) grid.appendChild(makeCard(skin, offer.kind));
    }
    root.appendChild(grid);

    // Progressive skinned-render pump: a few real 3D renders per frame so the
    // shop stays responsive while the previews fill in. Results are cached
    // so revisits are instant.
    this._shopRenderToken = (this._shopRenderToken || 0) + 1;
    const token = this._shopRenderToken;
    const pump = () => {
      if (token !== this._shopRenderToken) return;
      let n = 0;
      while (previewJobs.length && n < 3) {
        const j = previewJobs.shift();
        let src = _shopThumbCache.get(j.key);
        if (!src) {
          try { src = renderWeaponSkinned(j.gun, j.skin); } catch { src = null; }
          if (src) _shopThumbCache.set(j.key, src);
        }
        if (src) setMarketPreview(j.el, src, j.skin);
        n++;
      }
      if (previewJobs.length) requestAnimationFrame(pump);
    };
    if (previewJobs.length) requestAnimationFrame(pump);
  }

  // ── Battle Pass ────────────────────────────────────────────────────────────

  _renderBattlePass({ refresh = true } = {}) {
    if (refresh) {
      this._bpStatus = '';
      this._bpError = '';
      this._bpLoading = BattlePass.usesServer();
      const revision = this._bpLoadRevision = (this._bpLoadRevision || 0) + 1;
      if (this._bpLoading) BattlePass.refresh().then(result => {
        if (this._bpLoadRevision !== revision) return;
        this._bpLoading = false;
        this._bpError = result.ok ? '' : result.err;
        this._renderBattlePass({ refresh: false });
      });
    }
    const progress = BattlePass.getProgress();
    const selected = progress.rewards.find(reward => reward.tier === this._bpSelectedTier) || progress.next;
    this._bpSelectedTier = selected.tier;
    const skin = getArmorSkin(selected.id);
    const busy = !!(this._bpLoading || this._bpClaiming || this._bpError);
    const element = id => document.getElementById(id);
    element('bp-tier-label').textContent = 'Tier ' + progress.tier;
    element('bp-tier-total').textContent = '/ ' + BattlePass.TOTAL_TIERS;
    const percent = progress.complete ? 100 : progress.xpInTier / BattlePass.XP_PER_TIER * 100;
    element('bp-xp-bar').style.width = percent + '%';
    element('bp-xp-meter').setAttribute('aria-valuenow', progress.complete ? BattlePass.XP_PER_TIER : progress.xpInTier);
    element('bp-xp-text').textContent = progress.complete ? 'All tiers reached' : progress.xpInTier.toLocaleString() + ' / ' + BattlePass.XP_PER_TIER + ' XP';
    element('bp-next-reward').textContent = progress.claimable
      ? progress.claimable + (progress.claimable === 1 ? ' skin' : ' skins') + ' ready to collect'
      : progress.claimed === progress.rewards.length ? 'Collection complete. Every reward is yours.'
      : Math.max(0, progress.next.xp - progress.xp).toLocaleString() + ' XP to your next skin';
    element('bp-collected').textContent = progress.claimed + ' / ' + progress.rewards.length;
    element('bp-summary').textContent = this._bpLoading ? 'Loading your progress…' : progress.claimable + (progress.claimable === 1 ? ' reward' : ' rewards') + ' ready to claim';
    element('bp-save-note').textContent = BattlePass.usesServer()
      ? 'Progress and claimed skins are saved to your game account.'
      : 'Local preview progress is saved in this browser. Live rewards are earned in signed-in matches.';
    element('bp-status').textContent = this._bpError || this._bpStatus || '';
    element('bp-status').classList.toggle('is-error', !!this._bpError);
    element('bp-retry').hidden = !this._bpError;
    element('bp-retry').onclick = () => this._renderBattlePass();
    element('bp-claim-all').disabled = busy || !progress.claimable;
    element('bp-claim-all').textContent = this._bpClaiming ? 'CLAIMING…' : 'CLAIM ALL';
    element('bp-claim-all').onclick = () => this._claimPassReward();

    const rail = element('bp-season-rail');
    rail.replaceChildren();
    for (let tier = 1; tier <= BattlePass.TOTAL_TIERS; tier++) {
      const step = document.createElement('span');
      step.className = (tier <= progress.tier ? 'reached ' : '') + (tier % 5 === 0 ? 'milestone' : '');
      step.title = 'Tier ' + tier + (tier % 5 === 0 ? ' · Skin reward' : '');
      rail.appendChild(step);
    }
    element('bp-feature-tier').textContent = 'TIER ' + selected.tier + ' / CHARACTER SKIN';
    element('bp-feature-name').textContent = skin.name;
    element('bp-feature-rarity').textContent = skin.rarity.toUpperCase();
    element('bp-feature-rarity').style.color = RARITY_COLORS[skin.rarity];
    const art = element('bp-feature-art');
    art.src = skinArtwork(skin);
    art.alt = skin.name;
    const remaining = Math.max(0, selected.xp - progress.xp);
    element('bp-feature-detail').textContent = selected.claimed ? 'Added to your inventory'
      : selected.reached ? (Shop.isOwned(skin.id) ? 'Already in your inventory · collect this milestone' : 'Ready to add to your inventory')
      : remaining.toLocaleString() + ' XP to unlock · ' + selected.xp.toLocaleString() + ' XP total';
    const claim = element('bp-claim-selected');
    claim.disabled = busy || selected.claimed || !selected.reached;
    claim.textContent = selected.claimed ? 'COLLECTED ✓' : selected.reached ? 'CLAIM SKIN' : 'UNLOCKS AT TIER ' + selected.tier;
    claim.onclick = () => this._claimPassReward(selected.tier);

    const track = element('bp-track');
    track.replaceChildren();
    for (const reward of progress.rewards) track.appendChild(this._bpRewardCard(reward));
    element('bp-next-milestone').onclick = () => {
      this._bpSelectedTier = progress.next.tier;
      this._renderBattlePass({ refresh: false });
      element('bp-reward-' + this._bpSelectedTier)?.focus({ preventScroll: true });
    };
  }

  _bpRewardCard(reward) {
    const skin = getArmorSkin(reward.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.id = 'bp-reward-' + reward.tier;
    card.className = 'bp-milestone-card' + (reward.claimed ? ' claimed' : reward.reached ? ' ready' : ' locked');
    card.setAttribute('aria-pressed', String(reward.tier === this._bpSelectedTier));
    card.setAttribute('aria-label', 'Tier ' + reward.tier + ': ' + skin.name + '. ' + (reward.claimed ? 'Collected' : reward.reached ? 'Ready to claim' : 'Locked') + '. Preview reward.');
    const header = document.createElement('span');
    header.className = 'bp-card-tier';
    header.textContent = 'TIER ' + reward.tier;
    const image = document.createElement('img');
    image.src = skinArtwork(skin);
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    const title = document.createElement('strong');
    title.textContent = skin.name.replace(/ Reforged$/, '');
    const rarity = document.createElement('span');
    rarity.className = 'bp-card-rarity';
    rarity.textContent = skin.rarity;
    rarity.style.color = RARITY_COLORS[skin.rarity];
    const state = document.createElement('span');
    state.className = 'bp-card-state';
    state.textContent = reward.claimed ? 'COLLECTED ✓' : reward.reached ? 'READY TO CLAIM' : reward.xp.toLocaleString() + ' XP';
    card.append(header, image, title, rarity, state);
    card.onclick = () => {
      this._bpSelectedTier = reward.tier;
      this._renderBattlePass({ refresh: false });
      document.getElementById(card.id)?.focus({ preventScroll: true });
    };
    return card;
  }

  async _claimPassReward(tier = null) {
    if (this._bpClaiming) return;
    const owner = UserAccount.current();
    this._bpClaiming = true;
    this._bpStatus = '';
    this._bpError = '';
    this._renderBattlePass({ refresh: false });
    const result = await BattlePass.claimRewards(tier);
    if (owner !== UserAccount.current()) { this._bpClaiming = false; return; }
    if (result.ok && BattlePass.usesServer()) await UserAccount.restore();
    this._bpClaiming = false;
    if (owner !== UserAccount.current()) return;
    if (result.ok) this._bpStatus = 'Rewards collected. Your skins are ready in Inventory.';
    else this._bpError = result.err;
    this._renderBattlePass({ refresh: false });
  }
}
