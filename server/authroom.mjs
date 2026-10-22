import { BOT_MOVEMENT_SCALE } from '../src/sim/MovementConfig.js';
import { createDeathReaction } from '../src/sim/DeathReaction.js';
import { stepGrenade, launcherShouldExplode } from '../src/sim/GrenadePhysics.js';
import { shotSpread, spreadDirection } from '../src/weapons/ShotSpread.js';
// Authoritative room (Phase 4 + 5) — fixed-20Hz server-owned simulation.
//
// Runs the SAME deterministic MoveSim the client predicts with, so server and
// client agree tick-for-tick. Owns every gameplay truth: position (validated
// against the sim, never trusted from the client), health/shield, damage,
// death, respawn, match timer, score, and the kill feed. Hitscan is
// lag-compensated by rewinding target positions to the snapshot the shooter saw.
//
// Wire protocol (JSON messages):
//   client → server:
//     {t:'hello', name}                         join
//     {t:'input', seq, tick, mx,mz,yaw,pitch,   one command per client tick
//                 sprint,crouch,jump,crouchDown,tele}
//     {t:'fire', seq, wid, yaw, pitch, viewTick} fire request (server hitscans)
//     {t:'reload', wid}                         reload request (server owns ammo)
//     {t:'ability', seq, kind, yaw, pitch}      throwable request
//     {t:'pong', id}                            heartbeat reply
//   server → client:
//     {t:'welcome', you, tick, arena, players}  post-join
//     {t:'snapshot', tick, ack, you, players, events}   20Hz world state
//     {t:'ping', id}                            heartbeat
//     {t:'kick', reason}
//
// Anti-abuse lives in authserver.mjs (origin/schema/rate/size/replay/
// heartbeat/backpressure); this file enforces GAMEPLAY authority.

import { createState, step, makeInput, isSprinting } from '../src/sim/MoveSim.js';
import { blastDamage } from '../src/sim/BlastDamage.js';
import { PatrolNavigation, choosePatrolGoal } from './patrol-navigation.mjs';
import { STAMINA_MAX, STAMINA_DRAIN, FIRE_SPRINT_RECOVERY, WALK_SPEED, SPRINT_MULT, JUMP_SPEED, PLAYER_EYE_HEIGHT } from '../src/sim/MovementConfig.js';
import {
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_RATE,
  MAX_PICKUP_SHIELD,
  SHIELD_REGEN_DELAY,
  SHIELD_REGEN_RATE,
  addShieldStack,
} from '../src/core/CombatConfig.js';
import {
  BOT_DASH,
  BOT_RETALIATION_AIM_SCALE,
  botArenaDetectionDistance,
  BOT_STATES,
  botAimErrorMeters,
  botTrackingOffset,
  botDashBonusSpeed,
  botSeparationVector,
  chooseReachableRoamPoint,
  choosePlayerLikeBotMove,
  getBotDifficulty,
  isBotDashLaneSafe,
  isInsideBotFov,
  smoothBotAim,
  quantizeBotMove,
} from '../src/entities/BotCombat.js';
import { randomBotName } from '../src/entities/BotNames.js';
import {
  MAIN_WEAPON_IDS,
  WEAPONS as CLIENT_WEAPONS,
  isMatchPickupWeaponId,
} from '../src/weapons/weaponDefs.js';
import { randomLootSpecs, rollLootItem } from '../src/world/PickupLayout.js';
import { RESULTS_MS } from '../src/sim/MatchFlow.js';
import { IMPORTED_ARENAS } from './rookarena.mjs';
import { MATCH_DURATION_MS, continuousMatchState } from './matchclock.mjs';

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

export function botPresentationYaw(aimYaw, vx, vz, combat = false) {
  if (combat) return aimYaw;
  const speed = Math.hypot(vx, vz);
  if (speed < 0.2) return aimYaw;

  // The weapon/upper body receives `aimYaw` separately. Let the visible body
  // follow resolved lateral travel so the pelvis is not twisted 90 degrees
  // underneath a forward-facing torso while a bot changes cover or circles at
  // close range. Keep facing the opponent only during a genuine retreat: that
  // produces an ordinary backpedal instead of making the soldier turn its back
  // on the fight.
  const nx = vx / speed, nz = vz / speed;
  const aimForwardX = -Math.sin(aimYaw);
  const aimForwardZ = -Math.cos(aimYaw);
  const forwardDot = nx * aimForwardX + nz * aimForwardZ;
  if (forwardDot < -0.35) return aimYaw;
  return Math.atan2(-nx, -nz);
}

const RESPAWN_TICKS = TICK_HZ * 3;          // 3s
const SPAWN_PROTECTION_TICKS = Math.ceil(TICK_HZ * 1.5);
const MAX_INPUT_QUEUE = 8;                  // drop floods; catch-up caps here
const INPUT_HOLD_GRACE_TICKS = 3;           // at most 150ms between input packets
const INPUT_LEAD_TICKS = 6;                 // how far ahead of server tick we allow
const HISTORY_TICKS = 20;                   // 1s of position history for lag-comp
const START_HEALTH = 100, START_SHIELD = 0;

// Derive authority from the same catalog used by the client. The old
// five-entry table silently converted every other shipped weapon into an M4.
const WEAPONS = Object.fromEntries(CLIENT_WEAPONS.map((weapon) => [weapon.id, {
  id: weapon.id,
  kind: weapon.kind,
  dmg: weapon.damage,
  rate: weapon.fireRate,
  spread: weapon.spread,
  spreadMin: weapon.spreadMin,
  spreadMax: weapon.spreadMax,
  bloomShot: weapon.spreadBloomPerShot,
  bloomRecovery: weapon.spreadRecovery,
  zoomSpreadMod: weapon.zoomSpreadMod,
  pellets: weapon.pellets || 1,
  ammoPerShot: weapon.ammoPerShot || 1,
  energyBlast: !!weapon.energyBlast,
  range: weapon.range,
  hs: weapon.headshotMultiplier || 1,
  splashRadius: weapon.splashRadius || 0,
  splashMin: weapon.splashMin ?? 0.25,
  rocketSpeed: weapon.rocketSpeed || 0,
  reload: weapon.reloadTime || 0,
  mag: weapon.magSize || 0,
  reserve: weapon.reserveMax || 0,
  infiniteReserve: !!weapon.infiniteReserve,
  arc: weapon.arc || 0,
}]));
const BASE_WEAPONS = new Set([...MAIN_WEAPON_IDS, 'sword']);
const MAIN_WEAPONS = new Set(MAIN_WEAPON_IDS);
const WEAPON_COLLECT_RADIUS = 2.0;
const WEAPON_COLLECT_HEIGHT = 2.2;
const LOOT_RESPAWN_TICKS = TICK_HZ * 35;
const HEAD_Y = 1.55, BODY_R = 0.5, HEAD_R = 0.28;

// Server-authoritative throwable abilities (Phase 10). The server owns charges,
// cooldown, the detonation point, and every effect — the client only requests.
//   flash:   LOS-gated blind on players inside the radius
//   smoke:   a vision volume that blocks hitscan for its lifetime
//   impulse: radial knockback velocity (clamped so it can't launch to infinity)
const ABILITIES = {
  timebomb: { cd: 15, charges: 1, throwRange: 0, radius: 9, damage: 80, fuseSec: 3 },
  frag:    { cd: 15.0, charges: 2, throwRange: 24, radius: 9, damage: 150, fuseSec: 2.5 },
  flash:   { cd: 15.0, charges: 2, throwRange: 24, radius: 8,  blindSec: 2.2 },
  smoke:   { cd: 15.0, charges: 2, throwRange: 22, radius: 5,  lifeSec: 8, fuseSec: 1.2 },
  impulse: { cd: 15.0, charges: 2, throwRange: 18, radius: 6,  power: 11 },
};
const IMPULSE_MAX = 18;   // hard clamp on any single knockback component
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// AABB slab raycast (nearest hit t in [0.1, maxT], else maxT) — used to find
// an ability's detonation point against the arena geometry.
function rayVsBoxes(world, ox, oy, oz, dx, dy, dz, maxT) {
  if (world.raycast) return world.raycast(ox, oy, oz, dx, dy, dz, maxT);
  let best = maxT;
  for (const b of world.boxes) {
    let t0 = 0, t1 = best, hit = true;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < b.min[a] || o[a] > b.max[a]) { hit = false; break; } }
      else {
        let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { hit = false; break; }
      }
    }
    if (hit && t0 > 0.1 && t0 < best) best = t0;
  }
  return best;
}

let _pid = 1;

// Select from the safest authored tier relative to every living combatant.
// Vertical separation is deliberately discounted: a bot one floor above is
// still a dangerous spawn neighbour in an arena shooter.
export function chooseSafeSpawn(spawns, occupants = [], seed = 0) {
  if (!spawns?.length) return [0, 0, 0];
  if (!occupants.length) return [...spawns[Math.abs(seed) % spawns.length]];
  const scored = spawns.map((spawn, index) => {
    let nearest = Infinity;
    for (const occupant of occupants) {
      const dx = spawn[0] - occupant[0];
      const dy = spawn[1] - occupant[1];
      const dz = spawn[2] - occupant[2];
      nearest = Math.min(nearest, dx * dx + dz * dz + dy * dy * 0.2);
    }
    return { spawn, index, nearest };
  }).sort((a, b) => b.nearest - a.nearest || a.index - b.index);
  const best = scored[0]?.nearest ?? 0;
  const threshold = Math.max(12 * 12, best * 0.72);
  let tier = scored.filter((entry) => entry.nearest >= threshold);
  if (!tier.length) tier = scored.slice(0, 1);
  tier = tier.slice(0, Math.max(1, Math.ceil(scored.length / 3)));
  return [...tier[Math.abs(seed) % tier.length].spawn];
}

export class AuthRoom {
  constructor(arena = IMPORTED_ARENAS, {
    shieldsEnabled = false,
    targetPopulation = 0,
    botDifficulty = 'normal',
    botDifficultyOverrides = null,
    lootSeed = Date.now(),
    now = Date.now(),
  } = {}) {
    this.arenas = Array.isArray(arena) ? arena : [arena];
    if (!this.arenas.length) throw new Error('AuthRoom requires at least one imported arena');
    const continuousMatch = continuousMatchState(now, this.arenas.length);
    this._arenaIndex = continuousMatch.arenaIndex;
    this.arena = this.arenas[this._arenaIndex];
    this._setSimArena(this.arena);
    this.tick = 0;
    this._lootSeed = Number(lootSeed) | 0;
    this._lootGeneration = 0;
    this.shieldsEnabled = shieldsEnabled;
    this.lootPads = [];
    this._resetLootPads();
    this.players = new Map();   // id -> player
    this.events = [];           // per-tick outgoing events (kills, hits, spawns)
    this.smokes = [];           // active smoke volumes {x,y,z,r,until}
    this.projectiles = [];
    this._projectileSerial = 0;
    this.frags = [];            // pending authoritative detonations
    this.matchStart = continuousMatch.matchStart;
    this.matchDurationMs = MATCH_DURATION_MS;
    this._arenaBroadcastUntilTick = -1;
    const requestedPopulation = Number.isFinite(targetPopulation) ? targetPopulation | 0 : 0;
    this.targetPopulation = clamp(requestedPopulation, 0, 8);
    this.botDifficultyName = botDifficulty;
    this.botDifficulty = getBotDifficulty(botDifficulty, botDifficultyOverrides);
    this._botSerial = 0;
    this._fillBotSlots();
  }

  weaponDefinition(id) { return WEAPONS[id] || WEAPONS.m4; }

  opponents(a,b) { return a.id!==b.id; }

  _setSimArena(arena) {
    // Routes and cached collision edges belong to one map only.
    this._patrolNavigation = null;
    this.arena = arena;
    this.simWorld = {
      half: arena.half, killY: arena.killY,
      noBaseFloor: !!arena.noBaseFloor,
      platforms: arena.platforms, boxes: arena.boxes,
      gravLifts: arena.gravLifts, teleporters: arena.teleporters,
      raycast: arena.raycast,
    };
  }

  _arenaPayload() {
    return {
      id: this.arena.id,
      name: this.arena.name,
      region: this.arena.region,
      half: this.arena.half,
      killY: this.arena.killY,
      noBaseFloor: !!this.arena.noBaseFloor,
      platforms: this.arena.platforms,
      boxes: this.arena.boxes,
      spawns: this.arena.spawns,
      lootPads: this._lootPadPayload(),
    };
  }

  _lootPadPayload() {
    return this.lootPads.map((pad) => ({
      padId: pad.padId,
      x: pad.x, y: pad.y, z: pad.z,
      lootType: pad.lootType,
      gunId: pad.gunId,
      color: pad.color,
      active: pad.active,
      respawnTicks: pad.active ? 0 : Math.max(0, pad.respawnTick - this.tick),
    }));
  }

  _resetLootPads() {
    const points = (this.arena.pickups || []).map((pickup) => ({
      x: pickup.x, y: pickup.y, z: pickup.z, markerKind: pickup.markerKind,
    }));
    const seed = this._lootSeed + this._lootGeneration++ * 0x51ed270b;
    this.lootPads = randomLootSpecs(points, seed, this.shieldsEnabled).map((spec) => ({
      padId: spec.padId,
      x: spec.position.x, y: spec.position.y, z: spec.position.z,
      lootType: spec.lootType,
      gunId: spec.gunId,
      color: spec.color,
      active: true,
      respawnTick: 0,
      generation: 0,
    }));
  }

  _rerollLootPad(pad) {
    const item = rollLootItem(
      this._lootSeed + this.tick * 101 + (++pad.generation) * 0x45d9f3b,
      pad.padId, this.shieldsEnabled,
    );
    Object.assign(pad, item, { active: true, respawnTick: 0 });
    this.events.push({ e: 'loot-ready', padId: pad.padId, lootType: pad.lootType, gunId: pad.gunId });
  }

