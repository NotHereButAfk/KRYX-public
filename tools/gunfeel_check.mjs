import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { getWeapon } from '../src/weapons/weaponDefs.js';
import { WeaponSystem } from '../src/weapons/WeaponSystem.js';
import * as THREE from 'three';
import {
  advanceFireCooldown,
  isMovingAndFiring,
  scheduleNextShot,
  wantsTriggerShot,
} from '../src/weapons/FireControl.js';

function automaticShots(fps, seconds, interval) {
  let cooldown = 0;
  let shots = 0;
  const dt = 1 / fps;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    cooldown = advanceFireCooldown(cooldown, dt);
    if (wantsTriggerShot(true, true, true) && cooldown <= 0) {
      shots++;
      cooldown = scheduleNextShot(cooldown, interval);
    }
  }
  return shots;
}

const ar = getWeapon('m4');
assert.equal(ar.magSize, 50, 'EV.IO Auto Rifle magazine must hold 50 rounds');
assert.equal(ar.spreadMin, 0, 'Auto Rifle must begin pin-accurate');
assert.equal(ar.spreadMax, 0.02, 'Auto Rifle sustained-fire bloom must cap at 0.02');
assert.equal(ar.zoomSpreadMod, 0, 'aiming must remove Auto Rifle bloom');
assert.equal(ar.muzzleSmoke, true, 'Auto Rifle must emit muzzle smoke');
assert.equal(ar.spawnShells, true, 'Auto Rifle must eject shells');

const weaponSystemSource = readFileSync(new URL('../src/weapons/WeaponSystem.js', import.meta.url), 'utf8');
const effects = Object.create(WeaponSystem.prototype);
effects.scene = new THREE.Scene(); effects.tracers = [];
effects._spawnTracer(new THREE.Vector3(), new THREE.Vector3(0, 0, -60), ar);
const bullet = effects.tracers[0];
bullet.mesh.geometry.computeBoundingBox();
const bulletSize = bullet.mesh.geometry.boundingBox.getSize(new THREE.Vector3());
assert.ok(bulletSize.x >= .024, 'visible bullet is too thin to read in motion');
assert.ok(bullet.speed <= 360, 'presentation bullet travels too fast to read');
assert.equal(bullet.mesh.material.blending, THREE.NormalBlending, 'solid ballistic round must not look like an energy beam');
effects._spawnTracer(new THREE.Vector3(), new THREE.Vector3(0, 0, -60), {laserBeam:true,energyColor:0x22bbff});
const laser = effects.tracers[1];
assert.equal(laser.mesh.material.color.getHex(), 0x22bbff, 'dedicated laser must retain its energy colour');
assert.equal(laser.mesh.scale.z, 60, 'dedicated laser must still span the full shot');
for (const {mesh} of effects.tracers) { mesh.geometry.dispose(); mesh.material.dispose(); }

let bloom = ar.spreadMin;
for (let shot = 0; shot < 12; shot++) {
  bloom = Math.max(ar.spreadMin, bloom - ar.spreadRecovery * ar.fireRate);
  bloom = Math.min(ar.spreadMax, bloom + ar.spreadBloomPerShot);
}
assert.ok(bloom > 0.015, 'sustained fire must visibly build toward maximum bloom');

assert.equal(wantsTriggerShot(false, true, false), true, 'semi-auto fires on press edge');
assert.equal(wantsTriggerShot(false, true, true), false, 'semi-auto cannot fire while held');
assert.equal(wantsTriggerShot(true, true, true), true, 'automatic keeps firing while held');
assert.equal(
  isMovingAndFiring({ velocity: { x: 9, z: 0 } }, { mouseDown: true }),
  true,
  'walking-fire trigger state was not detected while moving',
);
assert.equal(
  isMovingAndFiring({ velocity: { x: 9, z: 0 } }, { mouseDown: false }),
  false,
  'walking-fire state ignored a released trigger',
);
assert.match(weaponSystemSource, /isMovingAndFiring\(player, input\)/,
  'weapon presentation must expose a moving-fire pose');

const expected = automaticShots(60, 1, ar.fireRate);
for (const fps of [30, 60, 144]) {
  assert.ok(
    Math.abs(automaticShots(fps, 1, ar.fireRate) - expected) <= 1,
    `automatic cadence drifted at ${fps}Hz`,
  );
}

// A single 180ms hitch may defer presentation by one frame, but timing debt
// must be preserved instead of resetting the entire cadence.
let cd = scheduleNextShot(-0.18, ar.fireRate);
assert.ok(cd <= 0.001, 'hitch timing debt was discarded');

console.log(`gunfeel passed: ${expected} AR rounds/s; visible tracers, ADS, bloom, smoke, shell and trigger rules verified`);

// Exercise the real firing path without WebGL: a revolver retains its cases,
// while the Auto Rifle still ejects them. Both must retain their shot effects.
for (const id of ['magnum', 'm4']) {
  const effects = { shot: 0, casingSound: 0, shell: 0, hit: 0, flash: 0 };
  const fixture = {
    currentDef: getWeapon(id), currentState: { isReloading: false, magAmmo: 8 },
    fireTimer: 0, scopeT: 0, _shotBloom: 0,
    kickPos: {x:0,y:0,z:0}, kickVel: {x:0,y:0,z:0}, kickRotX: 0, kickRotXVel: 0,
    _activeSkinFor: () => null,
    audio: {
      playShot: () => effects.shot++,
      playShellCasing: () => effects.casingSound++,
    },
    _doHitscanShot: () => effects.hit++,
    _spawnShell: () => effects.shell++,
    _flash: () => effects.flash++,
    _spawnMuzzleSmoke() {}, _applyViewmodelRecoil: WeaponSystem.prototype._applyViewmodelRecoil,
  };
  WeaponSystem.prototype._fire.call(fixture, {}, [], {}, {});
  assert.equal(fixture.currentState.magAmmo, 7, `${id} shot must consume one round`);
  for (const effect of ['shot', 'hit', 'flash']) assert.equal(effects[effect], 1, `${id} lost ${effect}`);
  assert(id === 'magnum' ? fixture.kickRotX > .3 : fixture.kickRotX < .1, `${id} lost its distinct recoil weight`);
  const ejected = id === 'magnum' ? 0 : 1;
  assert.equal(effects.shell, ejected, `${id} casing ejection does not match its action`);
  assert.equal(effects.casingSound, ejected, `${id} casing sound does not match its action`);
}
console.log('Casing behavior passed: Hand Cannon retains cases; Auto Rifle ejects and plays casing audio.');
