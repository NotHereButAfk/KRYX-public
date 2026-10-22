// Simulates an always-on, 24/7 game server with a fixed capacity.
//
// The lobby is ALWAYS full: the local player takes one slot and the rest are
// filled with bots, so the arena is never empty even with nobody else online.
// Remote players are simulated joining and leaving over time — when one joins,
// a bot is removed to make room; when one leaves, a bot fills the empty slot.
// Total combatants therefore stay pinned at MAX_PLAYERS at all times.

import { countLocalMatchPlayers } from './Population.js';

const MIN_JOIN_GAP = 9;    // seconds between roster changes (min)
const MAX_JOIN_GAP = 26;   // seconds between roster changes (max)

export class ServerSim {
  constructor({ maxPlayers = 8, botManager, hud }) {
    this.maxPlayers = maxPlayers;
    this.botManager = botManager;
    this.hud        = hud;
    this.active     = false;
    this._timer     = 0;
    this._noRespawn = false;
    this._healthMult = 1;
  }

  // Begin the live-roster simulation. The remaining slots are already spawned
  // as bots by the caller; we flag a few of them as already-connected remote
  // players so the 24/7 server feels populated the moment you drop in.
  start(noRespawn = false, healthMult = 1) {
    this.active      = true;
    this._noRespawn  = noRespawn;
    this._healthMult = healthMult;
    this._timer      = this._nextGap();

    // Seed 2–4 simulated players (leaving at least one bot in the lobby).
    const botSlots = this.botManager.count;
    const seed = Math.min(botSlots - 1, 2 + Math.floor(Math.random() * 3));
    const candidates = this.botManager.bots.filter((b) => !b.isHumanSlot);
    for (let i = 0; i < seed && i < candidates.length; i++) {
      candidates[i].isHumanSlot = true;
    }
    this._pushCount();
  }

  stop() {
    this.active = false;
  }

  _nextGap() {
    return MIN_JOIN_GAP + Math.random() * (MAX_JOIN_GAP - MIN_JOIN_GAP);
  }

  // Slots filled by simulated remote players (human-flagged bots).
  get _humanSlots() {
    return this.botManager.bots.filter((b) => b.isHumanSlot).length;
  }

  // Every occupied combat slot is a player. Bots stay honestly labelled as
  // bots elsewhere, but still count toward the match population.
  get playersOnline() {
    return countLocalMatchPlayers(this.botManager.bots);
  }

  update(dt) {
    // Roster churn disabled. Once you're in the match the lobby stays put — the
    // seeded roster from start() holds steady, so the player count is stable and
    // bots no longer leave/rejoin (which despawned + respawned them mid-fight,
    // teleporting bots around for no apparent reason).
    if (!this.active) return;
  }

  // A remote player connects → kick a bot to free its slot, add the player.
  _playerJoins() {
    this.botManager.removeOne(false); // remove a bot slot
    const player = this.botManager.addBot(this._noRespawn, this._healthMult, true);
    if (this.hud && player) {
      this.hud.showJoinNotification?.(`▶  ${player.displayName}  joined the match`);
      this.hud.addKillFeed(`▶ ${player.displayName} joined`);
    }
  }

  // A remote player disconnects → backfill the empty slot with a bot.
  _playerLeaves() {
    const left = this.botManager.removeOne(true);     // remove a human slot
    this.botManager.addBot(this._noRespawn, this._healthMult, false);
    if (this.hud && left) {
      this.hud.showJoinNotification?.(`◀  ${left.displayName}  left the match`, true);
      this.hud.addKillFeed(`◀ ${left.displayName} left`);
    }
  }

  _pushCount() {
    this.hud?.setServerPop?.(this.playersOnline, this.maxPlayers);
  }
}
