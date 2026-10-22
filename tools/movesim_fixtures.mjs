#!/usr/bin/env node
// Phase 3 evidence runner — executes the nine sealed movement fixtures (plus
// flat-floor stability) against the deterministic MoveSim core and produces:
//   • pass/fail on every fixture's invariant checks
//   • movement tapes (per-tick positions) in tests/tapes/<id>.json
//   • stable 20 Hz state hashes, checked against tests/movesim.golden.json
//   • a double-run bit-identity check (same tape → same hashes, twice)
//   • frame-schedule parity: two different seeded frame-dt schedules feeding
//     the same tick tape through the accumulator produce identical hashes
//
//   node tools/movesim_fixtures.mjs           # run + verify against golden
//   node tools/movesim_fixtures.mjs --write   # (re)write golden + tapes

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, step, hashState, DT } from '../src/sim/MoveSim.js';
import { FIXTURES, expandTape } from '../src/sim/fixtures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const goldenPath = join(root, 'tests', 'movesim.golden.json');
const tapesDir = join(root, 'tests', 'tapes');
const WRITE = process.argv.includes('--write');

function runTape(fixture) {
  const tape = expandTape(fixture.tape);
  let s = createState(...fixture.spawn);
  const states = [], hashes = [];
  for (let i = 0; i < tape.length; i++) {
    s = step(s, tape[i], fixture.world);
    states.push(s);
    if ((i + 1) % 20 === 0 || i === tape.length - 1) hashes.push(hashState(s));
  }
  return { states, hashes, final: hashState(s) };
}

// mulberry32 — seeded frame-dt schedules for the parity test
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Drive the same tick tape through a frame accumulator with irregular frame
// times — the tick sequence (and therefore every hash) must not change.
function runScheduled(fixture, seed) {
  const tape = expandTape(fixture.tape);
  const rand = rng(seed);
  let s = createState(...fixture.spawn);
  let acc = 0, tick = 0;
  const hashes = [];
  while (tick < tape.length) {
    acc += 0.004 + rand() * 0.045;          // 4–49 ms frames
    while (acc >= DT && tick < tape.length) {
      acc -= DT;
      s = step(s, tape[tick], fixture.world);
      tick++;
      if (tick % 20 === 0 || tick === tape.length) hashes.push(hashState(s));
    }
  }
  return hashes;
}

const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : {};
const nextGolden = {};
let failed = 0;

for (const f of FIXTURES) {
  const a = runTape(f);
  const b = runTape(f);

  const problems = [];

  // invariant checks
  const err = f.check(a.states);
  if (err) problems.push(`invariant: ${err}`);

  // bit-identical double run
  if (a.hashes.join() !== b.hashes.join()) problems.push('nondeterministic: two runs differ');

  // frame-schedule parity (two irregular schedules vs the straight run)
  const s1 = runScheduled(f, 0xC0FFEE), s2 = runScheduled(f, 0xBADF00D);
  if (s1.join() !== a.hashes.join()) problems.push('schedule parity broken (seed 1)');
  if (s2.join() !== a.hashes.join()) problems.push('schedule parity broken (seed 2)');

  // golden hashes
  nextGolden[f.id] = { final: a.final, hashes: a.hashes };
  if (!WRITE) {
    const g = golden[f.id];
    if (!g) problems.push('no golden entry (run with --write)');
    else if (g.final !== a.final || g.hashes.join() !== a.hashes.join()) {
      problems.push(`golden mismatch (expected ${g?.final}, got ${a.final})`);
    }
  }

  if (WRITE) {
    mkdirSync(tapesDir, { recursive: true });
    const tapeOut = a.states.map((s) => [
      Math.round(s.px * 1e4) / 1e4,
      Math.round(s.py * 1e4) / 1e4,
      Math.round(s.pz * 1e4) / 1e4,
      s.onGround,
    ]);
    writeFileSync(join(tapesDir, `${f.id}.json`), JSON.stringify({
      fixture: f.id, title: f.title, tickRate: 20, states: tapeOut,
    }));
  }

  const status = problems.length ? 'FAIL' : 'ok';
  if (problems.length) failed++;
  console.log(`${status.padEnd(4)} ${f.id.padEnd(14)} ${a.final}  ${f.title}`);
  for (const p of problems) console.log(`      ↳ ${p}`);
}

if (WRITE) {
  mkdirSync(dirname(goldenPath), { recursive: true });
  writeFileSync(goldenPath, JSON.stringify(nextGolden, null, 2));
  console.log(`\ngolden hashes + tapes written (${FIXTURES.length} fixtures)`);
}

console.log(failed ? `\n${failed} fixture(s) FAILED` : '\nall fixtures passed');
process.exit(failed ? 1 : 0);
