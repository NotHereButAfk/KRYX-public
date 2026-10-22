#!/usr/bin/env node
// Phase 6 instrumentation — drive sim bots through the Inkfall Foundry graybox
// (via the real AuthRoom, so movement/combat run the authoritative code path)
// and measure the topology BEFORE any beauty work:
//   • route times   — ticks to travel between adjacent callouts
//   • occupancy      — where players actually spend time (heatmap grid)
//   • deaths/kills    — combat volume at each player count
//   • reachability    — every callout gets visited (no dead zones)
//
// Runs at 2 / 4 / 8 players and writes:
//   tests/arena/metrics.json         machine-readable report
//   tests/arena/occupancy_<N>.pgm    occupancy heatmaps (P2 ascii PGM)
//
//   node tools/arena_metrics.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WALK_SPEED } from '../src/sim/MovementConfig.js';
import { AuthRoom } from '../server/authroom.mjs';
import { AUTHORITY_TEST_ARENA } from './fixtures/authorityArena.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tests', 'arena');
mkdirSync(outDir, { recursive: true });

// Preserve the original patrol-distance budget when movement speed is tuned.
// Reachability assertions remain unchanged; route times still use real seconds.
const SIM_TICKS = Math.ceil(20 * 90 * 9.24 / WALK_SPEED);
const GRID = 40;                        // occupancy grid resolution
const cell = (AUTHORITY_TEST_ARENA.half * 2) / GRID;

// Deterministic per-bot RNG so runs are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; };
}

// A bot picks a target callout, walks toward it (yaw = bearing), and fires at
// the nearest visible enemy. Simple, but it exercises every route + combat.
function makeBot(id, seed) {
  return { id, rnd: rng(seed + id * 7919), target: null, retargetIn: 0, fireIn: 0 };
}
function pickTarget(bot) {
  const c = AUTHORITY_TEST_ARENA.callouts[Math.floor(bot.rnd() * AUTHORITY_TEST_ARENA.callouts.length)];
  bot.target = c; bot.retargetIn = 40 + Math.floor(bot.rnd() * 80);
}

function botInput(bot, me, others) {
  if (!bot.target || bot.retargetIn-- <= 0) pickTarget(bot);
  const dx = bot.target.x - me.state.px, dz = bot.target.z - me.state.pz;
  const dist = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz);            // sim: forward -z at yaw 0
  const mz = dist > 1.5 ? 1 : 0;
  const jump = bot.rnd() < 0.02;               // occasional hop (test air/steps)
  const sprint = dist > 8;
  return { mx: 0, mz, yaw, sprint, jumpJust: jump, seq: me._botSeq = (me._botSeq || 0) + 1 };
}

