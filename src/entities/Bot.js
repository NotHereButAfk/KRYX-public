import * as THREE from 'three';
import { groundDeathBody } from '../player/DeathBody.js';
import { buildPreviewCharacter, rigCharacterLimbs } from '../player/PreviewCharacter.js';
import { buildWeaponModel, hasLoadedWeaponModel } from '../weapons/WeaponModels.js';
import { getWeapon } from '../weapons/weaponDefs.js';
import { applyRifleCarry, restRifleTransform } from '../player/RifleCarry.js';
import { applyWalkCycle } from '../player/Locomotion.js';
import { applyMeleeCarry } from '../player/Actions.js';
import { directionToBodyYaw, turnBodyYaw } from '../player/Facing.js';
import { BOT_SKIN } from '../player/skins.js';
import { BOT_DASH, BOT_RETALIATION_AIM_SCALE, BOT_TACTICS, advanceBotMagazine, advanceBurst, botAimErrorMeters, botTrackingOffset, botArenaDetectionDistance, botLoadoutForId, chooseCombatSteering, choosePlayerLikeBotMove, chooseReachableRoamPoint, isBotDashLaneSafe } from './BotCombat.js';
import { BACKWARD_WALK_MULT, BOT_MOVEMENT_SCALE, WALK_SPEED, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN, STAMINA_REGEN_DELAY } from '../sim/MovementConfig.js';
import { DEATH_FALL_DURATION, deathFallProgress } from '../player/DeathAnimation.js';
import { PLAYER_WORLD_MODEL_SCALE } from '../player/Proportions.js';

const _STILL = { bob: 0, lean: 0, swing: 0 };
const _tmpA = new THREE.Vector3();   // scratch: bullet-cone basis
const _tmpB = new THREE.Vector3();

const DETECT_RADIUS = BOT_TACTICS.detectRadius;
const ATTACK_RADIUS = BOT_TACTICS.meleeAttackDistance;
const ATTACK_DAMAGE = 12;
const ATTACK_COOLDOWN = 0.95;
const LUNGE_TIME = 0.2;      // how long a sword bot's strike takes to play
const RESPAWN_DELAY = 4;
const RADIUS = 0.5;
const BOT_GRAVITY = -20;
const BOT_JUMP_SPEED = 9.6 * Math.sqrt(1.2);
const OUTLINE_LOD_DISTANCE = 36;
const MID_POSE_DISTANCE = 26;
const FAR_POSE_DISTANCE = 48;
// Aggro persists this long after losing sight of you, so breaking line of
// sight buys you a few seconds rather than instantly erasing you.
const PROVOKE_DURATION = BOT_TACTICS.memoryDuration;

// ── Combat tuning ────────────────────────────────────────────────────────────
// Aim error in METRES AT THE TARGET rather than as an angle — a bot "misses by
// about a metre, more the further out you are". Expressed this way it also
// can't turn into a perfect marksman at point-blank, which a fixed angular cone
// does (a 3° cone at 5m physically cannot miss a torso).
// Cover and player strafing still matter because these remain real ray shots.
const AIM_SKILL_MIN = 0.80;    // per-bot multiplier — lower is a better shot
const AIM_SKILL_MAX = 1.15;
const REACTION_MIN  = 0.18;    // seconds between acquiring a target and firing
const REACTION_MAX  = 0.52;
// Player hitboxes, relative to their feet: a torso sphere and a head.
const PLAYER_BODY_Y = 1.05, PLAYER_BODY_R = 0.42;
const PLAYER_HEAD_Y = 1.60, PLAYER_HEAD_R = 0.24;

let nextId = 1;

// Bots share the exact default player presentation. Names and BOT badges keep
// them readable without giving AI opponents a separate model/skin roster.
const DEFAULT_BOT_SKIN = BOT_SKIN;
// Bots always use the same authored default body as a fresh player.  Keep this
// explicit so reordering the selectable armour menu cannot silently reskin
// every bot in a later update.
const DEFAULT_BOT_ARMOR_ID = 'vanguard';

function buildHealthBar() {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x14161a, depthTest: false })
  );
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff4d4d, depthTest: false })
  );
  bg.renderOrder = 10;
  fg.renderOrder = 11;
  bg.userData.noHit = true;
  fg.userData.noHit = true;
  group.add(bg);
  group.add(fg);
  group.position.y = 2.7; // above the tallest armor type (heavy ~2.5)
  return { group, fg };
}

