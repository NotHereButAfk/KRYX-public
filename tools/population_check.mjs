#!/usr/bin/env node

import assert from 'node:assert/strict';
import { countAuthoritativePlayers, countLocalMatchPlayers } from '../src/core/Population.js';
import { ServerSim } from '../src/core/ServerSim.js';
import { AuthRoom, chooseSafeSpawn } from '../server/authroom.mjs';
import { randomGuestName } from '../server/authserver.mjs';
import { ROOK } from '../server/rookarena.mjs';
import { AuthClient } from '../src/net/AuthClient.js';
import { buildLeaderboardRows, buildMatchRows } from '../src/core/MatchRows.js';
import { readFileSync } from 'node:fs';

const bots = Array.from({ length: 7 }, (_, index) => ({
  isHumanSlot: index < 3,
  displayName: index < 3 ? `Human ${index + 1}` : `Bot ${index - 2}`,
}));

assert.equal(randomGuestName(new Set(), () => 0.000042), 'Guest000042',
  'server guest names must contain exactly six random digits');

assert.equal(countLocalMatchPlayers(bots), 8, 'seven bots plus the local human must count as eight players');
assert.equal(countAuthoritativePlayers([
  { id: 1, isBot: false },
  { id: 2, isBot: true },
  { id: 3, isBot: true },
]), 3, 'authoritative bots must count exactly like authoritative humans');
assert.equal(countAuthoritativePlayers([]), 1, 'the pre-snapshot HUD must retain the local player');

assert.deepEqual(
  chooseSafeSpawn([[0, 0, 0], [4, 0, 0], [30, 0, 0]], [[1, 0, 0]], 0),
  [30, 0, 0],
  'safe spawning must prefer an empty part of the map over an occupied cluster',
);

let displayed = null;
const sim = new ServerSim({
  maxPlayers: 8,
  botManager: { bots, count: bots.length },
  hud: { setServerPop: (count, max) => { displayed = { count, max }; } },
});
sim.start();
assert.deepEqual(displayed, { count: 8, max: 8 }, 'offline HUD must include every bot slot');

const room = new AuthRoom(ROOK, { targetPopulation: 4 });
assert.equal(room.players.size, 4, 'an authoritative room must backfill its configured slots');
assert.equal([...room.players.values()].filter((p) => p.isBot).length, 4);
let welcome = null;
const humanId = room.add((message) => { if (message.t === 'welcome') welcome = message; }, 'Human');
assert.equal(room.players.size, 4, 'a joining human must replace a bot instead of exceeding capacity');
assert.equal(welcome.players.length, 4, 'the welcome roster must immediately include bots');
assert.equal(welcome.players.filter((p) => p.isBot).length, 3);
const serverBotNames = welcome.players.filter((p) => p.isBot).map((p) => p.name);
assert.equal(new Set(serverBotNames).size, serverBotNames.length,
  'authoritative bot names must be unique within the match');
assert.ok(serverBotNames.every((name) => name && !/^BOT \d+$/.test(name)),
  'authoritative bots must receive readable random names instead of numbered placeholders');

const client = new AuthClient('unused');
client._recv(JSON.stringify(welcome));
assert.equal(client.roster.length, 4, 'the client must expose welcome population before the first snapshot');
client.self = { ...client.self, kills: 2, deaths: 1, score: 250 };
const finalRows = buildLeaderboardRows(buildMatchRows({
  authClient: client,
  bots: [], // authoritative play intentionally clears the local BotManager
  playerName: 'Human',
}));
assert.equal(finalRows.length, 4,
  'post-match results must keep every authoritative bot after local bots are cleared');
assert.equal(finalRows.filter((row) => row.isBot).length, 3,
  'post-match results must identify every authoritative bot');
assert.equal(finalRows.find((row) => row.isYou)?.deaths, 1,
  'post-match results must use authoritative deaths and K/D');
const hudSource = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
assert.doesNotMatch(hudSource, /sb-bot-badge/,
  'scoreboard must not add BOT labels beside names');
