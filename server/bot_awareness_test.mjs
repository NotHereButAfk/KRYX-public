import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthRoom, TICK_HZ } from './authroom.mjs';
import { createState, step } from '../src/sim/MoveSim.js';
import { botAimErrorMeters } from '../src/entities/BotCombat.js';

// Exercise authoritative perception and commands with real box/smoke rays.
// Keep the arena separate from imported maps and wall-clock match rotation.
function duel({ distance = 60, targetIsBot = false, boxes = [] } = {}) {
  const arena = {
    id: 'bot-awareness-proof', name: 'Bot awareness proof', half: 140,
    killY: -25, noBaseFloor: false, platforms: [], boxes,
    gravLifts: [], teleporters: [], pickups: [], spawns: [[0, 0, 0]],
    groundHeightAt: () => 0,
  };
  const room = new AuthRoom(arena, { botDifficulty: 'normal', lootSeed: 1, now: 0 });
  const bot = room.players.get(room.addBot('Observer'));
  const targetId = targetIsBot ? room.addBot('Opponent') : room.add(() => {}, 'Opponent');
  const target = room.players.get(targetId);
  bot.state = createState(0, 0, 0);
  target.state = createState(0, 0, -distance);
  bot.invulnerableUntil = target.invulnerableUntil = 0;
  bot._botAimYaw = 0;
  bot._botNextScanTick = 0;
  bot._botRoamTarget = [0, 0, -100];
  bot._botRoamUntil = Infinity;
  bot.fireReq = null;
  return { room, bot, target };
}

function driveAt(room, bot, tick) {
  room.tick = tick;
  return room._driveBot(bot);
}

for (const targetIsBot of [false, true]) {
  const kind = targetIsBot ? 'bot' : 'human';
  test(`notices a visible ${kind} at 70m, then runs closer without long-range fire`, () => {
    const { room, bot, target } = duel({ distance: 70, targetIsBot });
    assert(room._botCanSee(bot, target), 'open distant sightline was ignored');
    room._driveBot(bot);
    assert.equal(bot._botTargetId, target.id);
    assert.equal(bot._botState, 'react');
    assert.equal(bot.fireReq, null, 'acquisition skipped the reaction delay');

    const command = driveAt(room, bot, bot._botReactionUntil);
    assert.equal(bot._botState, 'engage');
    assert(command.inp.mz > 0, 'distant opponent did not trigger forward pursuit');
    assert.equal(command.inp.sprint, 1, 'distant pursuit should use ordinary sprint');
    assert.equal(command.botDash, false, 'awareness must not grant a speed boost');
    assert.equal(command.aiming, false, 'distant acquisition extended the aiming range');
    assert.equal(bot.fireReq, null, 'awareness extended the ordinary firing range');
    const moved = step(bot.state, command.inp, room.simWorld);
    assert(moved.pz < bot.state.pz, 'pursuit command did not move toward the target');
  });

  test(`retains an acquired ${kind} at 80m but cannot acquire a fresh one there`, () => {
    const fresh = duel({ distance: 80, targetIsBot });
    assert.equal(fresh.room._botCanSee(fresh.bot, fresh.target), false);
    fresh.room._driveBot(fresh.bot);
    assert.equal(fresh.bot._botTargetId, null, 'tracking distance leaked into new acquisition');

    const { room, bot, target } = duel({ targetIsBot });
    room._driveBot(bot);
    target.state.pz = -80;
    const command = driveAt(room, bot, bot._botReactionUntil + 1);
    assert.equal(bot._botTargetId, target.id, 'pursuit dropped a visible fleeing opponent');
    assert.equal(bot._botLosCache, true, 'tracking did not extend beyond acquisition range');
    assert.equal(bot._botLastSeen.z, -80);
    assert(command.inp.mz > 0, 'retained opponent did not receive a chase command');
    assert.equal(bot.fireReq, null);

    target.state.pz = -91;
    driveAt(room, bot, bot._botNextLosTick);
    assert.equal(bot._botLosCache, false, 'tracking exceeded its bounded distance');
    assert.equal(bot._botLastSeen.z, -80, 'out-of-range position replaced the last sighting');
  });
}

test('acquisition has a 72m boundary and checks for new opponents every quarter second', () => {
  const { room, bot, target } = duel({ distance: 72.1 });
  assert.equal(room._botCanSee(bot, target), false);
  room._driveBot(bot);
  assert.equal(bot._botTargetId, null);
  target.state.pz = -72;
  assert.equal(room._botCanSee(bot, target), true);
  const scanAt = Math.ceil(.25 * TICK_HZ);
  driveAt(room, bot, scanAt - 1);
  assert.equal(bot._botTargetId, null, 'new targets bypassed the perception cadence');
  driveAt(room, bot, scanAt);
  assert.equal(bot._botTargetId, target.id, 'visible target was not noticed at the next scan');
});

test('wide forward vision and nearby peripheral vision still have angular and distance limits', () => {
  const { room, bot, target } = duel();
  const atAngle = (degrees, distance) => {
    const radians = degrees * Math.PI / 180;
    target.state.px = Math.sin(radians) * distance;
    target.state.pz = -Math.cos(radians) * distance;
  };
  atAngle(65, 40);
  assert(room._botCanSee(bot, target), 'the widened forward cone missed a visible opponent');
  atAngle(75, 40);
  assert.equal(room._botCanSee(bot, target), false, 'distant peripheral vision became omnidirectional');
  atAngle(180, 10);
  assert(room._botCanSee(bot, target), 'nearby visible opponent behind the bot was ignored');
  room._driveBot(bot);
  assert.equal(bot._botTargetId, target.id, 'peripheral sight did not acquire the opponent');

  const outside = duel({ distance: -10.1 });
  assert.equal(outside.room._botCanSee(outside.bot, outside.target), false,
    'nearby awareness extended beyond its intended radius');
});

