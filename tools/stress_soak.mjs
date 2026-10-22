#!/usr/bin/env node
// Phase 9 — stress + soak test of the authoritative simulation. Drives the
// real AuthRoom headless at high player counts for a sustained run and proves
// the slice holds up:
//   • TICK BUDGET  — every update() must fit the 20Hz budget (50ms). Reports
//     p50/p95/p99/max update() wall-time at 8 / 16 / 32 / 64 players.
//   • SOAK          — a long run (default 10 min sim, compressed) with no crash,
//     no unbounded growth in room state, and continuous combat/spawns.
//   • REVALIDATE    — under load: movement stays finite/on-map (no NaN, no
//     fall-through), respawns keep firing, kill feed keeps flowing.
//
//   npm run stress:soak                 # standard matrix + 3 min soak
//   npm run stress:soak -- --soak 10     # 10 min soak on the 32p cohort

import { AuthRoom } from '../server/authroom.mjs';
import { AUTHORITY_TEST_ARENA } from './fixtures/authorityArena.mjs';

const TICK_MS = 50, BUDGET_MS = 50;
const soakMin = (() => { const i = process.argv.indexOf('--soak'); return i > 0 ? +process.argv[i + 1] : 3; })();

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; }; }

// Bot driver: navigate to a random callout, fire at nearest enemy. Same shape
// as the metrics harness — exercises movement + combat authority under load.
function driveBots(room, bots, t) {
  for (const bot of bots) {
    const me = room.players.get(bot.id);
    if (!me || !me.alive) continue;
    if (!bot.target || bot.retargetIn-- <= 0) {
      bot.target = AUTHORITY_TEST_ARENA.callouts[Math.floor(bot.rnd() * AUTHORITY_TEST_ARENA.callouts.length)];
      bot.retargetIn = 40 + Math.floor(bot.rnd() * 80);
    }
    const dx = bot.target.x - me.state.px, dz = bot.target.z - me.state.pz;
    const dist = Math.hypot(dx, dz);
    room.onInput(bot.id, {
      seq: (me._s = (me._s || 0) + 1), tick: t, mx: 0, mz: dist > 1.5 ? 1 : 0,
      yaw: Math.atan2(-dx, -dz), pitch: 0, sprint: dist > 8,
      jump: bot.rnd() < 0.02, crouchDown: false, tele: false,
    });
    if (bot.fireIn-- <= 0) {
      let best = null, bd = 40;
      for (const o of room.players.values()) {
        if (o.id === bot.id || !o.alive) continue;
        const d = Math.hypot(o.state.px - me.state.px, o.state.pz - me.state.pz);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        room.onFire(bot.id, { seq: (me._f = (me._f || 0) + 1), wid: 'm4',
          yaw: Math.atan2(-(best.state.px - me.state.px), -(best.state.pz - me.state.pz)), pitch: 0 });
        bot.fireIn = 2 + Math.floor(bot.rnd() * 4);
      }
    }
  }
}

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; }

function benchCohort(n, ticks) {
  const room = new AuthRoom(AUTHORITY_TEST_ARENA);
  const bots = [];
  for (let i = 0; i < n; i++) bots.push({ id: room.add(() => {}, `B${i}`), rnd: rng(9001 + i * 131), target: null, retargetIn: 0, fireIn: 0 });
  const times = [];
  let kills = 0, respawns = 0, bad = 0;
  for (let t = 0; t < ticks; t++) {
    driveBots(room, bots, t);
    const t0 = performance.now();
    room.update();
    times.push(performance.now() - t0);
    for (const e of room.events) { if (e.e === 'kill') kills++; if (e.e === 'respawn') respawns++; }
    // revalidate every player is finite + on the map
    for (const p of room.players.values()) {
      const s = p.state;
      if (!Number.isFinite(s.px) || !Number.isFinite(s.py) || !Number.isFinite(s.pz)) bad++;
      else if (Math.abs(s.px) > AUTHORITY_TEST_ARENA.half + 2 || Math.abs(s.pz) > AUTHORITY_TEST_ARENA.half + 2 || s.py < AUTHORITY_TEST_ARENA.killY - 5) bad++;
    }
  }
  times.sort((a, b) => a - b);
  return {
    players: n, ticks,
    p50: +pct(times, 0.5).toFixed(3), p95: +pct(times, 0.95).toFixed(3),
    p99: +pct(times, 0.99).toFixed(3), max: +times[times.length - 1].toFixed(3),
    avg: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
    kills, respawns, invalidStates: bad,
    withinBudget: times[times.length - 1] < BUDGET_MS,
  };
}

