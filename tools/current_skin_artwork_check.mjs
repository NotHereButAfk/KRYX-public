import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { REMADE_CHARACTERS, REMADE_GUNS, REMADE_SWORDS } from '../server/remadecollection.mjs';
import { THEMED_SKIN_CARDS, skinArtwork } from '../src/ui/MarketPreview.js';
import { AuthClient } from '../src/net/AuthClient.js';
import { buildMatchRows } from '../src/core/MatchRows.js';

const fallback = '/assets/anime-skin-cards/default-reforged-v2.png';
assert.equal(skinArtwork(), fallback);
assert.equal(skinArtwork({ id: 'arctic_ghost', thumbnail: '/removed-legacy.png' }), fallback);
assert.equal(skinArtwork('missing-skin'), fallback);
assert.equal(skinArtwork('constructor'), fallback);
for (const skin of [...REMADE_CHARACTERS, ...REMADE_GUNS, ...REMADE_SWORDS]) {
  const source = skinArtwork(skin);
  assert.equal(source, THEMED_SKIN_CARDS[skin.id] || skin.thumbnail, `current artwork: ${skin.id}`);
  assert(existsSync(new URL('../public' + source, import.meta.url)), `missing current artwork: ${source}`);
}
const client = new AuthClient('unused');
const arena = { id: 'artwork-check', half: 100, killY: -25, platforms: [], boxes: [] };
const players = [
  { id: 1, name: 'Owner', armorSkin: 'remake_110', kills: 2, health: 100, alive: true },
  { id: 2, name: 'Other player', armorSkin: 'remake_153', kills: 1, health: 100, alive: true },
  { id: 3, name: 'Guest', kills: 0, health: 100, alive: true },
];
client._recv(JSON.stringify({ t: 'welcome', you: 1, players, arena, matchStart: 1, matchDurationMs: 180000 }));
assert.deepEqual(client.roster.map(row => row.armorSkin), ['remake_110', 'remake_153', null]);
let rows = buildMatchRows({ authClient: client });
assert.equal(rows.find(row => row.isYou).armorSkin, 'remake_110');
assert.equal(rows.find(row => row.name === 'Other player').armorSkin, 'remake_153');
players[1].armorSkin = 'remake_154';
client._recv(JSON.stringify({ t: 'snapshot', tick: 1, ack: 0, mapId: arena.id, matchStart: 1,
  you: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, health: 100, alive: true },
  players: players.map(row => ({ ...row, x: row.id, y: 0, z: 0, yaw: 0 })), events: [] }));
rows = buildMatchRows({ authClient: client });
assert.equal(rows.find(row => row.name === 'Other player').armorSkin, 'remake_154', 'snapshot skin changes reach scoreboard');
const hud = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert(!hud.includes('ev-portrait.png'), 'retired portrait must not return');
assert.match(index, /id="inv-profile-picture" src="\/assets\/anime-skin-cards\/default-reforged-v2\.png"/);
console.log('Current skin artwork passed: all 357 Reforged entries resolve to existing art, retired IDs use Default Reforged, and equipped player skins survive welcome/snapshot/scoreboard mapping.');