for (const behind of [false, true]) {
  test(`${behind ? 'nearby rear' : 'distant forward'} awareness respects cover and smoke`, () => {
    const distance = behind ? -9 : 60;
    const wallZ = behind ? 4 : -30;
    const { room, bot, target } = duel({ distance });
    assert(room._botCanSee(bot, target), 'fixture must begin with clear sight');
    room.arena.boxes.push({ min: [-5, 0, wallZ - .5], max: [5, 4, wallZ + .5] });
    assert.equal(room._botCanSee(bot, target), false, 'awareness saw through a solid wall');
    room._driveBot(bot);
    assert.equal(bot._botTargetId, null, 'hidden opponent was acquired through cover');

    room.arena.boxes.length = 0;
    room.smokes.push({ x: 0, y: 1.55, z: wallZ, r: 2, until: 1000 });
    bot._botAimYaw = 0;
    assert.equal(room._botCanSee(bot, target), false, 'awareness saw through smoke');
    driveAt(room, bot, bot._botNextScanTick);
    assert.equal(bot._botTargetId, null, 'hidden opponent was acquired through smoke');
  });
}

for (const [name, change] of [
  ['dead', target => { target.alive = false; }],
  ['spawn protected', target => { target.invulnerableUntil = 100; }],
  ['spectating', target => { target.spectating = true; }],
  ['still loading', target => { target.mapReady = false; }],
]) {
  test(`does not notice or acquire a ${name} opponent`, () => {
    const { room, bot, target } = duel({ distance: 12 });
    assert(room._botCanSee(bot, target), 'eligibility fixture must begin with visible opposition');
    change(target);
    assert.equal(room._botCanSee(bot, target), false);
    room._driveBot(bot);
    assert.equal(bot._botTargetId, null);
    assert.equal(bot.fireReq, null);
  });
}

test('search follows the frozen last sighting for seven seconds, then expires', () => {
  const { room, bot, target } = duel({ distance: 12 });
  room._driveBot(bot);
  const remembered = { ...bot._botLastSeen };
  const seenAt = bot._botLastSeenTick;
  room.arena.boxes.push({ min: [-120, 0, -6], max: [120, 4, -5] });
  for (const [elapsed, x, z] of [[1, 20, -20], [7, 35, -30]]) {
    target.state.px = x;
    target.state.pz = z;
    driveAt(room, bot, seenAt + elapsed * TICK_HZ);
    assert.equal(bot._botTargetId, target.id, 'lost target was forgotten before the search window');
    assert.equal(bot._botState, 'search');
    assert.deepEqual(bot._botLastSeen, remembered, 'search read the hidden live position');
    assert.equal(bot._botLastSeenTick, seenAt, 'hidden target refreshed its visibility timestamp');
    assert.equal(bot.fireReq, null, 'search shot through cover');
  }
  driveAt(room, bot, seenAt + Math.ceil(7.5 * TICK_HZ) + 1);
  assert.equal(bot._botTargetId, null, 'search kept chasing indefinitely');
  assert.equal(bot._botState, 'roam');
});

test('reappearing opponents receive a fresh casual reaction window', () => {
  const { room, bot } = duel({ distance: 12 });
  room._driveBot(bot);
  room.smokes.push({ x: 0, y: 1.55, z: -6, r: 2, until: 1000 });
  driveAt(room, bot, TICK_HZ);
  assert.equal(bot._botLosCache, false);
  assert.equal(bot.fireReq, null);
  room.smokes.length = 0;
  driveAt(room, bot, TICK_HZ * 2);
  const reactionTicks = bot._botReactionUntil - room.tick;
  assert(reactionTicks >= Math.ceil(.28 * TICK_HZ));
  assert(reactionTicks <= Math.ceil(.48 * TICK_HZ));
  assert.equal(bot._botState, 'react');
  assert.equal(bot.fireReq, null, 'reacquisition fired immediately');
});

test('wider awareness preserves forgiving aim, gradual turning, and reaction before fire', () => {
  const { room, bot, target } = duel({ distance: 12 });
  target.state.px = 9;
  const desired = Math.atan2(-target.state.px, -target.state.pz);
  room._driveBot(bot);
  assert(Math.abs(bot._botAimYaw) > 0, 'bot did not begin facing its opponent');
  assert(Math.abs(bot._botAimYaw) < Math.abs(desired), 'acquisition snapped to perfect aim');
  assert.equal(room.botDifficulty.aimErrorScale, 1.1, 'awareness increased shooting accuracy');
  assert(botAimErrorMeters(30, room.botDifficulty.aimErrorScale) > .9,
    'casual world-space scatter became a perfect aim lock');
  const reactionUntil = bot._botReactionUntil;
  assert(reactionUntil >= Math.ceil(.28 * TICK_HZ));
  assert(reactionUntil <= Math.ceil(.48 * TICK_HZ));
  for (let tick = 1; tick < reactionUntil; tick++) {
    driveAt(room, bot, tick);
    assert.equal(bot.fireReq, null, 'new target was fired on before the reaction window ended');
  }
  driveAt(room, bot, reactionUntil);
  assert(bot.fireReq, 'reaction ended without allowing normal close-range fire');
});
