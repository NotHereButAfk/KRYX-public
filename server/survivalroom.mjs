import { SURVIVAL_WAVE_SECONDS, ZombieSpawnQueue, survivalWave, zombieForWave, zombieStats } from '../src/entities/ZombieRoster.js';
import { smoothBotAim } from '../src/entities/BotCombat.js';
import { AuthRoom, TICK_HZ } from "./authroom.mjs";
import { SurvivalBotAI } from "./survival-bot-ai.mjs";
import { SurvivalNavigation } from "./survival-navigation.mjs";
import {
  survivalBotConfig,
  loadSurvivalBotConfig,
} from "./survival-bot-config.mjs";
import { makeInput } from "../src/sim/MoveSim.js";
// Authoritative PvE reuses the production collision, weapon and damage simulation.
export class SurvivalRoom extends AuthRoom {
  constructor(arena, options = {}) {
    super(arena, { ...options, shieldsEnabled: true, targetPopulation: 0 });
    this.mode = "survival";
    this.botConfig = options.botConfig
      ? survivalBotConfig(options.botConfig)
      : loadSurvivalBotConfig();
    this.navigation = new SurvivalNavigation(this, this.botConfig);
    this.allyAI = new SurvivalBotAI(this, this.botConfig, this.navigation);
    this.waveState = "PRE_WAVE";
    this.wave = 0;
    this.enemyQueue = new ZombieSpawnQueue();
    this.waveTotal = 0;
    this.nextEnemyTick = 0;
    this.nextWaveTick = TICK_HZ * 15;
    this.matchDurationMs = 24 * 60 * 60 * 1000;
    this.matchStart = Date.now();
  }
  participants() {
    return [...this.players.values()].filter((p) => !p.survivalEnemy && !p.spectating);
  }
  enemies() {
    return [...this.players.values()].filter((p) => p.survivalEnemy);
  }
  get pendingEnemies() { return this.enemyQueue.pending; }
  opponents(a, b) {
    if (!a || !b || a.id === b.id) return false;
    if (a.survivalEnemy && b.survivalEnemy) return false;
    if (!a.survivalEnemy && !b.survivalEnemy)
      return !this.botConfig.survivalFriendlyBots;
    return true;
  }
  _provokeBot() {} // Survival perception never receives FFA's wall-penetrating last-seen hints.
  _allyName(used) {
    for (let suffix = 0; ; suffix++)
      for (const base of this.botConfig.names) {
        const name = base + (suffix || "");
        if (!used.has(name)) {
          used.add(name);
          return name;
        }
      }
  }
  _fillBotSlots() {
    this._rebalanceBots();
  }
  _rebalanceBots() {
    if (!this.botConfig) return;
    const humans = this.participants().filter((p) => !p.isBot);
    if (!humans.length) return;
    const desired = Math.min(
      this.botConfig.maximumBots,
      this.botConfig.desiredParticipants - humans.length,
    );
    const bots = this.participants().filter((p) => p.isBot);
    while (bots.length > desired) this._remove(bots.pop().id, false);
    while (bots.length < desired) {
      const used = new Set(this.participants().map((p) => p.name)),
        name = this._allyName(used);
      const id = this.addBot(name),
        p = this.players.get(id);
      p.survivalAlly = true;
      p.survivalWeapon =
        this.botConfig.weapons[id % this.botConfig.weapons.length];
      this._resetLifeInventory(p);
      p.damageDealt = 0;
      p.bossDamage = 0;
      p.wavesSurvived = 0;
      p.livesRemaining = this.botConfig.limitedLives;
      this.allyAI.reset(p);
      // Filling a vacated slot during combat must not manufacture an extra life.
      if (this.waveState === "ACTIVE" || this.waveState === "GAME_OVER") {
        p.alive = false;
        p.health = 0;
        p.deadUntil = Infinity;
        p.survivalAI.state = "DEAD";
      }
      bots.push(p);
    }
  }
  add(send, name, waitForReady = false) {
    const humans = this.participants().filter((p) => !p.isBot);
    if (humans.length >= this.botConfig.desiredParticipants) {
      send({ t: "kick", reason: "match full" });
      return null;
    }
    if (this.participants().length >= this.botConfig.desiredParticipants) {
      const enemies = this.enemies().filter((p) => p.alive);
      const danger = (p) =>
        Math.min(
          Infinity,
          ...enemies.map((e) =>
            Math.hypot(e.state.px - p.state.px, e.state.pz - p.state.pz),
          ),
        );
      const bots = this.participants()
        .filter((p) => p.isBot)
        .sort(
          (a, b) => Number(a.alive) - Number(b.alive) || danger(b) - danger(a),
        );
      if (bots[0]) this._remove(bots[0].id, false);
    }
    const id = super.add(send, name, waitForReady),
      p = this.players.get(id);
    if (p) {
      p.livesRemaining = this.botConfig.limitedLives;
      p.damageDealt = 0;
      p.bossDamage = 0;
      p.wavesSurvived = 0;
    }
      const used = new Set(this.participants().filter(q => !q.isBot).map(q => q.name));
      for (const bot of this.participants().filter(q => q.isBot)) {
        if (used.has(bot.name)) bot.name = this._allyName(used);
        else used.add(bot.name);
      }
    return id;
  }
  _rotateMatch() {
    return false;
  }
  // Count only ready, living human play, never lobby/loading/spectator time.
  // Persist the maximum periodically and on death/disconnect, not a sum of runs.
  _saveSurvivalTime(p, reset = false) {
    if (!p || p.isBot || p.survivalEnemy) return;
    const seconds = Math.floor((p.survivalAliveTicks || 0) / TICK_HZ);
    if (seconds > (p.survivalSavedSeconds || 0)) {
      this.achievements?.record(p.accountId, { bestSurvivalSeconds: seconds });
      this.tournaments?.recordResult(p.accountId,'longest_survival',seconds,Date.now()-seconds*1000);
      p.survivalSavedSeconds = seconds;
    }
    if (reset) p.survivalAliveTicks = p.survivalSavedSeconds = 0;
  }
  _trackSurvivalTime() {
    for (const p of this.players.values()) {
      if (p.isBot || p.survivalEnemy) continue;
      if (!p.alive || p.spectating || !this._canSimulate(p)) {
        this._saveSurvivalTime(p, true); continue;
      }
      if (this.waveState !== 'ACTIVE') continue;
      p.survivalAliveTicks = (p.survivalAliveTicks || 0) + 1;
      if (p.survivalAliveTicks % (TICK_HZ * 15) === 0) this._saveSurvivalTime(p);
    }
  }
  remove(id) {
    this._saveSurvivalTime(this.players.get(id), true);
    this._remove(id, false);
    if (!this.participants().some((p) => !p.isBot)) {
      for (const p of [...this.players.values()]) this._remove(p.id, false);
      this.economy
        ?.finish()
        .catch((e) => console.error("[survival close]", e.message));
      this.wave = 0;
      this.enemyQueue.clear();
      this.waveTotal = 0;
      this.waveState = "PRE_WAVE";
      this.nextWaveTick = this.tick + TICK_HZ * 15;
    } else this._rebalanceBots();
  }
  _driveBot(p) {
    if (p.survivalAlly) return this.allyAI.update(p);
    if (this.waveState === "GAME_OVER")
      return { seq: p.lastInputSeq + 1, inp: makeInput({}), wid: "sword" };
    // Zombies always know living players' positions, regardless of range or
    // sight. Visibility still controls attacks, and navigation routes around cover.
    const survivors = this.participants().filter(t => t.alive && this._canSimulate(t));
    const humans = survivors.filter(t => !t.isBot);
    const targets = humans.length ? humans : survivors;
    targets.sort(
      (a, b) =>
        Math.hypot(a.state.px - p.state.px, a.state.py - p.state.py, a.state.pz - p.state.pz) -
        Math.hypot(b.state.px - p.state.px, b.state.py - p.state.py, b.state.pz - p.state.pz),
    );
    const t = targets[0];
    p.attackingId = t?.id ?? null;
    if (!t)
      return { seq: p.lastInputSeq + 1, inp: makeInput({}), wid: "sword" };
    const pos = [p.state.px,p.state.py,p.state.pz];
    const goal = [t.state.px,t.state.py,t.state.pz];
    const dx = goal[0]-pos[0], dz=goal[2]-pos[2], distance=Math.hypot(dx,dz);
    const gunner = p.enemyType === 'gunner';
    const desiredAim = Math.atan2(-dx,-dz);
    const dy = goal[1]-pos[1];
    const rayLength = Math.hypot(dx,dy,dz) || .001;
    const visible = this.arena.raycast(pos[0],pos[1]+1.2,pos[2],dx/rayLength,dy/rayLength,dz/rayLength,rayLength) >= rayLength-.25;
    p.survivalAI ||= { nextPath:0, path:[], goal, pathAt:0 };
    let mx=0,mz=0,yaw=desiredAim;
    if (distance > 1.4 || !visible) {
      // Chest/floor corridor tests are expensive on imported map octrees.
      // Recheck at 4Hz; per-tick capsule collision and ledge guards remain active.
      if (this.tick >= (p._enemyLaneAt || 0)) {
        const lane=this.navigation.lane(pos,goal);
        p._enemyDirectLane=!!lane && Math.abs(lane[1]-goal[1])<.7;
        // Offset corridor scans by zombie ID so a whole wave does not perform
        // its expensive map queries on the same server tick.
        p._enemyLaneAt=this.tick+1+((p.id-this.tick-1)%5+5)%5;
      }
      const direction=p._enemyDirectLane ? [dx,dz] : this.navigation.steer(p,goal);
      if (Math.hypot(...direction)>.1) {
        const desired=Math.atan2(-direction[0],-direction[1]);
        yaw=smoothBotAim(p._lastYaw ?? desired,desired,10,1/TICK_HZ);
        // Keep pursuing through gentle turns instead of alternating stop/run.
        mz=Math.cos(yaw-desired)>.25 ? 1 : 0;
      }
    }
    if (visible && this.tick >= (p.attackAt || 0)) {
      if (distance < 1.9 && Math.abs(dy)<2) {
        this._damage(t,p,p.enemyDamage || 18,false);
        p._swingStart=this.tick;
        p._swingUntil=this.tick+6;
        p.attackAt=this.tick+TICK_HZ;
      } else if (gunner && distance<28) {
        const ammo=this._weaponState(p,p.wid);
        if (ammo.mag===0) this._startReload(p,p.wid);
        else if (p.reloadUntil<=this.tick) {
          const random=seed=>this._rand(p.id*227+this.tick*seed)*2-1;
          this.onFire(p.id,{seq:p.lastFireSeq+1,wid:p.wid,yaw:desiredAim+random(19)*.045,
            pitch:Math.atan2(dy,Math.max(.01,distance))+random(23)*.035,viewTick:this.tick});
          p.attackAt=this.tick+5;
        }
        yaw=desiredAim;
      }
    }
    // Ground routing cannot find a floor while a jumping capsule is above it.
    // Preserve takeoff travel until landing instead of braking in mid-air.
    if (!p.state.onGround) { yaw=p._lastYaw ?? yaw; mz=1; }
    const move = p.state.onGround
      ? this._botMoveInput(p,{mx,mz,yaw,sprint:true})
      : makeInput({mx,mz,yaw,sprint:true});
    // Use the same jump impulse/gravity as players. Jump to reach a higher
    // opponent or a low obstruction; never bounce repeatedly down slopes.
    if (p.state.onGround && mz && this.tick >= (p._enemyJumpAt || 0)) {
      const fx=-Math.sin(yaw), fz=-Math.cos(yaw);
      const blocked=this.arena.raycast(pos[0],pos[1]+.65,pos[2],fx,0,fz,1.4)<1.2;
      const overhead=this.arena.raycast(pos[0],pos[1]+1.8,pos[2],0,1,0,2)>1.8;
      if (overhead && (dy>.8 && distance<8 || blocked) && move.mz) {
        move.jumpJust=1;
        p._enemyJumpAt=this.tick+TICK_HZ*1.5;
      }
    }
    return {seq:p.lastInputSeq+1,inp:move,wid:p.wid,aiming:gunner&&visible};
  }
  _damage(target, shooter, damage, head, wid = null, source = null) {
    if (!this._canSimulate(target)) return;
    if (shooter?.survivalEnemy && shooter.enemyType === "gunner") damage = shooter.enemyDamage;
    if (this.waveState === "GAME_OVER" || (shooter !== target && !this.opponents(target, shooter)))
      return;
    if (
      target.alive &&
      this.tick >= (target.invulnerableUntil || 0) &&
      shooter && shooter !== target
    ) {
      const actual = Math.min(
        damage,
        Math.max(0, target.health) + Math.max(0, target.shield),
      );
      shooter.damageDealt = (shooter.damageDealt || 0) + actual;
      if (target.bossInstance)
        shooter.bossDamage = (shooter.bossDamage || 0) + actual;
      target.attackedBy = shooter.id;
    }
    super._damage(target, shooter, damage, head, wid, source);
  }
  _kill(target, shooter, head = false, wid = null, source = null) {
    const wasAlive = target.alive,
      result = super._kill(target, shooter, head, wid, source);
    if (!wasAlive) return result;
    this._saveSurvivalTime(target, true);
    target.deadUntil = Infinity;
    if (target.survivalAlly) {
      target.survivalAI.state = "DEAD";
      target.survivalAI.target = null;
      target.fireReq = null;
    }
    if (!target.survivalEnemy && target.livesRemaining !== null)
      target.livesRemaining = Math.max(0, (target.livesRemaining ?? 1) - 1);
    if (target.survivalEnemy) {
      if (target.bossInstance && shooter) {
        const boss = this.economy?.match.bosses[target.bossInstance];
        if (boss && !boss.defeated) {
          boss.defeated = true;
          if (shooter.isBot) return result;
          const before = Number(this.economy.preview(shooter.id)?.finalE || 0);
          this.economy.direct(
            shooter.id,
            "BOSS_REWARD",
            boss.directE,
            boss.instanceId,
          );
          const after = Number(this.economy.preview(shooter.id)?.finalE || 0);
          shooter.send({
            t: "earning",
            kind: "boss",
            amount: (after - before).toFixed(4),
          });
        }
      }
    }
    return result;
  }
  _fillEnemySlots(initial = false) {
    if (!this.pendingEnemies || (!initial && this.tick < this.nextEnemyTick)) return;
    const plan = survivalWave(this.wave);
    const slots = plan.maxActive - this.enemies().filter(p => p.alive).length;
    const count = Math.min(slots, this.pendingEnemies, initial ? plan.maxActive : 2);
    for (let i = 0; i < count; i++) {
      const entry = this.enemyQueue.take(), boss = entry.boss;
      const design = boss ? { id: 17, type: 'walker', name: boss.id } : zombieForWave(entry.wave, entry.index);
      const stats = zombieStats(entry.wave, design.type);
      const p = this.players.get(this.addBot(design.name));
      p.survivalEnemy = true;
      p.spawnWave = entry.wave;
      p.zombieVariant = design.id;
      p.enemyType = design.type;
      p.maxHealth = p.health = boss ? boss.health : stats.health;
      p.enemyDamage = boss ? boss.damage : stats.damage;
      p.enemySpeed = stats.speed;
      p.wid = p.mainWid = stats.weapon;
      this._resetLifeInventory(p);
      p.wid = stats.weapon;
      p.shield = p.maxShield = 0;
      if (boss) {
        p.bossInstance = boss.instanceId;
        if (boss.announce) for (const h of this.participants().filter(t => !t.isBot))
          h.send({ t: 'earning', kind: 'boss_spawn', description: 'RARE BOSS SPAWNED' });
      }
    }
    if (count > 0) this.nextEnemyTick = this.tick + Math.ceil(plan.spawnInterval * TICK_HZ);
  }
  update() {
    if (this._roundWaiting) {
      if (Number.isFinite(this.nextWaveTick)) this.nextWaveTick++;
      super.update();
      return;
    }
    this._trackSurvivalTime();
    const humans = this.participants().filter((p) => !p.isBot);
    for (const p of this.enemies()) if (!p.alive) this._remove(p.id, false);
    const survivors = this.participants().filter(
      (p) => p.alive && (!p.isBot || this.botConfig.botsCountAsAlive),
    );
    if (humans.length && !survivors.length && this.waveState !== "GAME_OVER") {
      this.waveState = "GAME_OVER";
      this.enemyQueue.clear();
      this.gameOverUntil = this.tick + TICK_HZ * this.botConfig.gameOverSeconds;
      for (const p of this.players.values()) {
        p.fireReq = null;
        p.queue = [];
        p._firingTicks = 0;
      }
    }
    if (this.waveState === "GAME_OVER") {
      for (const p of this.players.values()) {
        p.fireReq = null;
        p.queue = [];
      }
      if (this.tick >= this.gameOverUntil) {
        for (const p of this.enemies()) this._remove(p.id, false);
        const elapsed = Date.now() - this.matchStart;
        this.matchDurationMs = Math.max(1, elapsed);
        super._rotateMatch();
        this.matchDurationMs = 24 * 60 * 60 * 1000;
        const usedNames = new Set(
          this.participants()
            .filter((p) => !p.isBot)
            .map((p) => p.name),
        );
        for (const p of this.participants()) {
          if (p.isBot) p.name = this._allyName(usedNames);
          this._saveSurvivalTime(p, true);
          p.damageDealt = 0;
          p.bossDamage = 0;
          p.wavesSurvived = 0;
          p.livesRemaining = this.botConfig.limitedLives;
          if (p.isBot) this.allyAI.reset(p);
        }
        this.wave = 0;
        this.enemyQueue.clear();
        this.waveTotal = 0;
        this.waveState = "PRE_WAVE";
        this.nextWaveTick = this.tick + TICK_HZ * 15;
      }
    } else if (
      humans.length &&
      this.tick >= this.nextWaveTick
    ) {
      if (this.wave > 0) {
        for (const p of this.participants()) {
          if (p.alive) {p.wavesSurvived = (p.wavesSurvived || 0) + 1;this.achievements?.record(p.accountId,{waves:1});}
          else if (this.botConfig.respawnRule === 'wave' &&
            (p.livesRemaining === null || p.livesRemaining > 0)) p.deadUntil = this.tick + 1;
        }
      }
      this.waveState = "ACTIVE";
      this.wave++;
      if (this.economy?.ready) this.economy.match.wave = this.wave;
      this.waveTotal = survivalWave(this.wave).total;
      this.enemyQueue.add(this.wave, this.waveTotal);
      const boss = this.economy?.ready
        ? this.economy.spawnBoss(this.wave)
        : null;
      if (boss) {
        this.waveTotal++;
        this.enemyQueue.add(this.wave, 1, boss);
      }
      this._fillEnemySlots(true);
      this.nextWaveTick = this.tick + TICK_HZ * SURVIVAL_WAVE_SECONDS;
    }
    if (humans.length && this.waveState === 'ACTIVE') this._fillEnemySlots();
    super.update();
  }
}
