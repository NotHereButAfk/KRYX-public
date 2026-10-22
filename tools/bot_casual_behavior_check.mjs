import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { BotManager } from '../src/entities/BotManager.js';
import { chooseBotCoverPoint, shouldBotTacticalReload } from '../src/entities/BotCombat.js';

const arena = { id: 'casual-bots', half: 80, killY: -20, noBaseFloor: false,
  spawns: [[0, 0, 0]], platforms: [], boxes: [], gravLifts: [], teleporters: [], pickups: [],
  groundHeightAt: () => 0 };
function duel(extra = {}) {
  const room = new AuthRoom({ ...arena, ...extra });
  const bot = room.players.get(room.addBot('Casual'));
  const target = room.players.get(room.add(() => {}, 'Opponent'));
  Object.assign(bot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
  Object.assign(target.state, { px: 0, py: 0, pz: -12, onGround: 1 });
  bot.invulnerableUntil = target.invulnerableUntil = 0;
  bot._botAimYaw = 0;
  bot._botNextScanTick = 0;
  bot.fireReq = null;
  return { room, bot, target };
}

{
  const { room, bot, target } = duel();
  assert(room._botCanSee(bot, target), 'fixture must have an open sightline');
  room.smokes.push({ x: 0, y: 1.55, z: -6, r: 2, until: 100 });
  assert.equal(room._botCanSee(bot, target), false, 'smoke must conceal players from bots');
  room.smokes.length = 0;
  room._driveBot(bot);
  room.tick = bot._botReactionUntil + 1;
  bot.blindUntil = room.tick + 30;
  bot._botLosCache = true; bot.fireReq = null;
  room._driveBot(bot);
  assert.equal(bot.fireReq, null, 'flash must immediately block fire even with cached LOS');
  bot.blindUntil = 0;
  assert(room._botCanSee(bot, target), 'vision must recover when flash ends');
}

{
  const { room, bot, target } = duel();
  room._driveBot(bot);
  const remembered = { ...bot._botLastSeen };
  room._botCanSee = () => false;
  bot._botNextLosTick = 0;
  target.state.px = 40;
  for (let tick = 1; tick <= TICK_HZ * 2; tick++) {
    room.update();
    assert.equal(bot._botTargetId, target.id, 'bot forgot its last sighting too quickly');
    assert.deepEqual(bot._botLastSeen, remembered, 'search tracked the hidden live player');
    assert.equal(bot.fireReq, null, 'search fired without sight');
    assert.equal(room.events.filter(event => event.e === 'shot' && event.by === bot.id).length, 0);
  }
  room.tick = Math.ceil(room.botDifficulty.searchDuration * TICK_HZ) + 1;
  room._driveBot(bot);
  assert.equal(bot._botTargetId, null, 'search must expire rather than pursue forever');
}

{
  const { room, bot, target } = duel();
  room._driveBot(bot);
  room.tick = TICK_HZ;
  bot._botLosCache = false; bot._botNextLosTick = 0;
  room._driveBot(bot);
  assert(bot._botReactionUntil - room.tick >= Math.ceil(.28 * TICK_HZ),
    'reappearing targets must receive a fresh reaction window');
  assert.equal(bot.fireReq, null, 'reacquisition fired immediately');
  // A smoke cloud appearing between perception scans must also stop the shot.
  room.tick = bot._botReactionUntil + 1;
  bot._botLosCache = true; bot._botLosTargetId = target.id;
  bot._botNextLosTick = room.tick + TICK_HZ;
  room.smokes.push({ x: 0, y: 1.55, z: -6, r: 2, until: room.tick + 100 });
  room._driveBot(bot);
  assert.equal(bot.fireReq, null, 'cached sight allowed a shot through new smoke');
}

{
  const { room, bot } = duel({ boxes: [{ min: [1.8, 0, -4], max: [4.2, 2.8, -2] }] });
  room._driveBot(bot);
  room.tick = bot._botReactionUntil + 1;
  const ammo = room._weaponState(bot);
  ammo.mag = bot.mag = 10;
  room._startReload(bot);
  const command = room._driveBot(bot);
  assert(bot._botCoverPoint, 'reloading bot failed to choose adjacent real cover');
  assert(bot._botCoverPoint.x > 1, 'cover route moves away from the occluding wall');
  assert(command.inp.mx > 0, 'reloading bot did not move toward its cover');
  const destination = { ...bot._botCoverPoint };
  Object.assign(bot.state, { px: destination.x, py: destination.y, pz: destination.z });
  room.tick++;
  const held = room._driveBot(bot);
  assert.equal(held.inp.mx, 0, 'bot shuffled after reaching cover');
  assert.equal(held.inp.mz, 0, 'bot left cover before finishing reload');
  assert.deepEqual(bot._botCoverPoint, destination, 'cover choice changed every tick');
}

assert.equal(chooseBotCoverPoint({ x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: -12,
  groundHeightAt: () => -Infinity, raycast: () => 0 }), null, 'cover planner accepted unsupported ground');
assert.equal(chooseBotCoverPoint({ x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: -12,
  groundHeightAt: () => 0, raycast: (...args) => args.at(-1) }), null, 'empty space was treated as cover');
assert.equal(shouldBotTacticalReload(12, 50, .6), true);
assert.equal(shouldBotTacticalReload(12, 50, 0), false, 'bot reloads while exposed with useful ammo');
assert.equal(shouldBotTacticalReload(45, 50, 3), false, 'bot reloads after every burst');
{
  const { room, bot } = duel();
  room._weaponState(bot).mag = bot.mag = 10;
  room._botCanSee = () => false;
  room._driveBot(bot);
  assert(bot.reloadUntil > room.tick, 'idle bot did not top up a nearly empty magazine');
}

{
  const fake = (id, x, visible = true) => ({ id, position: new THREE.Vector3(x, 0, -8),
    alive: true, health: 100, isBot: true, visible, update() {}, canNotice: other => other.visible,
    takeDamage() {} });
  const bot = fake(1, 0), first = fake(2, 8), second = fake(3, 9), hidden = fake(4, .5, false);
  const player = { position: new THREE.Vector3(100, 0, 0), isDead: false, visible: true };
  const manager = new BotManager(null, null);
  manager.bots = [bot, first, second, hidden];
  manager.update(.1, player, null, () => {}, null);
  assert.equal(bot._targetEntity, first, 'hidden nearest body stole attention from visible opponent');
  second.position.x = 7.8;
  for (let i = 0; i < 10; i++) manager.update(.05, player, null, () => {}, null);
  assert.equal(bot._targetEntity, first, 'small distance changes caused frame-by-frame target switching');
  first.alive = false;
  manager.update(.05, player, null, () => {}, null);
  assert.equal(bot._targetEntity, second, 'dead target was retained');
  bot._retaliationTarget = 'player';
  manager.update(.05, player, null, () => {}, null);
  assert.equal(bot._targetEntity, player, 'offline bot ignored the player who just hit it');
}
console.log('Casual bot behavior passed: smoke/flash, fair reacquisition, bounded last-seen search, real cover, tactical reload and stable visible target selection.');