  _resetLifeInventory(player) {
    player.pendingPickup = null;
    const mainWid = MAIN_WEAPONS.has(player.mainWid) ? player.mainWid : 'm4';
    player.mainWid = mainWid;
    player.wid = mainWid;
    player.matchWeapons.clear();
    player.shield = START_SHIELD;
    player.maxShield = START_SHIELD;
    player.shieldRegenDelay = 0;
    player.mag = WEAPONS[mainWid].mag;
    player.ammo = {
      [mainWid]: { mag: WEAPONS[mainWid].mag, reserve: WEAPONS[mainWid].reserve },
    };
  }

  _rotateMatch(now = Date.now()) {
    if (now - this.matchStart < this.matchDurationMs) return false;
    if (!this._postMatchUntil) {
      const active=[...this.players.values()].filter(p=>!p.isBot&&!p.spectating&&(p.kills>0||p.assists>0||p.deaths>0));
      const highKills=Math.max(0,...[...this.players.values()].filter(p=>!p.survivalEnemy&&!p.spectating).map(p=>p.kills));
      const winners=[...this.players.values()].filter(p=>!p.survivalEnemy&&!p.spectating&&p.kills===highKills&&highKills>0);
      for(const p of active)this.achievements?.record(p.accountId,{games:1,wins:this.mode!=='survival'&&winners.length===1&&winners[0]===p?1:0});
      if (this.economy?.ready) {
        const humans=[...this.players.values()].filter(p=>!p.isBot);
        const high=Math.max(0,...[...this.players.values()].filter(p=>!p.spectating).map(p=>p.kills));
        const leaders=humans.filter(p=>!p.spectating&&p.kills===high && high>0);
        this.economy.finish(this.winnerIds?this.winnerIds():(this.mode!=='survival'&&leaders.length===1?[leaders[0].id]:[])).catch(e=>console.error('[economy round]',e.message));
      }
      this.previousRound = {
        start: this.matchStart,
        rows: Array.from(this.players.values()).filter(p=>!p.survivalEnemy).map(p => ({
          id: p.id, name: p.name, nameCosmetics:p.nameCosmetics||null, isBot: !!p.isBot,
          kills: p.kills, deaths: p.deaths, score: p.score, assists: p.assists,
          survival: this.mode==='survival', survivalEnemy: !!p.survivalEnemy, zombieVariant: p.zombieVariant, enemyType: p.enemyType, maxHealth: p.maxHealth || START_HEALTH, survivalAlly: !!p.survivalAlly, damageDealt:p.damageDealt||0, bossDamage:p.bossDamage||0, wavesSurvived:p.wavesSurvived||0,
        })),
      };
      this._postMatchUntil = now + RESULTS_MS;
      this._resultsUntil = this._postMatchUntil;
      this._roundWaiting = true;
      for (const p of this.players.values()) {
        p.queue.length = 0; p._heldInput = null; p.fireReq = p.abilityReq = null;
      }
      return false;
    }
    if (now < this._postMatchUntil) return false;
    this._postMatchUntil = 0;
    // Keep the clock on its global cadence even if the process sleeps or a
    // tick is delayed across more than one complete round.
    const elapsedRounds = Math.max(1, Math.floor((now - this.matchStart) / this.matchDurationMs));
    this.matchStart += elapsedRounds * this.matchDurationMs;
    this._arenaIndex = (this._arenaIndex + elapsedRounds) % this.arenas.length;
    this._setSimArena(this.arenas[this._arenaIndex]);
    this._resetLootPads();
    // Repeat the collision/map payload for five seconds. A congested client
    // may skip an individual snapshot; map identity must never advance without
    // the matching simulation geometry.
    this._arenaBroadcastUntilTick = this.tick + TICK_HZ * 5;
    this.smokes.length = 0;
    this.frags.length = 0;
    this.projectiles.length = 0;

    // A fresh round gets a fresh set of readable bot identities while human
    // names stay untouched. The same names then flow through snapshots and the
    // final leaderboard for the whole round.
    const usedNames = new Set(
      Array.from(this.players.values()).filter((player) => !player.isBot).map((player) => player.name),
    );
    for (const player of this.players.values()) {
      if (player.isBot) player.name = randomBotName(usedNames);
    }

    let spawnIndex = 0;
    for (const player of this.players.values()) {
      const spawn = this._spawn(spawnIndex++, null, false);
      player.state = createState(spawn[0], spawn[1], spawn[2]);
      player.queue.length = 0;
      player._heldInput = null;
      player.history.length = 0;
      player.health = START_HEALTH;
      player.healthRegenDelay = 0;
      this._resetLifeInventory(player);
      player.alive = true;
      player.deadUntil = 0;
      player.kills = 0;
      player.killStreak = 0;
      player.deaths = 0;
      player.score = 0;
      player.assists = 0;
      player.damageContributors = new Map();
      player.reloadUntil = 0;
      player.reloadWid = null;
      player.invulnerableUntil = this.tick + SPAWN_PROTECTION_TICKS;
      player._swingStart = player._swingUntil = 0;
      player.fireCooldown = 0;
      player.gunBloom = 0;
      player._animVX = player._animVZ = 0;
      player._lastSprint = false;
      player._lastAim = false;
      player._firingTicks = 0;
      player.blindUntil = 0;
      player.abilities = {
        frag: ABILITIES.frag.charges, flash: ABILITIES.flash.charges,
        smoke: ABILITIES.smoke.charges,
        timebomb: ABILITIES.timebomb.charges, impulse: ABILITIES.impulse.charges,
      };
      player.abilityCD = 0; player.abilityCooldowns = {};
      if (player.isBot) this._resetBotAI(player);
      if(player.survivalAlly)this.allyAI?.reset(player);
    }
    this._beginRoundGate(now);
    this.events.push({ e: 'map', id: this.arena.id, name: this.arena.name });
    return true;
  }

  _beginRoundGate(now = Date.now()) {
    this._roundWaiting = [...this.players.values()].some(p => !p.isBot && p.readinessProtocol);
    this._readyDeadline = now + 10000;
    this._resultsUntil = 0;
    for (const p of this.players.values()) {
      p.mapReady = p.isBot || !p.readinessProtocol;
      p.queue.length = 0; p._heldInput = null; p.fireReq = p.abilityReq = null;
      p._animVX = p._animVZ = 0; p._lastSprint = false;
    }
  }

  onReady(id, msg) {
    const p = this.players.get(id);
    if (!p || msg.matchStart !== this.matchStart || msg.mapId !== this.arena.id) return false;
    if (!p.mapReady) {
      p.mapReady = true;
      p.queue.length = 0; p._heldInput = null; p.fireReq = p.abilityReq = null;
      p.invulnerableUntil = this.tick + SPAWN_PROTECTION_TICKS;
    }
    return true;
  }

  _advanceRoundGate(now = Date.now()) {
    if (!this._roundWaiting || this._postMatchUntil) return;
    const pending = [...this.players.values()].some(p => !p.isBot && !p.spectating && p.mapReady === false);
    if (pending && now < this._readyDeadline) return;
    this._roundWaiting = false;
    for (const p of this.players.values()) if (p.mapReady !== false) {
      p.invulnerableUntil = this.tick + SPAWN_PROTECTION_TICKS;
      p.queue.length = 0;
      p._heldInput = null;
    }
  }

  _canSimulate(p) { return !p.spectating && !this._roundWaiting && p.mapReady !== false; }

  setSpectating(id, enabled) {
    const p = this.players.get(id);
    if (!p || p.isBot || !!p.spectating === (enabled === true)) return;
    if (enabled !== true && this.targetPopulation
        && [...this.players.values()].filter(q => !q.isBot && !q.spectating).length >= this.targetPopulation) return;
    p.spectating = enabled === true;
    p.queue.length = 0; p._heldInput = null; p.fireReq = p.abilityReq = null;
    p.state.vx = p.state.vz = 0;
    this._rebalanceBots();
  }

  // Add a HUMAN-controlled player (a real socket).
  add(send, name, waitForReady = false) {
    // A real player always gets a seat. Remove one server bot first when the
    // advertised room is full. Guests are real socket players and replace bots
    // exactly like signed-in players.
    if (this.targetPopulation && this.players.size >= this.targetPopulation) {
      const bot = Array.from(this.players.values()).find((p) => p.isBot);
      if (bot) this._remove(bot.id, false);
      else { send({ t: 'kick', reason: 'match full' }); return null; }
    }
    const firstHuman = ![...this.players.values()].some(p => !p.isBot);
    const id = this._add(send, name, false);
    const p = this.players.get(id);
    p.readinessProtocol = waitForReady;
    p.mapReady = !waitForReady;
    if (waitForReady && firstHuman) this._beginRoundGate();
    this._rebalanceBots();
    return id;
  }

  // Add a clearly-labelled BOT for gameplay/load/stability testing. isBot
  // rides the roster + every snapshot so no client can ever be shown a bot as
  // a human (Phase 11: no fake-human surfaces).
  addBot(name) { return this._add(() => {}, name, true); }

  _fillBotSlots() {
    this._rebalanceBots();
  }

  _rebalanceBots() {
    if (!this.targetPopulation) return;
    const humans = Array.from(this.players.values()).filter((player) => !player.isBot && !player.spectating).length;
    const desiredBots = Math.min(8, Math.max(0, this.targetPopulation - humans));
    const bots = Array.from(this.players.values()).filter((player) => player.isBot);
    while (bots.length > desiredBots) {
      const bot = bots.pop();
      this._remove(bot.id, false);
    }
    while (bots.length < desiredBots) {
      this._botSerial++;
      const usedNames = new Set(Array.from(this.players.values()).map((player) => player.name));
      const id = this.addBot(randomBotName(usedNames));
      bots.push(this.players.get(id));
    }
  }

  _add(send, name, isBot) {
    const id = _pid++;
    const spawn = this._spawn(id, id, true);
    const p = {
      id, send, name, isBot: !!isBot, assists: 0, damageContributors: new Map(),
      state: createState(spawn[0], spawn[1], spawn[2]),
      lastInputSeq: 0, ackTick: 0,
      queue: [],
      _heldInput: null, _heldInputUntilTick: 0,
      health: START_HEALTH, shield: START_SHIELD, maxShield: START_SHIELD,
      healthRegenDelay: 0, shieldRegenDelay: 0,
      alive: true, deadUntil: 0, kills: 0, deaths: 0, score: 0,
      wid: 'm4', mainWid: 'm4', mag: WEAPONS.m4.mag, fireCooldown: 0, gunBloom: 0,
      ammo: { m4: { mag: WEAPONS.m4.mag, reserve: WEAPONS.m4.reserve } },
      matchWeapons: new Set(),
      reloadUntil: 0, reloadWid: null,
      invulnerableUntil: this.tick + SPAWN_PROTECTION_TICKS,
      _swingStart: 0, _swingUntil: 0,
      _lastSprint: false, _lastAim: false, _animVX: 0, _animVZ: 0,
      _botReloadUntil: 0,
      history: [],               // [{tick, x,y,z,eye,crouch,slide}]
      lastFireSeq: 0, lastFireRequestTick: -Infinity, lastPickupSeq: 0,
      abilities: { frag: ABILITIES.frag.charges, flash: ABILITIES.flash.charges, smoke: ABILITIES.smoke.charges,
                   timebomb: ABILITIES.timebomb.charges, impulse: ABILITIES.impulse.charges },
      abilityCooldowns: {}, abilityCD: 0, blindUntil: 0, lastAbilitySeq: 0, abilityReq: null,
    };
    this.players.set(id, p);
    if (p.isBot) this._resetBotAI(p);
    this.events.push({ e: 'spawn', id, name, x: spawn[0], y: spawn[1], z: spawn[2] });
    p.send({
      t: 'welcome', you: id, tick: this.tick,
      arena: this._arenaPayload(),
      matchStart: this.matchStart,
      matchDurationMs: this.matchDurationMs,
      players: this._roster(),
    });
    return id;
  }

  remove(id) { this._remove(id, true); }

  _remove(id, refill) {
    this._patrolNavigation?.jobs.delete(id);
    if (this.players.delete(id)) this.events.push({ e: 'leave', id });
    if (refill) this._fillBotSlots();
  }

  _resetBotAI(p) {
    this._patrolNavigation?.jobs.delete(p.id);
    p._botEscapeUntil = p._botSteerAt = p._botBlockedScans = 0;
    p._botProgressX = p.state.px; p._botProgressZ = p.state.pz;
    p._botState = p.alive ? BOT_STATES.ROAM : BOT_STATES.DEAD;
    p._botHostility = new Map();
    p._botIgnoredUntil = new Map();
    p._botTargetId = null;
    p._botTargetSince = 0;
    p._botLastSeenTick = -Infinity;
    p._botLastSeen = null;
    p._botReactionUntil = 0;
    p._botNextScanTick = this.tick + (p.id % 5);
    p._botNextDecisionTick = this.tick;
    p._botNextLosTick = this.tick;
    p._botLosTargetId = null;
    p._botLosCache = false;
    p._botStrafe = this._rand(p.id * 71 + this.tick) < 0.5 ? -1 : 1;
    p._botRoamTarget = null;
    p._botRoamUntil = 0;
    p._botRecoveryUntil = 0;
    p._botNextRoamJump = this.tick + TICK_HZ * (3 + this._rand(p.id * 379) * 3);
    p._botRoamJumpYaw = null;
    p._botRecoveryAt = -Infinity;
    p._botAreaAnchor = [p.state.px,p.state.pz];
    p._botAreaSince = this.tick;
    p._botVisited = [];
    p._botPatrolCheck = 0;
    p._botPatrolUntil = 0;
    p._botFailedGoals = new Map();
    p._botRoute = []; p._botGoal = null; p._botGoalUntil = 0;
    p._botLandmarkVisits = new Map(); p._botRouteFailures = 0;
    p._botStuckTicks = 0;
    p._botLastX = p.state.px;
    p._botLastZ = p.state.pz;
    p._botAimYaw = p._lastYaw ?? 0;
    p._botAimPitch = p._lastPitch ?? 0;
    p._botNextShotTick = this.tick;
    p._botBurstRemaining = 2 + Math.floor(this._rand(p.id * 193 + this.tick) * 3);
    p._botDashTicks = 0;
    p._botDashX = 0;
    p._botDashZ = 0;
    p._botDashStarts = 0;
    p._botHoldGroundTargetId = null;
    p._botNextDashTick = this.tick + Math.ceil(
      (0.65 + this._rand(p.id * 239 + this.tick) * 0.75) * TICK_HZ,
    );
  }

