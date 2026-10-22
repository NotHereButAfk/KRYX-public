import {networkMotionFeedback} from '../player/NetworkMotionFeedback.js';
import { applyMouseLook } from '../core/MouseLook.js';
import {renderNameCosmetics} from '../ui/NameCosmetics.js';
import { getArmorSkin } from '../player/ArmorSkins.js';
import { applySkinToCharacter } from '../player/PreviewCharacter.js';
import { EarningsUI } from '../ui/EarningsUI.js';
import { getWeapon } from '../weapons/weaponDefs.js';
// AuthNetBridge — folds the proven authoritative netcode (AuthClient) into the
// LIVE game. When enabled it replaces the local ServerSim path: the server owns
// movement + combat, the local player is client-predicted, and other players
// are real remotes interpolated from snapshots. OFF by default — enable with
//   ?authnet=1                  (connect to ws://<host>:8788)
//   ?authnet=ws://host:port     (explicit URL)
//   localStorage.kx_authnet = "1"
// Production can enable it with VITE_AUTH_WS_URL. The single-player /
// ServerSim path is completely untouched when no target is configured.

import * as THREE from 'three';
import { isMatchPickupWeaponId } from '../weapons/weaponDefs.js';
import { SHIELD_PER_STACK } from '../core/ShieldConfig.js';
import { PLAYER_WORLD_MODEL_SCALE, STATURE } from '../player/Proportions.js';
// Just above each rendered crown. Human avatars use a slightly smaller world
// scale than full-size bots, so their plate follows that actual silhouette.
const nameplateY = (avatar) => STATURE * (avatar.group.userData?.worldModelScale || 1) + 0.16;
import { AuthClient } from './AuthClient.js';
import { DT } from '../sim/MoveSim.js';
import { MovementAudio } from '../core/MovementAudio.js';
import { PLAYER_EYE_HEIGHT } from '../sim/MovementConfig.js';
import { characterSweepSegments } from '../sim/CharacterSweep.js';
import { Avatar } from '../player/Avatar.js';
import { ZombieAvatar } from '../entities/ZombieAvatar.js';
import {
  nextThirdPersonDistance,
  safeThirdPersonObstructionDistance,
  setThirdPersonDesired,
  findThirdPersonObstruction,
} from '../player/ThirdPersonCamera.js';
import {
  advanceFireCooldown,
  scheduleNextShot,
  wantsTriggerShot,
} from '../weapons/FireControl.js';
import { countAuthoritativePlayers } from '../core/Population.js';
import { isNameplateOccluded } from '../ui/NameplateOcclusion.js';
import { sprintRequested } from '../core/GameplayInput.js';
import { applyAuthoritativeResources } from './AuthoritativePresentation.js';
import { PLAYABLE_ARMOR_IDS } from '../player/ArmorTypes.js';
import { getSkin, BOT_SKIN } from '../player/skins.js';

const DEFAULT_REMOTE_SKIN = getSkin('default');
const DEFAULT_REMOTE_BOT_ARMOR_ID = 'vanguard';
export function authNetTarget() {
  return authNetTargets()[0] || null;
}

export function nearestSpawnYaw(spawns, x, y, z, fallback = Math.PI, maxDistanceSq = 64) {
  let bestYaw = fallback;
  let bestDistanceSq = maxDistanceSq;
  for (const spawn of spawns || []) {
    if (!Number.isFinite(spawn?.spawnYaw)) continue;
    const distanceSq = (spawn.x - x) ** 2 + (spawn.y - y) ** 2 + (spawn.z - z) ** 2;
    if (distanceSq >= bestDistanceSq) continue;
    bestDistanceSq = distanceSq;
    bestYaw = spawn.spawnYaw;
  }
  return bestYaw;
}

