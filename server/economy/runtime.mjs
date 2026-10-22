import { randomUUID, randomInt } from "node:crypto";
import { calculateEarnings, activeEvents } from "./calculate.mjs";
import { DEFAULT_ECONOMY } from "./config.mjs";
import { units as u, decimal as d } from "./money.mjs";
export class EconomyRuntime {
  constructor(
    store,
    {
      serverId = "public-1",
      mode = "deathmatch",
      privateMatch = false,
      clock = Date.now,
    } = {},
  ) {
    this.store = store;
    this.serverId = serverId;
    this.mode = mode;
    this.privateMatch = privateMatch;
    this.clock = clock;
    this.previewCache = new WeakMap();
    this.config = structuredClone(DEFAULT_ECONOMY);
    this.connections = new Map();
    this.profiles = new Map();
    this.results = new Map();
    this.queue = Promise.resolve();
    this.ready = false;
    this.failed = false;
  }
  async init() {
    await this.store.init();
    // One process per stable server ID. Advisory lock is held on a dedicated connection.
    this.lease = await this.store.pool.connect();
    const lock = await this.lease.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`e:${this.serverId}`],
    );
    if (!lock.rows[0].locked) {
      this.lease.release();
      this.lease = null;
      throw new Error("Economy server ID already active");
    }
    this.lease.on?.("error", () => {
      this.failed = true;
      this.ready = false;
    });
    await this.store.recover(this.serverId);
    this.config = (await this.store.config()).config;
    this.begin();
    this.ready = true;
  }
  capture(match = this.match) {
    match.journalRevision = (match.journalRevision || 0) + 1;
    match.checkpointAt = this.clock();
    return structuredClone(match);
  }
  begin() {
    this.match = {
      id: randomUUID(),
      serverId: this.serverId,
      mode: this.mode,
      private: this.privateMatch,
      startedAt: this.clock(),
      config: structuredClone(this.config),
      players: {},
      bosses: {},
      wave: 1,
    };
    this.lastCheckpoint = this.clock();
    const initial = this.capture();
    this.enqueue(() => this.store.checkpoint(initial));
  }
  enqueue(fn) {
    this.queue = this.queue
      .then(async () => {
        let last;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await fn();
          } catch (e) {
            last = e;
            if (attempt < 2)
              await new Promise((resolve) =>
                setTimeout(resolve, 250 * (attempt + 1)),
              );
          }
        }
        throw last;
      })
      .catch((e) => {
        this.failed = true;
        console.error("[economy]", e.message);
      });
    return this.queue;
  }
  async join(id, identity, send) {
    if (!this.ready || this.failed) return false;
    const joinedMatch = this.match;
    const key = identity?.id ? String(identity.id) : `guest:${id}`;
    if ([...this.connections.values()].some((c) => c.key === key)) return false;
    let p = this.match.players[key];
    if (!p) {
      p = {
        userId: identity?.id || null,
        sessionId: identity?.sessionId || null,
        joinedAt: this.clock(),
        lastSeen: this.clock(),
        lastActivity: 0,
        activeMs: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        boosters: [],
        actions: [],
        direct: [],
        victims: {},
        killTimes: [],
        flags: [],
        network: identity?.network || null,
      };
      this.match.players[key] = p;
      if (p.userId) {
        await this.store.checkpoint(this.capture());
        p.items = await this.store.earningItems(p.userId, this.match.config);
        p.boosters = await this.store.reserveBoosters(
          p.userId,
          this.match,
          this.match.config,
        );
      }
    }
    if (p.userId) {
      p.sessionId = identity.sessionId;
      this.profiles.set(key, await this.store.profile(p.userId, p.sessionId));
    }
    if (joinedMatch !== this.match) return this.join(id, identity, send);
    p.lastSeen = this.clock();
    this.connections.set(id, { key, send, identity });
    return true;
  }
  participant(id) {
    const c = this.connections.get(id);
    return c ? this.match.players[c.key] : null;
  }
  leave(id) {
    if (!this.match) return;
    const p = this.participant(id);
    if (p) p.lastSeen = this.clock();
    const key = this.connections.get(id)?.key;
    this.connections.delete(id);
    if (key) this.profiles.delete(key);
    const snapshot = this.capture();
    this.enqueue(() => this.store.checkpoint(snapshot));
  }
  activity(id, kind, elapsedMs = 0) {
    const p = this.participant(id);
    if (!p) return;
    const now = this.clock();
    p.lastSeen = now;
    if (kind) {
      p.lastActivity = now;
      p.activeMs += Math.min(1000, Math.max(0, elapsedMs));
    }
  }
  activePlayers() {
    const now = this.clock();
    return [...this.connections.keys()]
      .map((id) => this.participant(id))
      .filter(
        (p) =>
          p &&
          p.lastActivity > 0 &&
          now - p.lastActivity <= this.match.config.afkSeconds * 1000,
      ).length;
  }
  flag(p, reason, meta = {}) {
    if (p.flags.includes(reason)) return;
    p.flags.push(reason);
    const matchId = this.match.id;
    this.enqueue(() => this.store.flag(matchId, p.userId, reason, meta));
  }
  allowed(p) {
    const c = this.match.config;
    return (
      !p.loading &&
      !this.failed &&
      this.config.enabled &&
      c.enabled &&
      !!c.modes[this.mode]?.earningEnabled &&
      (!this.privateMatch || c.privateEarning) &&
      (!!p.userId) &&
      this.clock() - p.lastActivity <= c.afkSeconds * 1000 &&
      this.activePlayers() >= c.modes[this.mode].minimumPlayers
    );
  }
  award(
    id,
    kind,
    { score, wave = this.match?.wave || 1, victim = null, victimIsBot = false, victimStreak = 0, earnsE = true } = {},
  ) {
    const p = this.participant(id),
      c = this.match?.config || this.config,
      rule = c.actions[kind];
    if (!p || !rule) return { score: score ?? rule?.score ?? 0, e: "0.0000" };
    const normalScore = score ?? rule.score;
    if (
      !Number.isSafeInteger(normalScore) ||
      normalScore < 0 ||
      normalScore > 1000000
    )
      throw new Error("Invalid server score");
    p.score += normalScore;
    let allowed = earnsE && this.allowed(p),
      factor = "1";
    const now = this.clock();
    if (victimIsBot && !c.botEarning && this.mode !== "survival")
      allowed = false;
    if (victim) {
      const vp = this.participant(victim);
      const key = vp?.userId ? `user:${vp.userId}` : `entity:${victim}`;
      const times = (p.victims[key] || []).filter(
        (t) => now - t < c.repeatedVictim.windowSeconds * 1000,
      );
      times.push(now);
      p.victims[key] = times;
      factor =
        times.length <= c.repeatedVictim.fullKills
          ? "1"
          : times.length <= c.repeatedVictim.reducedKills
            ? c.repeatedVictim.reducedMultiplier
            : "0";
      if (factor !== "1") this.flag(p, "repeated_victim", { victim: key });
      if (vp?.network && vp.network === p.network) {
        this.flag(p, "shared_network");
        if (!c.sameNetworkEarning) allowed = false;
      }
    }
    if (["kill", "headshot"].includes(kind)) {
      p.kills++;
      p.killTimes = p.killTimes.filter((t) => now - t < 60000);
      p.killTimes.push(now);
      if (p.killTimes.length > c.maximumKillsPerMinute) {
        allowed = false;
        this.flag(p, "kill_rate");
      }
    }
    if (kind === "assist") p.assists++;
    // Limit journal size independently of game score to resist unbounded memory use.
    if (p.actions.length >= 20000) {
      this.flag(p, "action_limit");
      return { score: normalScore, e: "0.0000" };
    }
    const before = u(this.preview(id).finalE);
    let killBaseK;
    const kr = c.killRewards;
    if (kr?.enabled && ["kill", "headshot"].includes(kind)) {
      const low = u(victimIsBot ? kr.botMin : kr.playerMin);
      const high = u(victimIsBot ? kr.botMax : kr.playerMax);
      const streakBonus = !victimIsBot && this.mode === "deathmatch"
        ? BigInt(Math.max(0, Math.floor(victimStreak) - kr.streakThreshold)) * u(kr.streakBonus) : 0n;
      killBaseK = d(low + BigInt(randomInt(Number(high - low) + 1)) + streakBonus);
    }
    // Guest points use the same reward roll, without creating currency or a ledger entry.
    let awardedScore = normalScore;
    if (!p.userId && rule.earnsE) {
      const equivalent = calculateEarnings(this.match, {
        ...p, userId: 'score-preview', items: [], boosters: [], direct: [],
        actions: [{kind, score: normalScore, wave, at: now, allowed: true,
          farmingMultiplier: factor, ...(killBaseK !== undefined ? {killBaseK} : {})}],
      }, {...c, DAILY_E_CAP: null, MAX_E_PER_MATCH: null, maximumEPerMinute: null,
        modes: {...c.modes, [this.mode]: {...c.modes[this.mode], maxEPerMatch: null}}}, {now});
      awardedScore = Math.round(Number(equivalent.finalE) * 100);
      p.score += awardedScore - normalScore;
    }
    p.actions.push({
      ...(killBaseK !== undefined ? { killBaseK } : {}),
      kind,
      score: normalScore,
      wave,
      at: now,
      allowed,
      farmingMultiplier: factor,
    });
    this.previewCache.delete(p);
    if (allowed && rule.earnsE && factor === "1")
      for (const event of activeEvents(c, this.mode, now)) {
        if (
          event.directE != null &&
          event.directDropChance != null &&
          randomInt(1000000) < Number(event.directDropChance) * 1000000
        )
          this.direct(
            id,
            "EVENT_REWARD",
            event.directE,
            `event:${event.id}:${p.actions.length}`,
          );
      }
    return { score: awardedScore, guest: !p.userId, e: d(u(this.preview(id).finalE) - before) };
  }
  direct(id, type, amount, source) {
    const p = this.participant(id);
    if (!p || p.direct.some((r) => r.source === source)) return;
    p.direct.push({
      type,
      amount,
      source,
      allowed: this.allowed(p),
      at: this.clock(),
    });
    this.previewCache.delete(p);
  }
  preview(id) {
    const c = this.connections.get(id),
      p = this.participant(id);
    if (!p) return null;
    const profile = this.profiles.get(c.key) || {
      balance: "0.0000",
      dailyE: "0.0000",
      sessionE: "0.0000",
    };
    const now = this.clock(),
      stamp = `${Math.floor(now / 1000)}:${profile.dailyE}`;
    let cached = this.previewCache.get(p);
    if (cached?.stamp !== stamp) {
      cached = {
        stamp,
        value: calculateEarnings(this.match, p, this.match.config, {
          dailyEarned: profile.dailyE,
          now,
        }),
      };
      this.previewCache.set(p, cached);
    }
    return {
      ...cached.value,
      score: p.score,
      ...profile,
      matchId: this.match.id,
      pending: true,
      guest: !p.userId,
      ePer100Score: this.match.config.E_PER_100_SCORE,
      ...(this.failed ? { reason: "K temporarily unavailable" } : {}),
      lastSummary: this.results.get(c.key) || null,
    };
  }
  tick() {
    if (!this.ready || this.failed) return;
    const now = this.clock();
    for (const id of this.connections.keys()) this.activity(id, false);
    if (now - this.lastCheckpoint >= 5000) {
      this.lastCheckpoint = now;
      const state = this.capture();
      this.enqueue(async () => {
        await this.store.checkpoint(state);
        this.config = (await this.store.config()).config;
        for (const [id, c] of this.connections) {
          const p = this.participant(id);
          if (p?.userId)
            this.profiles.set(
              c.key,
              await this.store.profile(p.userId, p.sessionId),
            );
        }
      });
    }
  }
  async finish(winnerIds = []) {
    if (!this.ready) return;
    const c = this.match.config;
    for (const id of winnerIds) {
      const p = this.participant(id);
      if (!p) continue;
      let amount = c.modes[this.mode]?.winE || "0";
      for (const e of activeEvents(c, this.mode, this.clock()))
        if (e.winE != null) amount = e.winE;
      this.direct(id, "WIN_REWARD", amount, "win");
    }
    this.match.closedAt = this.clock();
    const closed = this.capture();
    const connections = [...this.connections];
    this.begin();
    const nextMatch = this.match;
    for (const [id, conn] of connections) {
      const old = closed.players[conn.key];
      nextMatch.players[conn.key] = {
        ...old,
        joinedAt: this.clock(),
        lastSeen: this.clock(),
        lastActivity: 0,
        activeMs: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        actions: [],
        direct: [],
        killTimes: [],
        flags: [],
        loading: true,
      };
    }
    await this.enqueue(async () => {
      await this.store.checkpoint(closed);
      for (const [key, p] of Object.entries(closed.players)) {
        if (p.userId) {
          const summary = await this.store.finalize(closed, p.userId);
          this.results.set(key, summary);
          if (this.results.size > 1000)
            this.results.delete(this.results.keys().next().value);
        }
      }
    });
    await this.enqueue(async () => {
      await this.store.checkpoint(this.capture(nextMatch));
      for (const [id, conn] of connections) {
        const p = nextMatch.players[conn.key];
        if (p.userId) {
          p.items = await this.store.earningItems(p.userId, nextMatch.config);
          p.boosters = await this.store.reserveBoosters(
            p.userId,
            nextMatch,
            nextMatch.config,
          );
          this.profiles.set(
            conn.key,
            await this.store.profile(p.userId, p.sessionId),
          );
        }
        p.loading = false;
      }
    });
  }
  // Only simulation code can call these methods. No network message routes to them.
  objective(id, kind = "objective") {
    this.activity(id, true, 50);
    return this.award(id, kind);
  }
  spawnBoss(wave, random = () => randomInt(1000000) / 1000000) {
    this.match.wave = wave;
    const c = this.match.config;
    const eventBosses = new Set(
      activeEvents(c, this.mode, this.clock()).flatMap((e) => e.bossIds || []),
    );
    const found = c.bosses.find(
      (b) =>
        (b.enabled || eventBosses.has(b.id)) &&
        wave >= b.minimumWave &&
        b.modes.includes(this.mode) &&
        random() < Number(b.spawnChance),
    );
    if (!found) return null;
    const entity = {
      ...structuredClone(found),
      instanceId: randomUUID(),
      remainingHealth: found.health,
      defeated: false,
    };
    this.match.bosses[entity.instanceId] = entity;
    return entity;
  }
  damageBoss(id, instanceId, damage) {
    const boss = this.match.bosses[instanceId];
    if (!boss || boss.defeated || !Number.isFinite(damage) || damage <= 0)
      return null;
    boss.remainingHealth = Math.max(0, boss.remainingHealth - damage);
    if (boss.remainingHealth) return null;
    boss.defeated = true;
    this.activity(id, true, 50);
    const reward = this.award(id, "boss", { score: boss.scoreReward });
    this.direct(id, "BOSS_REWARD", boss.directE, instanceId);
    return { ...reward, directE: boss.directE };
  }
  async close() {
    if (this.ready) {
      await this.finish();
      await this.queue;
      this.ready = false;
    }
    if (this.lease) {
      await this.lease.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `e:${this.serverId}`,
      ]);
      this.lease.release();
    }
  }
}