  _provokeBot(bot, attacker, forceSwitch = true) {
    if (!bot?.isBot || !bot.alive || !attacker || attacker === bot || !attacker.alive) return;
    if (this.mode === 'survival' && attacker.isBot && !attacker.survivalEnemy) return;
    const cfg = this.botDifficulty;
    const memoryTicks = Math.ceil((cfg.focusDuration + cfg.searchDuration) * TICK_HZ);
    bot._botHostility ||= new Map();
    bot._botHostility.set(attacker.id, this.tick + memoryTicks);
    bot._botLastSeen = { x: attacker.state.px, y: attacker.state.py, z: attacker.state.pz };
    bot._botLastSeenTick = this.tick;
    bot._botHoldGroundTargetId = attacker.id;
    // Only the first reaction brakes. Repeated hits must not pin an already
    // reacting player-like bot in place throughout its sidestep.
    if (bot._botTargetId !== attacker.id) bot.state.vx = bot.state.vz = 0;
    bot._botDashTicks = 0;
    bot._botDashX = 0;
    bot._botDashZ = 0;

    const current = this.players.get(bot._botTargetId);
    const currentDistance = current
      ? Math.hypot(current.state.px - bot.state.px, current.state.pz - bot.state.pz) : Infinity;
    const attackerDistance = Math.hypot(attacker.state.px - bot.state.px, attacker.state.pz - bot.state.pz);
    if (!current || (forceSwitch && current.id !== attacker.id) || attackerDistance < currentDistance * cfg.targetSwitchRatio) {
      bot._botTargetId = attacker.id;
      bot._botTargetSince = this.tick;
      bot._botReactionUntil = this.tick + this._botReactionTicks(bot);
      bot._botState = BOT_STATES.REACT;
      bot._botNextLosTick = this.tick;
    }
  }

  _botReactionTicks(p) {
    const cfg = this.botDifficulty;
    const r = this._rand(p.id * 421 + this.tick * 13);
    return Math.ceil((cfg.reactionMin + (cfg.reactionMax - cfg.reactionMin) * r) * TICK_HZ);
  }

  _botCanSee(p, target, ignoreFov = false) {
    if (!target?.alive || this.tick < (target.invulnerableUntil || 0)) return false;
    const cfg = this.botDifficulty;
    const dx = target.state.px - p.state.px;
    const dz = target.state.pz - p.state.pz;
    const distance = Math.hypot(dx, dz);
    const detectionDistance = target.isBot
      ? botArenaDetectionDistance(cfg.detectionDistance)
      : cfg.detectionDistance;
    if (distance > detectionDistance) return false;
    if (!ignoreFov && !isInsideBotFov(p._botAimYaw ?? p._lastYaw ?? 0, dx, dz, cfg.fovDegrees)) return false;
    const dy = (target.state.py + HEAD_Y) - (p.state.py + HEAD_Y);
    const length = Math.hypot(dx, dy, dz) || 1e-6;
    return rayVsBoxes(
      this.simWorld, p.state.px, p.state.py + HEAD_Y, p.state.pz,
      dx / length, dy / length, dz / length, length,
    ) >= length - 0.6;
  }

  _recoverBotPatrol(p) {
    const pos = [p.state.px,p.state.py,p.state.pz];
    const repeat = this.tick - p._botRecoveryAt < TICK_HZ * 10;
    p._botRouteFailures = repeat ? p._botRouteFailures + 1 : 1;
    p._botRecoveryAt = this.tick;
    p._botAreaAnchor = [pos[0],pos[2]];
    p._botAreaSince = this.tick;
    if (p._botRoamTarget) p._botVisited.push(p._botRoamTarget);
    p._botVisited = p._botVisited.slice(-32);
    this._patrolNavigation?.jobs.delete(p.id);
    p._botRoute = [];
    if (p._botRouteFailures >= 2 && p._botGoal) {
      p._botFailedGoals.set(p._botGoal.join(','),this.tick + TICK_HZ * 45);
      p._botGoal = null;
    }
    let sample = 0;
    // A short, verified escape fits tight corners where long roaming rays fail.
    p._botRoamTarget = chooseReachableRoamPoint({
      x:pos[0],y:pos[1],z:pos[2],half:this.arena.half,killY:this.arena.killY,
      groundHeightAt:this.arena.groundHeightAt || (!this.arena.noBaseFloor ? () => 0 : undefined),
      raycast:(...args)=>rayVsBoxes(this.simWorld,...args),
      random:()=>this._rand(p.id*997+this.tick*31+sample++*101),
      recent:p._botVisited,heading:p._botAimYaw+Math.PI,
      attempts:24,minDistance:1,maxDistance:4,maxDrop:this.arena.botMaxDrop ?? 2,
    }) || pos;
    p._botRecoveryUntil = this.tick + TICK_HZ;
    p._botRoamUntil = this.tick + TICK_HZ;
    p._botStuckTicks = 0;
    p._botDashTicks = 0;
  }

  _pickBotRoamTarget(p) {
    const pos = [p.state.px, p.state.py, p.state.pz];
    p._botFailedGoals ||= new Map();
    p._botLandmarkVisits ||= new Map();
    for (const [key,until] of p._botFailedGoals) if (until<=this.tick) p._botFailedGoals.delete(key);
    if (this.arena.groundHeightAt && this.arena.raycast && this.tick >= (p._botRecoveryUntil || 0)) {
      const nav = this._patrolNavigation ||= new PatrolNavigation(this);
      const reached = p._botGoal && Math.hypot(pos[0]-p._botGoal[0],pos[2]-p._botGoal[2]) < 3
        && Math.abs(pos[1]-p._botGoal[1]) < 0.7;
      if (reached || (p._botGoal && this.tick > p._botGoalUntil)) {
        const key = p._botGoal.join(',');
        if (reached) p._botLandmarkVisits.set(key, (p._botLandmarkVisits.get(key) || 0)+1);
        else p._botFailedGoals.set(key, this.tick+TICK_HZ*45);
        p._botGoal = null; p._botRoute = []; nav.jobs.delete(p.id);
      }
      if (!p._botGoal) {
        const destinations = nav.graph ? nav.reachableGoals(pos) : this.arena.spawns;
        const candidates = destinations.filter(s => Math.hypot(s[0]-pos[0],s[2]-pos[2]) > 18
          && (!this.arena.navigation || Math.hypot(s[0]-pos[0],s[2]-pos[2]) < 100)
          && !p._botFailedGoals.has(s.join(',')));
        p._botGoal = choosePatrolGoal(p, this.players, candidates, this.tick, value => this._rand(value));
        p._botGoalUntil = this.tick+TICK_HZ*60;
        p._botRouteFailures = 0;
      }
      const result = nav.take(p.id);
      if (result?.status === 'failed') {
        if (p._botGoal) p._botFailedGoals.set(p._botGoal.join(','),this.tick+TICK_HZ*45);
        p._botGoal = null;
      } else if (result) p._botRoute = result.route;
      while (p._botRoute.length && Math.hypot(p._botRoute[0][0]-pos[0],p._botRoute[0][2]-pos[2]) < (nav.graph ? WALK_SPEED * SPRINT_MULT / TICK_HZ + 0.35 : 1.2)
        && Math.abs(p._botRoute[0][1]-pos[1]) < 0.7) p._botRoute.shift();
      if (p._botRoute.length) {
        // Rejoin a completed route from wherever the bot wandered while it was
        // being planned. Only skip corners when the entire capsule fits.
        let join = -1;
        for (let i=p._botRoute.length-1;i>=0;i--) {
          const point = p._botRoute[i];
          if (Math.hypot(point[0]-pos[0],point[2]-pos[2]) > 35) continue;
          const lane = nav.lane(pos,point);
          if (lane && Math.abs(lane[1]-point[1]) < 0.7) { join=i; break; }
        }
        if (join >= 0) {
          p._botRoute.splice(0,join);
          return p._botRoute[0];
        }
        p._botRoute = [];
      }
      if (p._botGoal) nav.request(p.id,pos,p._botGoal);
      // Baked routes finish within a few ticks; stay here instead of wandering
      // away from the path's starting point while it is being planned.
      if (nav.graph && p._botGoal) return pos;
    }
    let sample = 0;
    const options = {
      x: pos[0], y: pos[1], z: pos[2],
      half: this.arena.half, killY: this.arena.killY,
      random: () => this._rand(p.id*997+this.tick*31+sample++*101),
      groundHeightAt: this.arena.groundHeightAt || (!this.arena.noBaseFloor ? () => 0 : undefined),
      raycast: (...args) => rayVsBoxes(this.simWorld,...args),
      recent: p._botVisited, heading: p._botAimYaw, maxDrop: this.arena.botMaxDrop ?? 2,
    };
    return chooseReachableRoamPoint(options)
      || chooseReachableRoamPoint({...options,minDistance:2,maxDistance:8}) || pos;
  }

  _separateBotMove(p, moveX, moveZ, yaw) {
    const separation = botSeparationVector({
      x: p.state.px,
      z: p.state.pz,
      id: p.id,
      neighbors: this.players.values(),
      botsOnly: true,
    });
    if (separation.strength <= 0.01) return [moveX, moveZ];

    const length = Math.hypot(moveX, moveZ) || 1;
    let worldX = Math.sin(yaw) * -(moveZ / length)
      + Math.sin(yaw + Math.PI / 2) * (moveX / length);
    let worldZ = Math.cos(yaw) * -(moveZ / length)
      + Math.cos(yaw + Math.PI / 2) * (moveX / length);
    const influence = 0.72 + separation.strength * 0.92;
    worldX += separation.x * influence;
    worldZ += separation.z * influence;
    const worldLength = Math.hypot(worldX, worldZ) || 1;
    worldX /= worldLength;
    worldZ /= worldLength;

    return [
      Math.cos(yaw) * worldX - Math.sin(yaw) * worldZ,
      -Math.sin(yaw) * worldX - Math.cos(yaw) * worldZ,
    ];
  }

  _steerBotMove(p, mx, mz, yaw) {
    if (!mx && !mz) return [mx, mz];
    // Keep an escape heading long enough to clear a corner, rather than
    // alternating left/right every tick as the aim turns toward an enemy.
    if (this.tick < (p._botEscapeUntil || 0)) {
      const wx = Math.sin(p._botEscapeYaw), wz = Math.cos(p._botEscapeYaw);
      return [Math.cos(yaw) * wx - Math.sin(yaw) * wz,
        -Math.sin(yaw) * wx - Math.cos(yaw) * wz];
    }
    if (this.tick < (p._botSteerAt || 0)) return [mx, mz];
    p._botSteerAt = this.tick + 5;
    const moved = Math.hypot(p.state.px - (p._botProgressX ?? p.state.px),
      p.state.pz - (p._botProgressZ ?? p.state.pz));
    p._botProgressX = p.state.px; p._botProgressZ = p.state.pz;
    p._botBlockedScans = moved < 0.15 ? (p._botBlockedScans || 0) + 1 : 0;
    const stuck = p._botBlockedScans >= 3;
    const length = Math.hypot(mx, mz);
    const wx = (Math.cos(yaw) * mx - Math.sin(yaw) * mz) / length;
    const wz = (-Math.sin(yaw) * mx - Math.cos(yaw) * mz) / length;
    const clearance = (x, z) => Math.min(...[-0.42, 0, 0.42].map(side => rayVsBoxes(
      this.simWorld, p.state.px - z * side, p.state.py + 0.65, p.state.pz + x * side,
      x, 0, z, 3)));
    if (!stuck && clearance(wx, wz) > 1.4) return [mx, mz];
    let best = null, bestScore = -Infinity;
    for (const angle of [0.65, -0.65, 1.25, -1.25, 1.8, -1.8, Math.PI]) {
      const x = wx * Math.cos(angle) - wz * Math.sin(angle);
      const z = wx * Math.sin(angle) + wz * Math.cos(angle);
      const local = [Math.cos(yaw) * x - Math.sin(yaw) * z,
        -Math.sin(yaw) * x - Math.cos(yaw) * z];
      if (!this._botGroundSafe(p, ...local, yaw)) continue;
      const room = clearance(x, z);
      if (room < 0.9) continue;
      const score = room - Math.abs(angle) * 0.18;
      if (score > bestScore) { bestScore = score; best = { x, z, local }; }
    }
    if (stuck && p._botTargetId != null) {
      p._botIgnoredUntil.set(p._botTargetId, this.tick + TICK_HZ * 8);
      p._botTargetId = null; p._botRoamTarget = null; p._botBlockedScans = 0;
    }
    if (!best) return [0, 0];
    p._botEscapeYaw = Math.atan2(best.x, best.z);
    p._botEscapeUntil = this.tick + Math.ceil(TICK_HZ * 0.65);
    return best.local;
  }

  _botMoveInput(p, options) {
    let [mx, mz] = quantizeBotMove(options.mx, options.mz);
    if (!this._botGroundSafe(p, mx, mz, options.yaw)) {
      const alternatives = [[mx, 0], [0, mz], [-mx, 0], [0, -mz]];
      [mx, mz] = alternatives.find(([x,z]) => (x || z) && this._botGroundSafe(p, x, z, options.yaw)) || [0, 0];
    }
    return makeInput({ ...options, mx, mz });
  }