function runCohort(n) {
  const room = new AuthRoom(AUTHORITY_TEST_ARENA);
  const bots = [];
  const occ = new Int32Array(GRID * GRID);
  const callVisits = Object.fromEntries(AUTHORITY_TEST_ARENA.callouts.map((c) => [c.name, 0]));
  let kills = 0, deaths = 0, respawns = 0;
  const routeTimes = [];        // {from,to,ticks}
  const lastCallout = new Map();
  const enteredAt = new Map();

  for (let i = 0; i < n; i++) {
    const id = room.add(() => {}, `Bot${i}`);
    bots.push(makeBot(id, 12345));
  }

  for (let t = 0; t < SIM_TICKS; t++) {
    for (const bot of bots) {
      const me = room.players.get(bot.id);
      if (!me || !me.alive) continue;
      const inp = botInput(bot, me, bots);
      room.onInput(bot.id, {
        seq: inp.seq, tick: t, mx: inp.mx, mz: inp.mz, yaw: inp.yaw,
        pitch: 0, sprint: inp.sprint, crouch: false,
        jump: inp.jumpJust, crouchDown: false, tele: false,
      });
      // fire at the nearest living enemy roughly in front
      if (bot.fireIn-- <= 0) {
        let best = null, bd = 1e9;
        for (const other of room.players.values()) {
          if (other.id === bot.id || !other.alive) continue;
          const d = Math.hypot(other.state.px - me.state.px, other.state.pz - me.state.pz);
          if (d < bd) { bd = d; best = other; }
        }
        if (best && bd < 40) {
          const tx = best.state.px - me.state.px;
          const ty = best.state.py - me.state.py;
          const tz = best.state.pz - me.state.pz;
          const yaw = Math.atan2(-tx, -tz);
          const pitch = Math.atan2(ty, Math.hypot(tx, tz));
          room.onFire(bot.id, {
            seq: (me._fireSeq = (me._fireSeq || 0) + 1),
            wid: 'm4',
            yaw,
            pitch,
          });
          bot.fireIn = 2 + Math.floor(bot.rnd() * 4);
        }
      }
    }
    room.update();

    // instrument this tick
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      const gx = Math.floor((p.state.px + AUTHORITY_TEST_ARENA.half) / cell);
      const gz = Math.floor((p.state.pz + AUTHORITY_TEST_ARENA.half) / cell);
      if (gx >= 0 && gx < GRID && gz >= 0 && gz < GRID) occ[gz * GRID + gx]++;
      // nearest callout → route timing
      let near = null, nd = 1e9;
      for (const c of AUTHORITY_TEST_ARENA.callouts) {
        const d = Math.hypot(c.x - p.state.px, c.z - p.state.pz);
        if (d < nd) { nd = d; near = c; }
      }
      if (near && nd < 6) {
        const prev = lastCallout.get(p.id);
        if (prev && prev !== near.name) {
          routeTimes.push({ from: prev, to: near.name, ticks: t - (enteredAt.get(p.id) || t) });
          callVisits[near.name]++;
          enteredAt.set(p.id, t);
        } else if (!prev) { enteredAt.set(p.id, t); callVisits[near.name]++; }
        lastCallout.set(p.id, near.name);
      }
    }
    for (const e of room.events) {
      if (e.e === 'kill') kills++;
      if (e.e === 'respawn') respawns++;
    }
  }
  for (const p of room.players.values()) deaths += p.deaths;

  // write occupancy heatmap (PGM P2)
  let max = 1; for (const v of occ) if (v > max) max = v;
  const rows = [];
  for (let z = GRID - 1; z >= 0; z--) {          // flip so +z is up
    const r = [];
    for (let x = 0; x < GRID; x++) r.push(Math.round((occ[z * GRID + x] / max) * 255));
    rows.push(r.join(' '));
  }
  writeFileSync(join(outDir, `occupancy_${n}.pgm`),
    `P2\n# Inkfall occupancy, ${n} bots, ${SIM_TICKS} ticks\n${GRID} ${GRID}\n255\n${rows.join('\n')}\n`);

  // reachability + route summary
  const unreached = Object.entries(callVisits).filter(([, v]) => v === 0).map(([k]) => k);
  const byRoute = {};
  for (const r of routeTimes) {
    const k = `${r.from}→${r.to}`;
    (byRoute[k] ||= []).push(r.ticks);
  }
  const routes = Object.fromEntries(Object.entries(byRoute).map(([k, arr]) => {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return [k, { samples: arr.length, avgTicks: Math.round(avg), avgSec: +(avg / 20).toFixed(2) }];
  }));

  return {
    players: n, ticks: SIM_TICKS, seconds: SIM_TICKS / 20,
    kills, deaths, respawns,
    kdPerMin: +((kills / (SIM_TICKS / 20)) * 60).toFixed(1),
    calloutVisits: callVisits,
    unreachedCallouts: unreached,
    topRoutes: Object.fromEntries(Object.entries(routes).sort((a, b) => b[1].samples - a[1].samples).slice(0, 8)),
  };
}

const report = { arena: AUTHORITY_TEST_ARENA.name, generated: new Date().toISOString(), cohorts: {} };
for (const n of [2, 4, 8]) {
  const r = runCohort(n);
  report.cohorts[n] = r;
  console.log(`\n── ${n} players ──`);
  console.log(`  kills ${r.kills}  deaths ${r.deaths}  respawns ${r.respawns}  (${r.kdPerMin}/min)`);
  console.log(`  callout visits: ${Object.entries(r.calloutVisits).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`  unreached callouts: ${r.unreachedCallouts.length ? r.unreachedCallouts.join(', ') : 'NONE (fully reachable)'}`);
  console.log(`  top routes:`);
  for (const [k, v] of Object.entries(r.topRoutes)) console.log(`    ${k.padEnd(28)} ${v.samples}× avg ${v.avgSec}s`);
}
writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(report, null, 2));
console.log(`\nwrote tests/arena/metrics.json + occupancy_{2,4,8}.pgm`);

// simple topology sanity gate
let bad = 0;
for (const n of [2, 4, 8]) {
  if (report.cohorts[n].unreachedCallouts.length) { console.log(`WARN ${n}p: dead zones`); bad++; }
  if (report.cohorts[n].kills === 0) { console.log(`WARN ${n}p: zero combat`); bad++; }
}
console.log(bad ? `\n${bad} topology warning(s)` : '\ntopology looks healthy at all player counts');
