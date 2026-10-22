import { groundDeathBody } from './DeathBody.js';
import { sampleDeathReaction } from '../sim/DeathReaction.js';
import * as THREE from 'three';
import { LandingEffect } from '../effects/LandingEffect.js';
import { buildPreviewCharacter, rigCharacterLimbs } from './PreviewCharacter.js';
import { isSharedGeometry } from './LowPolyModels.js';
import { buildWeaponModel, hasLoadedWeaponModel } from '../weapons/WeaponModels.js';
import { getWeapon } from '../weapons/weaponDefs.js';
import { applyWalkCycle, triggerHop } from './Locomotion.js';
import { applyRifleCarry, restRifleTransform } from './RifleCarry.js';
import { triggerAction, tickActions, applyMeleeCarry } from './Actions.js';
import { cameraYawToBodyYaw, movementInBodySpace, turnBodyYaw } from './Facing.js';
import { isEvCharacterReady } from './EvCharacter.js';
import { PLAYER_WORLD_MODEL_SCALE } from './Proportions.js';

// ═══════════════════════════════════════════════════════════════════════════
// One character body, driven entirely by a state struct.
//
// This exists so that the version of you OTHER players see and the version YOU
// see in third person are produced by the same code from the same inputs.
// Before this, your own body was a rigged cyborg running the full walk cycle
// and rifle carry, while everyone else saw you as a cyan capsule with a sphere
// for a head — no model, no animation, no weapon, no aim.
//
// Feed it {position, yaw, pitch, speed, sprint, grounded, crouch, firing,
// alive} and it renders that faithfully. Where the state comes from — your own
// controller, or a network snapshot of somebody else — makes no difference.
// ═══════════════════════════════════════════════════════════════════════════

// A position jump bigger than this in a single frame can't be running — the
// the normal sprint is 13.2 m/s, which is 0.22m per frame at 60Hz and still
// under 0.6m on a badly stuttering one.
const TELEPORT_STEP = 3.0;    // metres
const OUTLINE_LOD_DISTANCE_SQ = 36 * 36;
const MID_POSE_DISTANCE_SQ = 26 * 26;
const FAR_POSE_DISTANCE_SQ = 48 * 48;
// Shared frame-local scratch for resolved travel direction. Remote avatars are
// updated sequentially, so one module vector avoids a per-avatar allocation
// without leaking state between them.
const _v = new THREE.Vector3();

