import assert from 'node:assert/strict';
import { shotSpread, spreadDirection } from '../src/weapons/ShotSpread.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';
import { WALK_SPEED, SPRINT_MULT } from '../src/sim/MovementConfig.js';
const gun = getWeapon('m4');
const standing = shotSpread(gun, 0, 0, 0);
const walking = shotSpread(gun, 0, 0, WALK_SPEED);
const sprinting = shotSpread(gun, 0, 0, WALK_SPEED * SPRINT_MULT);
assert.equal(standing, 0);
assert.ok(walking > standing && sprinting > walking && sprinting < 0.05 && walking >= 0.030);
assert.equal(shotSpread(gun, 0, 0, 0.1), standing, 'tiny resting drift is not running');
assert.equal(shotSpread(gun, 0, 1, WALK_SPEED), walking, 'ADS cannot remove movement penalty');
assert.ok(shotSpread(gun, 0.01, 0, 0) > standing, 'spread:0 must not disable sustained bloom');
assert.equal(shotSpread(gun, 1, 0, 0), gun.spreadMax);
assert.ok(Math.abs(shotSpread(gun, 0, 0, 100) - sprinting) < 1e-12, 'dash spread stays bounded');
for (const yaw of [0, Math.PI/2, Math.PI, -Math.PI/2]) {
  for (const pitch of [-1.5, -0.7, 0, 0.7, 1.5]) {
    const center = spreadDirection(yaw, pitch, 0, 0);
    const ray = spreadDirection(yaw, pitch, 0.01, -0.008);
    assert.ok(Math.abs(Math.hypot(ray.x,ray.y,ray.z)-1) < 1e-12);
    const dot = center.x*ray.x+center.y*ray.y+center.z*ray.z;
    assert.ok(Math.abs(dot-1/Math.sqrt(1+0.01**2+0.008**2)) < 1e-12,
      'spread cone must not collapse when facing sideways or vertically');
  }
}
console.log('Movement spread, bloom, ADS and aim-plane invariance passed');

// Exercise the authoritative hit resolver, not just the calculation helper.
const { AuthRoom } = await import('../server/authroom.mjs');
const { AUTHORITY_TEST_ARENA } = await import('./fixtures/authorityArena.mjs');
const room = new AuthRoom(AUTHORITY_TEST_ARENA, { targetPopulation: 1 });
const id = room.add(() => {}, 'Runner');
const player = room.players.get(id);
room._rotateMatch = () => false;
room._rand = () => 0.9;
const weapon = { ...gun, pellets: 1, dmg: gun.damage, hs: gun.headshotMultiplier };
function directionAtSpeed(speed) {
  player._animVX = speed; player._animVZ = 0; player.gunBloom = 0;
  room.events.length = 0;
  room._hitscan(player, weapon, 0, 0, false);
  const shot = room.events.find(e => e.e === 'shot');
  assert(shot, 'walking must still produce a shot');
  const x = shot.tx-shot.x, y = shot.ty-shot.y, z = shot.tz-shot.z;
  return Math.hypot(x,y)/Math.max(1e-9, Math.abs(z));
}
assert.equal(directionAtSpeed(0), 0);
assert.ok(directionAtSpeed(WALK_SPEED) > 0);
assert.equal(shotSpread({kind:'melee'}, 0, 0, 100), 0, 'movement must not scatter sword hits');
console.log('Authoritative hit resolver applies movement spread and retains walking shots');