let firePayload = null;
client.connected = true;
client.lastServerTick = 77;
client.ws = { send: (payload) => { firePayload = JSON.parse(payload); } };
client.sendFire('m4', 0.5, -0.1);
assert.equal(firePayload.viewTick, 77,
  'fire requests must identify the authoritative snapshot the shooter saw');

client._serverClockOffset = performance.now() - (77 * 50 + 25);
client.remoteStates();
client.sendFire('m4', 0.5, -0.1);
assert.equal(firePayload.viewTick, 74, 'shots rewind to the rendered targets, not the newer received snapshot');
const before = [...room.players.values()].filter((p) => p.isBot)
  .map((p) => [p.id, p.state.px, p.state.pz]);
for (let i = 0; i < 40; i++) room.update();
assert.ok(before.some(([id, x, z]) => {
  const p = room.players.get(id);
  return p && Math.hypot(p.state.px - x, p.state.pz - z) > 0.1;
}), 'server bots must actively move rather than filling the roster as inert labels');

for (let i = 0; i < 3; i++) room.add(() => {}, `Human ${i + 2}`);
assert.equal([...room.players.values()].filter((p) => p.isBot).length, 0,
  'four real players, including guests, must remove every server bot');
let fullReply = null;
assert.equal(room.add((message) => { fullReply = message; }, 'Overflow'), null,
  'an extra join must not push a full human room beyond its advertised capacity');
assert.equal(fullReply?.reason, 'match full');
assert.equal(room.players.size, 4);
room.remove(humanId);
assert.equal(room.players.size, 4, 'a vacated human slot must be backfilled by a bot');
assert.equal([...room.players.values()].filter((p) => p.isBot).length, 1);

const fullRoom = new AuthRoom(ROOK, { targetPopulation: 8 });
for (let i = 0; i < 4; i++) fullRoom.add(() => {}, `Full Human ${i + 1}`);
assert.equal(fullRoom.players.size, 8, 'configured maximum must remain fully occupied');
assert.equal([...fullRoom.players.values()].filter((p) => p.isBot).length, 4,
  'empty slots above four real players must still be bot-filled');

const voidArena = {
  id: 'void-proof', name: 'Void Proof', region: 'test', half: 20,
  killY: -2, noBaseFloor: true, platforms: [], boxes: [],
  gravLifts: [], teleporters: [], spawns: [[0, 0, 0]],
};
const voidRoom = new AuthRoom(voidArena);
const voidId = voidRoom.add(() => {}, 'Faller');
const faller = voidRoom.players.get(voidId);
faller.state.py = -3;
faller.state.vy = -1;
faller.state.onGround = 0;
voidRoom.events.length = 0;
voidRoom.update();
assert.equal(faller.alive, false, 'crossing the authoritative kill plane must cause a real death');
assert.equal(faller.deaths, 1, 'a void fall must count on the leaderboard');
assert.ok(voidRoom.events.some((event) => event.e === 'kill' && event.id === voidId && event.wid === 'void'),
  'a void fall must emit an understandable environmental kill event');

const deployWorkflow = readFileSync(new URL('../.github/workflows/deploy-vps.yml', import.meta.url), 'utf8');
assert.match(deployWorkflow, /src\/entities\/BotNames\.js/,
  'the VPS deployment must ship the shared bot-name module imported by the authoritative server');

console.log('player population passed: named bots occupy live/results rosters and void falls count as deaths');

const capped = new AuthRoom(ROOK, {targetPopulation: 8});
for (let humans = 0; humans <= 8; humans++) {
  if (humans) capped.add(() => {}, 'Cap ' + humans);
  assert.equal([...capped.players.values()].filter(p => p.isBot).length, Math.min(8, 8 - humans));
  assert.equal([...capped.players.values()].filter(p => !p.isBot).length, humans);
}
console.log('Eight-bot maximum retains eight human slots.');
