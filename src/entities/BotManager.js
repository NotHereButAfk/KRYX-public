import { Bot } from './Bot.js';
import {
  botSeparationVector,
} from './BotCombat.js';
import { randomBotName } from './BotNames.js';

// Gamertag pool for simulated remote players and named bots, so the kill feed
// and server roster read like a live lobby instead of "Bot-7".
export class BotManager {
  constructor(world, scene, audio = null) {
    this.world = world;
    this.scene = scene;
    this.audio = audio;   // bots emit positional gunfire / footsteps / death
    this.bots  = [];
    this._usedTags = new Set();
    this.enabled = true;
  }

  // Survival owns a separate ZombieManager. Disabling this manager is a mode
  // invariant: it clears existing player-style bots and rejects late roster,
  // menu, or reconnect attempts to add them until the mode changes again.
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.clear();
  }

  // Spawn a fresh set of bots. noRespawn prevents auto-respawn (wave/elimination modes).
  // healthMult scales max HP (used by wave survival to ramp up difficulty).
  spawnAll(count = 8, noRespawn = false, healthMult = 1) {
    if (!this.enabled) { this.clear(); return; }
    for (const bot of this.bots) this.scene.remove(bot.mesh);
    this.bots = [];
    this._usedTags.clear();
    for (let i = 0; i < Math.min(8, count); i++) {
      this._spawnOne(noRespawn, healthMult, false);
    }
  }

  _spawnOne(noRespawn, healthMult, isHumanSlot) {
    if (!this.enabled || this.bots.length >= 8) return null;
    const point = this.world.safeSpawnPoint(this.bots);
    const bot   = new Bot(this.world, point);
    bot.audio       = this.audio;
    bot.noRespawn   = noRespawn;
    bot.maxHealth   = Math.round(100 * healthMult);
    bot.health      = bot.maxHealth;
    bot.isHumanSlot = isHumanSlot;
    bot.isBot       = true;   // every combatant here is a bot — labelled as one
    bot.displayName = randomBotName(this._usedTags);
    bot._chooseRespawnPoint = () => this.world.safeSpawnPoint([
      this._livePlayer,
      ...this.bots.filter((candidate) => candidate !== bot),
    ]);
    this.scene.add(bot.mesh);
    this.bots.push(bot);
    return bot;
  }

  // Add a single combatant to fill a server slot. `isHumanSlot` flags it as a
  // simulated remote player rather than a bot.
  addBot(noRespawn = false, healthMult = 1, isHumanSlot = false) {
    return this._spawnOne(noRespawn, healthMult, isHumanSlot);
  }

  // Remove a single combatant. Prefers a slot matching `preferHuman` so the
  // server sim can swap a bot out for a joining player (or vice-versa).
  removeOne(preferHuman = false) {
    if (!this.bots.length) return null;
    let idx = this.bots.findIndex((b) => b.isHumanSlot === preferHuman);
    if (idx === -1) idx = this.bots.length - 1;
    const [bot] = this.bots.splice(idx, 1);
    this.scene.remove(bot.mesh);
    if (bot.displayName) this._usedTags.delete(bot.displayName);
    return bot;
  }

  get count() { return this.bots.length; }

  // True when every bot in the current set is dead (useful for wave / elimination checks).
  allDead() {
    return this.bots.length > 0 && this.bots.every((b) => !b.alive);
  }

  update(dt, player, camera, onPlayerDamaged, world, allowBotCombat = true) {
    if (!this.enabled) return;
    this._livePlayer = player;
    for (const bot of this.bots) {
      const separation = botSeparationVector({
        x: bot.position.x,
        z: bot.position.z,
        id: bot.id,
        neighbors: this.bots,
      });
      if (bot._separationDir) {
        bot._separationDir.set(separation.x, 0, separation.z);
        bot._separationStrength = separation.strength;
      }
      // Commit to an opponent between perception scans. Selecting the nearest
      // body every frame made aim ping-pong between people and let an unseen
      // opponent behind a wall steal attention from a visible one.
      let target = bot._targetEntity;
      if (target?.isDead || target?.alive === false) target = null;
      const attacker = bot._retaliationTarget === 'player' ? player : bot._retaliationTarget;
      bot._retaliationTarget = null;
      if (attacker && !attacker.isDead && attacker.alive !== false && attacker !== target) {
        target = attacker;
        bot._targetScanT = .6;
        bot._losCache = false; bot._losT = 0; bot._coverPoint = null;
        bot._lastSeenPos?.copy(attacker.position);
        bot._lastSeenValid = true;
      }
      bot._targetScanT = Math.max(0, (bot._targetScanT || 0) - dt);
      if (!target || bot._targetScanT <= 0) {
        bot._targetScanT = .3 + (Math.abs(bot.id || 0) % 4) * .025;
        if (target && !bot._provoked && bot.canNotice && !bot.canNotice(target, world || this.world)) target = null;
        let best = target, bestDistance = target ? bot.position.distanceToSquared(target.position) * .55 : Infinity;
        for (const candidate of [player, ...this.bots]) {
          if (!candidate || candidate === bot || candidate === target || candidate.isDead || candidate.alive === false) continue;
          const distance = bot.position.distanceToSquared(candidate.position);
          if (distance >= bestDistance) continue;
          if (bot.canNotice && !bot.canNotice(candidate, world || this.world)) continue;
          best = candidate; bestDistance = distance;
        }
        if (best && best !== target) {
          bot._losCache = false; bot._losT = 0;
          bot._lastSeenValid = false; bot._coverPoint = null;
          bot._provoked = false; bot._encounterTime = 0;
        }
        target = best;
      }
      target ||= player;
      bot._targetEntity = target;
      const onTargetDamaged = (damage, from) => {
        if (!allowBotCombat) return;
        const wasDead = target.isDead || target.alive === false;
        if (target === player) onPlayerDamaged(damage, from, bot);
        else target.takeDamage(damage, bot);
        if (!wasDead && (target.isDead || target.alive === false)) {
          bot._botKills = (bot._botKills || 0) + 1;
          bot._targetEntity = null;
        }
      };

      bot.update(dt, target, camera, onTargetDamaged, world);
    }
  }

  getRaycastTargets() {
    return this.bots.filter((b) => b.alive).map((b) => b.mesh);
  }

  clear() {
    for (const bot of this.bots) this.scene.remove(bot.mesh);
    this.bots = [];
    this._usedTags.clear();
  }
}
