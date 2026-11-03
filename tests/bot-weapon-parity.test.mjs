import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Bot } from '../src/entities/Bot.js';
import { BOT_RANGED_LOADOUTS, advanceBotMagazine } from '../src/entities/BotCombat.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';
import { advanceFireCooldown, scheduleNextShot } from '../src/weapons/FireControl.js';
import { AuthRoom, TICK_HZ } from '../server/authroom.mjs';

const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8,
  `${label}: ${actual} != ${expected}`);
function withRandom(values, callback) {
  const original = Math.random;
  let index = 0;
  Math.random = () => values[index++ % values.length];
  try { return callback(); } finally { Math.random = original; }
}

// Run the real firing method and Three ray/sphere intersections without loading
// a rendered character. Only presentation, the muzzle and world query are fakes.
function fixture(id = 'battlerifle', { height = 1.05, crouching = false, sliding = false } = {}) {
  const bot = Object.create(Bot.prototype);
  const target = { position: new THREE.Vector3(0, 0, -12), isCrouching: crouching, isSliding: sliding };
  const rays = [], sounds = [], origins = [], damage = [];
  let flashes = 0, obstruction = Infinity;
  Object.assign(bot, {
    id: 2, position: new THREE.Vector3(), mesh: new THREE.Object3D(),
    _botGun: BOT_RANGED_LOADOUTS.find(weapon => weapon.id === id),
    _shootFrom: new THREE.Vector3(), _shootTarget: new THREE.Vector3(),
    _shootDir: new THREE.Vector3(), _bulletRay: new THREE.Ray(),
    _sphere: new THREE.Sphere(), _hitPt: new THREE.Vector3(),
    _lastSeenPos: target.position.clone(), _observation: null,
    _perceptionTime: 0, _encounterTime: 0, _aimSkill: 0, _animSpeed: 0, _shotBloom: 0,
    _gunKick: 0, _muzzleT: 0,
    audio: {
      playAt(point, callback) { origins.push(point.clone()); callback(); },
      playShot(sound, rounds) { sounds.push({ sound, rounds }); },
    },
  });
  // Choose an explicit sight line; the collision target remains at its real feet.
  bot._lastSeenPos.y = height - (crouching || sliding ? .65 : 1.05);
  bot.mesh.userData.getMuzzleWorldPosition = output => { output.set(0, height, 0); return true; };
  bot.mesh.userData.triggerFire = () => flashes++;
  const world = { raycastCollisionDistance(ray, range) {
    rays.push({ origin: ray.origin.clone(), direction: ray.direction.clone(), range });
    return obstruction;
  } };
  return { bot, target, rays, sounds, origins, damage, world,
    get flashes() { return flashes; },
    set obstruction(value) { obstruction = value; },
    fire(rounds = 1) { return bot._shootAt(target, (amount, from, attacker) => {
      assert.equal(attacker, bot); assert.equal(from, bot.position); damage.push(amount);
    }, world, rounds); },
  };
}

for (const loadout of BOT_RANGED_LOADOUTS) {
  assert.deepEqual(loadout, getWeapon(loadout.id), `${loadout.id}: bot weapon drifted from player catalog`);
}

for (const remaining of [36, 3, 2, 1]) {
  const f = fixture(), rounds = Math.min(remaining, f.bot._botGun.ammoPerShot);
  assert.equal(withRandom([.5], () => f.fire(rounds)), true);
  assert.equal(f.rays.length, rounds, 'burst traced more/fewer rounds than supplied');
  assert.deepEqual(f.damage, Array(rounds).fill(22));
  assert.deepEqual(f.sounds, [{ sound: 'battlerifle', rounds }], 'one sound must describe the entire actual burst');
  assert.equal(f.origins.length, 1); assert.equal(f.flashes, 1);
  assert(f.origins[0].equals(f.rays[0].origin), 'sound did not originate at the muzzle');
  assert(f.rays.every(ray => ray.range === getWeapon('battlerifle').range));
  const magazine = advanceBotMagazine(remaining, 0, 0, f.bot._botGun, true);
  assert.equal(magazine.ammo, remaining - rounds);
  assert.equal(magazine.reloadRemaining, remaining === rounds ? f.bot._botGun.reloadTime : 0);
}

