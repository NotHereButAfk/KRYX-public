import { makeInput, createState } from "../src/sim/MoveSim.js";
import { smoothBotAim, isInsideBotFov } from "../src/entities/BotCombat.js";
export const SURVIVAL_STATES = [
  "SPAWN",
  "ROAM",
  "SEARCH",
  "ENGAGE",
  "CHASE",
  "RETREAT",
  "REGROUP",
  "INTERMISSION",
  "DEAD",
];
const position = (p) => [p.state.px, p.state.py, p.state.pz];
const distance = (a, b) =>
  Math.hypot(a.state.px - b.state.px, a.state.pz - b.state.pz);
export function calculateTargetPriority(bot, enemy, participants, config) {
  const d = distance(bot, enemy);
  let score = Math.max(0, 30 - d * 0.5) + (enemy.bossInstance ? 30 : 0);
  if (enemy.attackingId === bot.id) score += 40;
  const attacked = participants.find(
    (p) => p.id === enemy.attackingId && !p.isBot && p.alive,
  );
  if (attacked && distance(bot, attacked) < config.detectionRange * 0.6)
    score += enemy.bossInstance ? 50 : 25;
  if (enemy.enemyType === "fast" && d < 10) score += 30;
  if (enemy.enemyType === "ranged") score += 20;
  if (enemy.health < 40 && d < 20) score += 15;
  if (d < 5) score += 25;
  return score + (bot.id % 7) * ((enemy.id % 3) - 1); // small stable preferences split squad focus
}
export class SurvivalBotAI {
  constructor(room, config, navigation) {
    this.room = room;
    this.config = config;
    this.nav = navigation;
  }
  reset(p) {
    if (p.survivalWeapon) {
      p.wid = p.survivalWeapon;
      p.matchWeapons.add(p.wid);
      const w = this.room.weaponDefinition(p.wid);
      p.ammo[p.wid] = { mag: w.mag, reserve: w.reserve };
      p.mag = w.mag;
    }
    p.survivalAI = {
      state: "SPAWN",
      target: null,
      lastSeen: null,
      seenAt: -Infinity,
      nextScan: this.room.tick / 20 + (p.id % 6) * 0.05,
      switchAt: 0,
      reactAt: 0,
      nextPath: 0,
      path: [],
      goal: position(p),
      pathAt: 0,
      yaw: p._lastYaw || 0,
      pitch: 0,
      strafe: p.id % 2 ? 1 : -1,
      nextStrafe: 0,
      burstUntil: 0,
      pauseUntil: 0,
      patrol: null,
      patrolUntil: 0,
      lastPosition: position(p),
      progressAt: this.room.tick / 20,
      stuckSince: null,
      ignored: new Map(),
      threat: 0,
      recoveries: 0,
      lastSafe: position(p),
      scanOffset: 0,
    };
  }
  visible(p, e, range, fov = true) {
    if (
      !e?.alive ||
      !this.room.opponents(p, e) ||
      this.room.tick < (e.invulnerableUntil || 0)
    )
      return false;
    const dx = e.state.px - p.state.px,
      dz = e.state.pz - p.state.pz,
      dy = e.state.py - p.state.py,
      dist = Math.hypot(dx, dy, dz);
    if (
      dist > range ||
      (fov &&
        !isInsideBotFov(p.survivalAI.yaw, dx, dz, this.config.fieldOfView))
    )
      return false;
    return (
      this.room.arena.raycast(
        p.state.px,
        p.state.py + 1.2,
        p.state.pz,
        dx / (dist || 1),
        dy / (dist || 1),
        dz / (dist || 1),
        dist,
      ) >=
        dist - 0.15 &&
      !this.room._raySmoked(
        p.state.px,
        p.state.py + 1.2,
        p.state.pz,
        dx / (dist || 1),
        dy / (dist || 1),
        dz / (dist || 1),
        dist,
      )
    );
  }
  update(p) {
    if (!p.survivalAI) this.reset(p);
    const a = p.survivalAI,
      c = this.config,
      r = this.room,
      now = r.tick / 20,
      rand = () =>
        r._rand(
          p.id * 313 +
            r.tick * 17 +
            (a.randomCounter = (a.randomCounter || 0) + 1),
        );
    const idle = () => ({
      seq: ++p.lastInputSeq,
      inp: makeInput({ yaw: a.yaw, pitch: a.pitch }),
      wid: p.wid,
    });
    if (!p.alive || r.waveState === "GAME_OVER") {
      a.state = p.alive ? "INTERMISSION" : "DEAD";
      a.target = null;
      p.fireReq = null;
      return idle();
    }
    const skill = { easy: 0.8, normal: 1, hard: 1.2 }[c.difficulty],
      scale = c.waveScaling
        ? Math.min(c.maximumWaveImprovement, r.wave * 0.003)
        : 0;
    const range =
        c.detectionRange * skill * (r.enemies().length <= 3 ? 1.2 : 1),
      reaction = (c.reactionDelay / skill) * (1 - scale);
    const enemies = r.enemies().filter((e) => e.alive),
      participants = r.participants();
    let target = r.players.get(a.target);
    if (target && !target.alive) {
      a.target = null;
      target = null;
      a.lastSeen = null;
    }
    if (now >= a.nextScan && r.waveState === "ACTIVE") {
      a.nextScan = now + c.targetScanInterval;
      for (const [id, until] of a.ignored)
        if (now >= until) a.ignored.delete(id);
      const candidates = enemies.filter(
        (e) => distance(p, e) <= range && !a.ignored.has(e.id),
      );
      candidates.sort(
        (x, y) =>
          calculateTargetPriority(p, y, participants, c) -
          calculateTargetPriority(p, x, participants, c),
      );
      // Reserve half the budget for rotating candidates so hidden high-threat enemies cannot starve visible ones.
      const top = candidates.slice(0, Math.ceil(c.scanBudget / 2));
      for (
        let n = 0;
        n < Math.floor(c.scanBudget / 2) && candidates.length;
        n++
      )
        top.push(candidates[(a.scanOffset + n) % candidates.length]);
      a.scanOffset += Math.floor(c.scanBudget / 2);
      let best = null,
        score = -Infinity;
      for (const e of new Set(top))
        if (this.visible(p, e, range, e.id !== a.target)) {
          const s = calculateTargetPriority(p, e, participants, c);
          if (s > score) {
            best = e;
            score = s;
          }
        }
      const currentScore = target
        ? calculateTargetPriority(p, target, participants, c)
        : 0;
      if (
        best &&
        (!target ||
          (now >= a.switchAt && score > currentScore * c.targetSwitchRatio))
      ) {
        a.target = best.id;
        target = best;
        a.reactAt = now + reaction * (0.8 + rand() * 0.4);
        a.switchAt = now + c.targetSwitchCooldown;
        a.path = [];
        a.threat = score;
      }
      if (target && this.visible(p, target, range, false)) {
        a.lastSeen = position(target);
        a.seenAt = now;
      }
    }
    // Live LOS is checked before each potential shot; cached awareness never authorizes firing.
    const visual = target && this.visible(p, target, range, false);
    if (visual) {
      a.lastSeen = position(target);
      a.seenAt = now;
    }
    if (target && !visual && now - a.seenAt > c.targetMemory) {
      a.target = null;
      target = null;
      a.path = [];
    }
    const w = r.weaponDefinition(p.wid),
      ammo = r._weaponState(p, p.wid);
    if (
      ammo.mag === 0 ||
      (r.waveState !== "ACTIVE" && ammo.mag < w.mag) ||
      (!target && ammo.mag < w.mag * 0.4)
    )
      r._startReload(p, p.wid);
    if (ammo.mag + ammo.reserve === 0) {
      // Normal loadout ammo only; no magical refill.
      p.wid = "sword";
    }
    let goal = null,
      worldX = 0,
      worldZ = 0,
      desiredYaw = a.yaw,
      desiredPitch = 0;
    if (r.waveState !== "ACTIVE") {
      a.target = null;
      target = null;
      a.lastSeen = null;
      a.state = "INTERMISSION";
      if (!a.patrol || now > a.patrolUntil) {
        const center = participants.find((q) => !q.isBot && q.alive);
        const candidate = center
          ? [
              center.state.px + Math.sin(p.id) * 5,
              center.state.py,
              center.state.pz + Math.cos(p.id) * 5,
            ]
          : r._pickBotRoamTarget(p);
        a.patrol = candidate;
        a.patrolUntil = now + 5 + rand() * 4;
        a.path = [];
      }
      goal = a.patrol;
      if (Math.hypot(goal[0] - p.state.px, goal[2] - p.state.pz) > 2)
        a.state = "REGROUP";
      else goal = null;
    } else if (target && a.lastSeen) {
      const point = visual ? position(target) : a.lastSeen,
        dx = point[0] - p.state.px,
        dz = point[2] - p.state.pz,
        d = Math.hypot(dx, dz) || 1;
      desiredYaw = Math.atan2(-dx, -dz);
      desiredPitch = Math.atan2(point[1] + 1.05 - (p.state.py + 1.55), d);
      const close = enemies.filter(
        (e) => distance(p, e) < 9 && this.visible(p, e, 12, false),
      );
      const ideal =
        w.kind === "melee"
          ? 1.6
          : Math.min(
              w.range * 0.55,
              p.wid === "levershotgun"
                ? 7
                : p.wid === "boltsniper"
                  ? 25
                  : c.idealCombatDistance,
            );
      const danger =
        (target.bossInstance && d < ideal) ||
        close.length >= Math.max(2, c.retreatThreshold / skill) ||
        p.health < c.retreatHealth ||
        (target.enemyType === "fast" && d < 7);
      a.state = !visual
        ? "CHASE"
        : danger
          ? "RETREAT"
          : now < a.reactAt
            ? "SEARCH"
            : "ENGAGE";
      if (!visual) goal = point;
      else {
        if (now >= a.nextStrafe) {
          a.strafe = rand() < 0.18 ? 0 : rand() < 0.5 ? -1 : 1;
          a.nextStrafe = now + 0.6 + rand() * 1.4;
        }
        let forward = d > ideal * 1.3 ? 1 : d < ideal * 0.65 ? -1 : 0;
        if (danger) {
          worldX = 0;
          worldZ = 0;
          for (const e of close) {
            const ed = Math.max(1, distance(p, e));
            worldX += (p.state.px - e.state.px) / ed ** 2;
            worldZ += (p.state.pz - e.state.pz) / ed ** 2;
          }
          forward = -1;
        }
        worldX += (dx / d) * forward + (dz / d) * a.strafe * 0.8;
        worldZ += (dz / d) * forward - (dx / d) * a.strafe * 0.8;
        if (now >= a.pauseUntil && now >= a.burstUntil) {
          a.burstUntil = now + c.burstDuration * (0.75 + rand() * 0.5);
          a.pauseUntil = a.burstUntil + c.burstPause * (0.75 + rand() * 0.5);
        }
        const angle = Math.atan2(
          Math.sin(desiredYaw - a.yaw),
          Math.cos(desiredYaw - a.yaw),
        );
        if (
          now >= a.reactAt &&
          now < a.burstUntil &&
          Math.abs(angle) < 0.2 &&
          Math.abs(desiredPitch - a.pitch) < 0.2 &&
          d < w.range &&
          p.fireCooldown <= 0 &&
          p.reloadUntil <= r.tick &&
          (w.kind === "melee" || ammo.mag > 0)
        ) {
          const spread = (c.aimSpread * (1 - c.accuracy * 0.7)) / skill;
          r.onFire(p.id, {
            seq: p.lastFireSeq + 1,
            wid: p.wid,
            yaw: a.yaw + (rand() * 2 - 1) * spread,
            pitch: a.pitch + (rand() * 2 - 1) * spread,
            viewTick: r.tick,
          });
          // Deliberately omit botTargetId: the legacy FFA fire hook snaps aim to target position.
        }
      }
    } else {
      a.state = enemies.length <= 3 ? "SEARCH" : "ROAM";
      if (this.lastPatrolTick !== r.tick && now >= (a.nextPatrolQuery || 0) && (
        !a.patrol ||
        now > a.patrolUntil ||
        Math.hypot(a.patrol[0] - p.state.px, a.patrol[2] - p.state.pz) < 1.5
      )) {
        // A route search probes imported collision geometry. Share that work
        // across ticks and back off failed searches instead of retrying every bot.
        this.lastPatrolTick = r.tick;
        a.nextPatrolQuery = now + .5;
        a.patrol = r._pickBotRoamTarget(p);
        a.patrolUntil = now + 4 + rand() * 5;
        a.path = [];
      }
      goal = a.patrol;
    }
    if (goal) {
      [worldX, worldZ] = this.nav.steer(p, goal);
      if (!target && Math.hypot(worldX, worldZ) > 0.1)
        desiredYaw = Math.atan2(-worldX, -worldZ);
    }
    // Friendly spacing and exposed boss hazard avoidance are steering inputs, not damage immunity.
    for (const other of participants) {
      if (other === p || !other.alive) continue;
      const d = distance(p, other);
      if (d > 0 && d < 2.5) {
        worldX += ((p.state.px - other.state.px) / d) * 1.5;
        worldZ += ((p.state.pz - other.state.pz) / d) * 1.5;
      }
    }
    for (const e of enemies)
      for (const zone of e.dangerZones || []) {
        const dx = p.state.px - zone.x,
          dz = p.state.pz - zone.z,
          d = Math.hypot(dx, dz);
        if (d < zone.radius + 2) {
          worldX += (dx / (d || 1)) * 3;
          worldZ += (dz / (d || 1)) * 3;
        }
      }
    a.yaw = smoothBotAim(a.yaw, desiredYaw, c.trackingSpeed * skill, 0.05);
    a.pitch +=
      (desiredPitch - a.pitch) *
      (1 - Math.exp(-c.trackingSpeed * skill * 0.05));
    const len = Math.hypot(worldX, worldZ),
      yaw = a.yaw;
    let mx =
        len > 0.1
          ? (Math.cos(yaw) * worldX) / len - (Math.sin(yaw) * worldZ) / len
          : 0,
      mz =
        len > 0.1
          ? (-Math.sin(yaw) * worldX) / len - (Math.cos(yaw) * worldZ) / len
          : 0;
    // makeInput quantizes axes; validate precisely the command actually sent to MoveSim.
    const quant = (v) => (Math.abs(v) < 0.25 ? 0 : Math.sign(v));
    mx = quant(mx);
    mz = quant(mz);
    const safe = (x, z) => {
      const l = Math.hypot(x, z) || 1;
      return !!this.nav.lane(position(p), [
        p.state.px + ((Math.cos(yaw) * x - Math.sin(yaw) * z) / l) * 1.4,
        p.state.py,
        p.state.pz + ((-Math.sin(yaw) * x - Math.cos(yaw) * z) / l) * 1.4,
      ]);
    };
    if ((mx || mz) && !safe(mx, mz)) {
      const alternative = [
        [a.strafe || 1, 0],
        [-(a.strafe || 1), 0],
        [0, -1],
        [0, 1],
      ].find(([x, z]) => safe(x, z));
      [mx, mz] = alternative || [0, 0];
    }
    if (now - a.progressAt >= 1) {
      const moved = Math.hypot(
        p.state.px - a.lastPosition[0],
        p.state.pz - a.lastPosition[2],
      );
      if ((goal || len > 0.1) && moved < 0.25) {
        a.stuckSince ??= now;
        if (now - a.stuckSince >= c.stuckTimeout) {
          a.path = [];
          a.patrol = null;
          if (a.target) a.ignored.set(a.target, now + c.targetMemory);
          a.target = null;
        }
      } else {
        a.stuckSince = null;
        if (safe(0, 0)) a.lastSafe = position(p);
      }
      if (a.stuckSince !== null && now - a.stuckSince >= c.recoveryTimeout) {
        const options = [a.lastSafe, ...r.arena.spawns].filter(
          (v) =>
            Math.abs(r.arena.groundHeightAt(v[0], v[2], v[1], v[1]) - v[1]) <
            0.6,
        );
        options.sort(
          (x, y) =>
            Math.hypot(x[0] - p.state.px, x[2] - p.state.pz) -
            Math.hypot(y[0] - p.state.px, y[2] - p.state.pz),
        );
        const point = options.find(
          (v) => Math.hypot(v[0] - p.state.px, v[2] - p.state.pz) > 1,
        );
        if (point) {
          p.state = createState(...point);
          p.history = [];
          a.recoveries++;
        }
        a.stuckSince = null;
        a.path = [];
      }
      a.lastPosition = position(p);
      a.progressAt = now;
    }
    p._botState = a.state;
    return {
      seq: ++p.lastInputSeq,
      inp: makeInput({
        mx,
        mz,
        yaw: a.yaw,
        pitch: a.pitch,
        sprint: !visual && mz > 0,
      }),
      wid: p.wid,
      aiming: !!visual,
    };
  }
}
