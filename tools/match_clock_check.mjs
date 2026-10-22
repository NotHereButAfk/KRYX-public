#!/usr/bin/env node

import assert from 'node:assert/strict';
import { RESULTS_MS } from '../src/sim/MatchFlow.js';
import fs from 'node:fs';
import { AuthClient } from '../src/net/AuthClient.js';
import { createState } from '../src/sim/MoveSim.js';
import { getMode } from '../src/core/GameModes.js';
import { AuthRoom } from '../server/authroom.mjs';
import {
  MATCH_DURATION_MS,
  MATCH_EPOCH_MS,
  continuousMatchState,
} from '../server/matchclock.mjs';

assert.equal(MATCH_DURATION_MS, 180_000, 'public deathmatch must last three minutes');
assert.equal(getMode('deathmatch').timeLimit * 1000, MATCH_DURATION_MS,
  'client and authoritative server deathmatch lengths diverged');

const now = MATCH_EPOCH_MS + MATCH_DURATION_MS * 247 + 42_000;
const state = continuousMatchState(now, 3);
assert.equal(state.matchStart, MATCH_EPOCH_MS + MATCH_DURATION_MS * 247);
assert.equal(state.remainingMs, MATCH_DURATION_MS - 42_000);
assert.equal(state.arenaIndex, 247 % 3);

const arenas = [0, 1, 2].map((index) => ({
  id: `clock-${index}`, name: `Clock ${index}`, region: 'test', half: 20, killY: -20,
  noBaseFloor: false, platforms: [], boxes: [], gravLifts: [], teleporters: [],
  pickups: [], spawns: [[0, 0, 0]], groundHeightAt: () => 0,
  raycast: (_ox, _oy, _oz, _dx, _dy, _dz, far) => far,
}));
const beforeRestart = new AuthRoom(arenas, { now, lootSeed: 1 });
const afterRestart = new AuthRoom(arenas, { now: now + 1_000, lootSeed: 1 });
assert.equal(afterRestart.matchStart, beforeRestart.matchStart,
  'server restart reset the active round clock');
assert.equal(afterRestart.arena.id, beforeRestart.arena.id,
  'server restart reset the active map rotation');

const nextStart = beforeRestart.matchStart + MATCH_DURATION_MS;
const playerId = beforeRestart.add(() => {}, 'RoundWinner');
const winner = beforeRestart.players.get(playerId);
winner.kills = 7;
winner.score = 700;
assert.equal(beforeRestart._rotateMatch(nextStart - 1), false, 'map rotated before the round ended');
assert.equal(beforeRestart._rotateMatch(nextStart + 5), false, 'results must precede map rotation');
assert.equal(winner.kills, 7, 'scores reset before results finished');
assert.equal(beforeRestart._rotateMatch(nextStart + RESULTS_MS + 4), false);
assert.equal(beforeRestart._rotateMatch(nextStart + RESULTS_MS + 5), true,
  'continuous room did not advance at the global round boundary');
assert.equal(beforeRestart.matchStart, nextStart,
  'round rotation drifted away from the fixed wall-clock cadence');
assert.equal(beforeRestart._arenaIndex, (state.arenaIndex + 1) % arenas.length);
assert.equal(beforeRestart.previousRound.rows.find(p => p.id === playerId).kills, 7);
assert.equal(winner.kills, 0, 'new round did not reset live score');
assert.equal(beforeRestart.previousRound.rows.find(p => p.id === playerId).score, 700,
  'reset mutated frozen final results');

// Exercise real client reconciliation with a same-map round boundary too.
const client = new AuthClient('ws://unused');
client.sim = createState(0, 0, 0);
client.mapId = arenas[0].id;
client.matchStart = nextStart - MATCH_DURATION_MS;
client.matchDurationMs = MATCH_DURATION_MS;
let changes = 0;
client.onMapChange = (_id, match) => {
  changes++;
  assert.equal(match.roundEnded, true);
  assert.equal(match.results.find(p => p.id === playerId).kills, 7);
};
const snapshot = {
  tick: 1, ack: 0, mapId: arenas[0].id, matchStart: nextStart,
  matchDurationMs: MATCH_DURATION_MS, serverTime: nextStart + 42_000,
  previousRound: beforeRestart.previousRound, players: [],
  you: { x: 0, y: 0, z: 0, health: 100, alive: true },
};
client._reconcile(snapshot);
client._reconcile(snapshot);
assert.equal(changes, 1, 'repeated snapshots duplicated the results screen');
assert.equal(client._matchClock.remaining, 138, 'timer is not derived from server time');
const roundStart = client.matchStart;
client._reconcile({ ...snapshot, mapId: 'missing-arena', matchStart: roundStart + MATCH_DURATION_MS });
assert.equal(client.matchStart, roundStart, 'incomplete map payload consumed the round boundary');
assert.equal(client.mapId, arenas[0].id, 'incomplete map payload changed the map');

// Run the actual Game transition method without booting the renderer.
const gameSource = fs.readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
const method = gameSource.split('  _onAuthoritativeMap(mapId, match = {}, initial = false) {')[1]
  .split('\n  // Reconcile which existing bot slots')[0].trim();
const transition = new Function('mapId', 'match', 'initial', 'document', method.slice(0, -1));
const document = {getElementById:()=>({classList:{add(){}}})};
let shown = 0;
const game = { state: 'playing', _authNet: { client: { you: playerId } },
  world: { currentMapId: 'old' },
  _showLeaderboard(rows) { shown++; this.state = 'leaderboard'; assert(rows[0].isYou); },
  async _activateMap(id, options) {
    assert.equal(this.state, 'leaderboard', 'results disappear before map readiness');
    assert.equal(options.deferFinish, true);
    this.world.currentMapId = id; return {};
  },
  _resetSpectatorCamera() {},
};
await transition.call(game, 'next', { roundEnded: true, results: [{ id: playerId }] }, false, document);
await transition.call(game, 'next', { roundEnded: true }, false, document);
assert.equal(shown, 1);
assert.equal(game.world.currentMapId, 'next', 'next map must load behind results before sending ready');
assert.equal(game._lbTimer, Infinity, 'server readiness, not a local timer, releases results');
assert(gameSource.includes('if (this._authNet) return;'), 'legacy relay can override the dedicated map');

console.log('match clock passed: three-minute rounds survive restarts and rotate continuously');