// Alternating offsets must begin from the same aim direction. Accumulating the
// first pellet's perturbation into the next makes the second land at the centre.
{
  const f = fixture();
  withRandom([0, .5, 1, .5, .5, .5], () => f.fire(3));
  const [left, right, centre] = f.rays.map(ray => ray.direction);
  assert(left.x < 0 && right.x > 0);
  close(left.x, -right.x, 'independent horizontal pellet spread');
  close(left.z, right.z, 'independent forward pellet direction');
  close(centre.x, 0, 'third pellet retained a previous offset');
  close(centre.y, 0, 'neutral vertical spread');
  assert.deepEqual(f.damage, [22, 22, 22]);
}

for (const height of [1.05, 1.60]) {
  const f = fixture('battlerifle', { height }); f.obstruction = 5;
  withRandom([.5], () => f.fire(3));
  assert.equal(f.rays.length, 3, 'wall must be checked for every pellet');
  assert.deepEqual(f.damage, [], 'wall failed to block body/head damage');
  assert.equal(f.sounds.length, 1, 'blocked bullets should still report firing once');
}

for (const test of [
  { height: 1.05, critical: false },
  { height: 1.60, critical: true },
  // Both spheres intersect these lines; only the nearest may decide damage.
  { height: 1.40, critical: false },
  { height: 1.45, critical: true },
  { height: .65, crouching: true, critical: false },
  { height: 1.16, crouching: true, critical: true },
  { height: .65, sliding: true, critical: false },
  { height: 1.16, sliding: true, critical: true },
]) {
  const f = fixture('battlerifle', test); f.obstruction = 14;
  withRandom([.5], () => f.fire(1));
  assert.equal(f.damage.length, 1, JSON.stringify(test));
  close(f.damage[0], 22 * (test.critical ? 1.8 : 1), `nearest hit zone ${JSON.stringify(test)}`);
  assert.equal(f.bot._shotHeadshot, test.critical);
}
for (const posture of ['crouching', 'sliding']) {
  const f = fixture('battlerifle', { height: 1.6, [posture]: true });
  withRandom([.5], () => f.fire(1));
  assert.deepEqual(f.damage, [], `${posture}: standing-height ghost hitbox remained`);
  assert.equal(f.bot._shotHeadshot, false);
}

// The Laser Rifle is an instant 65-damage hit, despite dormant energyBlast
// metadata. It must not apply extra splash damage or emit a second report.
{
  const f = fixture('plasmarifle');
  withRandom([.5], () => f.fire());
  assert.deepEqual(f.damage, [65]);
  assert.equal(f.rays.length, 1);
  assert.deepEqual(f.sounds, [{ sound: 'plasmarifle', rounds: 1 }]);
}

for (const failure of ['missing', 'unready', 'empty']) {
  const f = fixture();
  if (failure === 'missing') delete f.bot.mesh.userData.getMuzzleWorldPosition;
  if (failure === 'unready') f.bot.mesh.userData.getMuzzleWorldPosition = () => false;
  assert.equal(f.fire(failure === 'empty' ? 0 : 3), false);
  assert.equal(f.flashes, 0); assert.equal(f.bot._gunKick, 0); assert.equal(f.bot._muzzleT, 0);
  assert.deepEqual(f.rays, []); assert.deepEqual(f.sounds, []); assert.deepEqual(f.damage, []);
}
{
  const br = getWeapon('battlerifle');
  assert.deepEqual(advanceBotMagazine(0, br.reloadTime, .5, br, true),
    { ammo: 0, reloadRemaining: br.reloadTime - .5 }, 'reload permitted another shot');
  assert.deepEqual(advanceBotMagazine(0, .1, .1, br),
    { ammo: br.magSize, reloadRemaining: 0 }, 'reload did not restore the catalog magazine');
}

