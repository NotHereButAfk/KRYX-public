#!/usr/bin/env node
// Regression proof: respawning from any movement pose starts the next life in
// one deterministic, neutral animation state.

import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { sprintRequested } from '../src/core/GameplayInput.js';

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
const isZeroVector = (vector) => vector.x === 0 && vector.y === 0 && vector.z === 0;

const desktopInput = (held) => ({ isMobile: false, isDown: (code) => held === code });
check(sprintRequested(desktopInput('ShiftLeft'), 1), 'left Shift does not request sprint');
check(sprintRequested(desktopInput('ShiftRight'), 1), 'right Shift does not request sprint');
check(sprintRequested(desktopInput('ShiftLeft'), 0), 'held Shift intent was lost before movement gating');
check(sprintRequested({ isMobile: true, isDown: () => false }, 1), 'mobile forward input does not request sprint');

function dirtyMovementState(player, seed) {
  player.health = 0;
  player.stamina = 1;
  player.shield = 2;
  player._staminaRegenDelay = 0.8;
  player._shieldRegenDelay = 1.7;
  player.velocity.set(9 + seed, -13 - seed, 5 + seed);

  player.onGround = false;
  player._wasOnGround = false;
  player.isSprinting = true;
  player._sprintT = 0.91;
  player.isCrouching = true;
  player.isSliding = true;
  player._slideTimer = 0.37;
  player._slideCooldown = 0.28;
  player._slideVel.set(14, 0, -7);
  player._slideFwd.set(0.5, 0, -0.5);
  player._coyoteTimer = 0.12;
  player._eyeHeight = 0.86;
  player.bobTime = 17.3 + seed;
  player._stepPhase = 4;
  player._lastBobSign = -1;
  player.camera.rotation.z = -0.025;

  player.recoilPitch = 0.4;
  player.recoilPitchVel = 2;
  player.recoilYaw = -0.2;
  player.recoilYawVel = -1;
  player.teleportCooldown = 4.2;
  player._padTeleCD = 0.7;
}

function neutralSnapshot(player) {
  return JSON.stringify({
    position: player.position.toArray(),
    velocity: player.velocity.toArray(),
    yaw: player.yaw,
    health: player.health,
    stamina: player.stamina,
    shield: player.shield,
    staminaDelay: player._staminaRegenDelay,
    shieldDelay: player._shieldRegenDelay,
    onGround: player.onGround,
    wasOnGround: player._wasOnGround,
    sprinting: player.isSprinting,
    sprintBlend: player._sprintT,
    crouching: player.isCrouching,
    sliding: player.isSliding,
    slideTimer: player._slideTimer,
    slideVelocity: player._slideVel.toArray(),
    slideForward: player._slideFwd.toArray(),
    coyoteTimer: player._coyoteTimer,
    eyeHeight: player._eyeHeight,
    bobTime: player.bobTime,
    stepPhase: player._stepPhase,
    lastBobSign: player._lastBobSign,
    cameraRoll: player.camera.rotation.z,
    recoil: [
      player.recoilPitch,
      player.recoilPitchVel,
      player.recoilYaw,
      player.recoilYawVel,
    ],
    teleportCooldown: player.teleportCooldown,
    padTeleportCooldown: player._padTeleCD,
  });
}

const player = new Player(16 / 9);
player.maxHealth = 125;
player.maxStamina = 110;
player.maxShield = 35;

const spawn = new THREE.Vector3(12, 0, -9);
spawn.spawnYaw = Math.PI / 3;

dirtyMovementState(player, 1);
player.respawn(spawn);
const first = neutralSnapshot(player);

check(player.position.equals(spawn), 'spawn position was not applied');
check(player.yaw === spawn.spawnYaw, 'spawn yaw was not applied');
check(isZeroVector(player.velocity), 'world velocity survived respawn');
check(player.health === 125 && player.stamina === 110 && player.shield === 35,
  'health, stamina, or shield did not refill');
check(player._staminaRegenDelay === 0 && player._shieldRegenDelay === 0,
  'regen delay survived respawn');
check(player.onGround && player._wasOnGround, 'respawn did not enter a grounded state');
check(!player.isSprinting && player._sprintT === 0, 'sprint pose survived respawn');
check(!player.isCrouching && player._eyeHeight === 1.8, 'crouch camera pose survived respawn');
check(!player.isSliding && player._slideTimer === 0 && player._slideCooldown === 0, 'slide state survived respawn');
check(isZeroVector(player._slideVel) && isZeroVector(player._slideFwd),
  'slide momentum survived respawn');
check(player._coyoteTimer === 0, 'coyote timer survived respawn');
check(player.bobTime === 0 && player._stepPhase === 0 && player._lastBobSign === 1,
  'bob or footstep phase survived respawn');
check(player.camera.rotation.z === 0, 'sprint camera roll survived respawn');
check(
  player.recoilPitch === 0 && player.recoilPitchVel === 0
    && player.recoilYaw === 0 && player.recoilYawVel === 0,
  'recoil pose survived respawn',
);
check(player.teleportCooldown === 0 && player._padTeleCD === 0,
  'teleport ability cooldown survived respawn');

// Poison the state differently and prove the same spawn produces the same
// complete neutral snapshot, independent of the death pose it followed.
dirtyMovementState(player, 99);
player.respawn(spawn);
check(neutralSnapshot(player) === first, 'respawn state depends on the previous movement pose');

if (!process.exitCode) {
  console.log('player respawn animation reset passed: grounded, standing, still, abilities ready, phase zero');
}
