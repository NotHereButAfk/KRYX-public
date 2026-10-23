import { strafeTilt } from './StrafeTilt.js';
import { applyMouseLook } from '../core/MouseLook.js';
import { BACKWARD_WALK_MULT, WALK_SPEED, SPRINT_MULT, SLIDE_LAUNCH_SPEED, SLIDE_DURATION, SLIDE_RECOVERY, JUMP_SPEED, PLAYER_EYE_HEIGHT as EYE_HEIGHT } from '../sim/MovementConfig.js';
import { canStartSlide, advanceSlide } from '../sim/SlideMotion.js';
import * as THREE from 'three';
import {
  safeThirdPersonObstructionDistance,
  setThirdPersonDesired,
  findThirdPersonObstruction,
} from './ThirdPersonCamera.js';
import { sprintRequested, crouchRequested, consumeSlidePress } from '../core/GameplayInput.js';
import { characterSweepSegments } from '../sim/CharacterSweep.js';
import {
  STAMINA_DRAIN,
  STAMINA_MAX,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
} from '../sim/MovementConfig.js';
import { HEALTH_REGEN_DELAY, HEALTH_REGEN_RATE } from '../core/CombatConfig.js';
import {
  SHIELD_REGEN_DELAY,
  SHIELD_REGEN_RATE,
  addShieldStack,
} from '../core/ShieldConfig.js';

const RADIUS = 0.45;
// KYX is intentionally a fast arena shooter. Keep this mirrored in MoveSim so
// local play, prediction, and the authoritative server travel at one speed.

const GRAVITY = -20;

const TELEPORT_RANGE    = 22;
const TELEPORT_COOLDOWN = 15.0;

const CROUCH_HEIGHT   = 0.85;
const COYOTE_TIME     = 0.14;

export class Player {
  constructor(aspect) {
    // Near plane at 0.02, not 0.05: the viewmodel is held ~0.5m from the eye
    // and its stock reaches back most of that, so at 0.05 the rear of every gun
    // was being sliced off by the near plane — worst during a reload, which
    // rolls the receiver toward you. The viewmodel is also pushed out far
    // enough to clear this; both are needed. 0.02/300 keeps the depth ratio
    // inside what a 24-bit buffer handles without z-fighting the arena.
    this.camera = new THREE.PerspectiveCamera(78, aspect, 0.02, 300);
    this.baseFov = 78;

    this.position = new THREE.Vector3(0, 0, 8);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.invertY = false; // when true, vertical look is inverted (mouse + touch)
    this.onGround = true;

    this.maxHealth = 100;
    this.health = this.maxHealth;
    this._healthRegenDelay = 0;
    this.maxStamina = STAMINA_MAX;
    this.stamina = STAMINA_MAX;
    this._staminaRegenDelay = 0;
    this.maxShield = 0;
    this.shield = 0;
    this._shieldRegenDelay = 0;
    this.isSprinting = false;
    this.bobTime = 0;
    this.recoilPitch = 0;
    this.recoilPitchVel = 0;
    this.recoilYaw = 0;
    this.recoilYawVel = 0;

    this.name = 'Recruit';
    this.skin = null;
    this.sensitivityMult = 1.0;
    this.audio = null;

    // Third-person camera
    this._camDist = 0;           // 0 = FPS, >0 = TPS metres
    this._tpsTarget = new THREE.Vector3();
    this._tpsDesired = new THREE.Vector3();
    this._tpsOffset = new THREE.Vector3();
    this._tpsRaycaster = new THREE.Raycaster();

    // Sprint blend (0..1) for camera roll
    this._sprintT = 0;

    // Teleport ability (Q key)
    this.teleportCooldown    = 0;
    this.teleportMaxCooldown = TELEPORT_COOLDOWN;
    this._respawnEpoch       = 0;
    this.onTeleport = null; // (fromPos, toPos) => void

    // Sound state
    this._wasOnGround = true;
    this._stepPhase = 0;
    this._lastBobSign = 1;

    this.isCrouching   = false;
    this.isSliding     = false;
    this._slideTimer   = 0;
    this._slideCooldown = 0;
    this._slideMotion = {};
    this._slideVel     = new THREE.Vector3();
    this._coyoteTimer  = 0;
    this._airJumpUsed = false;
    this._eyeHeight    = EYE_HEIGHT;  // current (lerped) eye height

    // Pre-allocated scratch vectors — avoids per-frame GC pressure
    this._fwdVec     = new THREE.Vector3();
    this._rightVec   = new THREE.Vector3();
    this._desiredVec = new THREE.Vector3();
    this._slideFwd   = new THREE.Vector3();
    this._headroomRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  }