export class Bot {
  constructor(world, spawnPoint) {
    this.isBot = true;
    this.id = nextId++;
    this.world = world;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.alive = true;
    // Server-roster metadata: every combatant fills one of the 8 server slots.
    // A "human slot" is a simulated remote player; otherwise it's a bot.
    this.displayName = `Bot-${this.id}`;
    this.isHumanSlot = false;
    this.respawnTimer = 0;
    this.attackCooldown = 0;
    this.flashTimer = 0;
    this.wanderTarget = spawnPoint.clone();
    this.wanderCooldown = 0;
    this.lungeTimer = 0;
    // The arena reads primarily as a firefight; a smaller sword cohort supplies
    // close-range disruption instead of turning every encounter into a mob.
    this._botGun      = botLoadoutForId(this.id);
    this._isSwordBot  = !this._botGun;
    this.speed = WALK_SPEED * SPRINT_MULT;
    this.stamina = STAMINA_MAX;
    this._staminaDelay = 0;
    this._staminaRecovering = false;
    this._encounterTime = 0;
    this._gunTimer    = Math.random() * 0.8;
    this._magAmmo     = this._botGun?.magSize || 0;
    this._reloadTimer = 0;
    this._burstShots  = 2 + Math.floor(Math.random() * 3);
    // Per-bot marksmanship multiplier on the aim error. Rolling this per bot is
    // what makes some of them feel dangerous and others sloppy.
    this._aimSkill    = AIM_SKILL_MIN + Math.random() * (AIM_SKILL_MAX - AIM_SKILL_MIN);
    this._reactT      = 0;       // reaction delay before a fresh target is engaged
    this._footPhase   = 0;       // last walk-cycle phase a footstep played on
    this._weaponT     = Math.random() * Math.PI * 2; // phase offset for variety
    this._alertBlend  = 0;   // 0 = low-ready, 1 = high-ready/aiming
    this._weaponMesh  = null;
    this._rig         = null;
    this._walkT       = Math.random() * Math.PI * 2; // random phase so bots aren't in sync
    this._targetYaw   = 0;      // desired facing — smoothed each frame (no snap turns)
    this._yawInit     = false;
    this._gunKick     = 0;      // recoil impulse, decays
    this._muzzleT     = 0;      // muzzle-flash visible timer
    this._muzzleFlash = null;
    this._weaponBaseZ = 0;
    this._provoked     = false;
    this._provokedByPlayer = false;
    this._provokeTimer = 0;
    this._losT         = Math.random() * 0.12;
    this._losCache     = false;
    this._decisionT    = 0;
    this._strafeSign   = Math.random() < 0.5 ? -1 : 1;
    this._wantsJump    = false;
    this._jumpCooldown = Math.random() * 0.8;
    this._velY         = 0;
    this._onGround     = true;
    this._animSpeed    = 0;
    this._stuckT       = 0;
    this._dashT        = 0;
    this._dashCooldown = 0.75 + Math.random() * 0.65;
    this._padTeleCD    = 0;
    this._targetEntity = null;
    this._targetScanT  = Math.random() * 0.35;
    this._botKills     = 0;
    this._botDeaths    = 0;
    this._poseAcc      = 0;
    this._outlineVisible = true;

    // Pre-allocated scratch vectors — avoids per-frame GC pressure
    this._toPlayer    = new THREE.Vector3();
    this._toTarget    = new THREE.Vector3();
    this._wanderDir   = new THREE.Vector3();
    this._combatDir   = new THREE.Vector3();
    this._strafeDir   = new THREE.Vector3();
    this._dashDir     = new THREE.Vector3();
    this._separationDir = new THREE.Vector3();
    this._separationSteer = new THREE.Vector3();
    this._separationStrength = 0;
    this._lastSeenPos = spawnPoint.clone();
    this._lastSeenValid = false;
    this._shootFrom   = new THREE.Vector3();
    this._shootTarget = new THREE.Vector3();
    this._shootDir    = new THREE.Vector3();
    this._raycaster   = new THREE.Raycaster();
    this._bulletRay   = new THREE.Ray();
    this._sphere      = new THREE.Sphere();
    this._hitPt       = new THREE.Vector3();
    this._healthQuat  = new THREE.Quaternion();
    this._worldContact = { grounded: false, normalY: -1, depth: 0, verticalCorrection: 0 };

    this.position = spawnPoint.clone();

    const armorTypeId = DEFAULT_BOT_ARMOR_ID;
    const skin = DEFAULT_BOT_SKIN;
    this.armorTypeId = armorTypeId;
    this.skin = skin;
    // Bots use the exact Blender-authored default warrior and its native rig.
    // If the asset is still loading, the builder retains its safe fallback.
    this.mesh = buildPreviewCharacter(skin, armorTypeId, null, { allowHuman: true });
    this._isHuman = !!this.mesh.userData?.isHuman;
    // Bots and players share one silhouette. The old full-scale bot setting
    // made the same mesh look like a different, oversized character.
    this.mesh.scale.multiplyScalar(PLAYER_WORLD_MODEL_SCALE);
    this._baseScale = this.mesh.scale.clone();
    this.mesh.userData.worldModelScale = PLAYER_WORLD_MODEL_SCALE;
    this.bodyMat = this.mesh.userData.primaryMat;

    this.mesh.userData.bot = this;
    this.mesh.traverse((obj) => {
      obj.userData.bot = this;
      // Procedural model: tag head-zone parts for headshots (human headshots are
      // resolved by hit-point height in WeaponSystem instead).
      if (!this._isHuman && obj.isMesh && obj.position.y >= 1.90) obj.userData.isHead = true;
    });

    const { group: hpGroup, fg } = buildHealthBar();
    this.healthBarFg = fg;
    this.mesh.add(hpGroup);
    this.healthBarGroup = hpGroup;

    this.mesh.position.copy(this.position);
    // Yaw-first euler order, so the run lean (rotation.x) and the death topple
    // (rotation.z) tilt about the BODY's axes rather than the world's.
    this.mesh.rotation.order = 'YXZ';

    // Rig limb pivots for the connected exosuit walk cycle. The guarded human
    // branch remains only for direct development tooling.
    this._rig = this._isHuman ? null : rigCharacterLimbs(this.mesh);

    const weaponId = this._isSwordBot ? 'sword' : this._botGun.id;

    // Human bots hold their weapon in the rigged right hand — same attach +
    // hold-pose animation as the player's third-person body. noHit keeps the
    // weapon meshes out of hitscan raycasts (shooting the gun isn't a hit).
    if (this._isHuman && this.mesh.userData.attachWeapon) {
      const def = getWeapon(weaponId);
      if (def) {
        const { group: wm, muzzle } = buildWeaponModel(def, { procedural: true });
        wm.traverse(o => { if (o.isMesh) o.userData.noHit = true; });
        this.mesh.userData.attachWeapon(wm, this._isSwordBot);
        this._weaponMuzzle = muzzle;
        this._weaponMesh = null; // hand-held; no procedural weapon animation
      }
    }

    const weaponDef = !this._isHuman && getWeapon(weaponId);
    if (weaponDef) {
      const { group: wm, muzzle } = buildWeaponModel(weaponDef, { procedural: true });
      wm.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.noHit = true; } });
      if (this._isSwordBot) {
        // Sword low guard: right hand out front, blade angled forward-up
        wm.position.set(-0.22, 1.06, -0.24);
        wm.rotation.set(-0.70, 0, 0.22);
      } else {
        // AR in the high combat-ready carry — stock tight to the right shoulder,
        // receiver at the upper chest, muzzle only slightly lowered.
        // applyRifleCarry() completes the small lift when the bot engages.
        restRifleTransform(wm);
      }
      this._weaponMuzzle = muzzle;
      this.mesh.add(wm);
      this._weaponMesh = wm;
      this._weaponBaseZ = wm.position.z;
      if (!this._isSwordBot) {
        // Muzzle flash — a bright additive burst parented to the WEAPON at the
        // barrel tip, so it tracks the muzzle no matter how the gun is posed.
        const flash = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.11),
          new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95,
                                        blending: THREE.AdditiveBlending, depthWrite: false })
        );
        flash.position.set(0, 0, 0);
        flash.visible = false;
        flash.renderOrder = 6;
        flash.raycast = () => {};
        muzzle.add(flash);
        this._muzzleFlash = flash;
      }
    }
  }

  get isDead() { return !this.alive; }

  refreshWeaponModel() {
    if (this._isSwordBot || !hasLoadedWeaponModel(this._botGun?.id)) return;
    if (this._isHuman) {
      if (this._heldWeaponReady) return;
      const def = getWeapon(this._botGun.id);
      const built = def && buildWeaponModel(def);
      const weapon = built?.group;
      this._weaponMuzzle = built?.muzzle;
      if (weapon) { this.mesh.userData.attachWeapon(weapon); this._heldWeaponReady = true; }
      return;
    }
    if (['quaternius', 'blender-arsenal'].includes(this._weaponMesh?.userData?.modelSource)) return;
    const def = getWeapon(this._botGun.id);
    const built = def && buildWeaponModel(def);
    const wm = built?.group;
    this._weaponMuzzle = built?.muzzle;
    if (!wm) return;
    this.mesh.remove(this._weaponMesh);
    wm.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.noHit = true; } });
    restRifleTransform(wm);
    this.mesh.add(wm);
    this._weaponMesh = wm;
    this._weaponBaseZ = wm.position.z;
    const flash = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95,
                                    blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flash.position.set(0, 0, 0);
    flash.visible = false;
    flash.renderOrder = 6;
    flash.raycast = () => {};
    this._weaponMuzzle.add(flash);
    this._muzzleFlash = flash;
  }

  takeDamage(amount, attacker = null) {
    if (!this.alive) return false;
    // Damage immediately refreshes combat memory even if the attacker fired
    // from outside the normal vision cone/range.
    if (!this._provoked) {
      this._reactT = REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
      this._encounterTime = -this._reactT;
    }
    this._provoked = true;
    // A missing attacker is the local player weapon/grenade path. Bot-v-bot
    // damage passes the attacking bot explicitly and must not make this bot
    // hostile toward the human later.
    if (!attacker) this._provokedByPlayer = true;
    if (!attacker) {
      // Cancel traversal boosts while reacting to the attacker.
      this._dashT = 0;
      this._dashDir.set(0, 0, 0);
      this._wantsJump = false;
    }
    this._provokeTimer = PROVOKE_DURATION;
    this.health = Math.max(0, this.health - amount);
    this.flashTimer = 0.12;
    // Rigged humans flinch away from the hit direction; procedural bots skip.
    this.mesh?.userData?.triggerHit?.(0, 1);
    this.healthBarFg.scale.x = Math.max(0.001, this.health / this.maxHealth);
    this.healthBarFg.position.x = -((1 - this.healthBarFg.scale.x) * 0.33);
    if (this.health <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    if (this.audio) this.audio.playAt(this.position, () => { this.audio.playHurt(); this.audio.playLand(true); });
    this._botDeaths = (this._botDeaths || 0) + 1;
    this.alive = false;
    this._dying      = true;
    this._deathT     = 0;
    this._deathSide  = Math.random() < 0.5 ? 1 : -1;
    this._deathBaseY = this.mesh.position.y;
    this._deathYaw = this.mesh.rotation.y;
    this.healthBarGroup.visible = false;
  }

  respawnAt(point) {
    this.stamina = STAMINA_MAX;
    this._staminaDelay = 0;
    this._staminaRecovering = false;
    this.position.copy(point);
    this.mesh.position.set(point.x, point.y, point.z);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.copy(this._baseScale);
    this.health = this.maxHealth;
    this.healthBarFg.scale.x = 1;
    this.healthBarFg.position.x = 0;
    this.healthBarGroup.visible = true;
    this._dying = false;
    this.alive = true;
    this.mesh.visible = true;
    // Clear the death-crumple pose off the rig so the fresh body starts neutral.
    if (this._rig) {
      for (const k of ['legL', 'legR', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
                       'armL', 'armR', 'elbowL', 'elbowR']) {
        this._rig[k]?.rotation.set(0, 0, 0);
      }
    }
    this._gunKick   = 0;
    this._alertBlend = 0;
    this._velY = 0;
    this._onGround = true;
    this._animSpeed = 0;
    this._poseTravel = this._poseAcc = 0;
    this._jumpCooldown = 0.4 + Math.random() * 0.8;
    this._wantsJump = false;
    this._stuckT = 0;
    this._dashT = 0;
    this._dashCooldown = 0.75 + Math.random() * 0.65;
    this._dashDir.set(0, 0, 0);
    this._lastSeenValid = false;
    this._provoked = false;
    this._provokedByPlayer = false;
    this._encounterTime = 0;
    this._provokeTimer = 0;
    this._losCache = false;
    this._decisionT = 0;
    this._burstShots = 2 + Math.floor(Math.random() * 3);
    this._magAmmo = this._botGun?.magSize || 0;
    this._reloadTimer = 0;
    this._targetEntity = null;
    this._targetScanT = 0;
    if (this._isHuman) {
      const ud = this.mesh.userData;
      ud.setDeathState?.(0, this._deathSide);
      ud.setLocomotion?.(0, true, false, 0, 1, 0);
      ud.setAim?.(0, 0);
      ud.setActionState?.({
        reload: 0, swing: 1, crouch: 0, slide: 0, vy: 0,
        aim: 0, move: 0, run: 0, firing: 0, scoped: 0,
      });
    }
    if (this._isSwordBot) {
      if (this._weaponMesh) { this._weaponMesh.position.z = this._weaponBaseZ; this._weaponMesh.rotation.x = -0.70; }
    } else {
      // Snap (dt=1 ⇒ ease factor 1) straight into the patrol carry so the fresh
      // body doesn't spend its first frames unfolding out of a T-pose.
      applyRifleCarry(this._rig, this._weaponMesh, 0, 1);
    }
    // Phase in on respawn instead of popping into existence. Human bots play
    // the rigged teleport-arrival reform; cyborg/procedural bodies materialise
    // via a fade + settle (see the spawn-in tick in update()).
    if (this._isHuman) {
      this.mesh.userData.triggerTeleport?.();
    } else {
      this._spawnT = 0.45;
      this.mesh.scale.copy(this._baseScale);
      this.mesh.traverse(o => {
        if (o.isMesh && o.material && 'opacity' in o.material) { o.material.transparent = true; o.material.opacity = 0; }
      });
    }
  }

  /** Clear line of sight from the bot's eye to the player's chest? */
  hasLineOfSight(player, world) {
    this._shootFrom.set(this.position.x, this.position.y + 1.5, this.position.z);
    this._shootTarget.set(player.position.x, player.position.y + PLAYER_BODY_Y, player.position.z);
    const dist = this._shootFrom.distanceTo(this._shootTarget);
    if (dist < 0.5) return true;
    this._shootDir.subVectors(this._shootTarget, this._shootFrom).normalize();
    if (!world?.raycastCollisionDistance) return true;
    // Use World's collision octree plus bare box colliders. Traversing every
    // render mesh for each bot probe made dense imported maps unplayable.
    this._bulletRay.set(this._shootFrom, this._shootDir);
    return world.raycastCollisionDistance(this._bulletRay, dist - 0.5) >= dist - 0.5;
  }

  _dashLaneSafe(direction, world, laneDistance = BOT_DASH.laneDistance) {
    return isBotDashLaneSafe({
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      dx: direction.x,
      dz: direction.z,
      laneDistance,
      killY: world?.killY ?? -25,
      groundHeightAt: world?.groundHeightAt
        ? (x, z, prevY, nextY) => world.groundHeightAt(x, z, prevY, nextY)
        : null,
      raycast: (ox, oy, oz, dx, dy, dz, far) => {
        this._shootFrom.set(ox, oy, oz);
        this._shootDir.set(dx, dy, dz);
        this._bulletRay.set(this._shootFrom, this._shootDir);
        return world?.raycastCollisionDistance?.(this._bulletRay, far) ?? far;
      },
    });
  }

  _shootAt(player, onAttack, world) {
    const nativeMuzzle = this.mesh?.userData?.getMuzzleWorldPosition;
    if (nativeMuzzle) {
      if (!nativeMuzzle(this._shootFrom)) return;
    } else {
      if (!this._weaponMuzzle?.parent) return;
      this._weaponMuzzle.updateWorldMatrix(true, false);
      this._weaponMuzzle.getWorldPosition(this._shootFrom);
    }
    this._shootTarget.set(player.position.x, player.position.y + PLAYER_BODY_Y, player.position.z);
    const dist = this._shootFrom.distanceTo(this._shootTarget);
    if (dist < 0.5) return;
    this._shootDir.subVectors(this._shootTarget, this._shootFrom).normalize();

    // Fire feedback: rigged humans use their skeletal recoil; cyborg/procedural
    // bots get a weapon recoil kick + a muzzle flash (driven in update()).
    this.mesh?.userData?.triggerFire?.(1);
    this._gunKick = 1;
    this._muzzleT = 0.05;
    if (this._muzzleFlash) {
      this._muzzleFlash.visible = true;
      this._muzzleFlash.rotation.set(0, 0, Math.random() * Math.PI);
      this._muzzleFlash.scale.setScalar(0.75 + Math.random() * 0.6);
    }
    if (this.audio) this.audio.playAt(this._shootFrom, () => this.audio.playShot(this._botGun.sound));

    // ── The bullet is a real ray ───────────────────────────────────────────────
    // Scatter it inside the bot's aim cone, then see what it actually hits. This
    // is the whole point: cover blocks it, distance widens the cone's footprint,
    // and strafing makes it miss — none of which a probability roll can express.
    // Scatter radius in metres at the target, converted to an angle.
    const retaliationScale = BOT_RETALIATION_AIM_SCALE * (this._animSpeed > WALK_SPEED * 1.1 ? 1.25 : 1);
    const spread = botAimErrorMeters(dist, this._aimSkill * retaliationScale) / Math.max(1, dist);
    _tmpA.set(-this._shootDir.z, 0, this._shootDir.x);              // horizontal ⊥
    if (_tmpA.lengthSq() < 1e-6) _tmpA.set(1, 0, 0);
    _tmpA.normalize();
    _tmpB.crossVectors(this._shootDir, _tmpA).normalize();          // vertical ⊥
    const tracking = botTrackingOffset(this.id, this._encounterTime);
    this._shootDir
      .addScaledVector(_tmpA, tracking.x * spread)
      .addScaledVector(_tmpB, tracking.y * spread)
      .normalize();

    this._bulletRay.set(this._shootFrom, this._shootDir);
    const range = this._botGun.range;

    // Nearest world obstruction along the bullet's actual path.
    let blockAt = Infinity;
    if (world?.raycastCollisionDistance) {
      blockAt = world.raycastCollisionDistance(this._bulletRay, range);
    }

    // Does it reach the player before that?
    const hitDist = this._rayHitsPlayer(player, range);
    if (hitDist !== null && hitDist < blockAt) onAttack(this._botGun.damage, this.position);
  }

  /** Distance along _bulletRay at which it strikes the player, or null. */
  _rayHitsPlayer(player, range) {
    let best = null;
    for (const [dy, r] of [[PLAYER_BODY_Y, PLAYER_BODY_R], [PLAYER_HEAD_Y, PLAYER_HEAD_R]]) {
      this._sphere.center.set(player.position.x, player.position.y + dy, player.position.z);
      this._sphere.radius = r;
      if (!this._bulletRay.intersectSphere(this._sphere, this._hitPt)) continue;
      const d = this._bulletRay.origin.distanceTo(this._hitPt);
      if (d <= range && (best === null || d < best)) best = d;
    }
    return best;
  }

  update(dt, player, camera, onAttack, world) {
    this.refreshWeaponModel();
    // ── death animation ──────────────────────────────────────────────────────
    if (this._dying) {
      this._deathT += dt;
      const p = Math.min(1, this._deathT / DEATH_FALL_DURATION);
      const eased = deathFallProgress(this._deathT);
      this.mesh.quaternion.setFromEuler(new THREE.Euler(eased * Math.PI / 2, this._deathYaw, 0, 'YXZ'));
      this.mesh.position.y = this._deathBaseY;
      if (this._isHuman) {
        const ud = this.mesh.userData;
        ud.setLocomotion?.(0, true, false);
        ud.setDeathState?.(Math.max(.0001, eased), this._deathSide, true);
        ud.mixer?.update(dt);
      }
      groundDeathBody(this.mesh, this._deathBaseY);
      if (p > 0.58) {
        const fade = 1 - (p - 0.58) / 0.42;
        this.mesh.traverse(o => { if (o.isMesh && o.material && 'opacity' in o.material) {
          o.material.transparent = true;
          o.material.opacity = fade;
        }});
      }
      if (p >= 1) {
        this._dying = false;
        this.mesh.visible = false;
        this.mesh.rotation.set(0, 0, 0);
        this.mesh.position.y = this._deathBaseY;
        this.mesh.traverse(o => { if (o.isMesh && o.material && 'opacity' in o.material) {
          o.material.transparent = false; o.material.opacity = 1;
        }});
        if (!this.noRespawn) this.respawnTimer = RESPAWN_DELAY;
      }
      return;
    }

    if (!this.alive) {
      if (!this.noRespawn) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.respawnAt(this._chooseRespawnPoint?.() || this.world.randomSpawnPoint());
        }
      }
      return;
    }

    // Fade in at the same size as players; never enlarge the body on arrival.
    if (this._spawnT > 0) {
      this._spawnT = Math.max(0, this._spawnT - dt);
      const p  = 1 - this._spawnT / 0.45;           // 0 → 1
      const e  = p * (2 - p);                        // ease-out
      const op = Math.min(1, e * 1.35);
      this.mesh.scale.copy(this._baseScale);
      this.mesh.traverse(o => {
        if (o.isMesh && o.material && 'opacity' in o.material) { o.material.transparent = op < 1; o.material.opacity = op; }
      });
      if (this._spawnT === 0) {                       // land exactly on full
        this.mesh.scale.copy(this._baseScale);
        this.mesh.traverse(o => { if (o.isMesh && o.material && 'opacity' in o.material) { o.material.transparent = false; o.material.opacity = 1; } });
      }
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.bodyMat) {
        this.bodyMat.emissive.setRGB(1, 1, 1);
        this.bodyMat.emissiveIntensity = Math.max(0, this.flashTimer / 0.12) * 0.8;
      }
    } else if (this.bodyMat) {
      this.bodyMat.emissiveIntensity = 0;
    }

    // Bot weapons use finite magazines. The pause is both a fair combat window
    // and a visible action because its progress feeds the shared carry rig.
    if (this._reloadTimer > 0 && this._botGun) {
      const magazine = advanceBotMagazine(this._magAmmo, this._reloadTimer, dt, this._botGun);
      this._magAmmo = magazine.ammo;
      this._reloadTimer = magazine.reloadRemaining;
    }

    // Melee lunge timer — the swing is conveyed by the weapon thrust (weapon
    // animation block) rather than a whole-body scale "puff", which also freed
    // mesh.scale for the respawn materialize.
    if (this.lungeTimer > 0) this.lungeTimer -= dt;
    if (this._dashT > 0) this._dashT = Math.max(0, this._dashT - dt);
    else this._dashCooldown = Math.max(0, this._dashCooldown - dt);

    this._toPlayer.set(player.position.x - this.position.x, 0, player.position.z - this.position.z);
    const toPlayer = this._toPlayer;
    const distToPlayer = toPlayer.length();
    const outlineVisible = distToPlayer < OUTLINE_LOD_DISTANCE;
    if (outlineVisible !== this._outlineVisible) {
      this._outlineVisible = outlineVisible;
      for (const outline of this.mesh.userData?.outlines || []) outline.visible = outlineVisible;
    }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // ── Awareness ──────────────────────────────────────────────────────────────
    // Visible humans can start an encounter without damaging the bot first.
    const targetDetectRadius = player?.isBot
      ? botArenaDetectionDistance(DETECT_RADIUS)
      : DETECT_RADIUS;
    const inRange = !player.isDead && distToPlayer < targetDetectRadius;
    this._losT -= dt;
    if (inRange) {
      if (this._losT <= 0) {
        this._losT = 0.12 + Math.random() * 0.1;
        this._losCache = this.hasLineOfSight(player, world);
      }
    } else {
      this._losCache = false;
    }
    const hasVisual = inRange && this._losCache;
    // Arena bots can hear another bot's movement at the expanded acquisition
    // range. This lets separated opponents converge around cover, while all
    // shooting below still requires hasVisual and therefore real LOS.
    const hasArenaAwareness = !!player?.isBot && inRange;
    const canEngageTarget = !!player && player !== this;
    if (player.isDead) {
      this._provoked = false;
      this._provokedByPlayer = false;
      this._provokeTimer = 0;
      this._lastSeenValid = false;
    } else if ((hasVisual || hasArenaAwareness) && canEngageTarget) {
      if (!this._provoked) this._reactT = REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
      this._provoked = true;
      this._provokeTimer = PROVOKE_DURATION;
      this._lastSeenPos.copy(player.position);
      this._lastSeenValid = true;
    } else if (this._provokeTimer > 0) {
      this._provokeTimer -= dt;
      if (this._provokeTimer <= 0) {
        this._provoked = false;
        this._provokedByPlayer = false;
        this._lastSeenValid = false;
      }
    }
    if (this._reactT > 0) this._reactT -= dt;
    const engaged = canEngageTarget && this._provoked && !player.isDead && (hasVisual || this._lastSeenValid);

    let moveTarget = null;
    let chasing = false;
    let gaitDirF = 0;
    let gaitDirR = 0;
    if (engaged) {
      const target = (hasVisual || hasArenaAwareness) ? player.position : this._lastSeenPos;
      this._toTarget.set(target.x - this.position.x, 0, target.z - this.position.z);
      const targetDistance = this._toTarget.length();
      const targetDir = this._combatDir.copy(this._toTarget);
      if (targetDir.lengthSq() > 1e-5) targetDir.normalize();

      // Change direction in readable beats rather than vibrating every frame.
      this._decisionT -= dt;
      if (this._decisionT <= 0) {
        this._decisionT = 0.95 + Math.random() * 0.80;
        if (Math.random() < 0.35) this._strafeSign *= -1;
        const targetIsHigher = player.position.y > this.position.y + 1.15;
        this._wantsJump = this._onGround && this._jumpCooldown <= 0 &&
          (targetIsHigher || (hasVisual && targetDistance > 6 && targetDistance < 18
            && Math.random() < 0.10));
      }

      this._encounterTime += dt;
      const maneuver = choosePlayerLikeBotMove({
        id: this.id, elapsed: this._encounterTime, distance: targetDistance,
        reacting: this._reactT > 0, hasLineOfSight: hasVisual,
        reloading: this._reloadTimer > 0,
      });
      chasing = !!maneuver.sprint;
      const holdGround = !this._isSwordBot && !maneuver.forward && !maneuver.strafe;
      if (holdGround) {
        // Brief aiming beats keep their feet quiet between deliberate steps.
        this._dashT = 0;
        this._dashDir.set(0, 0, 0);
        this._wantsJump = false;
      } else {
        const steering = this._isSwordBot ? chooseCombatSteering({
          distance: targetDistance,
          hasLineOfSight: hasVisual,
          strafeSign: this._strafeSign,
          melee: this._isSwordBot,
        }) : maneuver;
        this._strafeDir.set(-targetDir.z, 0, targetDir.x);
        this._combatDir
          .copy(targetDir)
          .multiplyScalar(steering.forward)
          .addScaledVector(this._strafeDir, steering.strafe);
        const steerLen = Math.hypot(steering.forward, steering.strafe);
        if (this._combatDir.lengthSq() > 1e-5) {
          moveTarget = this._combatDir.normalize();
          gaitDirF = steering.forward / Math.max(1, steerLen);
          gaitDirR = steering.strafe / Math.max(1, steerLen);
        }
      }
      if (!this._isSwordBot) this._wantsJump = false;

      // Face the live target while circling/retreating. With no visual, face
      // the last-seen point until it is searched.
      this._targetYaw = directionToBodyYaw(
        target.x - this.position.x,
        target.z - this.position.z
      );

      // Ranged bots use short bursts only with a verified firing lane.
      const aimDelta = Math.abs(Math.atan2(Math.sin(this._targetYaw - this.mesh.rotation.y),
        Math.cos(this._targetYaw - this.mesh.rotation.y)));
      if (this._botGun && this._reloadTimer <= 0 && hasVisual && this._reactT <= 0
        && aimDelta < 0.28 && distToPlayer < this._botGun.range) {
        this._gunTimer -= dt;
        if (this._gunTimer <= 0) {
          this._shootAt(player, onAttack, world);
          const magazine = advanceBotMagazine(this._magAmmo, this._reloadTimer, 0, this._botGun, true);
          this._magAmmo = magazine.ammo;
          this._reloadTimer = magazine.reloadRemaining;
          const burst = advanceBurst(this._burstShots);
          this._burstShots = burst.shotsRemaining;
          this._gunTimer = this._botGun.fireRate * burst.delayScale;
        }
      }

      if (this._isSwordBot && hasVisual && distToPlayer <= ATTACK_RADIUS &&
          this.attackCooldown <= 0) {
        this.attackCooldown = ATTACK_COOLDOWN;
        this.lungeTimer = LUNGE_TIME;
        this.audio?.playAt?.(this.position, () => {
          this.audio.playSwing?.();
          this.audio.playSwordImpact?.('armor');
        });
        onAttack(ATTACK_DAMAGE, this.position);
      }

      // Reaching the remembered point without reacquiring the player starts a
      // brief search, then releases the target instead of tracking through walls.
      if (!hasVisual && targetDistance < 1.2) {
        this._lastSeenValid = false;
        this._provokeTimer = Math.min(this._provokeTimer, 0.65);
      }
    } else if (!this._provoked || !canEngageTarget) {
      this.wanderCooldown -= dt;
      if (this.wanderCooldown <= 0 || this.position.distanceTo(this.wanderTarget) < 1.5) {
        const picked = chooseReachableRoamPoint({
          x: this.position.x, y: this.position.y, z: this.position.z,
          half: this.world.arenaHalf, killY: this.world.killY,
          recent: this._patrolHistory || [], heading: this.mesh.rotation.y, maxDrop: 2,
          groundHeightAt: (x, z, prevY, newY) => this.world.groundHeightAt(x, z, prevY, newY),
          raycast: (ox, oy, oz, dx, dy, dz, far) => {
            this._shootFrom.set(ox, oy, oz);
            this._shootDir.set(dx, dy, dz);
            this._bulletRay.set(this._shootFrom, this._shootDir);
            return this.world.raycastCollisionDistance?.(this._bulletRay, far) ?? far;
          },
        });
        this._patrolHistory ||= [];
        this._patrolHistory.push([this.position.x, this.position.y, this.position.z]);
        if (this._patrolHistory.length > 24) this._patrolHistory.shift();
        if (picked) this.wanderTarget.set(picked[0], picked[1], picked[2]);
        else this.wanderTarget.copy(this.position);
        this.wanderCooldown = picked ? 7 + Math.random() * 4 : 0.65;
      }
      this._wanderDir.subVectors(this.wanderTarget, this.position);
      this._wanderDir.y = 0;
      if (this._wanderDir.lengthSq() > 0.04) {
        moveTarget = this._wanderDir.normalize();
        gaitDirF = 1;
        this._targetYaw = directionToBodyYaw(
          this.wanderTarget.x - this.position.x,
          this.wanderTarget.z - this.position.z
        );
      }
    }

    // Blend personal space into patrol/combat steering so several bots cannot
    // collapse into one lane. Stationary player-retaliation remains stationary.
    const holdingGround = engaged && !moveTarget;
    if (moveTarget && !holdingGround && this._separationStrength > 0.01) {
      this._separationSteer
        .copy(moveTarget)
        .addScaledVector(this._separationDir, 0.75 + this._separationStrength * 0.95);
      if (this._separationSteer.lengthSq() > 1e-5) moveTarget = this._separationSteer.normalize();
    }

    this._dashT = 0;
    if (engaged && moveTarget && this._onGround && !this._dashLaneSafe(moveTarget, world, 1.8)) {
      moveTarget = null;
    }

    if (this.stamina <= 2) this._staminaRecovering = true;
    if (this.stamina >= STAMINA_MAX * .5) this._staminaRecovering = false;
    const backwards = !!moveTarget && moveTarget.x * -Math.sin(this.mesh.rotation.y) + moveTarget.z * -Math.cos(this.mesh.rotation.y) < -.001;
    const sprinting = !backwards && !!moveTarget && (!engaged || chasing) && !this._staminaRecovering && this.stamina > 2;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      this._staminaDelay = STAMINA_REGEN_DELAY;
    } else if (this._staminaDelay > 0) {
      this._staminaDelay = Math.max(0, this._staminaDelay - dt);
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
    }
    const beforeX = this.position.x;
    const beforeZ = this.position.z;
    if (moveTarget) {
      this.position.addScaledVector(moveTarget, (sprinting ? this.speed : WALK_SPEED) * (backwards ? BACKWARD_WALK_MULT : 1) * BOT_MOVEMENT_SCALE * dt);
    }

    // Arena movement: bots can hop during a duel, recover from low cover, use
    // grav lifts and fall between different authored elevations.
    this._jumpCooldown = Math.max(0, this._jumpCooldown - dt);
    if (this._wantsJump && this._onGround && this._jumpCooldown <= 0) {
      this._velY = BOT_JUMP_SPEED;
      this._onGround = false;
      this._jumpCooldown = 2.2 + Math.random() * 1.4;
      this.audio?.playAt(this.position, () => this.audio.playJump());
    }
    this._wantsJump = false;

    const lift = world?.queryGravLift?.(this.position.x, this.position.z, this.position.y) || 0;
    if (lift > 0) {
      this._velY = Math.max(this._velY, lift);
      this._onGround = false;
    }

    const prevY = this.position.y;
    this._velY += BOT_GRAVITY * dt;
    this.position.y += this._velY * dt;
    const groundY = world?.groundHeightAt
      ? world.groundHeightAt(this.position.x, this.position.z, prevY, this.position.y)
      : 0;
    if (this.position.y <= groundY + 0.05 && this._velY <= 0.001) {
      this.position.y = groundY;
      this._velY = 0;
      this._onGround = true;
    } else {
      this._onGround = false;
    }
    this.world.resolveCollisions(this.position, RADIUS, this._worldContact);
    if (this._worldContact.grounded && this._velY <= 0.001) {
      this._velY = 0;
      this._onGround = true;
    }

    const actualDX = this.position.x - beforeX;
    const actualDZ = this.position.z - beforeZ;
    const actualMoved = Math.hypot(actualDX, actualDZ);
    const actualSpeed = dt > 1e-4 ? actualMoved / dt : 0;
    this._animSpeed += (actualSpeed - this._animSpeed)
      * (1 - Math.exp(-(actualSpeed < this._animSpeed ? 18 : 10) * dt));

    if (moveTarget) {
      if (actualMoved < this.speed * dt * 0.18) this._stuckT += dt;
      else this._stuckT = Math.max(0, this._stuckT - dt * 2);
      if (this._stuckT > 0.38 && this._onGround) {
        this._stuckT = 0;
        this._strafeSign *= -1;
        // A blocked patrol lane needs a new reachable detour, not a repeated
        // jump against the same wall.
        this.wanderCooldown = 0;
      }
    } else {
      this._stuckT = 0;
    }

    this._padTeleCD = Math.max(0, this._padTeleCD - dt);
    if (this._padTeleCD <= 0 && world?.queryTeleport) {
      const dest = world.queryTeleport(this.position.x, this.position.z);
      if (dest) {
        this.position.copy(dest);
        this._velY = 0;
        this._onGround = true;
        this._padTeleCD = 1;
        this._animSpeed = 0;
        this.mesh?.userData?.triggerTeleport?.();
      }
    }

    if (this.position.y < (this.world.killY ?? -25)) {
      this.respawnAt(this._chooseRespawnPoint?.()
        || this.world.safeSpawnPoint?.([player])
        || this.world.randomSpawnPoint());
      return;
    }

    this.mesh.position.set(this.position.x, this.position.y, this.position.z);

    // Smooth turn toward the desired facing — no more instant snap-arounds.
    if (this._yawInit) {
      this.mesh.rotation.y = turnBodyYaw(
        this.mesh.rotation.y, this._targetYaw, dt, 3.2
      );
    } else { this.mesh.rotation.y = this._targetYaw; this._yawInit = true; }

    // Recoil impulse decays (the weapon-anim block below applies the kick to the
    // gun); the muzzle flash flares out and hides.
    if (this._gunKick > 0) this._gunKick = Math.max(0, this._gunKick - dt * 7);
    if (this._muzzleT > 0) {
      this._muzzleT -= dt;
      if (this._muzzleFlash) this._muzzleFlash.scale.multiplyScalar(1 + dt * 6);
      if (this._muzzleT <= 0 && this._muzzleFlash) this._muzzleFlash.visible = false;
    }

    if (this.healthBarGroup?.visible) {
      this._healthQuat.copy(this.mesh.quaternion).invert().multiply(camera.quaternion);
      this.healthBarGroup.quaternion.copy(this._healthQuat);
    }

    const resolvedMoving = this._animSpeed > 0.25 && actualMoved > 1e-5;
    this._poseTravel = this._isHuman ? (this._poseTravel || 0) + (actualMoved < 2 ? actualMoved : 0) : 0;
    const bodySn = Math.sin(this.mesh.rotation.y);
    const bodyCs = Math.cos(this.mesh.rotation.y);
    const resolvedDirF = resolvedMoving
      ? (actualDX * -bodySn + actualDZ * -bodyCs) / actualMoved : 1;
    const resolvedDirR = resolvedMoving
      ? (actualDX * bodyCs + actualDZ * -bodySn) / actualMoved : 0;

    // Keep AI, collision, facing and movement at full rate, but small distant
    // bodies do not need a 60Hz bone + two-hand IK solve. Accumulating dt keeps
    // their gait speed correct when the presentation pose is sampled at 30/15Hz.
    const poseInterval = distToPlayer >= FAR_POSE_DISTANCE ? 1 / 15
      : distToPlayer >= MID_POSE_DISTANCE ? 1 / 30 : 0;
    if (poseInterval > 0) {
      this._poseAcc += dt;
      if (this._poseAcc < poseInterval) return;
      dt = Math.min(0.1, this._poseAcc);
      this._poseAcc = 0;
    } else {
      this._poseAcc = 0;
    }

    // ── Human soldier: drive its skeletal idle/walk/run animation ──────────────
    if (this._isHuman) {
      const ud = this.mesh.userData;
      const spd = this._animSpeed;
      const moving = resolvedMoving;
      // The tactical steering already expresses travel in the aim-relative
      // frame, so strafing remains correct while the torso tracks the player.
      const strafe = -resolvedDirR;
      if (ud.setLocomotion) {
        ud.setActionState?.({isBot:true});
        ud.setLocomotion(spd, this._onGround, spd > WALK_SPEED * 1.1, strafe, resolvedDirF, resolvedDirR, this._poseTravel);
        this._poseTravel = 0;
      }
      else ud.setMotion(moving ? (sprinting ? 'run' : 'walk') : 'idle');

      // Aim: when engaged with the player, spine + head track them; otherwise
      // gently return to zero via the smoother inside armorTick.
      if (ud.setAim && player) {
        if (this._provoked || engaged) {
          const aimAt = hasVisual ? player.position : this._lastSeenPos;
          const dx = aimAt.x - this.position.x;
          const dz = aimAt.z - this.position.z;
          const dy = (aimAt.y + 1.0) - (this.position.y + 1.5);
          const worldAim = directionToBodyYaw(dx, dz);
          const dyaw = worldAim - this.mesh.rotation.y;
          // Wrap to [-π, π] so the twist takes the short way round.
          const wrapped = ((dyaw + Math.PI) % (Math.PI * 2)) - Math.PI;
          const flat = Math.hypot(dx, dz);
          const pitch = Math.atan2(dy, flat);
          ud.setAim(pitch, wrapped);
        } else {
          ud.setAim(0, 0);
        }
      }
      const swing = this._isSwordBot && this.lungeTimer > 0
        ? 1 - this.lungeTimer / LUNGE_TIME : 1;
      ud.setActionState?.({
        swing,
        vy: this._velY,
        crouch: 0,
        slide: 0,
        reload: this._reloadTimer > 0 && this._botGun
          ? 1 - this._reloadTimer / this._botGun.reloadTime : 0,
        aim: !this._isSwordBot && (this._provoked || engaged) ? 1 : 0,
        move: moving ? 1 : 0,
        run: !sprinting ? 0 : THREE.MathUtils.clamp(this._animSpeed / this.speed, 0, 1),
        firing: this._gunKick > 0 ? 1 : 0,
        scoped: 0,
      });
      ud.mixer.update(dt);
      ud.armorTick?.(dt);
    }

    // ── Limb rig walk cycle ────────────────────────────────────────────────────
    // Runs BEFORE the weapon block so the rifle can ride this frame's stride
    // phase rather than last frame's.
    let gait = _STILL;
    // Resolved speed drives the complete walk-to-sprint blend, including the
    // short dash burst, so the feet accelerate with the body instead of skating.
    const run = THREE.MathUtils.clamp((this._animSpeed - 3.0) / 3.0, 0, 1);
    if (this._rig) {
      const isMoving = resolvedMoving;
      const gaitOptions = {
        speed: isMoving ? this._animSpeed : 0,
        moving: isMoving,
        run,
        sprint: this._dashT > 0,
        dirF: resolvedDirF,
        dirR: resolvedDirR,
        grounded: this._onGround,
        vy: this._velY,
        dt,
      };
      gait = applyWalkCycle(this._rig, gaitOptions);
      this._walkT = gait.phase;
      // Footsteps, one per heel strike (twice a stride), placed in the world so
      // you can hear someone coming up behind you.
      if (isMoving && this.audio) {
        const step = Math.floor(this._walkT / Math.PI);
        if (step !== this._footPhase) {
          this._footPhase = step;
          this.audio.playAt(this.position, () => this.audio.playFootstep(run > 0.6));
        }
      }
      // The pelvis drops at full stride and the body leans into the run. Local
      // pitch (the mesh is YXZ-ordered) so the lean follows the facing.
      this.mesh.position.x = this.position.x + Math.cos(this.mesh.rotation.y) * gait.sway;
      this.mesh.position.y = this.position.y + gait.bob;
      this.mesh.position.z = this.position.z - Math.sin(this.mesh.rotation.y) * gait.sway;
      this.mesh.rotation.x = gait.lean;        // already eased, and bob assumes it
      this.mesh.rotation.z = gait.roll;

      // AR bots' arms belong to the rifle (applyRifleCarry, below, poses both
      // onto the grip and handguard). Sword bots go through the shared melee
      // carry, which also owns the blade — so it runs down with the weapon
      // block rather than here.
    }

    // ── Weapon animation (procedural model only) ───────────────────────────────
    if (this._weaponMesh) {
      const isAlert   = engaged;
      const isMoving  = resolvedMoving;
      const isLunging = this.lungeTimer > 0;

      // Blend alert level: raise weapon when bot spots player
      this._alertBlend += ((isAlert ? 1 : 0) - this._alertBlend) * Math.min(1, dt * 5);

      // Advance animation timer — faster tick while walking
      this._weaponT += dt * (isMoving ? 7 : 2.2);

      const breathe = Math.sin(this._weaponT * (isMoving ? 1.0 : 0.28)) * 0.018;
      const sway    = Math.cos(this._weaponT * (isMoving ? 0.5 : 0.14)) * 0.010;
      const bob     = isMoving ? Math.abs(Math.sin(this._weaponT * 0.5)) * 0.022 : 0;

      const wm = this._weaponMesh;

      if (!this._isSwordBot) {
        // Rifle + both arms are driven together so the hands stay ON the gun:
        // relaxed = the across-the-body patrol carry, engaged = shouldered and
        // levelled down the body's forward axis. `swing` breathes/rides the
        // stride, _gunKick shoves it back and climbs the muzzle.
        applyRifleCarry(this._rig, wm, this._alertBlend, dt, {
          swing: gait.swing, kick: this._gunKick,
          move: isMoving ? 1 : 0, run,
          firing: this._gunKick > 0 ? 1 : 0, scoped: 0,
          reload: this._reloadTimer > 0
            ? 1 - this._reloadTimer / this._botGun.reloadTime : 0,
          smooth: true,
        });
      } else {
        // A lunge used to thrust the blade forward on its own while the arms
        // carried on swinging with the stride — the sword moved and the bot
        // holding it did not. Route it through the shared melee carry, which
        // owns both, so a bot's attack reads the same as a player's.
        const swing = isLunging
          ? 1 - this.lungeTimer / LUNGE_TIME       // 0 → 1 across the strike
          : 1;                                     // 1 = at rest
        applyMeleeCarry(this._rig, wm, {
          swing, moving: isMoving, phase: this._walkT, run, dt,
        });
        // Guard rises a little once it has seen you.
        wm.position.y += this._alertBlend * 0.06 + breathe * 1.3 - bob * 0.8;
        wm.position.x += sway * 0.3;
        wm.rotation.z += sway * 0.5;
      }
    }

  }
}