  _driveBot(p) {
    const cfg = this.botDifficulty;
    const seq = ++p.lastInputSeq;
    const secondsToTicks = (seconds) => Math.max(1, Math.ceil(seconds * TICK_HZ));

    // Expire grudges and focus cooldowns on the low-frequency scan cadence.
    if (this.tick >= p._botNextScanTick) {
      p._botNextScanTick = this.tick + secondsToTicks(cfg.scanInterval);
      for (const [id, until] of p._botHostility) if (until <= this.tick) p._botHostility.delete(id);
      for (const [id, until] of p._botIgnoredUntil) if (until <= this.tick) p._botIgnoredUntil.delete(id);

      // Arena bots may retain other bots as opponents.
      const current = this.players.get(p._botTargetId);
      const currentDistance = current?.alive
        ? Math.hypot(current.state.px - p.state.px, current.state.pz - p.state.pz) : Infinity;
      let best = null;
      let bestDistance = Infinity;
      for (const candidate of this.players.values()) {
        const id = candidate.id;
        if (candidate.id === p.id) continue;
        if (p._botIgnoredUntil.has(id)) continue;
        if (!candidate?.alive || !this._canSimulate(candidate) || !this.opponents(p,candidate)) continue;
        const dx = candidate.state.px - p.state.px;
        const dz = candidate.state.pz - p.state.pz;
        const distance = Math.hypot(dx, dz);
        const detectionDistance = cfg.detectionDistance;
        if (distance >= bestDistance || distance > detectionDistance) continue;
        // Only acquire visible opponents. Remember their last seen position
        // for a bounded search instead of tracking movement through walls.
        if (!this._botCanSee(p, candidate,
          candidate.id === p._botTargetId)) continue;
        best = candidate;
        bestDistance = distance;
      }
      const shouldSwitch = best && (!current || best.id === current.id
        || bestDistance < currentDistance * cfg.targetSwitchRatio);
      if (shouldSwitch && best.id !== p._botTargetId) {
        p._botHostility.set(best.id,
          this.tick + secondsToTicks(cfg.focusDuration + cfg.searchDuration));
        p._botTargetId = best.id;
        p._botHoldGroundTargetId = null;
        p._botTargetSince = this.tick;
        p._botReactionUntil = this.tick + this._botReactionTicks(p);
        p._botState = BOT_STATES.REACT;
      }


    }

    let target = this.players.get(p._botTargetId);
    if (!target?.alive || !p._botHostility.has(target.id)) {
      if (p._botHoldGroundTargetId === p._botTargetId) p._botHoldGroundTargetId = null;
      p._botTargetId = null;
      target = null;
    }

    let hasVisual = false;
    if (target && this.tick >= p._botNextLosTick) {
      const targetDistance = Math.hypot(
        target.state.px - p.state.px,
        target.state.pz - p.state.pz,
      );
      // Imported map octrees are intentionally detailed. Footstep-aware bots
      // can pursue at long range without spending a raycast every three ticks;
      // checks tighten once opponents are close enough to exchange fire.
      const losInterval = target.isBot
        ? Math.max(cfg.losInterval, targetDistance > 36 ? 0.70 : 0.32)
        : cfg.losInterval;
      p._botNextLosTick = this.tick + secondsToTicks(losInterval);
      p._botLosTargetId = target.id;
      p._botLosCache = this._botCanSee(p, target, true);
      if (p._botLosCache) {
        p._botLastSeen = { x: target.state.px, y: target.state.py, z: target.state.pz };
        p._botLastSeenTick = this.tick;
        p._botHostility.set(target.id, this.tick + secondsToTicks(cfg.focusDuration + cfg.searchDuration));
      }
    }
    hasVisual = !!target && p._botLosTargetId === target.id && p._botLosCache;

    if (target && !hasVisual
      && this.tick - p._botLastSeenTick > secondsToTicks(0.8)) {
      p._botIgnoredUntil.set(target.id, this.tick + secondsToTicks(1.5));
      p._botTargetId = null;
      target = null;
      p._botState = BOT_STATES.ROAM;
    }

    if (!target) {
      p._botHoldGroundTargetId = null;
      p._botState = BOT_STATES.ROAM;
      if (p._botRoamJumpYaw !== null && !p.state.onGround) {
        p._botAimYaw = p._botRoamJumpYaw;
        return {seq, inp: makeInput({mx: 0, mz: 1, yaw: p._botRoamJumpYaw, sprint: true}), wid: p.wid, aiming: false, botDash: false};
      }
      if (p._botRoamJumpYaw !== null) p._botRoamTarget = null;
      p._botRoamJumpYaw = null;
      this._patrolNavigation?.update(this.tick);
      const patrolJob = this._patrolNavigation?.jobs.get(p.id);
      if (patrolJob && patrolJob.status !== 'searching') p._botRoamTarget = null;
      const pos = [p.state.px, p.state.py, p.state.pz];
      if (this.tick >= p._botPatrolCheck) {
        p._botPatrolCheck = this.tick + 5;
        const moved = Math.hypot(pos[0] - p._botLastX, pos[2] - p._botLastZ);
        p._botStuckTicks = moved < 0.15 ? p._botStuckTicks + 1 : 0;
        p._botLastX = pos[0]; p._botLastZ = pos[2];
        p._botVisited.push(pos);
        if (p._botVisited.length > 32) p._botVisited.shift();
        // Shuffling against a corner is movement, but it is not route progress.
        if (Math.hypot(pos[0]-p._botAreaAnchor[0],pos[2]-p._botAreaAnchor[1]) > 2.5) {
          p._botAreaAnchor = [pos[0],pos[2]];p._botAreaSince = this.tick;
        }
        if (p._botStuckTicks >= 3 || this.tick-p._botAreaSince >= TICK_HZ*3) this._recoverBotPatrol(p);
      }
      if (!p._botRoamTarget || this.tick >= p._botRoamUntil
        || Math.hypot(p._botRoamTarget[0] - pos[0], p._botRoamTarget[2] - pos[2]) < (this.arena.navigation ? WALK_SPEED * SPRINT_MULT / TICK_HZ + 0.35 : 1.2)) {
        p._botRoamTarget = this._pickBotRoamTarget(p);
        p._botRoamUntil = this.tick + TICK_HZ * 7;
      }
      const dx = p._botRoamTarget[0] - pos[0], dz = p._botRoamTarget[2] - pos[2];
      const desired = Math.atan2(-dx, -dz);
      // Navigation turns must keep up with sprinting between short waypoints.
      // Combat retains the difficulty's slower aim speed below.
      p._botAimYaw = smoothBotAim(p._botAimYaw, desired, Math.max(8, cfg.aimTurnSpeed), 1 / TICK_HZ);
      p._botAimPitch *= 0.8;
      const yaw = p._botAimYaw;
      const alignment = Math.cos(desired - yaw);
      // Ease around shallow corners at walking speed; only sharp turns need
      // a full stop. Probe the actual heading, not the not-yet-reached yaw.
      let forward = alignment > 0.80 && Math.hypot(dx, dz) > 0.5;
      const groundSafe = !forward || this._botGroundSafe(p, 0, 1, yaw);
      const blockedAt = height => [-0.3, 0, 0.3].some(side => rayVsBoxes(this.simWorld,
        pos[0] + Math.cos(yaw) * side, pos[1] + height, pos[2] - Math.sin(yaw) * side,
        -Math.sin(yaw), 0, -Math.cos(yaw), 1.5) < 1.1);
      const blocked = forward && blockedAt(0.8);
      const hop = blocked && groundSafe && !blockedAt(1.75);
      if (forward && (!groundSafe || (blocked && !hop))) {
        forward = false;
        // A safe destination can lie around a corner while the current view
        // still points into its wall. Finish turning before abandoning it;
        // replacing the goal every tick traps the bot in repeated reversals.
        if (alignment > 0.995) this._recoverBotPatrol(p);
      }
      // Turn first, then run forward. Never orbit a destination or crab-walk
      // while the aim points in a different direction from locomotion.
      if ((!forward || Math.hypot(dx, dz) < 10) && p._botDashTicks) p._botDashTicks = 0;
      if (!forward && p.state.onGround) p.state.vx = p.state.vz = 0;
      let roamJump = false;
      if (forward && !blocked && !p._botStaminaRecovering && p.state.stamina > 2 + STAMINA_DRAIN * 1.5 && p.state.onGround && alignment > 0.995
        && Math.hypot(dx, dz) > WALK_SPEED * SPRINT_MULT * 1.5 && this.tick >= p._botNextRoamJump) {
        roamJump = this._botRoamJumpSafe(p, yaw);
        p._botNextRoamJump = this.tick + TICK_HZ * (roamJump ? 3 + this._rand(p.id * 379 + this.tick) * 3 : 1);
        if (roamJump) { p._botRoamJumpYaw = yaw; p._botDashTicks = 0; }
      }
      // Ordinary traversal uses the same sprint speed as players. Repeated
      // free speed boosts made patrols read as AI rather than running people.
      p._botDashTicks = 0;
      return { seq, inp: makeInput({ mx: 0, mz: forward ? 1 : 0, yaw,
        sprint: forward && alignment > 0.96 && Math.hypot(dx,dz) > 1.25, jumpJust: (hop || roamJump) && p.state.onGround }), wid: p.wid, aiming: false, botDash: false };
    }

    const aimPoint = hasVisual ? target.state : p._botLastSeen;
    const targetX = aimPoint.px ?? aimPoint.x;
    const targetY = aimPoint.py ?? aimPoint.y;
    const targetZ = aimPoint.pz ?? aimPoint.z;
    const realDx = targetX - p.state.px;
    const realDz = targetZ - p.state.pz;
    const distance = Math.hypot(realDx, realDz);
    const desiredYaw = Math.atan2(-realDx, -realDz);
    const desiredPitch = Math.atan2((targetY + HEAD_Y) - (p.state.py + HEAD_Y), Math.max(0.001, distance));
    p._botAimYaw = smoothBotAim(p._botAimYaw, desiredYaw, cfg.aimTurnSpeed, 1 / TICK_HZ);
    p._botAimPitch += (desiredPitch - p._botAimPitch) * (1 - Math.exp(-cfg.aimTurnSpeed / TICK_HZ));

    if (this.tick < p._botReactionUntil) p._botState = BOT_STATES.REACT;
    else p._botState = hasVisual ? BOT_STATES.ENGAGE : BOT_STATES.SEARCH;

    const maneuver = choosePlayerLikeBotMove({
      id: p.id, elapsed: (this.tick - p._botReactionUntil) / TICK_HZ,
      reacting: this.tick < p._botReactionUntil, hasLineOfSight: hasVisual,
      distance, reloading: p.mag <= 0 || p.reloadUntil > this.tick,
    });
    // Stay on navigable ground and redirect around walls before accepting a
    // sidestep or chase. Pursuit can run and fire while stamina permits.
    const [moveX, moveZ] = this._steerBotMove(p, maneuver.strafe, maneuver.forward, p._botAimYaw);
    const holdGround = !moveX && !moveZ;
    if (holdGround && p.state.onGround) p.state.vx = p.state.vz = 0;

    if (p.mag <= 0) this._startReload(p, p.wid);
    const aimDelta = Math.abs(Math.atan2(Math.sin(desiredYaw - p._botAimYaw), Math.cos(desiredYaw - p._botAimYaw)));
    const canFire = hasVisual && this.tick >= p._botReactionUntil && aimDelta < 0.12
      && distance < cfg.detectionDistance && p.fireCooldown <= 0
      && p.reloadUntil <= this.tick && p.mag > 0 && this.tick >= p._botNextShotTick;
    if (canFire) {
      this.onFire(p.id, { seq: p.lastFireSeq + 1, wid: p.wid, yaw: p._botAimYaw, pitch: p._botAimPitch });
      if (p.fireReq) {
        p.fireReq.botTargetId = target.id;
        p.fireReq.botRetaliating = !target.isBot;
      }
      p._botBurstRemaining--;
      const weaponTicks = Math.max(1, Math.ceil((WEAPONS[p.wid]?.rate || 0.2) * TICK_HZ));
      if (p._botBurstRemaining <= 0) {
        p._botBurstRemaining = 2 + Math.floor(this._rand(p.id * 509 + this.tick) * 3);
        p._botNextShotTick = this.tick + weaponTicks * (3 + Math.floor(this._rand(p.id * 557 + this.tick) * 3));
      } else p._botNextShotTick = this.tick + weaponTicks;
    }
    return {
      seq,
      inp: this._botMoveInput(p, { mx: moveX, mz: moveZ, yaw: p._botAimYaw, pitch: p._botAimPitch,
        sprint: !!maneuver.sprint && moveZ >= 0, jumpJust: false }),
      wid: p.wid,
      aiming: hasVisual && distance < cfg.detectionDistance * 0.8,
      botDash: false,
    };
  }

  _botDashCommand(p, mx, mz, yaw) {
    if (p._botDashTicks > 0) return true;
    if (!p.state.onGround || this.tick < p._botNextDashTick || Math.hypot(mx, mz) < 0.25) return false;

    const length = Math.hypot(mx, mz) || 1;
    const inputX = mx / length;
    const inputZ = mz / length;
    const worldX = Math.sin(yaw) * -inputZ + Math.sin(yaw + Math.PI / 2) * inputX;
    const worldZ = Math.cos(yaw) * -inputZ + Math.cos(yaw + Math.PI / 2) * inputX;
    const safe = isBotDashLaneSafe({
      x: p.state.px,
      y: p.state.py,
      z: p.state.pz,
      dx: worldX,
      dz: worldZ,
      killY: this.arena.killY,
      groundHeightAt: this.arena.groundHeightAt,
      raycast: this.arena.raycast
        || ((ox, oy, oz, dx, dy, dz, far) => rayVsBoxes(
          this.simWorld, ox, oy, oz, dx, dy, dz, far,
        )),
    });
    if (!safe) {
      p._botNextDashTick = this.tick + Math.ceil(0.45 * TICK_HZ);
      return false;
    }

    p._botDashX = worldX;
    p._botDashZ = worldZ;
    p._botDashTicks = Math.max(1, Math.ceil(BOT_DASH.duration * TICK_HZ));
    p._botDashStarts++;
    return true;
  }