  get isDead() {
    return this.health <= 0;
  }

  setMaxShield(max) {
    this.maxShield = max;
    this.shield = max;
    this._shieldRegenDelay = 0;
  }

  addShieldStack() {
    const next = addShieldStack(this.shield, this.maxShield);
    this.shield = next.shield;
    this.maxShield = next.maxShield;
    this._shieldRegenDelay = 0;
    return next.gained;
  }

  respawn(position) {
    this._respawnEpoch++;
    this.health   = this.maxHealth;
    this.stamina  = this.maxStamina;
    this.shield   = this.maxShield;
    this._staminaRegenDelay = 0;
    this._shieldRegenDelay  = 0;
    this._healthRegenDelay  = 0;
    this.position.copy(position);
    if (Number.isFinite(position.spawnYaw)) this.yaw = position.spawnYaw;
    this.velocity.set(0, 0, 0);

    // A new life must start from a neutral movement pose. Without clearing
    // these, dying during a crouch/slide/sprint can briefly respawn the camera
    // at crouch height, keep the body in its airborne pose, or carry the old
    // bob/slide phase into the first frame.
    this.onGround      = true;
    this._wasOnGround  = true;
    this.isSprinting   = false;
    this.weaponSprintBlocked = false;
    this._weaponSprintRecovery = 0;
    this._sprintT      = 0;
    this.isCrouching   = false;
    this.isSliding     = false;
    this._slideTimer   = 0;
    this._slideCooldown = 0;
    this._slideVel.set(0, 0, 0);
    this._slideFwd.set(0, 0, 0);
    this._coyoteTimer  = 0;
    this._airJumpUsed = false;
    this._eyeHeight    = EYE_HEIGHT;
    this.bobTime       = 0;
    this._bobWeight = 0;
    this._stepPhase    = 0;
    this._lastBobSign  = 1;
    this.camera.rotation.z = 0;
    this._strafeTilt = 0;

    // Ability state belongs to one life. The authoritative room already
    // rebuilds its MoveSim state with teleCD=0 on respawn; mirror that contract
    // in local/legacy matches so blinking immediately before death cannot lock
    // the next life out of teleport for several seconds.
    this.teleportCooldown = 0;
    this._padTeleCD = 0;

    this.recoilPitch = 0; this.recoilPitchVel = 0;
    this.recoilYaw = 0;   this.recoilYawVel = 0;
  }

  takeDamage(amount) {
    this._healthRegenDelay = HEALTH_REGEN_DELAY;
    this._shieldRegenDelay = SHIELD_REGEN_DELAY;
    const absorbed = Math.min(this.shield, amount);
    this.shield = Math.max(0, this.shield - absorbed);
    const remaining = amount - absorbed;
    if (remaining > 0) this.health = Math.max(0, this.health - remaining);
    return this.health <= 0;
  }

  updateHealthRegen(dt) {
    if (this.health <= 0 || this.health >= this.maxHealth) return;
    if (this._healthRegenDelay > 0) {
      this._healthRegenDelay = Math.max(0, this._healthRegenDelay - dt);
      if (this._healthRegenDelay > 1e-6) return;
      this._healthRegenDelay = 0;
    }
    this.health = Math.min(this.maxHealth, this.health + HEALTH_REGEN_RATE * dt);
  }