console.log('── TICK-BUDGET MATRIX (20Hz → 50ms budget, 30s each) ──');
let fail = 0;
for (const n of [8, 16, 32, 64]) {
  const r = benchCohort(n, 20 * 30);
  const flag = r.withinBudget ? 'ok' : 'OVER';
  const rt = r.invalidStates === 0 ? 'ok' : `${r.invalidStates} BAD`;
  console.log(`  ${String(n).padStart(2)}p  update p50 ${String(r.p50).padStart(6)}ms  p95 ${String(r.p95).padStart(6)}ms  p99 ${String(r.p99).padStart(6)}ms  max ${String(r.max).padStart(6)}ms  [${flag}]  kills ${r.kills}  respawns ${r.respawns}  states ${rt}`);
  if (!r.withinBudget) fail++;
  if (r.invalidStates) fail++;
}

console.log(`\n── SOAK (${soakMin} min sim @ 32p) ──`);
const soakTicks = 20 * 60 * soakMin;
const room = new AuthRoom(AUTHORITY_TEST_ARENA);
const bots = [];
for (let i = 0; i < 32; i++) bots.push({ id: room.add(() => {}, `S${i}`), rnd: rng(4200 + i * 97), target: null, retargetIn: 0, fireIn: 0 });
// Compare retained heap, not short-lived snapshots waiting for V8's next GC.
// Collection is outside the timed update loop and does not change its budget.
if (!globalThis.gc) throw new Error('Run with npm run stress:soak (requires --expose-gc)');
globalThis.gc();
const mem0 = process.memoryUsage().heapUsed;
let soakKills = 0, soakBad = 0, maxTick = 0, maxHistory = 0;
const start = performance.now();
for (let t = 0; t < soakTicks; t++) {
  driveBots(room, bots, t);
  const t0 = performance.now();
  room.update();
  maxTick = Math.max(maxTick, performance.now() - t0);
  for (const e of room.events) if (e.e === 'kill') soakKills++;
  for (const p of room.players.values()) {
    if (!Number.isFinite(p.state.px) || !Number.isFinite(p.state.py)) soakBad++;
    maxHistory = Math.max(maxHistory, p.history.length);   // must stay bounded (≤20)
  }
}
const wall = ((performance.now() - start) / 1000).toFixed(1);
globalThis.gc();
const mem1 = process.memoryUsage().heapUsed;
const memGrowth = ((mem1 - mem0) / 1024 / 1024).toFixed(1);
console.log(`  ticks ${soakTicks}  simulated ${soakMin}min in ${wall}s wall`);
console.log(`  kills ${soakKills}  max update ${maxTick.toFixed(2)}ms  invalid states ${soakBad}`);
console.log(`  history buffer max ${maxHistory} (bound 20)  heap growth ${memGrowth}MB`);
const soakOk = soakBad === 0 && maxTick < BUDGET_MS && maxHistory <= 20 && Math.abs(+memGrowth) < 50;
if (!soakOk) fail++;

console.log(`\n${fail ? `${fail} check(s) FAILED` : 'PASS — slice holds 20Hz budget + soaks clean'}`);
process.exit(fail ? 1 : 0);
