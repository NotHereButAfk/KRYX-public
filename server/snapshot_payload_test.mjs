import assert from 'node:assert/strict';
import { AuthRoom } from './authroom.mjs';

const arena = {
  id: 'snapshot-fixture', name: 'Snapshot fixture', half: 200, killY: -20,
  platforms: [], boxes: [], gravLifts: [], teleporters: [],
  spawns: [[0, 0, 0], [40, 0, 40]],
  pickups: [{ x: 50, y: 0, z: 50, markerKind: 'weapon' }],
};
const room = new AuthRoom(arena, { targetPopulation: 8, lootSeed: 42 });
room._rotateMatch = () => false;
let botSends = 0, lootBuilds = 0;
for (const p of room.players.values()) if (p.isBot) p.send = () => botSends++;
const loot = room._lootPadPayload;
room._lootPadPayload = function () { lootBuilds++; return loot.call(this); };
const bot = room.players.values().next().value;
bot.mag = -1;
room.update();
assert.equal(room.players.size, 8, 'optimization changed the bot population');
assert.equal(bot.mag, bot.ammo[bot.wid].mag, 'bot ammo mirror was skipped');
assert.equal(botSends, 0, 'bot no-op transports received browser snapshots');
assert.equal(lootBuilds, 0, 'empty browser room built loot snapshots');

const receivedA = [], receivedB = [];
const a = room.add(message => { if (message.t === 'snapshot') receivedA.push(message); }, 'A');
const b = room.add(message => { if (message.t === 'snapshot') receivedB.push(message); }, 'B');
room.players.get(a).ackTick = 11;
room.players.get(a).lastInputSeq = 11;
room.players.get(b).ackTick = 22;
room.players.get(a).health = 75;
room.players.get(a).healthRegenDelay = 5;
room.players.get(b).mapReady = false;
room.players.get(a).matchWeapons.add('smg');
room.players.get(a).ammo.smg = { mag: 17, reserve: 80 };
room.frags.push({ id: 99, kind: 'timebomb', x: 2, y: 0, z: 3, until: room.tick + 100 });
room.smokes.push({ x: 8, y: 1, z: 3, r: 4, until: room.tick + 100 });
room.projectiles.push({ id: 101, kind: 'rocket', wid: 'rocket', by: a, x: 0, y: 8, z: 0, vx: 1, vy: 0, vz: 0 });
// Payload fixture holds projectiles stationary; movement is covered separately.
room._updateProjectiles = () => {};
lootBuilds = 0;
room.update();
const firstA = receivedA.at(-1), firstB = receivedB.at(-1);
assert(firstA && firstB, 'every human needs a snapshot each tick');
assert.equal(firstA.ack, 11); assert.equal(firstB.ack, 22);
assert.equal(firstA.you.health, 75); assert.equal(firstB.you.health, 100);
assert.equal(firstA.roundGate.pending, 1);
assert.equal(firstB.you.ready, false);
assert.equal(firstA.players.length, 8, 'bots disappeared from public state');
assert.equal(firstA.arena, undefined, 'ready recipient received unnecessary map payload');
assert.equal(firstB.arena.id, arena.id, 'loading recipient lost map payload');
assert.equal(firstA.you.matchWeapon, 'smg');
assert.deepEqual(firstA.you.matchWeapons, ['smg']);
assert.equal(firstA.you.weaponAmmo.smg.mag, 17);
assert.equal(lootBuilds, 2, 'loot is built once for the tick and once for the loading map payload');
for (const key of ['players', 'projectiles', 'bombs', 'smokes', 'lootPads', 'roundGate']) {
  assert.deepEqual(firstA[key], firstB[key], `${key}: recipient values diverged`);
}
const retained = JSON.stringify({
  projectiles: firstA.projectiles, bombs: firstA.bombs, lootPads: firstA.lootPads,
  roundGate: firstA.roundGate, mapLoot: firstB.arena.lootPads,
});
room.lootPads[0].active = false;
room.lootPads[0].respawnTick = room.tick + 20;
room.projectiles[0].x += 9;
room.players.get(b).mapReady = true;
room.update();
assert.equal(JSON.stringify({
  projectiles: firstA.projectiles, bombs: firstA.bombs, lootPads: firstA.lootPads,
  roundGate: firstA.roundGate, mapLoot: firstB.arena.lootPads,
}), retained, 'a later tick mutated an earlier captured shared payload');
assert.equal(receivedA.at(-1).roundGate.pending, 0);
assert.equal(receivedA.at(-1).lootPads[0].active, false);
assert.equal(receivedA.at(-1).projectiles[0].x, 9);
assert.equal(receivedA.length, 2); assert.equal(receivedB.length, 2);
console.log('Snapshot payloads passed: bot ammo sync, human state, readiness, shared world state, retained tick isolation.');
