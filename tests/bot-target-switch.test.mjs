import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BotManager } from '../src/entities/BotManager.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';

function localFixture(unseen = .6, hiddenX = 3, visible = true) {
  const world = {}, manager = new BotManager(world, new THREE.Scene());
  const player = { position: new THREE.Vector3(0, 0, -30), isDead: false };
  const hidden = { id: 2, alive: true, position: new THREE.Vector3(hiddenX, 0, 0),
    update() {}, canNotice: () => false, hasLineOfSight: () => false };
  const bot = { id: 1, alive: true, position: new THREE.Vector3(), _targetEntity: hidden,
    _provoked: true, _lastSeenPos: new THREE.Vector3(0, 0, -5), _lastSeenValid: true,
    _unseenTime: unseen, _targetScanT: 0, update() {},
    canNotice: target => visible && target === player,
    hasLineOfSight: target => visible && target === player };
  manager.bots = [bot, hidden];
  manager.update(.016, player, new THREE.PerspectiveCamera(), () => {}, world);
  return { bot, hidden, player };
}

test('offline focus prefers a visible threat after brief occlusion', () => {
  for (const hiddenX of [.1, 3, 150]) {
    const { bot, player } = localFixture(.6, hiddenX);
    assert.equal(bot._targetEntity, player, 'unseen live position monopolized attention');
    assert.equal(bot._lastSeenValid, false, 'new target inherited stale visual data');
  }
  const grace = localFixture(.1, 150);
  assert.equal(grace.bot._targetEntity, grace.hidden, 'short occlusion erased a committed target');
  const blocked = localFixture(.6, 3, false);
  assert.equal(blocked.bot._targetEntity, blocked.hidden, 'unseen alternative stole attention');
});

function serverFixture(unseen = .6, hiddenX = 3, visible = true) {
  const arena = { id: 'target-switch', half: 160, killY: -25, noBaseFloor: false,
    boxes: [], platforms: [], spawns: [[0, 0, 0]], gravLifts: [], teleporters: [], pickups: [],
    groundHeightAt: () => 0 };
  const room = new AuthRoom(arena, { botDifficulty: 'normal', lootSeed: 1, now: 0 });
  const bot = room.players.get(room.addBot('Observer'));
  const hidden = room.players.get(room.add(() => {}, 'Hidden'));
  const visiblePlayer = room.players.get(room.add(() => {}, 'Visible'));
  Object.assign(bot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
  Object.assign(hidden.state, { px: hiddenX, py: 0, pz: 0 });
  Object.assign(visiblePlayer.state, { px: 0, py: 0, pz: -30 });
  for (const p of [bot, hidden, visiblePlayer]) p.invulnerableUntil = 0;
  room.tick = TICK_HZ;
  bot._botTargetId = hidden.id;
  bot._botHostility.set(hidden.id, room.tick + 1000);
  bot._botLastSeen = { x: 0, y: 0, z: -5 };
  bot._botLastSeenTick = room.tick - Math.round(unseen * TICK_HZ);
  bot._botNextScanTick = bot._botNextLosTick = 0;
  bot._botLosCache = false; bot._botAimYaw = 0; bot.fireReq = null;
  // This fixture isolates selection; the awareness suite exercises the actual
  // collision, smoke, field-of-view and spawn-protection visibility queries.
  room._botCanSee = (_observer, target) => visible && target === visiblePlayer;
  return { room, bot, hidden, visiblePlayer };
}

test('authority switches to visible threats using last observations for hidden focus', () => {
  for (const hiddenX of [.1, 3, 150]) {
    const { room, bot, visiblePlayer } = serverFixture(.6, hiddenX);
    room._driveBot(bot);
    assert.equal(bot._botTargetId, visiblePlayer.id);
    assert(bot._botReactionUntil > room.tick, 'switch skipped human reaction time');
    assert.equal(bot.fireReq, null);
  }
  const grace = serverFixture(.1, 150);
  grace.room._driveBot(grace.bot);
  assert.equal(grace.bot._botTargetId, grace.hidden.id);
  const blocked = serverFixture(.6, 3, false);
  const remembered = { ...blocked.bot._botLastSeen };
  blocked.room._driveBot(blocked.bot);
  assert.equal(blocked.bot._botTargetId, blocked.hidden.id);
  assert.deepEqual(blocked.bot._botLastSeen, remembered);
  assert.equal(blocked.bot.fireReq, null);
});

test('reload exit retraces the known firing position instead of chasing through a wall', () => {
  const { room, bot } = serverFixture(.6, 3, false);
  bot._botNextScanTick = Infinity;
  bot._botCoverReturn = { x: -3, y: 0, z: 0 };
  bot._botLastSeen = { x: 0, y: 0, z: -30 };
  bot.mag = 50; bot.reloadUntil = 0; bot.health = 100; bot.shield = 0;
  const command = room._driveBot(bot);
  assert(command.inp.mx < 0, 'bot did not return toward its own clear firing position');
  assert.equal(command.inp.mz, 0, 'bot resumed blind pursuit toward the enemy position');
  assert.equal(bot.fireReq, null, 'returning from cover bypassed fresh sight verification');
});

test('retaliation changes clear target-dependent cover and lane plans; repeated hits preserve intent', () => {
  const { room, bot, hidden, visiblePlayer } = serverFixture();
  function setIntent() {
    bot._botCoverPoint = { x: 3, y: 0, z: 1 };
    bot._botCoverReturn = { x: -2, y: 0, z: 0 };
    bot._botFiringLane = { forward: 0, strafe: -1 };
    bot._botCoverUntil = room.tick + 40;
    bot._botNextCoverTick = room.tick + 20;
    bot._botNextLaneTick = room.tick + 3;
    return {
      point: bot._botCoverPoint, returnPoint: bot._botCoverReturn, lane: bot._botFiringLane,
      coverUntil: bot._botCoverUntil, nextCover: bot._botNextCoverTick, nextLane: bot._botNextLaneTick,
    };
  }
  setIntent();
  assert.equal(bot._botTargetId, hidden.id);
  room._provokeBot(bot, visiblePlayer);
  assert.equal(bot._botTargetId, visiblePlayer.id);
  assert.equal(bot._botCoverPoint, null, 'retaliation kept cover selected for a different enemy');
  assert.equal(bot._botCoverReturn, null, 'retaliation kept the previous enemy firing position');
  assert.equal(bot._botFiringLane, null, 'retaliation reused a lane checked toward the previous enemy');
  for (const field of ['_botCoverUntil', '_botNextCoverTick', '_botNextLaneTick']) {
    assert(bot[field] <= room.tick, `${field}: old target delayed a new movement decision`);
  }
  assert(bot._botReactionUntil > room.tick, 'new attacker bypassed the reaction period');

  const intent = setIntent(), reaction = bot._botReactionUntil;
  room.tick++;
  room._provokeBot(bot, visiblePlayer);
  assert.equal(bot._botTargetId, visiblePlayer.id);
  assert.equal(bot._botCoverPoint, intent.point, 'repeat hit discarded useful cover');
  assert.equal(bot._botCoverReturn, intent.returnPoint, 'repeat hit erased the way out of cover');
  assert.equal(bot._botFiringLane, intent.lane, 'repeat hit discarded the existing firing lane');
  assert.equal(bot._botCoverUntil, intent.coverUntil);
  assert.equal(bot._botNextCoverTick, intent.nextCover);
  assert.equal(bot._botNextLaneTick, intent.nextLane);
  assert.equal(bot._botReactionUntil, reaction, 'repeat hits continually restarted reaction');
});