// Native cadence preserves fractional-frame debt instead of adding bot burst
// pauses. One render frame may release at most one trigger, including a hitch.
for (const weapon of BOT_RANGED_LOADOUTS) for (const hz of [30, 60, 144]) {
  const duration = 8, shots = []; let cooldown = 0;
  for (let frame = 0; frame < duration * hz; frame++) {
    cooldown = advanceFireCooldown(cooldown, 1 / hz);
    if (cooldown <= 0) {
      shots.push(frame / hz);
      cooldown = scheduleNextShot(cooldown, weapon.fireRate);
    }
  }
  assert(Math.abs(shots.length - duration / weapon.fireRate) <= 1,
    `${weapon.id}@${hz}Hz: cadence slowed to ${shots.length} shots`);
  for (let index = 1; index < shots.length; index++) {
    assert(shots[index] - shots[index - 1] <= weapon.fireRate + 1 / hz + 1e-8,
      `${weapon.id}@${hz}Hz: non-weapon pause between triggers`);
  }
  assert(scheduleNextShot(advanceFireCooldown(0, 5), weapon.fireRate) >= 0,
    `${weapon.id}: hitch accumulated an unbounded firing backlog`);
}

// Exercise the complete server firing path, including bot decisions, onFire,
// native cooldown, hit resolution and ammunition. Only locomotion is held still
// so aim alignment cannot obscure a second, bot-only fire-rate limiter.
for (const id of ['m4', 'uzi']) {
  const weapon = getWeapon(id);
  const arena = { id: `server-cadence-${id}`, half: 160, killY: -25, noBaseFloor: false,
    boxes: [], platforms: [], spawns: [[0, 0, 0]], gravLifts: [], teleporters: [], pickups: [],
    groundHeightAt: () => 0 };
  const room = new AuthRoom(arena, { botDifficulty: 'normal' });
  const bot = room.players.get(room.addBot('Cadence observer'));
  const target = room.players.get(room.add(() => {}, 'Cadence target'));
  Object.assign(bot.state, { px: 0, py: 0, pz: 0, onGround: 1 });
  Object.assign(target.state, { px: 0, py: 0, pz: -20, onGround: 1 });
  bot.invulnerableUntil = target.invulnerableUntil = 0;
  target.health = 10000;
  bot.wid = id;
  bot.matchWeapons.add(id); // Uzi is an earned pickup, not a permanent main gun.
  const magazine = room._weaponState(bot, id);
  bot.mag = magazine.mag;
  bot._botAimYaw = 0;
  bot._botAimPitch = Math.atan2(1.05 - 1.7, 20);
  room._steerBotMove = () => [0, 0];
  const shots = [], sounds = [];
  const measurementTicks = Math.round(TICK_HZ * 1.5);
  for (let tick = 0; tick < TICK_HZ * 3; tick++) {
    room.update();
    const events = room.events.filter(event => event.by === bot.id && event.wid === id);
    const projectiles = events.filter(event => event.e === 'shot');
    assert(projectiles.length <= 1, `${id}: multiple triggers fired in one authority tick`);
    for (const event of projectiles) {
      assert([event.tx, event.ty, event.tz].every(Number.isFinite));
      shots.push(room.tick);
    }
    sounds.push(...events.filter(event => event.e === 'weaponSound'));
    if (shots.length && room.tick >= shots[0] + measurementTicks) break;
  }
  assert(shots.length && shots[0] <= TICK_HZ, `${id}: acquisition never reached a firing state`);
  assert.equal(room.tick, shots[0] + measurementTicks, `${id}: incomplete cadence measurement`);
  assert.equal(sounds.length, shots.length, `${id}: report count diverged from resolved shots`);
  assert.equal(magazine.mag, weapon.magSize - shots.length, `${id}: cadence bypassed real ammunition`);
  assert(magazine.mag > 0 && bot.reloadUntil <= room.tick, `${id}: reload contaminated the short cadence window`);
  assert(target.alive && target.health < 10000, `${id}: fixture did not resolve actual combat damage`);
  const intervalTicks = weapon.fireRate * TICK_HZ;
  const gaps = shots.slice(1).map((tick, index) => tick - shots[index]);
  assert(gaps.includes(Math.floor(intervalTicks)) && gaps.includes(Math.ceil(intervalTicks)),
    `${id}: native fractional cadence was rounded up on every shot: ${gaps}`);
  for (let index = 1; index < shots.length; index++) {
    assert(Math.abs((shots[index] - shots[0]) - index * intervalTicks) <= 1 + 1e-8,
      `${id}: extra firing delay accumulated at authority shot ${index}`);
  }
}

console.log('Bot weapon parity passed: actual burst rays/audio, cover and criticals, magazines, 30/60/144Hz timing, and full authority M4/Uzi fractional cadence.');