  applyRecoil(amount) {
    // Camera kick: guns kick UP — an immediate jolt plus follow-through
    // velocity, with a touch of random horizontal drift. The springs in
    // update() pull the view back to where the player was aiming.
    this.recoilPitch    += amount * 0.9;
    this.recoilPitchVel += amount * 7;
    this.recoilYawVel   += (Math.random() - 0.5) * amount * 6;
  }

  update(dt, input, world) {
    const motionStartX = this.position.x, motionStartZ = this.position.z;
    this.updateHealthRegen(dt);
    // Competitive view is first-person only. Scroll remains available to the
    // weapon system, but can no longer switch into a shoulder camera.
    this._camDist = 0;

    // --- look ---
    // Standard (non-inverted) is mouse/finger up → look up. invertY flips the
    // vertical axis for players who prefer inverted aim (applies to touch too).
    applyMouseLook(this, input);

    // recoil recovery (spring back to 0)
    const recoilSpring = -this.recoilPitch * 18 - this.recoilPitchVel * 6;
    this.recoilPitchVel += recoilSpring * dt;
    this.recoilPitch += this.recoilPitchVel * dt;
    const yawSpring = -this.recoilYaw * 18 - this.recoilYawVel * 6;
    this.recoilYawVel += yawSpring * dt;
    this.recoilYaw += this.recoilYawVel * dt;

    // --- movement input ---
    let moveX = 0;
    let moveZ = 0;
    if (input.isDown('KeyW')) moveZ += 1;
    if (input.isDown('KeyS')) moveZ -= 1;
    if (input.isDown('KeyA')) moveX -= 1;
    if (input.isDown('KeyD')) moveX += 1;

    const moving = moveX !== 0 || moveZ !== 0;
    const wantCrouch = crouchRequested(input);
    // On mobile the joystick sets ShiftLeft virtually; also auto-sprint any forward motion
    const wantSprint = sprintRequested(input, moveZ, this.weaponSprintBlocked, moveX);
    this.isSprinting = moving && wantSprint && !wantCrouch && moveZ >= 0 && this.stamina > 2 && !this.isSliding && !this.isCrouching;

    // smooth sprint blend for camera roll
    this._sprintT += ((this.isSprinting ? 1 : 0) - this._sprintT) * Math.min(1, dt * 9);

    // stamina drain / regen
    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      this._staminaRegenDelay = STAMINA_REGEN_DELAY;
      if (this.stamina <= 0) this.isSprinting = false;
    } else {
      if (this._staminaRegenDelay > 0) {
        this._staminaRegenDelay = Math.max(0, this._staminaRegenDelay - dt);
      } else {
        this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * dt);
      }
    }

    // shield regen
    if (this._shieldRegenDelay > 0) {
      this._shieldRegenDelay = Math.max(0, this._shieldRegenDelay - dt);
    } else if (this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + SHIELD_REGEN_RATE * dt);
    }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) { moveX /= len; moveZ /= len; }

    const speed = WALK_SPEED * (this.isSprinting ? SPRINT_MULT : (this.isCrouching ? 0.55 : 1)) * (moveZ < 0 ? BACKWARD_WALK_MULT : 1);
    this._fwdVec.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this._rightVec.set(Math.sin(this.yaw + Math.PI / 2), 0, Math.cos(this.yaw + Math.PI / 2));

    const desired = this._desiredVec.set(0, 0, 0);
    desired.addScaledVector(this._fwdVec, -moveZ);
    desired.addScaledVector(this._rightVec, moveX);
    desired.multiplyScalar(speed);

    // --- crouch / slide ---
    const wasLow = this.isSliding || this.isCrouching;
    const justSlide = consumeSlidePress(input);
    this._slideCooldown = Math.max(0, this._slideCooldown - dt);
    if (this.isSliding && !this.onGround) {
      this.isSliding = false; this._slideTimer = 0; this._slideCooldown = SLIDE_RECOVERY;
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.isSprinting && canStartSlide(this.velocity.x, this.velocity.z, this.onGround, this.isSliding, this._slideCooldown, justSlide)) {
      // Carry the player's actual travel direction into the burst. This keeps
      // a diagonal sprint from snapping to camera-forward when C is pressed.
      this.isSliding   = true;
      this._slideTimer = SLIDE_DURATION;
      this._slideFwd.set(this.velocity.x / horizontalSpeed, 0, this.velocity.z / horizontalSpeed);
      this._slideVel.copy(this._slideFwd).multiplyScalar(SLIDE_LAUNCH_SPEED);
      this.isSprinting = false;
    }

    if (this.isSliding) {
      const motion = advanceSlide(this._slideTimer, this._slideVel.x, this._slideVel.z,
        desired.x, desired.z, wantCrouch, dt, this._slideMotion);
      this._slideTimer = motion.time;
      this._slideVel.set(motion.dx, 0, motion.dz);
      this.velocity.x = motion.vx;
      this.velocity.z = motion.vz;
      if (this._slideTimer <= 0) {
        this.isSliding   = false;
        this.isCrouching = wantCrouch;
        this._slideCooldown = SLIDE_RECOVERY;
      }
    } else if (this.onGround) {
      // Normal ground movement
      this.velocity.x = desired.x;
      this.velocity.z = desired.z;
      this.isCrouching = wantCrouch && !this.isSprinting;
    } else {
      // Air strafing — soft control, preserves jump momentum
      const blend = dt * 3.5;
      this.velocity.x += (desired.x - this.velocity.x) * Math.min(1, blend);
      this.velocity.z += (desired.z - this.velocity.z) * Math.min(1, blend);
    }

    const blockedStanding = wasLow && this._headroomBlocked(world);
    if (blockedStanding && !this.isSliding) this.isCrouching = true;

    // smooth eye height between stand / crouch / slide
    const targetEye = (this.isSliding || this.isCrouching) ? CROUCH_HEIGHT : EYE_HEIGHT;
    this._eyeHeight += (targetEye - this._eyeHeight) * Math.min(1, dt * 16);

    // --- teleport blink (Q key) ---
    if (this.teleportCooldown > 0) this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);
    if (input.teleportConfirmed && this.teleportCooldown <= 0) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);

      const raycaster = new THREE.Raycaster(camPos, camDir, 0.1, TELEPORT_RANGE);
      const hits = raycaster.intersectObjects(world.raycastMeshes, true);
      // Bare box colliders stop the blink too, so you can't jump into a tree.
      const boxHit = world.raycastBoxHit(raycaster.ray, TELEPORT_RANGE);
      let blockAt = hits.length ? hits[0].distance : Infinity;
      if (boxHit) blockAt = Math.min(blockAt, boxHit.distance);

      const destEye = camPos.clone().addScaledVector(
        camDir, blockAt === Infinity ? TELEPORT_RANGE : Math.max(0.1, blockAt - 0.9));
      // Eye → foot position, clamped to ground
      destEye.y -= EYE_HEIGHT;
      destEye.y = Math.max(0, destEye.y);

      const fromPos = this.position.clone();
      this.position.copy(destEye);
      this.velocity.set(0, 0, 0);
      if (this.isSliding) this._slideCooldown = SLIDE_RECOVERY;
      this.isSliding = false; this._slideTimer = 0;
      this.onGround = false;
      this.teleportCooldown = TELEPORT_COOLDOWN;
      this.onTeleport?.(fromPos, this.position.clone());
    }

    // --- coyote time (forgives jumps just after walking off a ledge) ---
    if (this.onGround) {
      this._coyoteTimer = COYOTE_TIME;
      this._airJumpUsed = false;
    } else {
      this._coyoteTimer = Math.max(0, this._coyoteTimer - dt);
    }

    // --- jump ---
    const canJump = this.onGround || this._coyoteTimer > 0;
    if (input.consumeJustPressed('Space') && (canJump || !this._airJumpUsed) && !blockedStanding) {
      if (!canJump) this._airJumpUsed = true;
      const jumpBoost = this.isCrouching ? JUMP_SPEED * 1.1 : JUMP_SPEED; // slight boost out of crouch
      this.velocity.y = jumpBoost;
      this.onGround    = false;
      this.isCrouching = false;
      if (this.isSliding) this._slideCooldown = SLIDE_RECOVERY;
      this.isSliding   = false;
      this._slideTimer = 0;
      this._coyoteTimer = 0;
      if (this.audio) this.audio.playJump();
    }
    // --- grav-lifts: launch upward while standing in an energy column ---
    if (world.queryGravLift) {
      const lift = world.queryGravLift(this.position.x, this.position.z, this.position.y);
      if (lift > 0) {
        this.velocity.y = lift;
        this.onGround = false;
        this._coyoteTimer = 0;
      }
    }

    this.velocity.y += GRAVITY * dt;

    // Break fast horizontal travel into short collision sweeps. At sprint
    // speed (or on a slow browser frame) one unswept move can cross a complete
    // stair tread and hit the following riser, making ordinary stairs feel
    // sticky. The step-height contract remains owned by groundHeightAt, so
    // this cannot turn walls into climbable surfaces.
    const totalDX = this.velocity.x * dt;
    const totalDZ = this.velocity.z * dt;
    const sweepSegments = characterSweepSegments(Math.hypot(totalDX, this.velocity.y * dt), totalDZ);
    const sweepDt = dt / sweepSegments;
    const landingVel = this.velocity.y;
    const wasOnGround = this._wasOnGround;
    let touchedGround = false;
    this._worldContact ||= {
      grounded: false, normalY: -1, depth: 0, verticalCorrection: 0,
    };
    for (let segment = 0; segment < sweepSegments; segment++) {
      const prevY = this.position.y;
      this.position.x += this.velocity.x * sweepDt;
      this.position.z += this.velocity.z * sweepDt;
      this.position.y += this.velocity.y * sweepDt;

      // Land on the highest walkable surface under this short sweep. Sampling
      // every tread is what makes both walking and sprinting climb smoothly.
      const groundY = world.groundHeightAt
        ? world.groundHeightAt(this.position.x, this.position.z, prevY, this.position.y)
        : 0;
      let segmentGrounded = false;
      if (this.position.y <= groundY + 0.05 && this.velocity.y <= 0.001) {
        this.position.y = groundY;
        this.velocity.y = 0;
        segmentGrounded = true;
      }

      world.resolveCollisions(this.position, RADIUS, this._worldContact,
        (this.isSliding || this.isCrouching) ? 1.0 : EYE_HEIGHT,
        this.velocity.x * sweepDt, this.velocity.z * sweepDt,
        (this.onGround || segmentGrounded) && this.velocity.y <= .001);
      if (this._worldContact.boundaryMask & 1) this.velocity.x = 0;
      if (this._worldContact.boundaryMask & 2) this.velocity.z = 0;
      if (this._worldContact.boundaryMask & 4) this.velocity.y = Math.min(0, this.velocity.y);
      if (this._worldContact.grounded && this.velocity.y <= 0.001) {
        this.velocity.y = 0;
        segmentGrounded = true;
      }
      this.onGround = segmentGrounded;
      touchedGround ||= segmentGrounded;
    }
    if (!wasOnGround && touchedGround && this.audio) {
      this.audio.playLand(landingVel < -12);
    }
    this._wasOnGround = this.onGround;
    if (this.onGround) this._airJumpUsed = false;

    // --- teleporter pads: step on one, drop out of its linked partner ---
    if (world.queryTeleport) {
      this._padTeleCD = Math.max(0, (this._padTeleCD || 0) - dt);
      if (this._padTeleCD <= 0) {
        const dest = world.queryTeleport(this.position.x, this.position.z);
        if (dest) {
          const from = this.position.clone();
          this.position.set(dest.x, 0, dest.z);
          this.velocity.set(0, 0, 0);
          this.onGround = true;
          this._padTeleCD = 1.0;
          if (this.audio) this.audio.playTeleport();
          this.onTeleport?.(from, this.position.clone());
        }
      }
    }

    // Advance gait feedback by resolved travel, not held movement keys. Walls,
    // jumps and teleports must not produce running footsteps or camera bounce.
    const traveled = Math.hypot(this.position.x-motionStartX,this.position.z-motionStartZ);
    const locomoting = this.onGround && !this.isSliding && traveled > 0.0001
      && traveled < WALK_SPEED * SPRINT_MULT * Math.max(dt,0.001) * 2;
    if (locomoting) {
      const stepLength = this.isCrouching ? 1.2 : this.isSprinting ? 2.35 : 2.0;
      const previousStep = Math.floor(this.bobTime / Math.PI);
      this.bobTime += traveled / stepLength * Math.PI;
      if (Math.floor(this.bobTime / Math.PI) !== previousStep && this.audio)
        this.audio.playFootstep(this.isSprinting);
    }
    this._bobWeight = THREE.MathUtils.damp(this._bobWeight || 0, locomoting ? 1 : 0, 16, dt);
    const bobOffset = this.reduceMotion ? 0 : Math.sin(this.bobTime * 2) * 0.006 * this._bobWeight;
    const lateralTravel=(this.position.x-motionStartX)*Math.cos(this.yaw)
      -(this.position.z-motionStartZ)*Math.sin(this.yaw);
    this._strafeTilt=strafeTilt(this._strafeTilt||0,dt>0?lateralTravel/dt:0,dt,
      !this.reduceMotion && moveX!==0 && traveled<3);
    const recoilView = this.reduceMotion ? 0 : this.recoilPitch;
    const recoilViewYaw = this.reduceMotion ? 0 : this.recoilYaw;

    // --- apply to camera ---
    if (this._camDist > 0) {
      setThirdPersonDesired(
        this._tpsDesired, this.position, this.yaw, this.pitch, this._camDist,
      );
      this._tpsTarget.set(this.position.x, this.position.y + 1.25, this.position.z);
      const cameraOffset = this._tpsOffset.copy(this._tpsDesired).sub(this._tpsTarget);
      const obstruction = findThirdPersonObstruction(
        this._tpsRaycaster, world, this._tpsTarget, this._tpsDesired, cameraOffset,
      );
      cameraOffset.copy(this._tpsDesired).sub(this._tpsTarget).normalize();
      this._tpsObstructed = !!obstruction && obstruction.distance < 0.8;
      if (this._tpsObstructed) {
        this.camera.position.set(this.position.x, this.position.y + this._eyeHeight + bobOffset, this.position.z);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.yaw + recoilViewYaw;
        this.camera.rotation.x = this.pitch + recoilView;
        this.camera.rotation.z = this.reduceMotion ? 0 : this._sprintT * -0.008 + this._strafeTilt;
      } else if (obstruction) {
        this.camera.position.copy(this._tpsTarget)
          .addScaledVector(cameraOffset, safeThirdPersonObstructionDistance(obstruction.distance));
      } else {
        this.camera.position.copy(this._tpsDesired);
      }
      if (!this._tpsObstructed) {
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.yaw + recoilViewYaw;
        this.camera.rotation.x = this.pitch + recoilView;
        this.camera.rotation.z = this.reduceMotion ? 0 : this._sprintT * -0.008 + this._strafeTilt;
      }
    } else {
      this._tpsObstructed = false;
      // First-person: camera sits at eye height with head-bob.
      this.camera.position.set(this.position.x, this.position.y + this._eyeHeight + bobOffset, this.position.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw + recoilViewYaw;
      this.camera.rotation.x = this.pitch + recoilView;
      this.camera.rotation.z = this.reduceMotion ? 0 : this._sprintT * -0.008 + this._strafeTilt; // slight COD-style lean while sprinting
    }
  }

  _headroomBlocked(world) {
    if (!world.raycastCollisionDistance) return false;
    const ray = this._headroomRay;
    for (const [x, z] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      ray.origin.set(this.position.x + x, this.position.y + 1.01, this.position.z + z);
      if (world.raycastCollisionDistance(ray, EYE_HEIGHT - 1.0) < EYE_HEIGHT - 1.01) return true;
    }
    return false;
  }
}
