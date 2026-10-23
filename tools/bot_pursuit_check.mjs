import assert from 'node:assert/strict';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';
import { PatrolNavigation } from '../server/patrol-navigation.mjs';
import { getServerArena } from '../server/rookarena.mjs';
import { createState } from '../src/sim/MoveSim.js';

function fixture(baked = false) {
  const boxes = [{ min: [-1, 0, -4], max: [1, 3, 4] }];
  const arena = { id: 'pursuit-cover', half: 40, killY: -20, noBaseFloor: false,
    spawns: [[-4, 0, 0]], platforms: [], boxes, pickups: [], gravLifts: [], teleporters: [],
    groundHeightAt: () => 0,
    raycast(ox, oy, oz, dx, dy, dz, maxT) {
      let result = maxT;
      for (const box of boxes) {
        let near = 0, far = result, hit = true;
        const origin = [ox, oy, oz], direction = [dx, dy, dz];
        for (let axis = 0; axis < 3; axis++) {
          if (Math.abs(direction[axis]) < 1e-9) {
            if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) hit = false;
          } else {
            const a = (box.min[axis] - origin[axis]) / direction[axis];
            const b = (box.max[axis] - origin[axis]) / direction[axis];
            near = Math.max(near, Math.min(a, b));
            far = Math.min(far, Math.max(a, b));
            if (near > far) hit = false;
          }
        }
        if (hit && near >= 0 && far >= 0) result = Math.min(result, near);
      }
      return result;
    },
  };
  if (baked) arena.navigation = {
    points: [[-4, 0, 0], [-4, 0, -6], [4, 0, -6], [4, 0, 0]],
    edges: [[1], [0, 2], [1, 3], [2]], components: [0, 0, 0, 0], landmarks: [0, 1, 2, 3],
  };
  const room = new AuthRoom(arena);
  const bot = room.players.get(room.addBot('Chaser'));
  const target = room.players.get(room.add(() => {}, 'Hidden runner'));
  Object.assign(bot.state, { px: -4, py: 0, pz: 0, onGround: 1 });
  Object.assign(target.state, { px: 25, py: 0, pz: 25, onGround: 1 });
  bot.invulnerableUntil = target.invulnerableUntil = 0;
  bot._botAimYaw = -Math.PI / 2;
  bot._botTargetId = target.id;
  bot._botHostility.set(target.id, 1000);
  bot._botLastSeen = { x: 4.6, y: 0, z: 0 };
  bot._botLastSeenTick = 0;
  room._botCanSee = () => false;
  return { room, bot, target };
}

for (const baked of [false, true]) {
  const { room, bot, target } = fixture(baked);
  const remembered = { ...bot._botLastSeen };
  let detour = 0, reached = false;
  const ticks = Math.ceil(room.botDifficulty.searchDuration * TICK_HZ);
  for (let tick = 0; tick < ticks; tick++) {
    room.update();
    detour = Math.max(detour, Math.abs(bot.state.pz));
    assert.equal(bot._botTargetId, target.id, 'cover caused premature target abandonment');
    assert.deepEqual(bot._botLastSeen, remembered, 'route tracked the hidden live player');
    assert(!room.events.some(event => event.e === 'shot' && event.by === bot.id), 'fired through cover');
    if (Math.hypot(bot.state.px - remembered.x, bot.state.pz - remembered.z) < 1.5) {
      reached = true; break;
    }
  }
  assert(detour > 4.4, `pursuit failed to route around the wall: ${JSON.stringify(bot.state)}`);
  assert(reached, `${baked ? 'baked' : 'dynamic'} pursuit failed to reach remembered position`);
  assert(Math.hypot(bot.state.px - target.state.px, bot.state.pz - target.state.pz) > 20,
    'bot followed hidden live coordinates');
  room.tick = ticks + 1;
  room._driveBot(bot);
  assert.equal(bot._botTargetId, null, 'search did not expire');
  assert.equal(bot._botPursuit, null, 'expired search retained its route');
  assert(!room._patrolNavigation.jobs.has(`pursuit:${bot.id}`), 'expired search retained its job');
}