export class Avatar {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts] { skin, armorTypeId, weaponId, allowHuman, modelScale }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.landingEffect = new LandingEffect(scene);
    this._modelOptions = opts;
    this.group = buildPreviewCharacter(
      opts.skin || null, opts.armorTypeId || 'vanguard', null,
      { allowHuman: opts.allowHuman ?? true });
    this.isHuman = !!this.group.userData?.isHuman;
    this.rig = this.isHuman ? null : rigCharacterLimbs(this.group);
    const modelScale = Number.isFinite(opts.modelScale) ? opts.modelScale : PLAYER_WORLD_MODEL_SCALE;
    this.group.scale.multiplyScalar(modelScale);
    this.group.userData.worldModelScale = modelScale;
    // Yaw-first, so the run lean pitches about the body's own axis.
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    this._baseScale = this.group.scale.clone();

    this.weaponId = null;
    this.weapon   = null;
    this.setWeapon(opts.weaponId || 'm4');

    this._walkT   = Math.random() * Math.PI * 2;
    this._aim     = 0;        // 0 = patrol carry, 1 = shouldered
    this._kick    = 0;
    this._pitch   = 0;
    this._crouch  = 0;
    this._yawInit = false;
    this._prevPos = new THREE.Vector3();
    this._hasPrev = false;
    this._lastDirPos = new THREE.Vector3();
    this._alive = true;
    this._dying = false;
    this._deathT = 0;
    this._deathSide = this.group.id % 2 ? 1 : -1;
    this._spawnT = 0;
    this._firePulseT = 0;
    this._animSpeed = 0;
    this._poseAcc = 0;
    this._poseTravel = 0;
    this._outlineVisible = true;
    this._gaitSway = 0;
    this._gaitBob = 0;
    this._gaitLean = 0;
    this._gaitRoll = 0;
  }

  setWeapon(id, force = false) {
    if (!force && id === this.weaponId) return;
    const isSwap = this.weaponId !== null;
    this.weaponId = id;
    this.muzzle = null;
    this._weaponAssetReady = hasLoadedWeaponModel(id);
    if (this.weapon) { this.group.remove(this.weapon); this.weapon = null; }
    const def = getWeapon(id);
    if (!def) return;
    if (this.isHuman && this.group.userData.attachWeapon) {
      const built = buildWeaponModel(def, { procedural: true });
      this.group.userData.attachWeapon(built?.group || null, def.kind === 'melee');
      // Keep the live reference so the asynchronous asset-ready check can
      // replace the startup mesh for remote humans and bots as well.
      this.weapon = built?.group || null;
      this.muzzle = built?.muzzle || null;
      if (isSwap) this.group.userData.triggerAction?.('swap');
      return;
    }
    const built = buildWeaponModel(def, { procedural: true });
    const wm = built?.group;
    this.muzzle = built?.muzzle || null;
    if (!wm) return;
    wm.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.noHit = true; } });
    this.isMelee = def.kind === 'melee';
    if (this.isMelee) { wm.position.set(-0.22, 1.06, -0.24); wm.rotation.set(-0.70, 0, 0.22); }
    else restRifleTransform(wm);
    this.group.add(wm);
    this.weapon = wm;
  }

  getMuzzleWorldPosition(out) {
    // A native rifle rig can dispose the replacement while keeping its own gun.
    // Read the visible barrel instead of the discarded replacement marker.
    if (this.group.userData.getMuzzleWorldPosition) return this.group.userData.getMuzzleWorldPosition(out);
    if (!this.muzzle || !this.weapon?.parent) return null;
    this.muzzle.updateWorldMatrix(true, false);
    return this.muzzle.getWorldPosition(out);
  }

  /** Recoil pulse — call when this character fires. */
  fire() { this._kick = 1; this._aimHold = 1.1; }

  /** Play the jump arc — call when this character blinks or takes a pad. */
  hop() {
    if (this.isHuman) this.group.userData?.triggerJump?.();
    else triggerHop(this.rig);
  }

  /**
   * @param {number} dt
   * @param {object} s  {
   *   position: Vector3, yaw, pitch, speed?, sprint?, grounded?, crouch?,
   *   firing?, alive?, vy?, sliding?, reload?, swing?, throwing?, hit?
   * }  speed is optional — omitted, it is measured from the position delta,
   *    which is how a remote player (who only sends positions) is animated.
   *
   *  The action fields come in two shapes. `reload` and `swing` are 0→1
   *  progresses owned by the weapon, passed straight through. `throwing` and
   *  `hit` are edge-triggered: a rising edge starts a one-shot here, so a
   *  snapshot only has to carry a boolean rather than a synchronised clock.
   */
  update(dt, s) {
    // A peer can arrive before an optional asset download finishes. Upgrade
    // that peer too, preserving its world transform and animation state.
    if (!this.group.userData.isEvCharacter && (this._modelOptions.armorTypeId || 'vanguard') === 'vanguard'
        && isEvCharacterReady()) {
      const old = this.group;
      this.dispose();
      this.group = buildPreviewCharacter(this._modelOptions.skin, 'vanguard');
      this.group.position.copy(old.position);
      this.group.rotation.copy(old.rotation);
      this.group.scale.copy(old.scale);
      this.group.userData.worldModelScale = old.userData.worldModelScale;
      this.scene.add(this.group);
      this.isHuman = true; this.rig = null; this.weapon = null;
      this.setWeapon(this.weaponId, true);
    }
    const g = this.group;
    if (this.weapon && !this._weaponAssetReady
        && hasLoadedWeaponModel(this.weaponId)) this.setWeapon(this.weaponId, true);
    const alive = s.alive !== false;
    this.landingEffect.update(dt, s);

    // Keep a body on screen long enough for a kill to read. The server already
    // owns alive/dead state; this visual fall never changes collision, timing,
    // or respawn authority.
    if (!alive) {
      if (this._alive) {
        this._dying = true;
        this._deathT = 0;
        this._deathSide *= -1;
        this._deathReaction = s.deathReaction || null;
        if (Number.isFinite(s.deathReaction?.floorY)) this._deathReaction = {
          ...s.deathReaction, groundOffset: Math.min(0, s.deathReaction.floorY - s.position.y) };
        this._deathYaw = g.rotation.y;
        this._deathSupportPose = {};
        this._firePulseT = 0;
        this._kick = 0;
        this._aimHold = 0;
      }
      this._alive = false;
      this._hasPrev = false;
      this._animSpeed = 0;
      this._poseTravel = this._poseAcc = 0;
      if (!this._dying) { g.visible = false; return; }

      this._deathT += dt;
      const reaction = sampleDeathReaction(this._deathReaction, this._deathT, this._deathYaw);
      const ud = g.userData;
      if (this.isHuman) {
        ud.setLocomotion?.(0, true, false, 0, 1, 0);
        ud.setDeathState?.(Math.max(.0001, reaction.fall), this._deathSide, reaction.poseTime);
        ud.mixer?.update(dt);
        ud.armorTick?.(dt);
      }
      g.position.copy(s.position);
      g.position.x += reaction.x; g.position.z += reaction.z;
      g.rotation.set(reaction.pitch, this._deathYaw, reaction.roll, 'YXZ');
      g.scale.copy(this._baseScale);
      const floor = Number.isFinite(s.deathFloor) ? s.deathFloor : s.position.y;
      groundDeathBody(g, this._deathReaction ? s.position.y : floor, reaction.air,
        reaction.settled ? this._deathSupportPose : null, ud.isEvCharacter === true);
      g.visible = !reaction.done;
      if (!g.visible) this._dying = false;
      return;
    }

    if (!this._alive) {
      this._alive = true;
      this._spawnT = 0.42;
      this._hasPrev = false;
      this._animSpeed = 0;
      this._poseTravel = this._poseAcc = 0;
      g.rotation.x = 0;
      g.rotation.z = 0;
      g.userData?.triggerTeleport?.();
    }
    g.visible = true;
    if (this.isHuman) g.userData?.setDeathState?.(0, this._deathSide);

    // Speed: measured from movement when not supplied, so a network snapshot
    // animates identically to a local controller without sending a velocity.
    let moveX = 0, moveZ = 0;
    if (this._hasPrev && dt > 0) {
      moveX = (s.position.x - this._prevPos.x) / dt;
      moveZ = (s.position.z - this._prevPos.z) / dt;
    }
    let speed = s.speed;
    if (speed === undefined) speed = Math.hypot(moveX, moveZ);
    // The RAW per-frame step, not the per-second speed above. A jump of metres
    // in a single frame is a blink or a teleport pad, not running: measuring
    // speed off it reads as an absurd sprint for one frame and the body slides
    // the whole way. Play the jump arc over it instead.
    const stepped = this._hasPrev ? Math.hypot(moveX, moveZ) * dt : 0;
    this._prevPos.copy(s.position);
    this._hasPrev = true;
    if (stepped > TELEPORT_STEP) {
      speed = 0;
      this._animSpeed = 0;
      this.hop();
      this._poseTravel = 0;
    }
    else this._poseTravel = this.isHuman ? this._poseTravel + stepped : 0;
    // Critically damp the network/sample jitter without lagging a sprint start.
    // Exponential damping is refresh-rate independent and cannot overshoot.
    const speedEase = 1 - Math.exp(-(speed < this._animSpeed ? 20 : 12) * dt);
    this._animSpeed += (Math.min(14, speed) - this._animSpeed) * speedEase;
    speed = this._animSpeed;

    if (this._spawnT > 0) {
      this._spawnT = Math.max(0, this._spawnT - dt);
    }
    // Arrival effects must not change the body's size relative to its capsule.
    g.scale.copy(this._baseScale);

    const grounded = s.grounded == null ? true : !!s.grounded;
    const moving   = speed > 0.6 && grounded;
    const run = s.sprint ? 1 : THREE.MathUtils.clamp((speed - 3.0) / 6.0, 0, 0.45);

    // Facing. `yaw` is a CAMERA yaw (the server relays the client's look yaw),
    // and a three.js camera looks down −Z — so the direction being described is
    // −(sin yaw, cos yaw). Every playable body uses that same local −Z axis.
    // Snap on the first frame so a fresh avatar doesn't spin into place.
    const yaw = cameraYawToBodyYaw(s.yaw || 0);
    // Bot yaw is already interpolated by AuthClient. A second slow turn made
    // the rendered barrel lag behind the actual firing direction.
    if (!this._yawInit || s.isBot) { g.rotation.y = yaw; this._yawInit = true; }
    else {
      g.rotation.y = turnBodyYaw(g.rotation.y, yaw, dt, 4.2);
    }

    // Presentation LOD never touches network interpolation or position/yaw.
    // It only lowers the expensive bone/carry solve for small distant bodies,
    // and drops their second-pass outline. Nearby combat remains full-rate.
    const viewDistanceSq = Number.isFinite(s.viewDistanceSq) ? s.viewDistanceSq : 0;
    const outlineVisible = viewDistanceSq < OUTLINE_LOD_DISTANCE_SQ;
    if (outlineVisible !== this._outlineVisible) {
      this._outlineVisible = outlineVisible;
      for (const outline of g.userData?.outlines || []) outline.visible = outlineVisible;
    }
    const poseInterval = viewDistanceSq >= FAR_POSE_DISTANCE_SQ ? 1 / 15
      : viewDistanceSq >= MID_POSE_DISTANCE_SQ ? 1 / 30 : 0;
    if (poseInterval > 0 && !s.firing) {
      this._poseAcc += dt;
      if (this._poseAcc < poseInterval) {
        if (this.isHuman) g.position.copy(s.position);
        else {
          g.position.set(
            s.position.x + Math.cos(g.rotation.y) * this._gaitSway,
            s.position.y + this._gaitBob,
            s.position.z - Math.sin(g.rotation.y) * this._gaitSway,
          );
          g.rotation.x = this._gaitLean;
          g.rotation.z = this._gaitRoll;
        }
        return;
      }
      dt = Math.min(0.1, this._poseAcc);
      this._poseAcc = 0;
    } else {
      this._poseAcc = 0;
    }

    // Rigged human bodies drive their own skeletal clips.
    if (this.isHuman) {
      const ud = g.userData;
      g.position.copy(s.position);
      const viewYaw = g.rotation.y;
      const travel = movementInBodySpace(moveX, moveZ, viewYaw);
      const dirF = speed > 0.2 ? travel.forward : 1;
      const dirR = speed > 0.2 ? travel.right : 0;
      ud.setLocomotion?.(speed, grounded, !!s.sprint, -dirR, dirF, dirR, this._poseTravel);
      this._poseTravel = 0;
      let aimOffset = (s.aimYaw ?? s.yaw ?? 0) - g.rotation.y;
      aimOffset = Math.atan2(Math.sin(aimOffset), Math.cos(aimOffset));
      ud.setAim?.(s.pitch || 0, aimOffset);
      if (s.throwing && !this._wasThrowing) ud.triggerAction?.('throw');
      this._wasThrowing = !!s.throwing;
      if (s.hit && !this._wasHit) ud.triggerHit?.(0.7, 0.8);
      this._wasHit = !!s.hit;
      ud.setActionState?.({
        isBot: !!s.isBot,
        reload: s.reload || 0,
        swing: s.swing == null ? 1 : s.swing,
        crouch: s.crouch ? 1 : 0,
        slide: s.sliding ? 1 : 0,
        vy: s.vy || 0, airJumpUsed: s.airJumpUsed || 0,
        aim: (s.firing || s.aiming) ? 1 : 0,
        move: speed > 0.6 && grounded ? 1 : 0,
        run: s.sprint ? 1 : 0,
        firing: s.firing ? 1 : 0,
        scoped: s.aiming ? 1 : 0,
        zombieReach: !!s.zombieReach,
      });
      this._firePulseT = Math.max(0, this._firePulseT - dt);
      if (s.firing && this._firePulseT <= 0) {
        ud.triggerFire?.(1);
        this._firePulseT = 0.09;
      }
      ud.mixer?.update(dt);
      ud.armorTick?.(dt);
      return;
    }
    if (!this.rig) { g.position.copy(s.position); return; }

    this._crouch += ((s.crouch ? 1 : 0) - this._crouch) * Math.min(1, dt * 10);

    // Which way this body is travelling relative to the way it is FACING —
    // without it the legs run a forward stride while the character strafes or
    // backpedals, and the feet travel with the body instead of planting.
    // The body faces local -Z, so after its yaw forward is (-sin, -cos) and
    // right is (cos, -sin).
    let dirF = 1, dirR = 0;
    if (speed > 0.6) {
      _v.copy(s.position).sub(this._lastDirPos); _v.y = 0;
      const m = _v.length();
      if (m > 1e-5) {
        const travel = movementInBodySpace(_v.x, _v.z, g.rotation.y);
        dirF = travel.forward;
        dirR = travel.right;
      }
    }
    this._lastDirPos.copy(s.position);

    // One-shot actions. `swap` has no clock of its own, so notice the weapon
    // changing; `reload` and `melee` are progresses owned by the weapon and
    // passed straight through.
    if (this._lastWeaponId !== undefined && this._lastWeaponId !== this.weaponId) {
      triggerAction(this.rig, 'swap');
    }
    this._lastWeaponId = this.weaponId;
    if (s.throwing && !this._wasThrowing) triggerAction(this.rig, 'throw');
    this._wasThrowing = !!s.throwing;
    if (s.hit && !this._wasHit) triggerAction(this.rig, 'flinch');
    this._wasHit = !!s.hit;
    const act = tickActions(this.rig, dt);

    const gaitOptions = {
      speed, moving, run, sprint: !!s.sprint, crouch: this._crouch, dt, dirF, dirR,
      grounded, vy: s.vy || 0, slide: s.sliding ? 1 : 0,
    };
    // The imported animation pack uses a different bind-axis convention. Its
    // retargeted absolute leg rotations can collapse the connected HeroBody
    // into a folded pose in live remote/spectator rendering. The procedural
    // solver is authored against this exact rig and keeps feet, knees and hips
    // in the correct local spaces for every network snapshot.
    const gait = applyWalkCycle(this.rig, gaitOptions);
    this._walkT = gait.phase;
    this._gaitSway = gait.sway;
    this._gaitBob = gait.bob;
    this._gaitLean = gait.lean;
    this._gaitRoll = gait.roll;
    g.position.set(
      s.position.x + Math.cos(g.rotation.y) * gait.sway,
      s.position.y + gait.bob,
      s.position.z - Math.sin(g.rotation.y) * gait.sway,
    );
    g.rotation.x = gait.lean;                  // already eased, and bob assumes it
    g.rotation.z = gait.roll;

    if (this.isMelee) {
      applyMeleeCarry(this.rig, this.weapon, {
        swing: s.swing, moving, phase: gait.phase, run, dt,
        throwP: act.throw, flinch: act.flinch,
      });
      return;
    }
    if (!this.weapon) return;

    // Shoulder the rifle while firing, drift back to the patrol carry after.
    this._aimHold = Math.max(0, (this._aimHold || 0) - dt);
    if (s.firing) this._aimHold = 1.1;
    this._firePulseT = Math.max(0, this._firePulseT - dt);
    if (s.firing && this._firePulseT <= 0) {
      this._kick = 1;
      this._firePulseT = 0.09;
    }
    this._kick = Math.max(0, this._kick - dt * 7);
    const want = (this._aimHold > 0 || s.aiming) ? 1 : 0;
    this._aim += (want - this._aim) * Math.min(1, dt * 8);

    // The rifle points where this character is actually shooting. Only the
    // smoothing lives here — applyRifleCarry converts the angle, so a remote
    // and its own local body cannot end up aiming at two different places.
    this._pitch += ((s.pitch || 0) - this._pitch) * Math.min(1, dt * 12);

    applyRifleCarry(this.rig, this.weapon, this._aim, dt, {
      aimPitch: this._pitch, bodyPitch: gait.lean,
      swing: gait.swing,
      kick:  this._kick,
      reload: s.reload || 0, swap: act.swap, flinch: act.flinch, throwP: act.throw,
      move: moving ? 1 : 0, run,
      firing: s.firing ? 1 : 0, scoped: s.aiming ? 1 : 0,
      smooth: true,
    });
  }

  dispose() {
    this.landingEffect.dispose();
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      // The cyborg chassis share their buffers between every body on the map
      // (LowPolyModels caches geometry per shape). Freeing one here would empty
      // the player's own model and every bot's along with this avatar's.
      if (!isSharedGeometry(o.geometry)) o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
      else o.material?.dispose?.();
    });
  }
}
