import assert from 'node:assert/strict';
import {
  chooseAvailableMatch,
  findAvailableMatch,
  matchmakingUrlFor,
} from '../src/net/Matchmaker.js';

assert.equal(matchmakingUrlFor('wss://one.kryx.live/socket'), 'https://one.kryx.live/api/matchmake');
assert.equal(matchmakingUrlFor('ws://127.0.0.1:8788'), 'http://127.0.0.1:8788/api/matchmake');

const selected = chooseAvailableMatch([
  { url: 'wss://busy', available: true, humans: 6, remainingMs: 300000, latencyMs: 10 },
  { url: 'wss://full', available: false, humans: 8, remainingMs: 400000, latencyMs: 2 },
  { url: 'wss://free-old', available: true, humans: 2, remainingMs: 10000, latencyMs: 5 },
  { url: 'wss://free', available: true, humans: 2, remainingMs: 250000, latencyMs: 20 },
]);
assert.equal(selected.url, 'wss://free', 'did not select the freest stable server');

const replies = new Map([
  ['https://a.kryx.live/api/matchmake', { available: false, humans: 8, mapId: 'daytime-rook' }],
  ['https://b.kryx.live/api/matchmake', { available: true, humans: 3, mapId: 'winter-graveyard' }],
]);
const match = await findAvailableMatch(['wss://a.kryx.live', 'wss://b.kryx.live'], async (url) => ({
  ok: true,
  json: async () => replies.get(url),
}));
assert.equal(match.url, 'wss://b.kryx.live');
assert.equal(match.mapId, 'winter-graveyard', 'selected server map was lost before loading');

await assert.rejects(
  findAvailableMatch(['wss://a.kryx.live'], async () => ({
    ok: true, json: async () => ({ available: false, humans: 8 }),
  })),
  /free player slot/,
);

console.log('matchmaker passed: free-server selection and pre-load arena identity are stable');