{
  const { room, bot, target } = fixture();
  // Physics obstruction used to erase a target after three quarter-second
  // steering scans. It now requests another route while search remains valid.
  for (let tick = 0; tick < TICK_HZ * 2; tick++) {
    room.update();
    Object.assign(bot.state, { px: -4, py: 0, pz: 0, vx: 0, vz: 0 });
    assert.equal(bot._botTargetId, target.id);
    assert(!bot._botIgnoredUntil.has(target.id));
  }
  room._resetBotAI(bot);
  assert.equal(bot._botPursuit, null);
  assert(!room._patrolNavigation.jobs.has(`pursuit:${bot.id}`));
}

for (const invalidate of [target => { target.alive = false; },
  target => { target.spectating = true; }, target => { target.mapReady = false; },
  target => { target.invulnerableUntil = 100; }]) {
  const { room, bot, target } = fixture();
  room._driveBot(bot);
  assert(bot._botPursuit);
  invalidate(target);
  room._driveBot(bot);
  assert.equal(bot._botTargetId, null);
  assert.equal(bot._botPursuit, null);
  assert(!room._patrolNavigation.jobs.has(`pursuit:${bot.id}`));
}

{
  const { room, bot, target } = fixture();
  room._driveBot(bot);
  const old = bot._botPursuit;
  const other = room.players.get(room.add(() => {}, 'New opponent'));
  other.invulnerableUntil = 0;
  room._provokeBot(bot, other);
  room._driveBot(bot);
  assert.notEqual(bot._botPursuit, old, 'target switch retained the old route');
  room._kill(bot, target);
  assert.equal(bot._botPursuit, null, 'death retained pursuit');
  assert(!room._patrolNavigation.jobs.has(`pursuit:${bot.id}`));
}

{
  const { room, bot } = fixture();
  room._patrolNavigation = new PatrolNavigation(room);
  const nav = room._patrolNavigation;
  let requests = 0;
  nav.lane = () => null;
  const request = nav.request.bind(nav);
  nav.request = (...args) => { requests++; request(...args); };
  // An unreachable remembered point must not restart a search every tick.
  for (let tick = 0; tick < TICK_HZ * 2; tick++) {
    room.tick = tick;
    room._driveBot(bot);
  }
  assert(requests <= 2, `unreachable target retried ${requests} times in two seconds`);
  room._remove(bot.id, false);
  assert(!nav.jobs.has(`pursuit:${bot.id}`), 'removed bot retained a search job');
}

{
  const arena = getServerArena('fractal');
  const room = new AuthRoom(arena);
  const bot = room.players.get(room.addBot('Fractal chaser'));
  const initial = createState(...arena.spawns[0]);
  bot.state = arena.resolveState({ ...initial }, { ...initial });
  bot._botTargetId = 12345;
  const from = [bot.state.px, bot.state.py, bot.state.pz];
  const nav = room._patrolNavigation = new PatrolNavigation(room);
  const candidates = nav.reachableGoals(from).filter(point => {
    const distance = Math.hypot(point[0] - from[0], point[2] - from[2]);
    return distance > 8 && distance < 35 && Math.abs(point[1] - from[1]) < 5;
  });
  const goal = candidates.find(point => !nav.lane(from, point));
  assert(goal, 'Fractal fixture needs a real obstructed pursuit destination');
  for (let tick = 0; tick < 60 && !bot._botPursuit?.route.length; tick++) {
    room.tick = tick;
    room._botPursuitPoint(bot, goal);
  }
  assert(bot._botPursuit.route.length, 'Fractal pursuit failed to produce a detour');
  let previous = from;
  for (const point of bot._botPursuit.route) {
    const lane = nav.lane(previous, point);
    assert(lane && Math.abs(lane[1] - point[1]) < .7,
      `Fractal pursuit crosses unsupported ground or cover: ${JSON.stringify([previous, point])}`);
    previous = point;
  }
  assert.deepEqual(previous, goal, 'Fractal pursuit stopped before the remembered district');
  console.log(`Fractal pursuit: ${bot._botPursuit.route.length} route points verified against real triangle collision and ground support.`);
}

console.log('Bot pursuit passed: dynamic/baked cover routes, remembered positions, bounded retries, target lifecycle and search expiry.');