  _advanceBotDash(p, state) {
    if (p._botDashTicks <= 0 || !state.onGround) {
      p._botDashTicks = 0;
      return state;
    }
    const remaining = p._botDashTicks / TICK_HZ;
    const bonusSpeed = botDashBonusSpeed(remaining);
    state.px = Math.round((state.px + p._botDashX * bonusSpeed / TICK_HZ) * 1e6) / 1e6;
    state.pz = Math.round((state.pz + p._botDashZ * bonusSpeed / TICK_HZ) * 1e6) / 1e6;
    state.vx = Math.round((state.vx + p._botDashX * bonusSpeed) * 1e6) / 1e6;
    state.vz = Math.round((state.vz + p._botDashZ * bonusSpeed) * 1e6) / 1e6;
    p._botDashTicks--;
    if (p._botDashTicks <= 0) {
      const r = this._rand(p.id * 281 + this.tick * 17);
      p._botNextDashTick = this.tick + Math.ceil(
        (BOT_DASH.cooldownMin + (BOT_DASH.cooldownMax - BOT_DASH.cooldownMin) * r) * TICK_HZ,
      );
    }
    return state;
  }

  _botRoamJumpSafe(p, yaw) {
    if (!this.arena.groundHeightAt) return false;
    // Derive flight clearance from the shared jump impulse. Check the corridor,
    // landing floor, and headroom before committing to a straight running jump.
    const distance = WALK_SPEED * SPRINT_MULT * (2 * JUMP_SPEED / 20 + 0.1);
    const clearance = JUMP_SPEED * JUMP_SPEED / 40 + PLAYER_EYE_HEIGHT + 0.2;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw), s = p.state;
    for (let along = 0; along <= distance + 1; along += 1) {
      for (const side of [-0.5, 0, 0.5]) {
        const x = s.px + dx * along + Math.cos(yaw) * side;
        const z = s.pz + dz * along - Math.sin(yaw) * side;
        const floor = this.arena.groundHeightAt(x, z, s.py + 0.5, s.py - 0.5);
        if (!Number.isFinite(floor) || Math.abs(floor - s.py) > 0.5 || floor <= this.arena.killY) return false;
        if (rayVsBoxes(this.simWorld, x, floor + 0.1, z, 0, 1, 0, clearance) < clearance) return false;
      }
    }
    for (const height of [0.8, 1.7, 3, 5]) {
      if (rayVsBoxes(this.simWorld, s.px, s.py + height, s.pz, dx, 0, dz, distance) < distance) return false;
    }
    return true;
  }

  _botGroundSafe(p, mx, mz, yaw) {
    if ((!mx && !mz) || !this.arena.groundHeightAt) return true;
    const length = Math.hypot(mx, mz) || 1;
    const inputX = mx / length, inputZ = mz / length;
    const worldX = Math.sin(yaw) * -inputZ + Math.sin(yaw + Math.PI / 2) * inputX;
    const worldZ = Math.cos(yaw) * -inputZ + Math.cos(yaw + Math.PI / 2) * inputX;
    // Look farther than one 20 Hz sprint step so a bot has time to brake before
    // its capsule crosses an unsupported edge.
    const maxDrop = this.arena.botMaxDrop ?? 2;
    let floor = p.state.py;
    for (const distance of [0.35, 0.7, 1.05, 1.4]) {
      const x = p.state.px + worldX * distance, z = p.state.pz + worldZ * distance;
      let ground = this.arena.groundHeightAt(x, z, floor, floor);
      if (!Number.isFinite(ground)) ground = this.arena.groundHeightAt(x, z, floor, floor - maxDrop);
      if (!Number.isFinite(ground) || ground <= this.arena.killY
        || floor - ground > maxDrop || ground - floor > 0.6) return false;
      floor = ground;
    }
    return true;
  }

  _spawn(index = _pid, excludeId = null, safe = true) {
    if (!safe) {
      const s = this.arena.spawns[Math.abs(index) % this.arena.spawns.length];
      return [s[0], s[1], s[2]];
    }
    const occupants = [];
    for (const player of this.players.values()) {
      if (!player.alive || player.id === excludeId) continue;
      occupants.push([player.state.px, player.state.py, player.state.pz]);
    }
    return chooseSafeSpawn(this.arena.spawns, occupants, index);
  }

  // Main guns and the standard blade are always legal. A random loot weapon
  // becomes legal only after onPickup validates and grants that exact pad.
  _discardEmptyAfterSwitch(p, nextWid) {
    if (nextWid === p.wid) return;
    const weapon = WEAPONS[p.wid], ammo = p.ammo?.[p.wid];
    if (!weapon || weapon.kind === 'melee' || weapon.infiniteReserve || !ammo
      || ammo.mag > 0 || ammo.reserve > 0) return;
    p.matchWeapons?.delete(p.wid);
  }

  _canEquipWeapon(p, wid) {
    if (!WEAPONS[wid]) return false;
    if (BASE_WEAPONS.has(wid) || p.matchWeapons?.has(wid)) return true;
    return false;
  }

  // Validated input: the client proposes intent; the server owns the sim.
  onInput(id, msg) {
    const p = this.players.get(id);
    if (p && !this._canSimulate(p)) return;
    if (!p || !p.alive) return;
    if (typeof msg.seq !== 'number' || msg.seq <= p.lastInputSeq) return;   // replay/stale
    // clamp look to finite numbers; movement to the tri-state set
    const inp = makeInput({
      mx: Math.max(-1, Math.min(1, msg.mx | 0)),
      mz: Math.max(-1, Math.min(1, msg.mz | 0)),
      yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0,
      pitch: Number.isFinite(msg.pitch) ? msg.pitch : 0,
      sprint: !!msg.sprint, crouch: !!msg.crouch,
      jumpJust: !!msg.jump, crouchJust: !!msg.crouchDown, teleJust: !!msg.tele,
    });
    const wid = this._canEquipWeapon(p, msg.wid) ? msg.wid : p.wid;
    if (MAIN_WEAPONS.has(wid)) p.mainWid = wid;
    p.queue.push({ seq: msg.seq, inp, wid, aiming: !!msg.aiming, receivedTick: this.tick });
    p.lastInputSeq = msg.seq;
    if (p.queue.length > MAX_INPUT_QUEUE) p.queue.splice(0, p.queue.length - MAX_INPUT_QUEUE);
  }

  // Queue a fire request (replay-guarded). It's RESOLVED inside update() on the
  // tick, so lag-comp rewinds to the right tick and the hit/kill events survive
  // to that tick's snapshot (clearing events at the top of update() would wipe
  // anything resolved between ticks).
  onFire(id, msg) {
    const p = this.players.get(id);
    if (p && !this._canSimulate(p)) return;
    if (!p || !p.alive) return;
    if (typeof msg.seq !== 'number' || msg.seq <= p.lastFireSeq) return;   // replay/dup
    p.lastFireSeq = msg.seq;
    const requestedWid = this._canEquipWeapon(p, msg.wid) ? msg.wid : null;
    if (!requestedWid) return;
    const requestedWeapon = WEAPONS[requestedWid];
    // Carry fractional tick debt only inside one continuous burst. Otherwise a
    // long idle period could bank negative cooldown and double-tap the first
    // two rounds faster than the weapon's real cadence.
    const burstGap = Math.ceil(requestedWeapon.rate * TICK_HZ) + 1;
    if (this.tick - p.lastFireRequestTick > burstGap) p.fireCooldown = 0;
    p.lastFireRequestTick = this.tick;
    // Hold a "firing" flag for ~0.4s so other clients can shoulder this
    // player's rifle and show the recoil, not just hear about the hit.
    p._firingTicks = Math.ceil(FIRE_SPRINT_RECOVERY * TICK_HZ);
    const oldestTick = Math.max(0, this.tick - HISTORY_TICKS + 1);
    const proposedViewTick = Number.isFinite(msg.viewTick) ? Math.trunc(msg.viewTick) : this.tick;
    p.fireReq = { wid: requestedWid,
                  yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0,
                  pitch: Number.isFinite(msg.pitch) ? msg.pitch : 0,
                  viewTick: Math.max(oldestTick, Math.min(this.tick, proposedViewTick)) };
  }

  onReload(id, msg) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const wid = WEAPONS[msg.wid] ? msg.wid : p.wid;
    if (wid !== p.wid) return;
    this._startReload(p, wid);
  }

  _weaponState(p, wid = p.wid) {
    const weapon = WEAPONS[wid] || WEAPONS.m4;
    p.ammo ||= {};
    p.ammo[wid] ||= { mag: weapon.mag, reserve: weapon.reserve };
    return p.ammo[wid];
  }

  _startReload(p, wid = p.wid) {
    const weapon = WEAPONS[wid];
    if (!weapon || weapon.kind === 'melee' || weapon.mag <= 0) return false;
    const ammo = this._weaponState(p, wid);
    if (p.reloadUntil > this.tick || ammo.mag >= weapon.mag || (!weapon.infiniteReserve && ammo.reserve <= 0)) return false;
    p.reloadWid = wid;
    p.reloadUntil = this.tick + Math.max(1, Math.ceil(weapon.reload * TICK_HZ));
    return true;
  }

  _finishReload(p) {
    if (!p.reloadWid || p.reloadUntil > this.tick) return;
    const wid = p.reloadWid;
    const weapon = WEAPONS[wid];
    const ammo = this._weaponState(p, wid);
    const amount = weapon.infiniteReserve ? weapon.mag - ammo.mag : Math.min(weapon.mag - ammo.mag, ammo.reserve);
    ammo.mag += amount;
    if (!weapon.infiniteReserve) ammo.reserve -= amount;
    p.reloadWid = null;
    p.reloadUntil = 0;
    if (p.wid === wid) p.mag = ammo.mag;
  }

  // Ability request (replay-guarded). Charges + cooldown + effects are ALL
  // owned by the server — resolved inside update() on the tick.
  onAbility(id, msg) {
    const p = this.players.get(id);
    if (p && !this._canSimulate(p)) return;
    if (!p || !p.alive) return;
    if (!ABILITIES[msg.kind]) return;                        // unknown ability type
    if (typeof msg.seq !== 'number' || msg.seq <= p.lastAbilitySeq) return;   // replay/dup
    p.lastAbilitySeq = msg.seq;
    p.abilityReq = { kind: msg.kind,
                     yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0,
                     pitch: Number.isFinite(msg.pitch) ? msg.pitch : 0 };
  }

  _hitscan(shooter, w, yaw, pitch, aiming = false, rewindTick = this.tick) {
    this._weaponSound(shooter, w.ammoPerShot > 1 ? w.pellets : 1);
    // Rewind targets to the authoritative snapshot the shooter last saw.
    // `ackTick` is deliberately not used here: it acknowledges input sequence
    // numbers and has a different clock from world snapshots.
    const rewind = Math.max(0, Math.min(this.tick, Math.trunc(rewindTick)));
    const ox = shooter.state.px, oy = shooter.state.py + HEAD_Y, oz = shooter.state.pz;
    const spread = shotSpread(w, shooter.gunBloom || 0, aiming ? 1 : 0,
      Math.hypot(shooter._animVX || 0, shooter._animVZ || 0));
    for (let pellet = 0; pellet < w.pellets; pellet++) {
      const a = (this._rand(shooter.id * 131 + this.tick * 7 + pellet) - 0.5) * spread;
      const b = (this._rand(shooter.id * 977 + this.tick * 13 + pellet) - 0.5) * spread;
      const { x: rx, y: ry, z: rz } = spreadDirection(yaw, pitch, a, b);
      let best = null, bestT = w.range;
      for (const t of this.players.values()) {
        if (t === shooter || !t.alive || !this._canSimulate(t)) continue;
        const pos = this._rewound(t, rewind);
        const headY = Math.max(0.8, (pos.eye || 1.7) - 0.15);
        const hit = this._raySphere(ox, oy, oz, rx, ry, rz, pos.x, pos.y + headY, pos.z, HEAD_R, bestT);
        if (hit && hit.t < bestT) { best = { t, head: true, t2: hit.t }; bestT = hit.t; continue; }
        const lowered = !!(pos.crouch || pos.slide);
        const bodyY = lowered ? 0.58 : 0.9;
        const bodyR = lowered ? 0.42 : BODY_R;
        const body = this._raySphere(ox, oy, oz, rx, ry, rz, pos.x, pos.y + bodyY, pos.z, bodyR, bestT);
        if (body && body.t < bestT) { best = { t, head: false, t2: body.t }; bestT = body.t; }
      }
      const wallT = rayVsBoxes(this.simWorld, ox, oy, oz, rx, ry, rz, w.range);
      let impactT = Math.min(bestT, wallT);
      // smoke occlusion: if the ray to the hit passes through an active smoke
      // volume, the shot is blocked (server-authoritative vision denial).
      if (best && this._raySmoked(ox, oy, oz, rx, ry, rz, best.t2)) best = null;
      if (best && wallT < best.t2 - 0.05) best = null;
      if (best) this._damage(best.t, shooter, w.dmg * (best.head ? w.hs : 1), best.head, shooter.wid);
      else if (w.kind === 'melee' && wallT < w.range) {
        this.events.push({ e: 'bladeImpact', by: shooter.id,
          x: ox + rx * wallT, y: oy + ry * wallT, z: oz + rz * wallT });
      }
      if (w.kind !== 'melee' && w.kind !== 'rocket') {
        // Replicate the presentation segment to every client. Damage remains
        // instantaneous and authoritative; clients animate a bright tracer
        // along this exact unobstructed path.
        this.events.push({
          e: 'shot', by: shooter.id, wid: shooter.wid,
          x: ox, y: oy, z: oz,
          tx: ox + rx * impactT, ty: oy + ry * impactT, tz: oz + rz * impactT,
        });
      }
    }
  }

  onPickup(id, msg) {
    const p = this.players.get(id);
    if (p && !this._canSimulate(p)) return;
    if (!p || !p.alive) return false;
    if (!Number.isInteger(msg.seq) || msg.seq <= p.lastPickupSeq) return false;
    p.lastPickupSeq = msg.seq;
    p.pendingPickup = null;
    if (this._tryPickup(p, msg.padId)) return true;
    const requested = this.lootPads.find(entry => entry.padId === msg.padId);
    // The request can precede the input that moves this player onto the pad.
    // Remember only a nearby request for 300ms; collection still requires the
    // ordinary authoritative radius/height, never a client-supplied position.
    if (requested?.active && Math.hypot(p.state.px-requested.x, p.state.pz-requested.z) < 6.2
      && Math.abs(p.state.py-requested.y) < WEAPON_COLLECT_HEIGHT) {
      p.pendingPickup = {padId: msg.padId, until: this.tick + Math.ceil(.3*TICK_HZ)};
    }
    return false;
  }

  _tryPickup(p, padId) {
    if (!p.alive || !this._canSimulate(p)) return false;
    const pad = this.lootPads.find((entry) => entry.padId === padId);
    if (!pad?.active) return false;
    const dx = p.state.px - pad.x;
    const dy = p.state.py - pad.y;
    const dz = p.state.pz - pad.z;
    if (Math.hypot(dx, dz) >= WEAPON_COLLECT_RADIUS || Math.abs(dy) >= WEAPON_COLLECT_HEIGHT) return false;

    if (pad.lootType === 'shield') {
      if (!this.shieldsEnabled) return false;
      if (p.maxShield >= MAX_PICKUP_SHIELD) return false;
      const next = addShieldStack(p.shield, p.maxShield);
      p.shield = next.shield;
      p.maxShield = next.maxShield;
      p.shieldRegenDelay = 0;
    } else if (pad.lootType === 'weapon' && isMatchPickupWeaponId(pad.gunId)) {
      const alreadyOwned = p.matchWeapons.has(pad.gunId);
      p.matchWeapons.add(pad.gunId);
      if (!alreadyOwned) {
        this._discardEmptyAfterSwitch(p, pad.gunId);
        p.wid = pad.gunId;
      }
      const weapon = WEAPONS[pad.gunId];
      if (alreadyOwned) {
        const ammo = this._weaponState(p, pad.gunId);
        ammo.reserve += weapon.mag + weapon.reserve;
      } else p.ammo[pad.gunId] = { mag: weapon.mag, reserve: weapon.reserve };
      if (p.wid === pad.gunId) p.mag = p.ammo[pad.gunId].mag;
      if (!alreadyOwned) {
        p.reloadUntil = 0;
        p.reloadWid = null;
      }
    } else {
      return false;
    }

    pad.active = false;
    pad.respawnTick = this.tick + LOOT_RESPAWN_TICKS;
    this.events.push({
      e: 'pickup', id: p.id, padId: pad.padId,
      lootType: pad.lootType, gunId: pad.gunId,
      shield: p.shield, maxShield: p.maxShield,
    });
    return true;
  }

  _weaponSound(shooter, rounds = 1) {
    this.events.push({ e: 'weaponSound', by: shooter.id, wid: shooter.wid, rounds,
      x: shooter.state.px, y: shooter.state.py + HEAD_Y, z: shooter.state.pz });
  }

  _resolveRocket(shooter, w, yaw, pitch) {
    this._weaponSound(shooter);
    const speed = w.rocketSpeed || 40, cp = Math.cos(pitch);
    this.projectiles.push({
      id: `${this.matchStart}:${++this._projectileSerial}`, kind: w.id === 'concussion' ? 'launcherGrenade' : 'rocket',
      by: shooter.id, wid: shooter.wid, weapon: w,
      x: shooter.state.px, y: shooter.state.py + HEAD_Y, z: shooter.state.pz,
      vx: -Math.sin(yaw) * cp * speed, vy: Math.sin(pitch) * speed,
      vz: -Math.cos(yaw) * cp * speed,
      until: this.tick + Math.ceil((w.id === 'concussion' ? 15 : Math.min(5, w.range / speed)) * TICK_HZ),
    });
  }

  _projectileWorldHit(p, dx, dy, dz, length) {
    if (this.arena.raycastHit) return this.arena.raycastHit(p.x, p.y, p.z, dx, dy, dz, length);
    let distance = rayVsBoxes(this.simWorld, p.x, p.y, p.z, dx, dy, dz, length);
    // The flat fixture arena has an implicit floor, not a box collider.
    if (!this.simWorld.noBaseFloor && dy < 0) {
      const floor = (0 - p.y) / dy;
      if (floor >= 0 && floor <= distance) return { distance: floor, nx: 0, ny: 1, nz: 0 };
    }
    if (distance >= length) return null;
    return { distance, nx: -dx, ny: -dy, nz: -dz };
  }

  _blast(origin, shooter, radius, damage, minimum = 0.25) {
    const raycast = (...args) => rayVsBoxes(this.simWorld, ...args);
    for (const target of this.players.values()) {
      if (!target.alive || !this._canSimulate(target)) continue;
      const amount = blastDamage(origin, target.state, radius, damage, minimum, raycast);
      if (amount > 0) this._damage(target, shooter, amount, false, origin.wid ?? (origin.kind === 'timebomb' ? 'timebomb' : 'frag'), origin);
    }
  }

  _updateProjectiles() {
    const remaining = [];
    for (const p of this.projectiles) {
      if (p.kind === 'launcherGrenade') {
        stepGrenade(p, 1 / TICK_HZ, (origin, dx, dy, dz, length) =>
          this._projectileWorldHit(origin, dx, dy, dz, length), true);
        if (launcherShouldExplode(p)) {
          const w = p.weapon;
          this._blast(p, this.players.get(p.by), w.splashRadius, w.dmg, w.splashMin);
          this.events.push({ e: 'explosion', id: p.id, kind: 'rocket', wid: p.wid, by: p.by,
            x: p.x, y: p.y, z: p.z, r: w.splashRadius });
        } else if (this.tick < p.until) remaining.push(p);
        // Shared fuse also covers slopes, corners and rounds falling into voids.
        continue;
      }
      if (p.kind === 'frag' || p.kind === 'smoke') {
        stepGrenade(p, 1 / TICK_HZ, (origin, dx, dy, dz, length) =>
          this._projectileWorldHit(origin, dx, dy, dz, length));
        if (this.tick >= p.until) {
          if (p.kind === 'smoke') {
            const A = ABILITIES.smoke;
            this.smokes.push({x:p.x,y:p.y,z:p.z,r:A.radius,until:this.tick + Math.round(A.lifeSec*TICK_HZ)});
            this.events.push({e:'ability',kind:'smoke',by:p.by,x:p.x,y:p.y,z:p.z,r:A.radius});
          } else this._explodeFrag(p);
        }
        else remaining.push(p);
        continue;
      }
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const dx = p.vx / (speed || 1), dy = p.vy / (speed || 1), dz = p.vz / (speed || 1);
      const length = speed / TICK_HZ;
      let hit = length > 0 ? this._projectileWorldHit(p, dx, dy, dz, length + 0.075) : null;
      if (p.kind === 'rocket') {
        let nearest = hit?.distance ?? length;
        for (const target of this.players.values()) {
          if (target.id === p.by || !target.alive || !this._canSimulate(target)) continue;
          for (const height of [0.45, 0.9, (target.state.crouch || target.state.slide) ? 0.85 : HEAD_Y]) {
            const body = this._raySphere(p.x, p.y, p.z, dx, dy, dz,
              target.state.px, target.state.py + height, target.state.pz, BODY_R + 0.075, nearest);
            if (body && body.t < nearest) {
              nearest = body.t;
              hit = { distance: nearest, nx: -dx, ny: -dy, nz: -dz };
            }
          }
        }
      }
      const travel = hit ? Math.max(0, hit.distance) : length;
      p.x += dx * travel; p.y += dy * travel; p.z += dz * travel;
      if (hit) {
        p.x += hit.nx * 0.09; p.y += hit.ny * 0.09; p.z += hit.nz * 0.09;

      }
      if ((p.kind === 'rocket' && hit) || this.tick >= p.until) {
        if (p.kind === 'frag') this._explodeFrag(p);
        else {
          const w = p.weapon;
          this._blast(p, this.players.get(p.by), w.splashRadius, w.dmg, w.splashMin);
          this.events.push({ e: 'explosion', id: p.id, kind: 'rocket', wid: p.wid, by: p.by,
            x: p.x, y: p.y, z: p.z, r: w.splashRadius });
        }
      } else remaining.push(p);
    }
    this.projectiles = remaining;
  }

  // Does the ray segment [0, maxT] pass within any active smoke sphere?
  _raySmoked(ox, oy, oz, dx, dy, dz, maxT) {
    for (const s of this.smokes) {
      const h = this._raySphere(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, s.r, maxT);
      if (h) return true;
    }
    return false;
  }

  _damage(target, shooter, dmg, head, wid = null, source = null) {
    if (!target.alive || !this._canSimulate(target)) return;
    if (this.mode === 'survival' && target !== shooter && target.isBot && shooter?.isBot
      && !target.survivalEnemy && !shooter.survivalEnemy) return;
    // Spawn protection prevents enemy spawn kills, never your own explosives.
    if (shooter !== target && this.tick < (target.invulnerableUntil || 0)) return;
    if (target.isBot && shooter && shooter !== target) this._provokeBot(target, shooter, true);
    if(shooter && shooter !== target){target.damageContributors.set(shooter.id,this.tick);this.economy?.activity(shooter.id,true,50);}
    const dealt = Math.min(Math.max(0, target.health) + Math.max(0, target.shield), dmg);
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    target.health -= (dmg - absorbed);
    target.healthRegenDelay = HEALTH_REGEN_DELAY;
    target.shieldRegenDelay = SHIELD_REGEN_DELAY;
    this.events.push({ e: 'hit', id: target.id, by: shooter?.id ?? null, dmg: Math.round(dealt), head, wid,
      x: target.state.px, y: target.state.py + 1.5, z: target.state.pz, killed: target.health <= 0 });
    if (target.health <= 0) this._kill(target, shooter, head, wid, source);
  }

  _kill(target, shooter = null, head = false, wid = null, source = null) {
    if (!target.alive) return false;
    target.deathReaction = createDeathReaction(wid ?? shooter?.wid ?? 'void', target.state,
      source ?? (shooter && shooter !== target ? {x:shooter.state.px,z:shooter.state.pz} : null),
      (ox, oy, oz, dx, dy, dz, maxT) => {
        let hit = rayVsBoxes(this.simWorld, ox, oy, oz, dx, dy, dz, maxT);
        if (!this.simWorld.noBaseFloor && dy < 0 && oy >= 0) hit = Math.min(hit, -oy / dy);
        return hit;
      });
    // Solve once per death rather than once per rendered frame on every client.
    const floor = this.arena.groundHeightAt?.(target.state.px, target.state.pz,
      target.state.py + 0.2, target.state.py - 256);
    target.deathReaction.floorY = Number.isFinite(floor) ? floor : target.state.py;
    target.alive = false;
    target.queue.length = 0;
    target._heldInput = null;
    target.health = 0;
    target._lastSprint = false;
    target._lastAim = false;
    target._animVX = target._animVZ = 0;
    target._firingTicks = 0;
    this._resetLifeInventory(target);
    target.deadUntil = this.tick + RESPAWN_TICKS;
    if (target.isBot) target._botState = BOT_STATES.DEAD;
    const victimStreak = target.killStreak || 0;
    target.killStreak = 0;
    target.deaths++;
    this.achievements?.record(target.accountId,{deaths:1});
    let awardedScore=0;
    if (shooter && target !== shooter) {
      shooter.kills++;
      if(this.mode==='deathmatch'&&!shooter.isBot)this.tournaments?.recordResult(shooter.accountId,'most_kills',1);
      shooter.killStreak = (shooter.killStreak || 0) + 1;
      const boss=target.bossInstance?this.economy?.match.bosses[target.bossInstance]:null;
      const kind=target.survivalEnemy?(boss?'boss':'survival_kill'):(head?'headshot':'kill');
      const reward=this.economy?.ready?this.economy.award(shooter.id,kind,{victimStreak,victim:target.id,victimIsBot:target.isBot,earnsE:this.mode!=='survival'||!!target.survivalEnemy,...(boss?{score:boss.scoreReward}:{})}):null;
      awardedScore=reward?.score ?? (head ? 150 : 100);
      shooter.score += awardedScore;
      this.achievements?.record(shooter.accountId,{kills:1,humanKills:!target.isBot?1:0,botKills:target.isBot&&!target.survivalEnemy?1:0,
        zombies:target.survivalEnemy?1:0,headshots:head?1:0,score:awardedScore,bestStreak:shooter.killStreak,swordKills:(wid??shooter.wid)==='sword'?1:0});
      if(reward && (reward.guest || reward.e !== '0.0000'))shooter.send({t:'earning',kind:'kill',amount:reward.e,guest:reward.guest,score:reward.score});
    }
    const assistWindow=(this.economy?.match?.config.assistWindowSeconds ?? 5)*TICK_HZ;
    for(const [id,tick] of target.damageContributors){
      if(id===shooter?.id || id===target.id || this.tick-tick>assistWindow)continue;
      const helper=this.players.get(id);if(!helper)continue;
      const reward=this.economy?.ready?this.economy.award(id,'assist',{victim:target.id,victimIsBot:target.isBot,earnsE:this.mode!=='survival'||!!target.survivalEnemy}):null;
      helper.assists++;helper.score+=reward?.score??10;
      this.achievements?.record(helper.accountId,{assists:1,score:reward?.score??10});
      helper.send({t:'earning',kind:'assist',amount:reward?.e||'0.0000',guest:reward?.guest,score:reward?.score??10});
    }
    target.damageContributors.clear();
    const earningTarget=this.economy?.participant(target.id);if(earningTarget)earningTarget.deaths++;
    this.events.push({
      e: 'kill', id: target.id, by: shooter?.id ?? null,
      byName: shooter?.name ?? 'THE VOID', victimName: target.name,
      score:awardedScore, head, wid: wid ?? shooter?.wid ?? 'void',
    });
    return true;
  }

  // A near miss aimed at a bot still counts as an attack. Only bots close to
  // the unobstructed shot ray react, so spraying a wall cannot alert enemies on
  // the other side of it.
  _provokeBotsAlongShot(shooter, weapon, yaw, pitch) {
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
    const ox = shooter.state.px, oy = shooter.state.py + HEAD_Y, oz = shooter.state.pz;
    for (const bot of this.players.values()) {
      if (!bot.isBot || bot === shooter || !bot.alive) continue;
      const tx = bot.state.px - ox, ty = (bot.state.py + 1.05) - oy, tz = bot.state.pz - oz;
      const along = tx * dx + ty * dy + tz * dz;
      if (along <= 0 || along > weapon.range) continue;
      const miss = Math.hypot(tx - dx * along, ty - dy * along, tz - dz * along);
      if (miss > 1.35) continue;
      if (rayVsBoxes(this.simWorld, ox, oy, oz, dx, dy, dz, along) < along - 0.1) continue;
      this._provokeBot(bot, shooter, true);
    }
  }

  // The server owns frag/smoke flight and planted bomb positions. Instant
  // flash/impulse abilities still resolve their validated aim here.
  _resolveAbility(p, kind, A, yaw, pitch) {
    const ox = p.state.px, oy = p.state.py + HEAD_Y, oz = p.state.pz;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dx = -Math.sin(yaw) * cp, dy = sp, dz = -Math.cos(yaw) * cp;
    const hitT = rayVsBoxes(this.simWorld, ox, oy, oz, dx, dy, dz, A.throwRange);
    const dist = Math.max(0, Math.min(hitT, A.throwRange) - 0.12);
    let bx = ox + dx * dist, by = oy + dy * dist, bz = oz + dz * dist;
    if (kind === 'impulse') { bx=ox; by=p.state.py+.9; bz=oz; }
    if (kind === 'timebomb') { bx=ox; by=p.state.py+.08; bz=oz; }

    if (kind === 'frag' || kind === 'smoke') {
      bx = ox; by = oy; bz = oz;
      this.projectiles.push({ kind, id: `${this.matchStart}:${++this._projectileSerial}`, by: p.id,
        x: bx, y: by, z: bz, vx: dx * 16, vy: dy * 16 + 4.5, vz: dz * 16,
        until: this.tick + Math.round(A.fuseSec * TICK_HZ) });
      if (kind === 'smoke') return; // Smoke starts at detonation, not on the throw.
    } else if (kind === 'timebomb') {
      this.frags.push({ kind, id: `${p.id}:${this.tick}`, by: p.id, x: bx, y: by, z: bz,
                        until: this.tick + Math.round(A.fuseSec * TICK_HZ) });
    } else if (kind === 'flash') {
      for (const t of this.players.values()) {
        if (!t.alive || !this._canSimulate(t)) continue;
        const d = Math.hypot(t.state.px - bx, t.state.pz - bz, (t.state.py + HEAD_Y) - by);
        if (d > A.radius) continue;
        // LOS gate: no blind through a wall
        const tx = t.state.px - bx, ty = (t.state.py + HEAD_Y) - by, tz = t.state.pz - bz;
        const len = Math.hypot(tx, ty, tz) || 1e-6;
        const blocked = rayVsBoxes(this.simWorld, bx, by, bz, tx / len, ty / len, tz / len, len) < len - 0.1;
        if (blocked) continue;
        const frac = 1 - d / A.radius;                 // closer = longer blind
        t.blindUntil = Math.max(t.blindUntil, this.tick + Math.round(A.blindSec * frac * TICK_HZ));
      }
    } else if (kind === 'impulse') {
      for (const t of this.players.values()) {
        if (!t.alive || t === p || !this._canSimulate(t)) continue;
        const tx = t.state.px - bx, ty = (t.state.py + 0.9) - by, tz = t.state.pz - bz;
        const d = Math.hypot(tx, ty, tz);
        if (d > A.radius) continue;
        if (d > 0 && rayVsBoxes(this.simWorld,bx,by,bz,tx/d,ty/d,tz/d,d) < d-.1) continue;
        const f = A.power * (1 - d / A.radius) / (d || 1e-6);
        // clamp every component so knockback can never launch to infinity
        t.state.vx = clamp(t.state.vx + tx * f, -IMPULSE_MAX, IMPULSE_MAX);
        t.state.vy = clamp(t.state.vy + Math.max(ty * f, A.power * 0.4), -IMPULSE_MAX, IMPULSE_MAX);
        t.state.vz = clamp(t.state.vz + tz * f, -IMPULSE_MAX, IMPULSE_MAX);
        t.state.onGround = 0;
      }
    }
    this.events.push({ e: 'ability', kind, by: p.id, x: bx, y: by, z: bz, r: A.radius });
  }

  _explodeFrag(frag) {
    const A = ABILITIES[frag.kind || 'frag'];
    this._blast(frag, this.players.get(frag.by), A.radius, A.damage, frag.kind === 'timebomb' ? 0.25 : 0.1);
    this.events.push({ e: 'explosion', id: frag.id, kind: frag.kind || 'frag', by: frag.by,
      x: frag.x, y: frag.y, z: frag.z, r: A.radius });
  }

  // advance one authoritative tick
  update() {
    this.tick++;
    this.events.length = 0;
    const rotated = this._rotateMatch();
    this._advanceRoundGate();

    for (const pad of this.lootPads) {
      if (!pad.active && this.tick >= pad.respawnTick) this._rerollLootPad(pad);
    }

    if (!this._roundWaiting) this._updateProjectiles();

    // expire finished smoke volumes
    if (this.smokes.length) this.smokes = this.smokes.filter((s) => this.tick < s.until);
    if (!this._roundWaiting && this.frags.length) {
      const due = this.frags.filter((frag) => this.tick >= frag.until);
      this.frags = this.frags.filter((frag) => this.tick < frag.until);
      for (const frag of due) this._explodeFrag(frag);
    }

    for (const p of this.players.values()) {
      if (!this._canSimulate(p)) { p.queue.length = 0; p._heldInput = null; p.fireReq = p.abilityReq = null; continue; }
      const equipped = WEAPONS[p.wid] || WEAPONS.m4;
      this._finishReload(p);
      p.fireCooldown = Math.max(
        -(equipped.rate || 0.12),
        p.fireCooldown - 1 / TICK_HZ,
      );
      p.gunBloom = Math.max(
        equipped.spreadMin || 0,
        (p.gunBloom || 0) - (equipped.bloomRecovery || 0) / TICK_HZ,
      );
      p.abilityCooldowns ||= {};
      for (const [kind, remaining] of Object.entries(p.abilityCooldowns)) {
        p.abilityCooldowns[kind] = Math.max(0, remaining - 1 / TICK_HZ);
        if (remaining > 0 && p.abilityCooldowns[kind] <= 0) p.abilities[kind] = ABILITIES[kind].charges;
      }
      p.abilityCD = Math.max(0, ...Object.values(p.abilityCooldowns));

      if (!p.alive) {
        if (this.tick >= p.deadUntil) {
          const s = this._spawn(p.id, p.id, true);
          p.state = createState(s[0], s[1], s[2]);
          p.health = START_HEALTH;
          this._resetLifeInventory(p);
          p.healthRegenDelay = 0;
          p.reloadUntil = 0; p.reloadWid = null;
          p.invulnerableUntil = this.tick + SPAWN_PROTECTION_TICKS;
          p.alive = true; p.deathReaction = null; p.queue.length = 0; p._heldInput = null;
          p._lastSprint = false;
          p._animVX = p._animVZ = 0;
          p._lastAim = false;
          p._firingTicks = 0;
          p._swingStart = p._swingUntil = 0;
          p._botReloadUntil = 0;
          p.gunBloom = 0;
          p.blindUntil = 0; p.abilityCooldowns = {}; p.abilityCD = 0;
          p.abilities = { frag: ABILITIES.frag.charges, flash: ABILITIES.flash.charges, smoke: ABILITIES.smoke.charges,
                          timebomb: ABILITIES.timebomb.charges, impulse: ABILITIES.impulse.charges };
          if (p.isBot) this._resetBotAI(p);
          if(p.survivalAlly)this.allyAI?.reset(p);
          this.events.push({ e: 'respawn', id: p.id, x: s[0], y: s[1], z: s[2] });
        }
        this._record(p);
        continue;
      }

      if (p.survivalEnemy) { /* Zombie health does not regenerate. */ }
      else if (p.healthRegenDelay > 0) {
        p.healthRegenDelay = Math.max(0, p.healthRegenDelay - 1 / TICK_HZ);
        if (p.healthRegenDelay <= 1e-6 && p.health < START_HEALTH) {
          p.healthRegenDelay = 0;
          p.health = Math.min(START_HEALTH, p.health + HEALTH_REGEN_RATE / TICK_HZ);
        }
      } else if (p.health < START_HEALTH) {
        p.health = Math.min(START_HEALTH, p.health + HEALTH_REGEN_RATE / TICK_HZ);
      }
      if (p.shieldRegenDelay > 0) {
        p.shieldRegenDelay = Math.max(0, p.shieldRegenDelay - 1 / TICK_HZ);
      } else if (p.shield < p.maxShield) {
        p.shield = Math.min(p.maxShield, p.shield + SHIELD_REGEN_RATE / TICK_HZ);
      }

      // A slow rendering frame can deliver held keys below the 20Hz server
      // rate. Briefly retain held intent instead of stopping every other tick.
      // Edges are NEVER repeated, and the deadline is tied to packet receipt,
      // not renewed by the fallback or by draining an old command backlog.
      let cmd = p.isBot ? this._driveBot(p) : p.queue.shift();
      if (!p.isBot && cmd) {
        p._heldInput = {...cmd, inp: {...cmd.inp, jumpJust: 0, crouchJust: 0, teleJust: 0}};
        p._heldInputUntilTick = (cmd.receivedTick ?? this.tick) + INPUT_HOLD_GRACE_TICKS;
      } else if (!p.isBot && p._heldInput && this.tick <= p._heldInputUntilTick) {
        cmd = p._heldInput;
      }
      if (!cmd) {
        p._heldInput = null;
        cmd = { seq: p.lastInputSeq, inp: makeInput({ yaw: p._lastYaw ?? 0 }) };
      }
      // reject inputs that claim to be too far in the future (schema guard)
      // Bots spend the same stamina as humans. After exhaustion, keep walking
      // until a useful reserve recovers instead of pulsing sprint every tick.
      if (p.isBot) {
        if (p.state.stamina <= 2) p._botStaminaRecovering = true;
        if (p.state.stamina >= STAMINA_MAX * 0.5) p._botStaminaRecovering = false;
        if (p._botStaminaRecovering) cmd = {...cmd, inp: {...cmd.inp, sprint: 0}, botDash: false};
      }
      // Human fire cancels sprint; server-driven bots may fire during pursuit.
      const firingGun = WEAPONS[cmd.wid || p.wid]?.kind !== 'melee' && p._firingTicks > 0;
      if (firingGun && !p.isBot) cmd = {...cmd, inp: {...cmd.inp, sprint: 0}, botDash: false};
      const previousState = p.state;
      const sprinting = isSprinting(previousState, cmd.inp);
      // Set enemy speed before integration so ground support and swept collision
      // use the actual distance travelled, including later-wave acceleration.
      p.state = step(previousState, cmd.inp, this.simWorld, p.survivalEnemy
        ? {speedScale: (p.enemySpeed || WALK_SPEED * SPRINT_MULT) / (WALK_SPEED * SPRINT_MULT), snapDown: .3} : p.isBot ? {speedScale: BOT_MOVEMENT_SCALE} : undefined);
      if (p.isBot && cmd.botDash) p.state = this._advanceBotDash(p, p.state);
      if (this.arena.resolveState && !p.state.recovered) p.state = this.arena.resolveState(previousState, p.state, p.survivalEnemy ? {snapDown: .3} : undefined);
      p.ackTick = cmd.seq;
      p._lastYaw = cmd.inp.yaw;
      const nextWid = this._canEquipWeapon(p, cmd.wid) ? cmd.wid : p.wid;
      this._discardEmptyAfterSwitch(p, nextWid);
      p.wid = nextWid;
      p.mag = this._weaponState(p, p.wid).mag;
      p._lastAim = !!cmd.aiming;
      // MoveSim restores the last safe transform when it crosses the kill
      // plane. Treat that recovery marker as an environmental death instead of
      // silently teleporting the player and leaving the HUD in an unclear state.
      if (p.state.recovered) {
        this._kill(p, null, false, 'void');
        p.queue.length = 0;
        p._heldInput = null;
        this._record(p);
        continue;
      }
      // Public animation velocity is resolved displacement, not requested
      // velocity, so a player pinned against a wall does not run in place.
      const dx = p.state.px - previousState.px;
      const dz = p.state.pz - previousState.pz;
      const distance = Math.hypot(dx, dz);
      const padJump = p.state.padCD > previousState.padCD + 0.5;
      const regularStep = distance < 2 && !cmd.inp.teleJust && !padJump;
      const resolvedSpeed = distance * TICK_HZ;
      p._animVX = regularStep ? dx * TICK_HZ : 0;
      p._animVZ = regularStep ? dz * TICK_HZ : 0;
      // Brief corner braking is still a running gait; do not flicker bots into
      // the walk clip for the last few centimetres of every waypoint.
      const runningPatrol = p.isBot && !p._botStaminaRecovering && p.state.stamina > 2 && p._botState === BOT_STATES.ROAM && cmd.inp.mz > 0;
      p._lastSprint = (sprinting || !!cmd.botDash || runningPatrol) && regularStep && resolvedSpeed > 6.5;
      // Pitch is client-owned look state — the sim doesn't use it, but remote
      // avatars need it or everyone renders as aiming flat at the horizon.
      if (Number.isFinite(cmd.inp.pitch)) p._lastPitch = cmd.inp.pitch;
      if (p._firingTicks > 0) p._firingTicks--;
      this._record(p);
    }

    // Walking onto a pad is sufficient. Collection cannot depend on a browser
    // request arriving during the short interval that a sprint crosses it.
    for (const p of this.players.values()) {
      if (p.isBot || !p.alive || !this._canSimulate(p)) continue;
      for (const pad of this.lootPads) if (pad.active) this._tryPickup(p, pad.padId);
    }

    // Recheck early pickup requests after the server has applied movement.
    for (const p of this.players.values()) {
      const request = p.pendingPickup;
      if (!request) continue;
      if (!p.alive || !this._canSimulate(p) || this.tick > request.until
        || !this.lootPads.find(pad => pad.padId === request.padId)?.active
        || this._tryPickup(p, request.padId)) p.pendingPickup = null;
    }

    // resolve fire requests AFTER movement + history record, so hitscan sees
    // this tick's positions and events land in this tick's snapshot.
    for (const p of this.players.values()) {
      if (!p.fireReq || !p.alive || !this._canSimulate(p)) { p.fireReq = null; continue; }
      const req = p.fireReq; p.fireReq = null;
      if (req.wid !== p.wid || p.fireCooldown > 0 || p.reloadUntil > this.tick) continue;
      const w = WEAPONS[req.wid] || WEAPONS.m4;
      const ammo = this._weaponState(p, req.wid);
      if (w.kind !== 'melee' && ammo.mag <= 0) { this._startReload(p, req.wid); continue; }
      if (p.isBot && req.botTargetId != null) {
        const target = this.players.get(req.botTargetId);
        if (target?.alive) {
          const tx = target.state.px - p.state.px;
          const tz = target.state.pz - p.state.pz;
          const distance = Math.max(0.001, Math.hypot(tx, tz));
          const personality = 0.9 + this._rand(p.id * 271) * 0.2;
          const retaliationScale = req.botRetaliating ? BOT_RETALIATION_AIM_SCALE : 1;
          const error = botAimErrorMeters(
            distance,
            this.botDifficulty.aimErrorScale * personality * retaliationScale * (p._lastSprint ? 1.25 : 1),
          );
          const tracking = botTrackingOffset(p.id, this.tick / TICK_HZ);
          const yawJitter = tracking.x * error / distance;
          const pitchJitter = tracking.y * error / distance;
          req.yaw = p._botAimYaw + yawJitter;
          req.pitch = p._botAimPitch + pitchJitter;
        }
      }
      p.wid = req.wid;
      p.fireCooldown = Math.max(-w.rate, p.fireCooldown) + w.rate;
      const shotRounds = Math.min(ammo.mag, w.ammoPerShot);
      if (w.kind !== 'melee') ammo.mag -= shotRounds;
      else {
        p._swingStart = this.tick;
        p._swingUntil = this.tick + Math.max(1, Math.ceil(w.rate * TICK_HZ));
      }
      p.mag = ammo.mag;
      this._provokeBotsAlongShot(p, w, req.yaw, req.pitch);
      if (w.kind === 'rocket') this._resolveRocket(p, w, req.yaw, req.pitch);
      else this._hitscan(p, w.ammoPerShot > 1 ? { ...w, pellets: shotRounds } : w,
        req.yaw, req.pitch, p._lastAim, req.viewTick);
      if (w.kind !== 'melee' && ammo.mag <= 0) this._startReload(p, req.wid);
      if (w.spreadMax != null) {
        p.gunBloom = Math.min(w.spreadMax, (p.gunBloom || 0) + (w.bloomShot || 0));
      }
    }

    // resolve ability requests (charges + cooldown + effect all server-owned)
    for (const p of this.players.values()) {
      if (!p.abilityReq || !p.alive || !this._canSimulate(p)) { p.abilityReq = null; continue; }
      const req = p.abilityReq; p.abilityReq = null;
      const A = ABILITIES[req.kind];
      if(req.kind === 'timebomb' && !p.state.onGround) continue;
      if (!A || (p.abilityCooldowns?.[req.kind] || 0) > 0 || p.abilities[req.kind] <= 0) continue;   // authority: cd + charges
      p.abilities[req.kind]--;
      p.abilityCD = A.cd;
      p.abilityCooldowns ||= {}; p.abilityCooldowns[req.kind] = A.cd;
      this._resolveAbility(p, req.kind, A, req.yaw, req.pitch);
    }

    for(const p of this.players.values()) {
      const moving=Math.hypot(p._animVX||0,p._animVZ||0)>.2;
      if(!p.isBot)this.economy?.activity(p.id,this._canSimulate(p) && (moving || (p._firingTicks||0)>0),TICK_MS);
    }
    // send per-player snapshots (each gets its own ack + authoritative you-state)
    const now = this.tick;
    const publicList = [];
    for (const p of this.players.values()) {
      const reloadDuration = Math.max(1, Math.ceil((WEAPONS[p.wid]?.reload || 0) * TICK_HZ));
      const reloadTicks = p.reloadWid === p.wid ? Math.max(0, p.reloadUntil - now) : 0;
      const swingDuration = Math.max(1, p._swingUntil - p._swingStart);
      publicList.push({
        ready: p.mapReady !== false && !p.spectating, id: p.id, name: p.name, nameCosmetics:p.nameCosmetics||null, isBot: p.isBot, armorSkin: p.armorSkin || null,
        x: p.state.px, y: p.state.py, z: p.state.pz,
        yaw: p.isBot
          ? botPresentationYaw(p._lastYaw ?? 0, p._animVX, p._animVZ, p._botTargetId != null || (p._firingTicks || 0) > 0)
          : (p._lastYaw ?? 0),
        aimYaw: p._lastYaw ?? 0, pitch: p._lastPitch ?? 0,
        vx: p._animVX, vy: p.state.vy, vz: p._animVZ,
        onGround: p.state.onGround, airJumpUsed: p.state.airJumpUsed, crouch: p.state.crouch,
        slide: p.state.slide, sprint: !!p._lastSprint, wid: p.wid,
        aiming: !!p._lastAim,
        firing: (p._firingTicks ?? 0) > 0, alive: p.alive, deathReaction: p.alive ? null : p.deathReaction,
        reload: reloadTicks > 0 ? 1 - reloadTicks / reloadDuration : 0,
        swing: p._swingUntil > now ? clamp((now - p._swingStart) / swingDuration, 0, 1) : 1,
        health: p.health, shield: p.shield, maxShield: p.maxShield,
        kills: p.kills, deaths: p.deaths, score: p.score, assists: p.assists,
        survival: this.mode==='survival', survivalEnemy: !!p.survivalEnemy, zombieVariant: p.zombieVariant, enemyType: p.enemyType, maxHealth: p.maxHealth || START_HEALTH, survivalAlly: !!p.survivalAlly, damageDealt:p.damageDealt||0, bossDamage:p.bossDamage||0, wavesSurvived:p.wavesSurvived||0,
        botState: p.isBot && (this.mode!=='survival'||this.botConfig?.debug) ? p._botState : undefined,
        botDebug: this.botConfig?.debug && p.survivalAI ? {state:p.survivalAI.state,target:p.survivalAI.target,threat:p.survivalAI.threat,path:p.survivalAI.path,detectionRange:this.botConfig.detectionRange} : undefined,
      });
    }
    const smokeList = this.smokes.map((s) => ({ x: s.x, y: s.y, z: s.z, r: s.r }));
    for (const p of this.players.values()) {
      const ammo = this._weaponState(p, p.wid);
      p.mag = ammo.mag;
      p.send({
        t: 'snapshot', tick: now, ack: p.ackTick,
        survival: this.mode==='survival'?{wave:this.wave,state:this.waveState,capacity:this.botConfig.desiredParticipants,participants:this.participants().length,enemies:this.enemies().filter(p=>p.alive).length,pending:this.pendingEnemies,total:this.waveTotal,nextWaveIn:Math.max(0,(this.nextWaveTick-now)/TICK_HZ)}:null,
        economy: this.economy?.ready ? this.economy.preview(p.id) : null,
        mapId: this.arena.id,
        mapName: this.arena.name,
        matchStart: this.matchStart,
        matchDurationMs: this.matchDurationMs,
        serverTime: Date.now(),
        roundGate: { waiting: !!this._roundWaiting, deadline: this._readyDeadline || 0, resultsUntil: this._resultsUntil || 0,
          pending: [...this.players.values()].filter(p => !p.isBot && !p.spectating && p.mapReady === false).length },
        postMatch: this._postMatchUntil ? { until: this._postMatchUntil, rows: this.previousRound.rows } : null,
        previousRound: this.previousRound || null,
        arena: rotated || p.mapReady === false || now <= this._arenaBroadcastUntilTick ? this._arenaPayload() : undefined,
        you: { ready: p.mapReady !== false, x: p.state.px, y: p.state.py, z: p.state.pz,
               vx: p.state.vx, vy: p.state.vy, vz: p.state.vz,
               eye: p.state.eye,
               onGround: p.state.onGround, crouch: p.state.crouch,
               slide: p.state.slide, slideT: p.state.slideT,
               slideCD: p.state.slideCD,
               slideDx: p.state.slideDx, slideDz: p.state.slideDz,
               stamina: p.state.stamina, stamDelay: p.state.stamDelay,
               coyote: p.state.coyote, airJumpUsed: p.state.airJumpUsed, teleCD: p.state.teleCD, padCD: p.state.padCD,
               nX: p.state.nX, nY: p.state.nY, nZ: p.state.nZ,
               safeX: p.state.safeX, safeY: p.state.safeY, safeZ: p.state.safeZ,
               sprint: !!p._lastSprint,
               health: p.health, shield: p.shield, maxShield: p.maxShield, alive: p.alive, deathReaction: p.alive ? null : p.deathReaction,
               wid: p.wid, mainWid: p.mainWid,
               matchWeapon: Array.from(p.matchWeapons)[0] || null,
               matchWeapons: Array.from(p.matchWeapons),
               weaponAmmo: p.ammo,
               mag: p.mag, reserve: ammo.reserve,
               reloading: p.reloadWid === p.wid && p.reloadUntil > now,
               reloadTicks: p.reloadWid === p.wid ? Math.max(0, p.reloadUntil - now) : 0,
               reloadDuration: Math.ceil((WEAPONS[p.wid]?.reload || 0) * TICK_HZ),
               spawnProtected: now < (p.invulnerableUntil || 0),
               kills: p.kills, deaths: p.deaths, score: p.score, assists: p.assists,
        survival: this.mode==='survival', survivalEnemy: !!p.survivalEnemy, zombieVariant: p.zombieVariant, enemyType: p.enemyType, maxHealth: p.maxHealth || START_HEALTH, survivalAlly: !!p.survivalAlly, damageDealt:p.damageDealt||0, bossDamage:p.bossDamage||0, wavesSurvived:p.wavesSurvived||0,
               blind: p.blindUntil > now, blindTicks: Math.max(0, p.blindUntil - now),
               abilities: p.abilities, abilityCooldowns: p.abilityCooldowns, abilityCD: +p.abilityCD.toFixed(2) },
        players: publicList,
        projectiles: this.projectiles.map(p => ({id:p.id,kind:p.kind,wid:p.wid,by:p.by,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz})),
        bombs: this.frags.filter(f=>f.kind==='timebomb').map(f=>({id:f.id,x:f.x,y:f.y,z:f.z,remaining:Math.max(0,(f.until-this.tick)/TICK_HZ)})),
        smokes: smokeList,
        lootPads: this._lootPadPayload(),
        events: this.events,
      });
    }
  }

  _record(p) {
    p.history.push({
      tick: this.tick, x: p.state.px, y: p.state.py, z: p.state.pz,
      eye: p.state.eye, crouch: !!p.state.crouch, slide: !!p.state.slide,
    });
    if (p.history.length > HISTORY_TICKS) p.history.shift();
  }
  _rewound(p, tick) {
    for (let i = p.history.length - 1; i >= 0; i--) {
      if (p.history[i].tick <= tick) return p.history[i];
    }
    return p.history[0] ?? { x: p.state.px, y: p.state.py, z: p.state.pz };
  }

  _roster() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id, name: p.name, nameCosmetics:p.nameCosmetics||null, isBot: p.isBot, armorSkin: p.armorSkin || null, kills: p.kills, deaths: p.deaths, score: p.score, assists: p.assists,
        survival: this.mode==='survival', survivalEnemy: !!p.survivalEnemy, zombieVariant: p.zombieVariant, enemyType: p.enemyType, maxHealth: p.maxHealth || START_HEALTH, survivalAlly: !!p.survivalAlly, damageDealt:p.damageDealt||0, bossDamage:p.bossDamage||0, wavesSurvived:p.wavesSurvived||0,
    }));
  }

  // ray vs sphere; returns {t} of nearest entry within maxT, else null
  _raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
    const ex = ox - cx, ey = oy - cy, ez = oz - cz;
    const b = ex * dx + ey * dy + ez * dz;
    const c = ex * ex + ey * ey + ez * ez - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxT) return null;
    return { t };
  }
  _rand(seed) {
    let s = seed | 0; s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
    s = Math.imul(s ^ (s >>> 12), 0x297a2d39);
    return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
  }
}