export function authNetTargets(mode = 'deathmatch') {
  if(mode === 'survival'){
    const explicit=import.meta.env.VITE_AUTH_SURVIVAL_WS_URLS;
    if(explicit)return String(explicit).split(',').map(s=>s.trim()).filter(Boolean);
    return authNetTargets().map(target=>{const url=new URL(target,location.href);url.searchParams.set('mode',mode);return url.href;});
  }
  if(mode!=='deathmatch')return [];
  try {
    const q = new URLSearchParams(location.search).get('authnet');
    if (q) return q === '1' ? [`ws://${location.hostname}:8788`] : q.split(',').map((s) => s.trim()).filter(Boolean);
    if (localStorage.getItem('kx_authnet') === '1') return [`ws://${location.hostname}:8788`];
  } catch {}
  return String(import.meta.env.VITE_AUTH_WS_URLS || import.meta.env.VITE_AUTH_WS_URL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

export class AuthNetBridge {
  constructor(game, url) {
    this.game = game;
    this.player = game.player;
    this.scene = game.world.scene;
    this.client = new AuthClient(url, { name: game.player?.name || 'Recruit' });
    this.remotes = new Map();          // id -> { group, mat, nameEl }
    this._acc = 0;
    this._fireCd = 0;
    this._prevFireDown = false;
    this._prevReloadDown = false;
    this._autoReloadRequested = false;
    this._tpsDesired = new THREE.Vector3();
    this._tpsOffset = new THREE.Vector3();
    this._tpsRaycaster = new THREE.Raycaster();
    this._nameRaycaster = new THREE.Raycaster();
    this._nameOrigin = new THREE.Vector3();
    this._nameTarget = new THREE.Vector3();
    this._remoteProject = new THREE.Vector3();
    this._collisionPosition = new THREE.Vector3();
    this._collisionContact = {
      grounded: false, normalY: -1, depth: 0, verticalCorrection: 0,
    };
    this._remoteSeen = new Set();
    this._edges = { jump: false, crouch: false, tele: false };
    this._wasAlive = true;
    // The local preview chooses a random spawn before the authoritative room
    // answers. Align the camera to the actual server spawn once its map is
    // ready instead of inheriting an unrelated yaw and staring into a wall.
    this._needsSpawnFacing = true;
    this.ready = false;
    this._welcomed = false;
    this._starting = false;
    this._mapReady = Promise.resolve();
    this.handshakePromise = new Promise(resolve => { this._resolveHandshake = resolve; });
    this.readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.client.onDisconnect = () => {
      if (this._disposed) return;
      if (!this.ready) this._rejectReady?.(new Error('Connection closed while loading. Please retry.'));
      else void game._reconnectMatch?.();
    };
    this._nameLayer = this._makeNameLayer();
    this.client.postStep = (next, previous) => this._resolveRookCollision(next, previous);
    this.client.onWelcome = (arena, match) => {
      this._welcomed = true;
      // Authoritative matches must have one ownership model. Local AI used to
      // keep fighting underneath the real server snapshots, causing phantom
      // damage, fake population counts, and two incompatible scoreboards.
      game.botManager?.clear?.();
      game.zombieManager?.clear?.();
      game.serverSim?.stop?.();
      game._netDriven = true;
      game.hud?.setServerPop?.(countAuthoritativePlayers(this.client.roster.filter(p=>!p.survivalEnemy)), this.client.survival?.capacity||8);
      this._mapReady = Promise.resolve(game._onAuthoritativeMap?.(arena?.id, match, true));
      this._mapReady.catch(error => this._rejectReady?.(error));
    };
    this.earnings = new EarningsUI(()=>{game.input.mouseDown=false;game.input.rightMouseDown=false;game.mobileControls?.hide();document.exitPointerLock?.();game._openMenu?.();},
      () => game.state === 'playing' && !game._menuOpen && !game._chatOpen && !game._spectating
        && !game._roundGateVisible && !game._authoritativeMapTransitioning);
    this.client.onEarning = m => {if(m.kind==='boss_spawn')game.hud?.addKillFeed?.(m.description);else this.earnings.notify(m.amount,m.kind,m.guest ? m.score : undefined);};
    this.client.onSnapshot = (snapshot) => {
      this.earnings.update(snapshot.economy?.guest && snapshot.postMatch
        ? {...snapshot.economy, score: snapshot.postMatch.rows.find(row => row.id === this.client.you)?.score || 0}
        : snapshot.economy);
      if (snapshot.postMatch && game.state === 'playing') {
        game._showLeaderboard(snapshot.postMatch.rows.map(row => ({ ...row, isYou: row.id === this.client.you })));
      }
      game._syncRoundGate?.();
      if (!this.client.roundGate?.waiting && this.client.self.ready !== false) this._releaseGate?.();
      // AuthClient owns the timestamped Survival state used by the HUD countdown.
      if(import.meta.env.DEV && snapshot.players?.some(p=>p.botDebug)){
        this._botDebug ||= Object.assign(document.createElement('pre'),{id:'survival-bot-debug'});
        if(!this._botDebug.isConnected)document.body.appendChild(this._botDebug);
        if(!this._debugAt||performance.now()>this._debugAt){this._debugAt=performance.now()+250;
          this._botDebug.textContent=snapshot.players.filter(p=>p.botDebug).map(p=>`${p.name}: ${p.botDebug.state} | Target ${p.botDebug.target??'none'} | Threat ${Math.round(p.botDebug.threat)} | Range ${p.botDebug.detectionRange}m | Path ${JSON.stringify(p.botDebug.path)}`).join('\n');
        }
      }else this._botDebug?.remove();
      if (!this._welcomed || this.ready || this._starting) return;
      this._resolveHandshake?.();
      this._starting = true;
      this._mapReady.then(async () => {
          // Do not release the ready promise on the same tick that map loading
          // completes. Finish the explicit ARENA READY phase first; Game starts
          // the player only after this promise resolves.
          if (this._disposed) throw new Error('Connection cancelled');
          if (await game._waitForMapLoadingMinimum?.() === false) throw new Error('Connection cancelled');
          if (this._disposed) throw new Error('Connection cancelled');
          this.client.sendReady();
          this._loadedRound = this.client.matchStart;
          await new Promise(resolve => {
            this._releaseGate = resolve;
            if (!this.client.roundGate?.waiting && this.client.self.ready !== false) resolve();
          });
          this._releaseGate = null;
          await game._finishServerJoining?.();
          if (this._disposed) throw new Error('Connection cancelled');
          this.ready = true;
          this._resolveReady?.(this);
        }).catch((error) => {
          console.error('[map] authoritative map load failed', error);
          this._rejectReady?.(error);
        });
    };
    this.client.onMapChange = (mapId, match) => {
      this._needsSpawnFacing = true;
      this._loadedRound = null;
      this._mapReady = Promise.resolve(game._onAuthoritativeMap?.(mapId, match, false));
      this._mapReady.then(async () => {
        if (await game._waitForMapLoadingMinimum?.() === false) return;
        if (this._disposed || this.client.mapId !== mapId || this.client.matchStart !== match.start) return;
        this._loadedRound = match.start;
        this.client.sendReady(mapId, match.start);
      }).catch(error => game._showServerJoinError?.(error.message));
    };
    this.client.armorSkin = this.game.selectedArmorSkin?.id;
    game.weaponSystem.authoritative = true;
    this.client.connect();
  }

  _makeNameLayer() {
    let el = document.getElementById('authnet-names');
    if (!el) { el = document.createElement('div'); el.id = 'authnet-names';
      el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden';
      document.getElementById('app')?.appendChild(el); }
    return el;
  }

  _remoteAvatar(id, isBot = false, survivalEnemy = false, zombieVariant = 0, enemyType = "walker") {
    let r = this.remotes.get(id);
    if (r) return r;
    // The SAME Avatar the local third-person body uses — same model, same walk
    // cycle, same rifle carry. Remote players used to be a cyan capsule with a
    // sphere head, so what everyone else saw of you bore no relation to what
    // you saw of yourself.
    const avatar = survivalEnemy ? new ZombieAvatar(this.scene, zombieVariant, enemyType) : new Avatar(this.scene, {
      skin: isBot ? BOT_SKIN : DEFAULT_REMOTE_SKIN,
      // Snapshots do not carry an equipped cosmetic chassis. Show the shared
      // default instead of inventing a different body from the peer's ID.
      armorTypeId: DEFAULT_REMOTE_BOT_ARMOR_ID,
      weaponId: 'm4',
      // Network peers and simulated bots share the Blender-authored default.
      allowHuman: true,
      // Bots and humans use the exact same default-player silhouette.
      modelScale: PLAYER_WORLD_MODEL_SCALE,
    });
    const nameEl = document.createElement('div');
    nameEl.className = 'nameplate';
    const nameRow = document.createElement('div');
    nameRow.className = 'np-name';
    const nameText = document.createElement('span');
    const bar = document.createElement('div');
    bar.className = 'np-bar';
    const healthFg = document.createElement('div');
    healthFg.className = 'np-bar-fg';
    nameRow.append(nameText);
    bar.appendChild(healthFg);
    nameEl.append(nameRow, bar);
    this._nameLayer.appendChild(nameEl);
    r = { avatar, nameEl, nameText, healthFg, pos: new THREE.Vector3() };
    this.remotes.set(id, r);
    return r;
  }

  update(dt, input, controlsEnabled = true) {
    const p = this.player, c = this.client;
    if (!c.sim) return;                 // not welcomed yet
    const mapReady = !this.game._authoritativeMapTransitioning
      && this.game.world.currentMapId === c.mapId;

    const alive = c.self.alive !== false;
    if (this._wasAlive && !alive) this.game._onAuthoritativeDeath?.(c.self);
    if (!this._wasAlive && alive) {
      this._needsSpawnFacing = true;
      this.game._onAuthoritativeRespawn?.(c.self);
    }
    this._wasAlive = alive;
    const canControl = alive && controlsEnabled && mapReady && !c.roundGate?.waiting && c.self.ready !== false;
    if (this.game.pickupSystem) {
      this.game.pickupSystem._authoritative = true;
      this.game.pickupSystem._onPickupRequest = padId => c.sendPickup(padId);
      this.game.pickupSystem.syncLootPads(c.lootPads);
    }

    // ── look (client-owned), same math as the legacy controller ──
    if (canControl) {
      applyMouseLook(p, input);
    }

    // Match the legacy controller: the wheel enters/leaves third-person and
    // WeaponSystem sees _camDist immediately, so it cannot also swap weapons.
    if (canControl && input.wheelDelta !== 0) {
      p._camDist = nextThirdPersonDistance(p._camDist, input.wheelDelta);
    }

    // edges collected per frame, consumed on the next tick
    if (canControl && input.consumeJustPressed('Space')) this._edges.jump = true;
    if (canControl && (input.consumeJustPressed('ControlLeft') || input.consumeJustPressed('KeyC'))) this._edges.crouch = true;
    if (canControl && input.teleportConfirmed) this._edges.tele = true;

    // ── fixed-tick input send + prediction ──
    this._acc += Math.min(dt, 0.1);
    this._syncAuthoritativeLoadout();
    const def = this.game.weaponSystem?.currentDef;
    while (this._acc >= DT) {
      this._acc -= DT;
      const mz = canControl ? (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0) : 0;
      const mx = canControl ? (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0) : 0;
      const previousJumpVelocity = c.sim.vy;
      const soundBefore = {px:c.sim.px, pz:c.sim.pz, onGround:c.sim.onGround, vy:c.sim.vy};
      if (alive) c.sendInput({
        mx, mz, yaw: p.yaw, pitch: p.pitch,
        sprint: canControl && sprintRequested(input, mz, p.weaponSprintBlocked, mx),
        crouch: canControl && (input.isDown('ControlLeft') || input.isDown('KeyC')),
        jumpJust: this._edges.jump, crouchJust: this._edges.crouch, teleJust: this._edges.tele,
        wid: def?.id || 'm4', aiming: canControl && !!input.rightMouseDown,
      });
      if (alive && this._edges.jump && !c.sim.onGround && c.sim.vy > previousJumpVelocity) p.audio?.playJump?.();
      this._movementAudio ||= new MovementAudio();
      this._movementAudio.update(p.audio, soundBefore, c.sim, !!c.sprinting,
        alive && mapReady, DT);
      this._edges.jump = this._edges.crouch = this._edges.tele = false;
    }

    // ── drive the local player from the predicted sim ──
    c.advancePresentation(dt);
    const lp = mapReady ? c.localPos(this._acc) : null;
    if (lp) { p.position.set(lp.x, lp.y, lp.z); }
    if (lp && this._needsSpawnFacing) {
      p.yaw = nearestSpawnYaw(this.game.world.spawnPoints, lp.x, lp.y, lp.z, p.yaw);
      p.pitch = 0;
      this._needsSpawnFacing = false;
    }
    p.velocity.set(alive ? (c.sim.vx || 0) : 0, alive ? (c.sim.vy || 0) : 0, alive ? (c.sim.vz || 0) : 0);
    p.onGround = !!c.sim.onGround;
    p._airJumpUsed = !!c.sim.airJumpUsed;
    p.isCrouching = !!c.sim.crouch;
    p.isSliding = !!c.sim.slide;
    p.isSprinting = alive && !p.weaponSprintBlocked && !!c.sprinting;
    p._eyeHeight += ((c.sim.eye ?? p._eyeHeight) - p._eyeHeight)
      * (1 - Math.exp(-22 * Math.max(0, dt)));
    p.health = c.self.health;
    // Movement prediction and the HUD now consume the same authoritative
    // stamina/inventory snapshot, so sprint drain and grenade counts agree.
    applyAuthoritativeResources(p, c, this.game.grenadeSystem);
    this.game.grenadeSystem?.syncBombs(c.bombs || []);
    this.game.grenadeSystem?.syncProjectiles(c.projectiles || [], dt, p => this._projectileMuzzle(p));
    this.game.kills = c.self.kills ?? this.game.kills;
    this.game.deaths = c.self.deaths ?? this.game.deaths;
    this.game.score = c.self.score ?? this.game.score;
    const weaponState = this.game.weaponSystem?.state.get(c.self.wid);
    if (weaponState && def?.kind !== 'melee') {
      weaponState.magAmmo = c.self.mag ?? weaponState.magAmmo;
      weaponState.reserveAmmo = c.self.reserve ?? weaponState.reserveAmmo;
      if (c.self.reloading) {
        weaponState.isReloading = true;
        weaponState.reloadTimer = (c.self.reloadTicks || 0) / 20;
      } else if (!this._prevReloadDown) {
        weaponState.isReloading = false;
        weaponState.reloadTimer = 0;
      }
    }
    this.game.hud?.updateBlind?.((c.self.blindTicks || 0) / 20);
    const movementRoll=networkMotionFeedback(p,dt,mapReady&&alive&&controlsEnabled);
    if (!mapReady) {
      p.velocity.set(0, 0, 0);
    } else if (p._camDist > 0) {
      setThirdPersonDesired(
        this._tpsDesired, p.position, p.yaw, p.pitch, p._camDist,
      );
      p._tpsTarget.set(p.position.x, p.position.y + 1.25, p.position.z);
      const cameraOffset = this._tpsOffset.copy(this._tpsDesired).sub(p._tpsTarget);
      const obstruction = findThirdPersonObstruction(
        this._tpsRaycaster, this.game.world, p._tpsTarget, this._tpsDesired, cameraOffset,
      );
      cameraOffset.copy(this._tpsDesired).sub(p._tpsTarget).normalize();
      p._tpsObstructed = !!obstruction && obstruction.distance < 0.8;
      if (p._tpsObstructed) {
        p.camera.position.set(p.position.x, p.position.y + p._eyeHeight, p.position.z);
        p.camera.rotation.order = 'YXZ';
        p.camera.rotation.y = p.yaw;
        p.camera.rotation.x = p.pitch;
        p.camera.rotation.z = movementRoll;
      } else if (obstruction) {
        p.camera.position.copy(p._tpsTarget)
          .addScaledVector(cameraOffset, safeThirdPersonObstructionDistance(obstruction.distance));
      } else {
        p.camera.position.copy(this._tpsDesired);
      }
      if (!p._tpsObstructed) {
        p.camera.rotation.order = 'YXZ';
        p.camera.rotation.y = p.yaw;
        p.camera.rotation.x = p.pitch;
        p.camera.rotation.z = movementRoll;
      }
    } else {
      p._tpsObstructed = false;
      p.camera.position.set(p.position.x, p.position.y + p._eyeHeight, p.position.z);
      p.camera.rotation.order = 'YXZ';
      p.camera.rotation.y = p.yaw;
      p.camera.rotation.x = p.pitch;
      p.camera.rotation.z = movementRoll;
    }

    // ── fire (server-authoritative hit; client just requests) ──
    this._fireCd = advanceFireCooldown(this._fireCd, dt);
    const reloadDown = canControl && input.isDown('KeyR');
    if (reloadDown && !this._prevReloadDown && def?.kind !== 'melee') c.sendReload(def.id);
    if (c.self.mag <= 0 && !c.self.reloading && !this._autoReloadRequested && def?.kind !== 'melee') {
      c.sendReload(def.id);
      this._autoReloadRequested = true;
    }
    if (c.self.mag > 0 || c.self.reloading) this._autoReloadRequested = false;
    this._prevReloadDown = reloadDown;

    const wantsShot = canControl && def
      && wantsTriggerShot(def.automatic, input.mouseDown, this._prevFireDown);
    if (wantsShot && this._fireCd <= 0) {
      c.sendFire(def.id, p.yaw, p.pitch);
      this._fireCd = scheduleNextShot(this._fireCd, def.fireRate);
    }
    if (!input.mouseDown && this._fireCd < 0) this._fireCd = 0;
    this._prevFireDown = canControl && !!input.mouseDown;

    // ── render remote players ──
    this._syncRemotes(dt, mapReady);
    // Count the authoritative roster, not only currently interpolated remote
    // meshes. Bots are full match participants and remain counted while dead,
    // respawning, or waiting for their first render buffer.
    this.game.hud?.setServerPop?.(countAuthoritativePlayers(this.client.roster.filter(p=>!p.survivalEnemy)), this.client.survival?.capacity||8);
    this._drainEvents();
  }

  setSpectating(enabled) {
    const ws = this.client.ws;
    if (!this.client.connected) return Promise.reject(new Error('Connection lost. Please reconnect.'));
    return new Promise((resolve,reject) => {
      const cleanup = () => { clearTimeout(timer); ws.removeEventListener('message',onMessage); };
      const onMessage = event => {
        let response; try { response = JSON.parse(event.data); } catch { return; }
        if (response.t !== 'spectator-state') return;
        cleanup();
        if (response.enabled === enabled) resolve();
        else reject(new Error('Match is full. Keep spectating and try Join again.'));
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Server did not confirm the spectator change.')); },5000);
      ws.addEventListener('message',onMessage);
      ws.send(JSON.stringify({t:'spectate',enabled}));
    });
  }

  _projectileMuzzle(projectile) {
    if (!projectile.wid) return null; // Hand-thrown grenades keep their throw origin.
    const from = new THREE.Vector3();
    if (projectile.by === this.client.you) {
      const weapons = this.game.weaponSystem;
      if (weapons?.currentDef.id !== projectile.wid || this.game.state !== 'playing') return null;
      weapons.models.get(projectile.wid)?.muzzle?.getWorldPosition(from);
      return weapons._projectMuzzleBeforeTarget(from,
        new THREE.Vector3(projectile.x, projectile.y, projectile.z));
    }
    const avatar = this.remotes.get(projectile.by)?.avatar;
    return avatar?.weaponId === projectile.wid && avatar.group.visible !== false
      ? avatar.getMuzzleWorldPosition(from) : null;
  }

  updateSpectator(dt) {
    this.game.grenadeSystem?.syncBombs(this.client.bombs || []);
    this.game.grenadeSystem?.syncProjectiles(this.client.projectiles || [], dt, p => this._projectileMuzzle(p));
    this.game.grenadeSystem?.update(dt, this.player, this.game.world);
    this._syncRemotes(dt, this._loadedRound === this.client.matchStart);
    this._drainEvents();
  }

  _syncAuthoritativeLoadout() {
    const weapons = this.game.weaponSystem;
    if (!weapons) return;
    const self = this.client.self;
    const ids = [...new Set(self.matchWeapons ?? (self.matchWeapon ? [self.matchWeapon] : []))]
      .filter(isMatchPickupWeaponId);
    const pending = weapons.pendingEmptyDiscards;
    // Keep predicted discards until a snapshot acknowledges their removal.
    // Old snapshots must never equip the empty gun again.
    for (const id of pending || []) if (!ids.includes(id)) pending.delete(id);
    const current = weapons.loadout.filter(w => isMatchPickupWeaponId(w.id)).map(w => w.id);
    let changed = false;
    if (current.some(id => !ids.includes(id))) {
      const selected = weapons.currentDef?.id;
      weapons.loadout = weapons.loadout.filter(w => !isMatchPickupWeaponId(w.id) || ids.includes(w.id));
      weapons.currentIndex = Math.max(0, weapons.loadout.findIndex(w => w.id === selected));
      weapons._rebuildKeyMap();
      weapons._setActiveModel(weapons.currentIndex);
      changed = true;
    }
    for (const id of ids) {
      if (pending?.has(id) || weapons.loadout.some(w => w.id === id)) continue;
      const def = weapons.addMapGun?.(id);
      if (def) {
        this.game.hud?.addKillFeed?.(`PICKED UP — ${def.name}`);
        changed = true;
      }
    }
    // Duplicate pickups can replenish an unequipped weapon. Sync by weapon id,
    // not by the selected slot, and don't rebuild/refill the inventory per frame.
    for (const [id, ammo] of Object.entries(self.weaponAmmo || {})) {
      const state = weapons.state.get(id);
      if (!state) continue;
      if (Number.isFinite(ammo.mag)) state.magAmmo = ammo.mag;
      if (Number.isFinite(ammo.reserve)) state.reserveAmmo = ammo.reserve;
    }
    if (changed) this.game.hud?.buildWeaponSlots?.(weapons.getHudInfo().slots, weapons.currentIndex);
  }

  _resolveRookCollision(next, previous) {
    const world = this.game.world;
    if (next.recovered) return next;
    if (!world?._mapOctree || this.game._authoritativeMapTransitioning
      || world.currentMapId !== this.client.mapId) return next;
    const dx = next.px - previous.px;
    const dy = next.py - previous.py;
    const dz = next.pz - previous.pz;
    const distance = Math.hypot(dx, dz);
    const segments = distance < 2 ? characterSweepSegments(Math.hypot(dx, dy), dz) : 1;
    let stepX = dx / segments;
    let stepY = dy / segments;
    let stepZ = dz / segments;
    next.px = previous.px;
    next.py = previous.py;
    next.pz = previous.pz;

    let supported = !!previous.onGround;
    for (let segment = 0; segment < segments; segment++) {
      const previousY = next.py;
      next.px += stepX;
      next.py += stepY;
      next.pz += stepZ;
      const ground = world.groundHeightAt(next.px, next.pz, previousY, next.py);
      if (next.py <= ground + (supported ? .3 : .05) && next.vy <= 0.001) {
        next.py = ground; next.vy = 0; next.onGround = 1;
        next.nX = 0; next.nY = 1; next.nZ = 0;
      }
      supported = next.vy <= .001 && next.py <= ground + .05;
      next.onGround = supported ? 1 : 0;
      const position = this._collisionPosition.set(next.px, next.py, next.pz);
      world.resolveCollisions(position, 0.45, this._collisionContact,
        (next.crouch || next.slide) ? 1.0 : PLAYER_EYE_HEIGHT);
      if (this._collisionContact.boundaryMask & 1) next.vx = 0;
      if (this._collisionContact.boundaryMask & 2) next.vz = 0;
      if (this._collisionContact.boundaryMask & 4) next.vy = Math.min(0, next.vy);
      if (this._collisionContact.grounded && next.vy <= 0.001) {
        supported = true;
        next.vy = 0;
        next.onGround = 1;
        next.nX = 0;
        next.nY = 1;
        next.nZ = 0;
      }
      next.px = Math.round(position.x * 1e6) / 1e6;
      next.py = Math.round(position.y * 1e6) / 1e6;
      next.pz = Math.round(position.z * 1e6) / 1e6;
      // Collision can remove one velocity component. Use the resolved motion
      // for the remaining micro-steps so a wall still stops the player.
      stepX = Math.sign(dx) * Math.min(Math.abs(dx), Math.max(0, next.vx * Math.sign(dx) * DT)) / segments;
      stepY = next.vy * DT / segments;
      stepZ = Math.sign(dz) * Math.min(Math.abs(dz), Math.max(0, next.vz * Math.sign(dz) * DT)) / segments;
    }
    return next;
  }

  _syncRemotes(dt, mapReady = true) {
    const seen = this._remoteSeen;
    seen.clear();
    const cam = this.game._spectating ? this.game.menuCamera : this.player.camera;
    cam.getWorldPosition(this._nameOrigin);
    const w = window.innerWidth, h = window.innerHeight;
    const v = this._remoteProject;
    const now = performance.now();
    this.renderedRemotes = this.client.remoteStates();
    for (const r of this.renderedRemotes) {
      seen.add(r.id);
      const a = this._remoteAvatar(r.id, r.isBot, r.survivalEnemy, r.zombieVariant, r.enemyType);
      const equippedArmor = r.armorSkin || null;
      if(!r.isBot && !r.survivalEnemy && (a.armorSkin !== equippedArmor || a.skinGroup !== a.avatar.group)){
        applySkinToCharacter(a.avatar.group, DEFAULT_REMOTE_SKIN, getArmorSkin(equippedArmor));
        a.armorSkin=equippedArmor;a.skinGroup=a.avatar.group;
      }
      a.avatar.group.visible = mapReady && r.ready !== false;
      if (!mapReady || r.ready === false) { a.nameEl.style.display = 'none'; continue; }
      a.pos.set(r.x, r.y, r.z);
      const avatarDistanceSq = this._nameOrigin.distanceToSquared(a.pos);
      a.avatar.setWeapon(r.wid || 'm4');
      // Derive cadence from rendered interpolation displacement, so a stalled
      // snapshot stream settles to idle rather than running in place.
      a.avatar.update(dt, {
        position: a.pos, yaw: r.yaw, aimYaw: r.aimYaw, pitch: r.pitch || 0,
        sprint: r.sprint, grounded: r.grounded, airJumpUsed: r.airJumpUsed || 0, vy: r.vy || 0,
        crouch: r.crouch, sliding: r.sliding,
        isBot: r.isBot,
        deathFloor: r.isBot && !r.alive ? this._remoteDeathFloor(a, r) : undefined,
        aiming: r.aiming, firing: r.firing, alive: r.alive, deathReaction: r.deathReaction,
        reload: r.reload || 0, swing: r.swing == null ? 1 : r.swing,
        viewDistanceSq: avatarDistanceSq,
      });
      // Keep semantic plate state current even while it is off-screen or
      // occluded, so the first visible frame never flashes an empty bar/name.
      renderNameCosmetics(a.nameText,r.name,r.nameCosmetics);
      const healthWidth = `${THREE.MathUtils.clamp((r.health || 0) / (r.maxHealth || 100) * 100, 0, 100)}%`;
      if (a.healthFg.style.width !== healthWidth) a.healthFg.style.width = healthWidth;
      // nameplate
      this._nameTarget.set(r.x, r.y + nameplateY(a.avatar), r.z);
      v.copy(this._nameTarget).project(cam);
      const distanceSq = this._nameOrigin.distanceToSquared(this._nameTarget);
      const drawable = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1
        && distanceSq <= 90 * 90 && r.alive;
      if (drawable && (!a._losNext || now >= a._losNext)) {
        a._nameOccluded = isNameplateOccluded(
          this.game.world, this._nameOrigin, this._nameTarget, this._nameRaycaster,
        );
        a._losNext = now + 100;
      }
      if (drawable && !a._nameOccluded) {
        const distance = Math.sqrt(distanceSq);
        a.nameEl.style.display = 'block';
        a.nameEl.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
        a.nameEl.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
        a.nameEl.style.transform = `translate(-50%,-100%) scale(${THREE.MathUtils.clamp(1.15 - distance / 180, 0.72, 1)})`;
      } else { a.nameEl.style.display = 'none'; }
    }
    for (const [id, a] of this.remotes) {
      if (!seen.has(id)) { a.avatar.dispose(); a.nameEl.remove(); this.remotes.delete(id); }
    }
  }

  _remoteDeathFloor(avatar, state) {
    if (Number.isFinite(state.deathReaction?.floorY)) return state.deathReaction.floorY;
    // Compatibility with an older server during rollout: cache by corpse
    // position rather than tracing the entire map on every animation frame.
    const key = `${state.x},${state.y},${state.z}`;
    if (avatar._deathFloorKey !== key) {
      avatar._deathFloorKey = key;
      avatar._deathFloor = this.game.world.groundHeightAt(state.x, state.z, state.y + .2, state.y - 256);
    }
    return avatar._deathFloor;
  }

  _drainEvents() {
    const me = this.client.you;
    for (const e of this.client.drainEvents()) {
      if (e.e === 'hit') {
        if (e.by === me && e.id !== me) {
          this.game.hud?.flashHitmarker?.(e.head);
          const position = [e.x, e.y, e.z].every(Number.isFinite)
            ? new THREE.Vector3(e.x, e.y, e.z)
            : this.remotes.get(e.id)?.avatar?.group?.position?.clone().add(new THREE.Vector3(0, 1.5, 0));
          if (position) this.game.damageNumbers?.spawn(this.player.camera, position, e.dmg,
            { headshot: e.head, killed: e.killed });
        }
        if (e.wid === 'sword') {
          const point = e.id === me ? this.player.position : this.remotes.get(e.id)?.avatar?.group?.position;
          if (point) this.game.audio?.playAt(point, () => this.game.audio.playSwordImpact?.('armor'));
        }
        if (e.id === me) this.game._playerBody?.userData?.triggerHit?.(0.7, 0.8);
        else this.remotes.get(e.id)?.avatar?.group?.userData?.triggerHit?.(0.7, 0.8);
      }
      else if (e.e === 'kill') {
        if (e.by === me) {
          this.game.hud?.flashHitmarker?.(e.head);
          this.game.hud?.showKillConfirm?.(e.head, e.score ?? 100);
          const skin = this.game.weaponSystem?.showLegendaryKill?.(e.wid);
          const victim = this.remotes.get(e.id)?.avatar?.group;
          if (skin && victim) this.game.deathEffects?.spawn(victim.position, skin.id, skin.id, e.wid === 'sword');
          if (e.head) this.game.hud?.showHeadshotFlair?.();
        }
        const tag = e.head ? ' 🎯' : '';
        this.game.hud?.addKillFeed?.(`${e.byName} eliminated ${e.victimName}${tag}`);
      }
      else if (e.e === 'ability' && e.kind === 'smoke') {
        this.game.grenadeSystem?.showAuthoritativeSmoke?.(new THREE.Vector3(e.x, e.y, e.z));
      }
      else if (e.e === 'ability' && e.kind === 'impulse') {
        this.game.grenadeSystem?.showImpulse(new THREE.Vector3(e.x,e.y,e.z));
      }
      else if (e.e === 'explosion' && ['frag','timebomb'].includes(e.kind)) {
        this.game.grenadeSystem?.showAuthoritativeExplosion?.(new THREE.Vector3(e.x, e.y, e.z), e.r);
      }
      else if (e.e === 'bladeImpact') {
        this.game.audio?.playAt(new THREE.Vector3(e.x, e.y, e.z), () => this.game.audio.playSwordImpact?.('metal'));
      }
      else if (e.e === 'weaponSound' && e.by !== me) {
        const def = getWeapon(e.wid);
        if (def) this.game.audio?.playAt(new THREE.Vector3(e.x, e.y, e.z), () => {
          if (def.kind === 'melee') this.game.audio.playSwing();
          else this.game.audio.playShot(def.sound || def.id, e.rounds);
        });
      }
      else if (e.e === 'shot' && e.by !== me) {
        const from = new THREE.Vector3(e.x, e.y, e.z);
        const to = new THREE.Vector3(e.tx, e.ty, e.tz);
        // Visual origins follow the rendered weapon, including its hand pose
        // and interpolation. Keep the server's hit endpoint unchanged.
        const avatar = this.remotes.get(e.by)?.avatar;
        if (avatar?.weaponId !== e.wid || avatar.group.visible === false
          || !avatar.getMuzzleWorldPosition?.(from)) continue;
        this.game.weaponSystem?.showAuthoritativeTracer?.(e.wid, from, to);
      }
      else if (e.e === 'explosion' && e.kind === 'rocket') {
        this.game.weaponSystem?.showAuthoritativeExplosion?.(
          new THREE.Vector3(e.x, e.y, e.z), e.r || 5, e.wid === 'plasmarifle' ? 'energy' : 'rocket',
        );
      }
      else if (e.e === 'pickup' && e.id === me && e.lootType === 'weapon') {
        // A real recollection can occur between snapshots that both list the gun.
        this.game.weaponSystem?.pendingEmptyDiscards?.delete(e.gunId);
      }
      else if (e.e === 'pickup' && e.id === me && e.lootType === 'shield') {
        const stacks = Math.ceil((e.maxShield || 0) / SHIELD_PER_STACK);
        this.game.hud?.addKillFeed?.(`SHIELD +${SHIELD_PER_STACK} · ${stacks} STACK${stacks === 1 ? '' : 'S'}`);
      }
    }
  }

  disconnect() {
    if (this._disposed) return;
    this._disposed = true;
    // Unblock a pending ready/map promise when an attempt is replaced/cancelled.
    if (!this.ready) this._rejectReady?.(new DOMException('Connection cancelled', 'AbortError'));
    this._releaseGate?.();
    this.game.weaponSystem.authoritative = false;
    this.game.grenadeSystem?.syncProjectiles([]);
    this._botDebug?.remove();
    this.earnings?.dispose();
    this.client.disconnect();
    for (const [, a] of this.remotes) { a.avatar.dispose(); a.nameEl.remove(); }
    this.remotes.clear();
    this._nameLayer?.remove();
  }
}
