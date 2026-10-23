import { isCrazyGames } from '../core/CrazyGamesAccount.js';
import { compareMatchRows } from '../core/MatchRows.js';
import {renderNameCosmetics} from './NameCosmetics.js';
import { getWeaponHudThumb, warmWeaponHudThumbs } from './WeaponThumbnails.js';
import './abilities.css';
import {
  MAX_PICKUP_SHIELD,
  SHIELD_PER_STACK,
} from '../core/ShieldConfig.js';

function setText(el, value) {
  if (!el) return;
  const next = String(value);
  if (el.textContent !== next) el.textContent = next;
}

function setStyle(el, property, value) {
  if (el && el.style[property] !== value) el.style[property] = value;
}

function setCustomStyle(el, property, value) {
  if (el && el.style.getPropertyValue(property) !== value) el.style.setProperty(property, value);
}

function toggleClass(el, name, enabled) {
  if (el && el.classList.contains(name) !== enabled) el.classList.toggle(name, enabled);
}

export class HUD {
  constructor() {
    this.root        = document.getElementById('hud');
    this.healthBar   = document.getElementById('health-bar');
    this.healthText  = document.getElementById('health-text');
    this.shieldWrap  = document.getElementById('shield-wrap');
    this.shieldBar   = document.getElementById('shield-bar');
    this.shieldText  = document.getElementById('shield-text');
    this.shieldStacks = document.getElementById('shield-stacks');
    this.staminaBar  = document.getElementById('stamina-bar');
    this.staminaText = document.getElementById('stamina-text');
    this.fragCount   = document.getElementById('frag-count');
    this.smokeCount  = document.getElementById('smoke-count');
    this.weaponName  = document.getElementById('weapon-name');
    this.ammoText    = document.getElementById('ammo-text');
    this.weaponWrap  = document.getElementById('weapon-wrap');
    this.reloadText  = document.getElementById('reload-text');
    this.reloadRing = document.getElementById('reload-ring');
    this.reloadProgress = document.getElementById('reload-progress');
    this.reloadTime     = document.getElementById('reload-time');
    this.killCount   = document.getElementById('kill-count');
    this.scoreCount  = document.getElementById('score-count');
    this.serverPop      = document.getElementById('server-pop');
    this.serverPopCount = document.getElementById('server-pop-count');
    this.serverPopMax   = document.getElementById('server-pop-max');
    this.weaponSlots = document.getElementById('weapon-slots');
    this.hitmarker   = document.getElementById('hitmarker');
    this.crosshair   = document.getElementById('crosshair');
    this.killConfirm      = document.getElementById('kill-confirm');
    this.killConfirmTitle = document.getElementById('kill-confirm-title');
    this.killConfirmScore = document.getElementById('kill-confirm-score');
    this.damageFlash = document.getElementById('damage-flash');
    this.blindOverlay = document.getElementById('blind-overlay');
    this.killfeed    = document.getElementById('killfeed');
    this.modeInfo    = document.getElementById('mode-info');
    this.dmTimer        = document.getElementById('dm-timer');
    this.streakBadge    = document.getElementById('streak-badge');
    this.downedOverlay  = document.getElementById('downed-overlay');
    this.downedBar      = document.getElementById('downed-bar');
    this.downedCountdown = document.getElementById('downed-countdown');
    this.respawnOverlay  = document.getElementById('respawn-overlay');
    this.respawnCountdown = document.getElementById('respawn-countdown');
    this.waveBanner     = document.getElementById('wave-banner');
    this._teleportFlash    = document.getElementById('teleport-flash');
    this._abilityQ         = document.getElementById('ability-q');
    this._joinNotification = document.getElementById('join-notification');
    this._adsActive           = false;
    this._hitmarkerTimeout    = null;
    this._killConfirmTimeout  = null;
    this._damageTimeout       = null;
    this._waveBannerTimer     = null;
    this._streakTimeout       = null;
    this._teleportFlashTimeout = null;
    this._joinNotifTimer      = null;
    this._joinFadeTimer       = null;
    this._slotEls             = [];
    this._slotAmmoEls         = [];
    this._activeSlot          = -1;
    this._initPresentation();
    this._scoreboardTab = 'leaderboard';
    const scoreboard = document.getElementById('scoreboard-overlay');
    scoreboard?.querySelectorAll('[data-sb-tab]').forEach((tab) => {
      tab.onclick = () => this._selectScoreboardTab(tab.dataset.sbTab);
      tab.onmousedown = (event) => event.stopPropagation();
    });
    document.addEventListener('keydown', (event) => {
      if (!scoreboard || scoreboard.classList.contains('hidden') || !['ArrowLeft', 'ArrowRight'].includes(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      const tabs = ['leaderboard', 'earn', 'performance'];
      const next = (tabs.indexOf(this._scoreboardTab) + (event.code === 'ArrowRight' ? 1 : 2)) % 3;
      this._selectScoreboardTab(tabs[next]);
    }, true);
  }

  _initPresentation() {
    if (!this.root) return;
    this.root.classList.add('hud-refined');
    // Keep the existing live data nodes; only their visual grouping changes.
    let vitals = this.root.querySelector('.hud-vitals');
    if (!vitals) {
      vitals = document.createElement('div');
      vitals.id = 'hud-vitals';
      vitals.className = 'hud-vitals';
      vitals.setAttribute('aria-label', 'Health, shield and stamina');
      this.root.appendChild(vitals);
    }
    for (const id of ['health-wrap', 'shield-wrap', 'stamina-wrap']) {
      const element = document.getElementById(id);
      if (element) vitals.appendChild(element);
    }
    // Population must remain visible even though the redundant score tray is hidden.
    if (this.serverPop) this.root.appendChild(this.serverPop);
    if (this.dmTimer) this.dmTimer.setAttribute('aria-label', 'Time remaining');
    this._initAbilityPresentation();
    // Split magazine and reserve for hierarchy without changing their source.
    if (this.ammoText) {
      this.ammoText.textContent = '';
      this._magazineText = document.createElement('span');
      this._magazineText.className = 'hud-magazine';
      this._reserveText = document.createElement('span');
      this._reserveText.className = 'hud-reserve';
      this.ammoText.append(this._magazineText, this._reserveText);
    }
  }

  _initAbilityPresentation() {
    this._grenadeHud = [];
    for (const [kind, name, caption] of [
      ['smoke', 'Smoke grenade', 'SMOKE'], ['frag', 'Frag grenade', 'FRAG'],
      ['timebomb', 'Time bomb', 'BOMB'], ['impulse', 'Impulse blast', 'BLAST'],
    ]) {
      const counter = document.getElementById(`${kind}-count`);
      const tile = counter?.closest('.grenade-slot');
      if (!tile) continue;
      const view = this._createAbilityView(tile, name, caption, '.grenade-label');
      view.kind = kind;
      view.counter = counter;
      this._grenadeHud.push(view);
    }
    this._teleportHud = this._abilityQ
      ? this._createAbilityView(this._abilityQ, 'Teleport', 'TELEPORT', '.ability-key') : null;
    this._abilityTargeting = false;
    this._abilityTargetValid = true;
    this._teleportRemaining = 0;
  }

  _createAbilityView(tile, name, caption, keySelector) {
    tile.classList.add('ability-tile');
    // Read the actual displayed binding once; update paths never query the DOM.
    const key = tile.querySelector(keySelector)?.textContent.trim() || '';
    let label = tile.querySelector('.ability-caption, .ability-name');
    if (!label) {
      label = document.createElement('span');
      tile.appendChild(label);
    }
    label.className = 'ability-caption';
    setText(label, caption);
    const timer = document.createElement('span');
    timer.className = 'ability-countdown';
    timer.setAttribute('aria-hidden', 'true');
    tile.appendChild(timer);
    tile.setAttribute('role', 'img');
    return { tile, timer, name, key, state: '', seconds: -1, count: -1 };
  }

  _updateAbilityView(view, remaining, count, targeting = false, valid = true) {
    if (!view) return;
    const seconds = Math.ceil(Math.max(0, remaining));
    const ready = seconds === 0 && count > 0;
    const state = targeting && ready ? (valid ? 'targeting' : 'blocked')
      : seconds > 0 ? 'cooldown' : ready ? 'ready' : 'empty';
    if (state !== view.state) {
      view.tile.dataset.abilityState = state;
      toggleClass(view.tile, 'ready', ready);
      view.state = state;
    }
    if (seconds !== view.seconds) {
      setText(view.timer, seconds > 0 ? `${seconds}s` : '');
      view.seconds = seconds;
    }
    // Screen readers and hover users get the full name, key and ready state.
    // No live region: a cooldown should not announce every second of gameplay.
    if (count !== view.count || seconds !== view.a11ySeconds || state !== view.a11yState) {
      const status = state === 'targeting' ? 'clear destination; click to teleport; Q or right click cancels'
        : state === 'blocked' ? 'destination blocked; Q or right click cancels'
        : seconds > 0 ? `ready in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
        : ready ? 'ready' : 'no charges';
      const description = `${view.name}, ${view.key}, ${count} ${count === 1 ? 'charge' : 'charges'}, ${status}`;
      view.tile.setAttribute('aria-label', description);
      view.tile.title = description;
      view.count = count;
      view.a11ySeconds = seconds;
      view.a11yState = state;
    }
  }

  show() { this.root?.classList.remove('hidden'); }
  hide() { this.root?.classList.add('hidden'); }

  // Mode-specific top-center overlay (timer, wave, lives, + optional 3rd line).
  setModeHUD(primary, secondary = '', tertiary = '') {
    if (this._modePrimary === primary && this._modeSecondary === secondary && this._modeTertiary === tertiary && !this.modeInfo.classList.contains('hidden')) return;
    this._modePrimary = primary;
    this._modeSecondary = secondary;
    this._modeTertiary = tertiary;
    this.modeInfo.classList.remove('hidden');
    this.modeInfo.textContent = '';
    const p = document.createElement('span');
    p.className = 'mode-primary';
    p.textContent = primary;
    this.modeInfo.appendChild(p);
    if (secondary) {
      const s = document.createElement('span');
      s.className = 'mode-secondary';
      s.textContent = secondary;
      this.modeInfo.appendChild(s);
    }
    if (tertiary) {
      const t = document.createElement('span');
      t.className = 'mode-tertiary';
      t.textContent = tertiary;
      this.modeInfo.appendChild(t);
    }
  }

  hideModeHUD() { this.modeInfo.classList.add('hidden'); }

  // Survival "Wave Bonus" coin multiplier (top-right).
  setWaveBonus(mult) {
    let el = document.getElementById('wave-bonus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wave-bonus';
      (this.root || document.getElementById('hud') || document.body).appendChild(el);
    }
    if (this._waveBonus === mult && !el.classList.contains('hidden')) return;
    this._waveBonus = mult;
    el.classList.remove('hidden');
    el.innerHTML = `<span class="wb-label">WAVE BONUS</span><span class="wb-mult">${mult}x</span>`;
  }
  hideWaveBonus() { document.getElementById('wave-bonus')?.classList.add('hidden'); }

  // Large centered deathmatch countdown timer
  showDMTimer(timeStr, isLow = false) {
    setText(this.dmTimer, timeStr);
    this.dmTimer.classList.remove('hidden');
    toggleClass(this.dmTimer, 'dm-low', isLow);
  }
  hideDMTimer() { this.dmTimer.classList.add('hidden'); }

  // Kill streak badge (shown briefly above the DM timer)
  showStreak(streak, coins) {
    if (streak < 2) return;
    this.streakBadge.textContent = `🔥 x${streak} KILL STREAK  +${coins} COINS`;
    this.streakBadge.classList.remove('hidden');
    clearTimeout(this._streakTimeout);
    this._streakTimeout = setTimeout(() => this.streakBadge.classList.add('hidden'), 2500);
  }

  // Survival: downed overlay with countdown bar
  showDowned(secsLeft, totalSecs) {
    this.downedOverlay.classList.remove('hidden');
    const pct = Math.max(0, (secsLeft / totalSecs) * 100);
    if (this.downedBar) this.downedBar.style.width = pct + '%';
    if (this.downedCountdown) this.downedCountdown.textContent = Math.ceil(Math.max(0, secsLeft));
  }
  hideDowned() { this.downedOverlay.classList.add('hidden'); }

  showRespawn(secsLeft) {
    this.respawnOverlay?.classList.remove('hidden');
    if (this.respawnCountdown) {
      this.respawnCountdown.textContent = secsLeft > 0 ? Math.ceil(secsLeft) : 'DEPLOYING';
    }
  }
  hideRespawn() { this.respawnOverlay?.classList.add('hidden'); }

  // Survival: wave banner (auto-removes after animation)
  showWaveBanner(text) {
    this.waveBanner.textContent = text;
    this.waveBanner.classList.remove('hidden');
    clearTimeout(this._waveBannerTimer);
    this._waveBannerTimer = setTimeout(() => this.waveBanner.classList.add('hidden'), 3000);
  }

  buildWeaponSlots(slots, activeIndex) {
    this._renderedWeaponSlots = slots;
    this.weaponSlots.style.setProperty('--carried-slot-count', String(Math.max(1, slots.length)));
    const buildToken = (this._weaponSlotBuildToken || 0) + 1;
    this._weaponSlotBuildToken = buildToken;
    this.weaponSlots.innerHTML = '';
    this._slotEls.length = 0;
    this._slotAmmoEls.length = 0;
    this._activeSlot = activeIndex;
    slots.forEach((slot, i) => {
      const key = (typeof slot === 'object') ? slot.key : slot;
      const id  = (typeof slot === 'object') ? slot.id  : null;
      const el = document.createElement('div');
      el.className = 'weapon-slot' + (i === activeIndex ? ' active' : '');
      el.dataset.index = i;
      el.classList.toggle('melee-slot', Boolean(slot.isMelee));

      const thumb = id ? getWeaponHudThumb(id) : null;
      if (thumb) {
        const img = document.createElement('div');
        img.className = 'ws-thumb';
        img.style.backgroundImage = `url(${thumb})`;
        el.appendChild(img);
      }
      const ammo = document.createElement('span');
      ammo.className = 'ws-ammo';
      ammo.textContent = slot.isMelee ? '∞' : `${slot.magAmmo ?? 0} / ${slot.infiniteReserve ? '∞' : (slot.reserveAmmo ?? 0)}`;
      el.appendChild(ammo);
      const k = document.createElement('span');
      k.className = 'ws-key';
      k.textContent = key;
      el.appendChild(k);

      this.weaponSlots.appendChild(el);
      this._slotEls.push(el);
      this._slotAmmoEls.push(ammo);
    });

    // Replace the instant placeholder with the real equipped model render as
    // soon as those one/two thumbnails are ready. A stale async completion may
    // never overwrite a newer pickup/loadout layout.
    warmWeaponHudThumbs(slots.map((slot) => slot?.id).filter(Boolean), () => {
      if (this._weaponSlotBuildToken !== buildToken) return;
      this._slotEls.forEach((el, index) => {
        const id = slots[index]?.id;
        const thumb = id ? getWeaponHudThumb(id) : null;
        const image = el?.querySelector('.ws-thumb');
        if (image && thumb) image.style.backgroundImage = `url(${thumb})`;
      });
    });
  }

  // Floating "+N" coin-earn popup near the crosshair (ev.io-style).
  showCoinEarn(amount) {
    const amt = Math.round(amount * 100) / 100;
    if (!amt) return;
    const host = this.root || document.getElementById('hud') || document.body;
    const el = document.createElement('div');
    el.className = 'coin-earn';
    el.innerHTML = `+${amt} <span class="coin-earn-icon">&#9670;</span>`;
    el.style.setProperty('--cx', `${(Math.random() * 2 - 1) * 30}px`);
    host.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 1300);
  }

  setActiveSlot(index) {
    if (this._activeSlot === index) return;
    this._slotEls[this._activeSlot]?.classList.remove('active');
    this._slotEls[index]?.classList.add('active');
    this._activeSlot = index;
  }

  syncWeaponSlots(weaponInfo) {
    // WeaponSystem replaces this cached array whenever the loadout changes,
    // including a predicted discard before the server acknowledges it.
    if (weaponInfo.slots && this._renderedWeaponSlots !== weaponInfo.slots) {
      this.buildWeaponSlots(weaponInfo.slots, weaponInfo.currentIndex);
    }
    this.setActiveSlot(weaponInfo.currentIndex);
  }

  update(player, weaponInfo, kills, score) {
    this.syncWeaponSlots(weaponInfo);
    const hpct = Math.max(0, (player.health / player.maxHealth) * 100);
    setStyle(this.healthBar, 'width', `${hpct}%`);
    setText(this.healthText, Math.ceil(player.health));

    if (player.shield > 0 && player.maxShield > 0) {
      this.shieldWrap.classList.remove('hidden');
      const spct = Math.max(0, Math.min(100, (player.shield / player.maxShield) * 100));
      setStyle(this.shieldBar, 'width', `${spct}%`);
      setText(this.shieldText, Math.ceil(player.shield));
      setText(this.shieldStacks, `×${Math.ceil(player.maxShield / SHIELD_PER_STACK)}`);
    } else {
      this.shieldWrap.classList.add('hidden');
    }

    const spct = Math.max(0, (player.stamina / player.maxStamina) * 100);
    setStyle(this.staminaBar, 'width', `${spct}%`);
    setText(this.staminaText, Math.ceil(player.stamina));
    toggleClass(this.staminaBar, 'stamina-low', player.stamina < 25);

    setText(this.weaponName, weaponInfo.name.toUpperCase());
    setText(this._magazineText, weaponInfo.isMelee ? '∞' : weaponInfo.magAmmo);
    setText(this._reserveText, weaponInfo.isMelee ? '' : ` / ${weaponInfo.infiniteReserve ? '∞' : weaponInfo.reserveAmmo}`);
    toggleClass(this.weaponWrap, 'melee-active', weaponInfo.isMelee);
    this._slotAmmoEls.forEach((ammo, i) => {
      const slot = weaponInfo.slots?.[i];
      if (!slot || !ammo) return;
      setText(ammo, slot.isMelee ? '∞' : `${slot.magAmmo} / ${slot.infiniteReserve ? '∞' : slot.reserveAmmo}`);
    });
    toggleClass(this.reloadText, 'hidden', !weaponInfo.isReloading);
    if (this.reloadRing) {
      toggleClass(this.reloadRing, 'hidden', !weaponInfo.isReloading);
      this.reloadRing.style.setProperty('--reload-fraction', String(Math.max(0, Math.min(1, weaponInfo.reloadProgress || 0))));
    }
    if (this.crosshair) {
      const bloom = Math.max(0, Math.min(1, weaponInfo.spreadRatio || 0));
      const aiming = Math.max(0, Math.min(1, weaponInfo.aiming || 0));
      this._adsActive = aiming > 0.72;
      // EV.IO-style readable cone: sustained hip fire opens the four bars;
      // ADS closes them into the optic without moving the centre dot.
      const gap = (4 + bloom * 8) * (1 - aiming * 0.78);
      setCustomStyle(this.crosshair, '--xhair-size', `${12 + gap * 2}px`);
      setCustomStyle(this.crosshair, '--xhair-opacity', `${1 - aiming * 0.42}`);
      toggleClass(this.crosshair, 'ads', this._adsActive);
      if (this._adsActive && this.hitmarker?.classList.contains('show')) {
        clearTimeout(this._hitmarkerTimeout);
        this.hitmarker.classList.remove('show', 'headshot');
      }
    }
    if (this.reloadProgress) {
      const reloadPct = Math.max(0, Math.min(1, weaponInfo.reloadProgress || 0));
      setStyle(this.reloadProgress, 'width', `${reloadPct * 100}%`);
    }
    if (this.reloadTime) {
      setText(this.reloadTime, `${Math.max(0, weaponInfo.reloadRemaining || 0).toFixed(1)}s`);
    }

    setText(this.killCount, kills);
    setText(this.scoreCount, score);
  }

  updateGrenades(frags, smokes, cooldowns = {}, charges = {}) {
    if (!this._grenadeHud) return;
    for (const view of this._grenadeHud) {
      const kind = view.kind;
      const amount = kind === 'frag' ? frags : kind === 'smoke' ? smokes : charges?.[kind] ?? 1;
      const count = Math.max(0, Math.floor(Number(amount) || 0));
      const remaining = Math.max(0, Number(cooldowns?.[kind]) || 0);
      const readyPercent = Math.round(Math.max(0, Math.min(1, 1 - remaining / 15)) * 100);
      setText(view.counter, count);
      toggleClass(view.counter, 'grenade-empty', count === 0);
      setCustomStyle(view.tile, '--ready', `${readyPercent}%`);
      this._updateAbilityView(view, remaining, count);
    }
  }

  flashHitmarker(headshot = false) {
    // The marker is a rotated X at screen centre. During ADS that places it
    // directly over the target and reads as a broken aim indicator. Scoped
    // hits retain their sound, damage number and elimination confirmation.
    if (this._adsActive || !this.hitmarker) return;
    this.hitmarker.classList.remove('show', 'headshot');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
    if (headshot) this.hitmarker.classList.add('headshot');
    clearTimeout(this._hitmarkerTimeout);
    this._hitmarkerTimeout = setTimeout(() => this.hitmarker.classList.remove('show', 'headshot'), 160);
  }

  showKillConfirm(headshot = false, points = 100) {
    if (!this.killConfirm) return;
    clearTimeout(this._killConfirmTimeout);
    this.killConfirmTitle.textContent = headshot ? 'HEADSHOT' : 'ELIMINATION';
    this.killConfirmScore.textContent = `+${Math.round(points)}`;
    this.killConfirm.classList.remove('hidden', 'show', 'headshot');
    void this.killConfirm.offsetWidth;
    this.killConfirm.classList.add('show');
    if (headshot) this.killConfirm.classList.add('headshot');
    this._killConfirmTimeout = setTimeout(() => {
      this.killConfirm.classList.remove('show', 'headshot');
      this.killConfirm.classList.add('hidden');
    }, 1150);
  }

  showHeadshotFlair() {
    const el = document.createElement('div');
    el.className = 'hs-flair';
    el.textContent = '🎯 HEADSHOT';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  flashTeleport() {
    if (!this._teleportFlash) return;
    this._teleportFlash.classList.remove('show');
    void this._teleportFlash.offsetWidth;
    this._teleportFlash.classList.add('show');
    clearTimeout(this._teleportFlashTimeout);
    this._teleportFlashTimeout = setTimeout(() => this._teleportFlash.classList.remove('show'), 300);
  }

  updateTeleport(ratio, secondsRemaining = (1 - ratio) * 15) {
    if (!this._abilityQ) return;
    const progress = Math.max(0, Math.min(1, Number(ratio) || 0));
    this._teleportRemaining = Math.max(0, Number(secondsRemaining) || 0);
    setCustomStyle(this._abilityQ, '--ratio', String(Math.round(progress * 100) / 100));
    setCustomStyle(this._abilityQ, '--ready', `${Math.round(progress * 100)}%`);
    this._updateAbilityView(this._teleportHud, this._teleportRemaining, 1, this._abilityTargeting, this._abilityTargetValid);
  }

  setAbilityTargeting(active, valid = true) {
    if (this._abilityTargeting === active && this._abilityTargetValid === valid) return;
    this._abilityTargeting = active;
    this._abilityTargetValid = valid;
    this._updateAbilityView(this._teleportHud, this._teleportRemaining, 1, active, valid);
  }

  /**
   * Point an arc at whatever just hit you.
   * @param {THREE.Vector3} from    world position of the shooter
   * @param {THREE.Vector3} self    world position of the player
   * @param {number} yaw            player's facing (game forward is +Z)
   */
  showDamageFrom(from, self, yaw) {
    const host = this._damageDirs || (this._damageDirs = document.getElementById('damage-dirs'));
    if (!host) return;
    // Angle to the shooter in world space, minus where we're looking → an angle
    // relative to the crosshair, with 0° meaning "dead ahead".
    const world = Math.atan2(from.x - self.x, from.z - self.z);
    let rel = world - yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));        // wrap to ±π
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    el.style.setProperty('--a', `${(-rel * 180) / Math.PI}deg`);
    host.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  flashDamage() {
    this.damageFlash.classList.remove('show');
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add('show');
    clearTimeout(this._damageTimeout);
    this._damageTimeout = setTimeout(() => this.damageFlash.classList.remove('show'), 600);
  }

  updateBlind(secondsLeft) {
    if (!this.blindOverlay) return;
    const active = secondsLeft > 0;
    toggleClass(this.blindOverlay, 'active', active);
    setStyle(this.blindOverlay, 'opacity', active
      ? String(Math.max(0.18, Math.min(1, secondsLeft / 0.7)))
      : '0');
  }

  // Mid-match player join/leave toast — slides in from left, fades after 3s.
  showJoinNotification(text, isLeave = false) {
    const el = this._joinNotification;
    if (!el) return;
    clearTimeout(this._joinNotifTimer);
    clearTimeout(this._joinFadeTimer);
    el.textContent = text;
    el.classList.remove('hidden', 'fade-out', 'leave');
    if (isLeave) el.classList.add('leave');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this._joinNotifTimer = setTimeout(() => {
      el.classList.add('fade-out');
      this._joinFadeTimer = setTimeout(() => el.classList.add('hidden'), 420);
    }, 3000);
  }

  // Live server population indicator (you + remote players, out of capacity).
  setServerPop(count, max) {
    setText(this.serverPopCount, count);
    setText(this.serverPopMax, max);
  }

  showServerPop(show) {
    this.serverPop?.classList.toggle('hidden', !show);
  }

  // Post-match leaderboard (outside #hud, so hud.hide() won't touch it).
  showLeaderboard(rows, playerName, earnedCoins = 0, stats = {}) {
    rows = [...rows].sort(compareMatchRows);
    document.getElementById('leaderboard-overlay')?.classList.add('hidden');
    this.showScoreboard(rows, 'Match complete', {...stats, earnedCoins});
    document.getElementById('scoreboard-overlay')?.classList.add('match-results');
    this._selectScoreboardTab('leaderboard');
    const panel=document.querySelector('#scoreboard-overlay .sb-panel');
    let countdown=document.getElementById('sb-next-match');
    if(!countdown && panel){countdown=document.createElement('div');countdown.id='sb-next-match';panel.appendChild(countdown);}
    if(countdown)countdown.hidden=false;
    let winner = document.getElementById('sb-winner');
    if (!winner && panel) { winner = document.createElement('div'); winner.id = 'sb-winner'; panel.querySelector('#sb-leaderboard-view')?.prepend(winner); }
    if (winner) {
      winner.replaceChildren();
      const text = stats.winnerLabel || (rows[0]?.name ? `${rows[0].name} WON` : 'MATCH COMPLETE');
      if (text.endsWith(' WON')) {
        const name = document.createElement('span'); name.className = 'sb-winner-name';
        name.textContent = text.slice(0, -4); winner.append(name, ' WON');
      } else winner.textContent = text;
    }
    let earned = document.getElementById('sb-result-earned');
    if (!earned && panel) { earned = document.createElement('div'); earned.id = 'sb-result-earned'; panel.querySelector('#sb-leaderboard-view')?.append(earned); }
    if (earned) earned.textContent = stats.guest ? `Match score: ${Number(stats.guestScore || 0).toLocaleString()} points` : `You earned ${Number(earnedCoins || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} K`;
    document.getElementById('sb-login-prompt')?.remove();
    if (stats.guest && earned) {
      const prompt = document.createElement('div');
      prompt.id = 'sb-login-prompt'; prompt.className = 'sb-login-prompt';
      const login = document.createElement('a'); login.href = '/login'; login.textContent = 'Login';
      prompt.append(login, 'to earn K in eligible matches');
      earned.after(prompt);
    }

  }

  hideLeaderboard() {
    document.getElementById('scoreboard-overlay')?.classList.remove('match-results');
    this.hideScoreboard();
    const countdown=document.getElementById('sb-next-match');if(countdown)countdown.hidden=true;
    document.getElementById('leaderboard-overlay')?.classList.add('hidden');
  }

  // In-game scoreboard (hold TAB). rows: [{name, kills, score, isYou}], sub: mode label.
  _selectScoreboardTab(name) {
    if (name !== 'leaderboard' && !document.getElementById('scoreboard-overlay')?.classList.contains('match-results')) return;
    this._scoreboardTab = name;
    document.querySelectorAll('[data-sb-tab]').forEach((tab) => {
      const active = tab.dataset.sbTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(`sb-${tab.dataset.sbTab}-view`)?.classList.toggle('hidden', !active);
    });
  }

  showScoreboard(rows, sub = '', stats = {}) {
    rows = [...rows].sort(compareMatchRows);
    const ov = document.getElementById('scoreboard-overlay');
    const tb = document.getElementById('sb-rows');
    if (!ov || !tb) return;
    if (ov.classList.contains('hidden')) this._selectScoreboardTab('leaderboard');
    const subEl = document.getElementById('sb-sub');
    if (subEl && sub) subEl.textContent = sub;
    tb.innerHTML = '';
    rows.forEach((r, i) => {
      const rank = i + 1;
      const tr = document.createElement('tr');
      if (r.isYou) tr.className = 'sb-row-you';
      const rankCls = rank <= 3 ? `sb-rank sb-rank-${rank}` : 'sb-rank';

      const nameTd = document.createElement('td');
      nameTd.className = 'sb-name-cell';
      const portrait = document.createElement(isCrazyGames() ? 'span' : 'img');
      portrait.className = r.isBot ? 'sb-portrait sb-portrait-bot' : 'sb-portrait';
      if (isCrazyGames()) { portrait.textContent = 'K'; portrait.style.cssText = 'display:inline-grid;place-items:center;background:#163344;color:#53e9ff;font-weight:bold'; }
      else portrait.src = '/images/ev-portrait.png';
      portrait.alt = ''; portrait.width = portrait.height = 34;
      nameTd.appendChild(portrait);
      const label = document.createElement('span'); label.className = 'sb-player-name';
      renderNameCosmetics(label,r.name,r.nameCosmetics); nameTd.appendChild(label);
      if (r.isYou) {
        const b = document.createElement('span');
        b.className = 'sb-you-badge'; b.textContent = 'YOU';
        nameTd.appendChild(b);
      }
      tr.innerHTML = `<td><span class="${rankCls}">${rank}.</span></td>`;
      tr.appendChild(nameTd);
      const kills = Number.isFinite(r.kills) ? r.kills : 0;
      const deaths = Number.isFinite(r.deaths) ? r.deaths : 0;
      for (const value of [(r.score || 0).toLocaleString(), r.assists ?? 0, kills, deaths,
        Number((deaths ? kills / deaths : kills).toFixed(2))]) {
        const cell = document.createElement('td'); cell.textContent = value; tr.appendChild(cell);
      }
      tb.appendChild(tr);
    });
    setText(document.querySelector('#sb-earned')?.previousElementSibling, stats.guest ? 'SCORE THIS MATCH' : 'K THIS MATCH · PENDING VALIDATION');
    setText(document.getElementById('sb-earned'), stats.guest ? Number(stats.guestScore || 0).toLocaleString() : Number(stats.earnedCoins || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
    setText(document.getElementById('sb-spectators'), `Spectators: ${stats.spectators?.join(', ') || '—'}`);
    const performance = document.getElementById('sb-performance');
    if (performance) {
      performance.replaceChildren();
      for (const [label, value] of [
        ['Accuracy', `${stats.shotsFired ? ((stats.hits || 0) / stats.shotsFired * 100).toFixed(1) : '0.0'}%`],
        ['Damage dealt', Math.round(stats.damageDealt || 0).toLocaleString()],
        ['Shots / hits', `${stats.shotsFired || 0} / ${stats.hits || 0}`],
        ['Headshots', stats.headshots || 0], ['Best streak', stats.bestStreak || 0],
      ]) {
        const term = document.createElement('dt'); term.textContent = label;
        const detail = document.createElement('dd'); detail.textContent = value;
        performance.append(term, detail);
      }
    }
    ov.classList.remove('hidden');
  }

  hideScoreboard() {
    document.getElementById('scoreboard-overlay')?.classList.add('hidden');
  }

  updateLeaderboardCountdown(secsLeft, total) {
    const next=document.getElementById('sb-next-match');if(next)next.textContent=`Next match in 0:${String(Math.max(0, Math.ceil(secsLeft))).padStart(2, '0')}`;
    const el = document.getElementById('lb-countdown');
    if (el) el.textContent = secsLeft;
    const bar = document.getElementById('lb-bar');
    if (bar) bar.style.width = `${Math.max(0, (secsLeft / total) * 100)}%`;
  }

  addKillFeed(text) {
    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.textContent = text;
    this.killfeed.appendChild(el);
    setTimeout(() => el.remove(), 4000);
    while (this.killfeed.children.length > 5) {
      this.killfeed.removeChild(this.killfeed.firstChild);
    }
  }
}
