import assert from 'node:assert/strict';
import { AuthRoom } from './authroom.mjs';
import { getWeapon } from '../src/weapons/weaponDefs.js';

const arena = { id: 'weapon-role-proof', half: 100, platforms: [], boxes: [],
  spawns: [[0, 0, 0], [0, 0, -12]], pickups: [], gravLifts: [], teleporters: [] };
function fixture(wid) {
  const messages = [];
  const room = new AuthRoom(arena);
  const a = room.players.get(room.add(msg => messages.push(msg), 'Shooter'));
  const b = room.players.get(room.add(() => {}, 'Target'));
  Object.assign(a.state, { px: 0, py: 0, pz: 0 });
  Object.assign(b.state, { px: 0, py: 0, pz: -12 });
  a.wid = wid; a.invulnerableUntil = b.invulnerableUntil = 0;
  b.health = 1000;
  const fire = seq => room.onFire(a.id, { seq, wid, yaw: 0, pitch: 0 });
  return { room, a, b, fire, messages };
}

for (const remaining of [36, 2, 1]) {
  const { room, a, fire } = fixture('battlerifle');
  room._weaponState(a, a.wid).mag = remaining;
  fire(1); room.update();
  assert.equal(a.mag, Math.max(0, remaining - 3));
  assert.equal(room.events.filter(e => e.e === 'shot').length, Math.min(3, remaining),
    'a trigger releases exactly as many bullets as the magazine can supply');
  assert.equal(room.events.filter(e => e.e === 'weaponSound').length, 1,
    'multi-projectile bursts must produce one remote sound, not one per pellet');
  fire(2); room.update();
  assert.equal(a.mag, Math.max(0, remaining - 3), 'cooldown blocks burst spam');
}
{
  const { room, a, fire } = fixture('energyshotgun');
  let bullets = 0;
  for (let tick = 0; tick < 20; tick++) {
    fire(tick + 1); room.update();
    bullets += room.events.filter(e => e.e === 'shot').length;
  }
  assert(bullets >= 9 && bullets <= 12, `machine-gun cadence: ${bullets}`);
  assert.equal(a.mag, 80 - bullets, 'Sweeper fires one bullet per round');
  assert.equal(getWeapon('energyshotgun').automatic, true);
}
{
  const { room, a, b, fire, messages } = fixture('plasmarifle');
  fire(1); room.update();
  assert.equal(a.mag, 5);
  assert.equal(room.events.filter(e => e.e === 'weaponSound' && e.wid === 'plasmarifle').length, 1);
  assert(b.health < 1000, 'laser beam applies damage on the firing tick');
  assert.equal(room.projectiles.length, 0, 'laser must not spawn a slow energy projectile');
  assert.equal(getWeapon('plasmarifle').laserBeam, true);
  assert(room.events.some(e => e.e === 'shot' && e.wid === 'plasmarifle'),
    'network clients receive the shot needed to render the laser beam');
}
{
  const { room, a, fire } = fixture('magnum');
  fire(1); room.update();
  assert.equal(a.mag, 5, 'Sheriff cylinder holds six rounds');
  assert.equal(room.events.filter(e => e.e === 'shot').length, 1);
}
{
  const { room, a, b, fire } = fixture('sword');
  b.state.pz = -1.5;
  fire(1); room.update();
  assert.equal(room.events.filter(e => e.e === 'weaponSound' && e.wid === 'sword').length, 1);
  assert(room.events.some(e => e.e === 'hit' && e.wid === 'sword'), 'confirmed blade impacts carry their weapon identity');
  room.events.length = 0;
  room._damage(b, a, 1, false);
  assert.equal(room.events.find(e => e.e === 'hit').wid, null,
    'unrelated damage must not clang just because the attacker holds a sword');
}
console.log('Weapon roles passed: six-shot revolver, automatic Sweeper, exact three-round bursts, networked instant laser beam.');
