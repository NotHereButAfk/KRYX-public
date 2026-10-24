// Run against the real map and simulation, without a network listener.
// Optional module path permits before/after comparisons against a local copy.
// Timings are diagnostic, not a machine-dependent CI threshold.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const moduleUrl = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2])) : new URL('../server/authroom.mjs', import.meta.url);
const ticks = Math.max(200, Number(process.argv[3]) || 2000);
const modules = process.argv[4]
  ? [moduleUrl, pathToFileURL(resolve(process.argv[4]))] : [moduleUrl];
const epoch = 1792800000000;
const realNow = Date.now, realRandom = Math.random;
const results = [];
try {
  for (const humans of [0, 1, 4, 8]) {
    const timingsByModule = new Map(modules.map(url => [url.href, []]));
    const summaries = new Map();
    for (let repeat = 0; repeat < 3; repeat++) {
      // Alternate order so a machine warming up or sharing CPU does not always
      // favor the same version when comparing a baseline and candidate.
      for (const activeModule of repeat % 2 ? [...modules].reverse() : modules) {
      let seed = 42, now = epoch;
      Date.now = () => now;
      Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
      const fresh = new URL(activeModule);
      fresh.searchParams.set('fixture', `${humans}-${repeat}`);
      const { AuthRoom } = await import(fresh.href);
      const room = new AuthRoom(undefined, { targetPopulation: 8, now: epoch, lootSeed: 42 });
      room._rotateMatch = () => false;
      const digest = createHash('sha256');
      let measured = false, messages = 0, discardedBotMessages = 0, bytes = 0, lootLists = 0;
      for (let n = 0; n < humans; n++) room.add((message) => {
        if (message.t !== 'snapshot') return;
        // Match the production transport's serialization cost.
        const json = JSON.stringify(message);
        if (measured) { messages++; bytes += Buffer.byteLength(json); digest.update(json); }
      }, `Benchmark ${n}`);
      for (const p of room.players.values()) if (p.isBot) p.send = (message) => {
        if (measured && message.t === 'snapshot') discardedBotMessages++;
      };
      const lootPayload = room._lootPadPayload;
      room._lootPadPayload = function () {
        if (measured) lootLists++;
        return lootPayload.call(this);
      };
      for (let i = 0; i < 200; i++) { now += 50; room.update(); }
      measured = true;
      const frameTimes = [];
      for (let i = 0; i < ticks; i++) {
        now += 50;
        const start = performance.now();
        room.update();
        frameTimes.push(performance.now() - start);
        // Include all bodies even when the room has no browser recipients.
        digest.update(JSON.stringify([...room.players.values()].map(p => ({
          id: p.id, state: p.state, alive: p.alive, health: p.health,
          shield: p.shield, mag: p.mag, ammo: p.ammo,
          kills: p.kills, deaths: p.deaths, score: p.score,
          botState: p._botState, target: p._botTargetId,
        }))));
      }
      const mean = frameTimes.reduce((a, b) => a + b, 0) / ticks;
      frameTimes.sort((a, b) => a - b);
      timingsByModule.get(activeModule.href).push({ meanMs: mean, p95Ms: frameTimes[Math.floor(ticks * .95)] });
      const next = {
        module: activeModule.pathname.split('/').pop(),
        map: room.arena.id, humans, bots: [...room.players.values()].filter(p => p.isBot).length,
        ticks, messages, discardedBotMessages, bytes, lootLists, digest: digest.digest('hex'),
      };
      const prior = summaries.get(activeModule.href);
      if (prior && prior.digest !== next.digest) throw new Error('Simulation fixture is not deterministic');
      summaries.set(activeModule.href, next);
      }
    }
    for (const activeModule of modules) {
      const timings = timingsByModule.get(activeModule.href);
      timings.sort((a, b) => a.meanMs - b.meanMs);
      results.push({ ...summaries.get(activeModule.href), median: timings[1], runs: timings });
    }
  }
} finally {
  Date.now = realNow;
  Math.random = realRandom;
}
console.log(JSON.stringify(results, null, 2));
