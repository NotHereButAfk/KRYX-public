#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { consumeThrowable } from '../src/core/GameplayInput.js';
import { GrenadeSystem } from '../src/weapons/GrenadeSystem.js';
import { applyAuthoritativeResources } from '../src/net/AuthoritativePresentation.js';
import { updateExplosion } from '../src/effects/ExplosionEffect.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';

const inputFor = (pressed) => ({
  consumeJustPressed(code) { return code === pressed; },
});
assert.equal(consumeThrowable(inputFor('KeyU')), 'frag', 'U is not wired to frag');
assert.equal(consumeThrowable(inputFor('KeyF')), 'smoke', 'F is not wired to smoke');
assert.equal(consumeThrowable(inputFor('KeyE')), 'impulse', 'E must trigger knockback');

const system = new GrenadeSystem(new THREE.Scene());
let routedDamage = 0;
system.onSelfDamage = (damage) => { routedDamage += damage; };
const player = { position: new THREE.Vector3(), takeDamage: () => assert.fail('bypassed Game death flow') };
system._fragExplode(new THREE.Vector3(), player);
assert.equal(routedDamage, 150, 'frag self-damage did not route through the Game damage/death callback');
assert.equal(system.explosions.length, 1, 'frag did not create a visible explosion');
const visibleExplosion = system.explosions[0];
assert.ok(visibleExplosion.root.children.length >= 6, 'frag explosion is missing layered fire/smoke/sparks');
assert.ok(visibleExplosion.root.position.y > 0, 'frag explosion is buried in the floor');
assert.ok(visibleExplosion.life >= 1.2, 'frag explosion disappears too quickly to see');
assert.ok(visibleExplosion.radius >= 6.5, 'frag explosion radius is still undersized');
updateExplosion(visibleExplosion, 0.1);
assert.ok(visibleExplosion.shockwave.scale.x > 1, 'frag shockwave did not visibly expand');

assert.ok(getWeapon('rpg').splashRadius >= 7, 'rocket launcher blast radius is still undersized');
assert.ok(getWeapon('concussion').splashRadius >= 4, 'grenade launcher must retain area damage');

// A swept collision must bounce off elevated map geometry. The previous y=0
// check let the same grenade pass through every upper platform.
const collisionSystem = new GrenadeSystem(new THREE.Scene());
const throwableMesh = new THREE.Group();
collisionSystem.throwables.push({
  mesh: throwableMesh,
  pos: new THREE.Vector3(0, 1.4, 0),
  vel: new THREE.Vector3(0, -10, 0),
  type: 'frag',
  life: 2,
});
const elevatedFloor = {
  raycastCollisionHit(ray, far) {
    if (ray.direction.y >= 0) return null;
    const distance = (1 - ray.origin.y) / ray.direction.y;
    if (distance < 0 || distance > far) return null;
    return {
      point: ray.at(distance, new THREE.Vector3()),
      distance,
      normal: new THREE.Vector3(0, 1, 0),
    };
  },
};
collisionSystem.update(0.05, player, elevatedFloor);
assert.ok(collisionSystem.throwables[0].pos.y > 1,
  'grenade passed through an elevated collision floor');
assert.ok(collisionSystem.throwables[0].vel.y > 0,
  'grenade did not bounce from the collision normal');

const presentationPlayer = { shield: 0, stamina: 100 };
const inventory = { frags: 0, smokes: 0 };
applyAuthoritativeResources(presentationPlayer, {
  sim: { stamina: 37, teleCD: 8 },
  self: { shield: 19, abilityCooldowns: {frag: 7.5, smoke: 0}, abilities: { frag: 1, smoke: 2 } },
}, inventory);
assert.deepEqual(presentationPlayer, { shield: 19, stamina: 37, teleportCooldown: 8 }, 'authoritative stamina did not reach HUD player');
assert.deepEqual(inventory, { frags: 1, smokes: 2, cooldowns: {timebomb: 0, impulse: 0, frag: 7.5, smoke: 0} }, 'authoritative grenade inventory did not reach HUD');
console.log('grenade contract passed: swept map collision, larger layered blasts, damage flow, stamina and inventory all replicate');
