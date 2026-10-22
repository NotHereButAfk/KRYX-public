import assert from 'node:assert/strict';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { BOT_RETALIATION_AIM_SCALE } from '../src/entities/BotCombat.js';

// Exercise actual authoritative ray shots, rather than treating scatter as
// a hit probability. Compare identical duels with the previous 1.65x miss radius.
const arena = { id: 'balance', half: 100, killY: -20, noBaseFloor: false,
  spawns: [[0, 0, 0]], platforms: [], boxes: [], gravLifts: [], teleporters: [], pickups: [],
  groundHeightAt: () => 0, raycast: (_x, _y, _z, _dx, _dy, _dz, far) => far };
function duels(oldScatter = false, moving = false) {
  let damage = 0, shots = 0, hits = 0;
  for (let trial = 0; trial < 24; trial++) {
    const room = new AuthRoom(arena, { botDifficultyOverrides: {
      aimErrorScale: 1.2 * (oldScatter ? 1.65 / BOT_RETALIATION_AIM_SCALE : 1),
    } });
    const bot = room.players.get(room.addBot('Opponent'));
    const player = room.players.get(room.add(() => {}, 'Player'));
    room.tick = trial * 31;
    Object.assign(bot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
    Object.assign(player.state, { px: 0, py: 0, pz: -(8 + trial % 3 * 6), onGround: 1 });
    bot.invulnerableUntil = player.invulnerableUntil = 0;
    bot._botAimYaw = 0;
    room._damage(bot, player, 1, false);
    const start = room.tick;
    let firstShot = null;
    for (let i = 0; i < TICK_HZ * 8; i++) {
      // Reset victim health to measure incoming damage without respawn or regen.
      player.health = 100; player.shield = 0; player.healthRegenDelay = 999;
      if (moving) player.state.px = Math.sin(i / TICK_HZ * 1.4) * 4;
      room.update();
      const shotCount = room.events.filter(e => e.e === 'shot' && e.by === bot.id).length;
      shots += shotCount;
      if (shotCount && firstShot === null) firstShot = (room.tick - start) / TICK_HZ;
      const dealt = Math.max(0, 100 - player.health);
      damage += dealt; hits += Number(dealt > 0);
    }
    assert(firstShot >= .25, 'bot fired before a readable reaction interval');
  }
  return { damage, shots, hits, hitRate: hits / shots, damagePerSecond: damage / (24 * 8) };
}
const previous = duels(true), current = duels(), moving = duels(false, true);
assert(current.damage > previous.damage * 1.25, 'return fire still fails to pressure exposed players');
assert(current.hitRate > .04 && current.hitRate < .45, 'normal bots must hit sometimes and miss most shots');
assert(current.damagePerSecond < 20 && moving.damagePerSecond < 20, 'casual bots became too punishing');
console.log('Authoritative bot balance (24 eight-second duels per scenario):', { previous, current, moving });

// A real untouched player must be killable, not just receive cosmetic damage.
const room = new AuthRoom(arena);
const bot = room.players.get(room.addBot('Hunter'));
const player = room.players.get(room.add(() => {}, 'Exposed'));
Object.assign(bot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
Object.assign(player.state, { px: 0, py: 0, pz: -10, onGround: 1 });
bot._botAimYaw = 0;
player.invulnerableUntil = room.tick + TICK_HZ;
for (let i = 0; i < TICK_HZ - 1; i++) room.update();
assert.equal(bot._botTargetId, null, 'spawn-protected player was targeted');
let deathAt = null;
for (let i = 0; i < TICK_HZ * 60; i++) {
  room.update();
  if (!player.alive) { deathAt = room.tick / TICK_HZ; break; }
}
assert(deathAt !== null && deathAt > 3, 'on-sight bot must earn a kill without instant deletion');
console.log(`Unprovoked exposed player killed after ${deathAt.toFixed(1)}s; spawn protection respected.`);

const coverRoom = new AuthRoom({ ...arena, raycast: undefined,
  boxes: [{ min: [-5, 0, -6], max: [5, 4, -4] }] });
const guard = coverRoom.players.get(coverRoom.addBot('Guard'));
const hidden = coverRoom.players.get(coverRoom.add(() => {}, 'Hidden'));
Object.assign(guard.state, { px: 0, py: 0, pz: 0 });
Object.assign(hidden.state, { px: 0, py: 0, pz: -10 });
guard._botAimYaw = 0; hidden.invulnerableUntil = 0;
coverRoom._driveBot(guard);
assert.equal(guard._botTargetId, null, 'bot acquired a player through a wall');
hidden.state.pz = 10;
guard._botNextScanTick = 0;
coverRoom._driveBot(guard);
assert.equal(guard._botTargetId, null, 'bot acquired a player behind its field of view');
console.log('On-sight acquisition respects solid cover and field of view.');
