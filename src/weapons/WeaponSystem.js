import { firstPersonBodyPose } from '../player/FirstPersonBody.js';
import { createBodyDynamics } from '../player/BodyDynamics.js';
import { jumpAirPose, jumpLandingDuration } from '../player/JumpMotion.js';
import { stepGrenade, launcherShouldExplode } from '../sim/GrenadePhysics.js';
import {SWORD_EDGE_ROLL, swordSwingPose} from './SwordMotion.js';
const INACTIVE_WEAPON_INPUT = Object.freeze({mouseDown:false, rightMouseDown:false, mouseDX:0, mouseDY:0, wheelDelta:0, isDown:()=>false, consumeJustPressed:()=>false});
import { shotSpread as calculateShotSpread } from './ShotSpread.js';
import { triggerLegendaryShot, triggerLegendaryKill } from './LegendaryEffects.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, isMainWeaponId, isMatchPickupWeaponId, canAimWeapon } from './weaponDefs.js';
import { weaponHandPose } from './WeaponHandPoses.js';
import { buildWeaponModel, onWeaponModelReady } from './WeaponModels.js';
import { applyWeaponSkin, animateWeaponSkin } from './WeaponSkins.js';
import { applySwordSkin, animateSwordSkin } from './SwordSkins.js';
import {
  buildViewmodelArm,
  preloadViewmodelArms,
  rigSupportWrist,
  tintViewmodelArm,
} from '../player/ViewmodelArms.js';
import {
  advanceFireCooldown,
  isMovingAndFiring,
  scheduleNextShot,
  wantsTriggerShot,
} from './FireControl.js';
import { prepareExplosionLights, disposeExplosion, spawnExplosion, updateExplosion } from '../effects/ExplosionEffect.js';
import { disposeModel } from '../core/ModelResources.js';
import { createEnergyBlast } from '../effects/EnergyBlast.js';
import { createLauncherGrenade } from './LauncherGrenadeModel.js';
import { ViewmodelAim } from './ViewmodelAim.js';
import { ViewmodelFraming, firearmPresentationScale } from './ViewmodelFraming.js';

const FLASH_LIFE = 0.030;

// Stand-in "object" for a hit on one of the map's bare box colliders — it has
// no mesh, but the hit-handling code only ever reads userData off it.
const _BOX_OBJ = { userData: {} };

// ── smoothing helpers ───────────────────────────────────────────────────────
// Frame-rate-INDEPENDENT exponential smoothing: the result is identical at any
// framerate (unlike `x += (t-x)*k*dt`, which jitters when dt varies). `lambda`
// is the decay rate — bigger = snappier. This is the core of the smooth feel.
function expDamp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}
// Exact critically damped spring. Unlike an Euler step, this produces the same
// pose after a given elapsed time at 30, 60, 144Hz, or a briefly uneven frame.
function springTo(out, x, v, target, stiffness, _damping, dt) {
  const h = Math.max(0, dt);
  const omega = Math.sqrt(stiffness);
  const offset = x - target;
  const impulse = v + omega * offset;
  const decay = Math.exp(-omega * h);
  out[0] = target + (offset + impulse * h) * decay;
  out[1] = (v - omega * impulse * h) * decay;
}

// Kawaii skins (anime pew, cat meow, uwu squeak, puppy yip, magic sparkle) all
// get the pink muzzle flash + sparkle-heart burst treatment.
const CUTE_SOUNDS = new Set(['anime', 'waifu', 'meow', 'uwu', 'bark', 'sparkle']);
// Fire-sound skins get an orange/red muzzle flash + ember burst.
const FIRE_SOUNDS = new Set(['fire']);

const TRACER_OPACITY = 0.90;
const TRACER_VISUAL_SPEED = 240;
const TRACER_LENGTH = 0.42;
const TRACER_END_FADE = 0.055;

function createTracerMesh(laserBeam = false) {
  let geo;
  if (laserBeam) {
    geo = new THREE.CylinderGeometry(.022, .022, 1, 6, 1, true);
    geo.translate(0, .5, 0);
    geo.rotateX(Math.PI / 2);
  } else {
    // A pointed copper/gold round with a short fading wake. Its visible size
    // is exaggerated for readability; hit timing still belongs to the shot.
    // Use one mesh/draw call, including RGBA vertex colour for the dim tail.
    const round = new THREE.LatheGeometry([
      new THREE.Vector2(0, .73), new THREE.Vector2(.026, .73),
      new THREE.Vector2(.026, .87), new THREE.Vector2(.018, .95),
      new THREE.Vector2(0, 1),
    ], 8);
    const wake = new THREE.CylinderGeometry(.017, .001, .76, 6, 1, true);
    wake.translate(0, .38, 0);
    for (const [part, bullet] of [[round, true], [wake, false]]) {
      const positions = part.getAttribute('position');
      const colors = new Float32Array(positions.count * 4);
      const copper = new THREE.Color(0xe7ad57), tip = new THREE.Color(0xffedb1);
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        const color = bullet ? (y > .9 ? tip : copper) : tip;
        colors.set([color.r, color.g, color.b, bullet ? 1 : .42 * y / .76], i * 4);
      }
      part.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      part.rotateX(Math.PI / 2);
    }
    geo = mergeGeometries([round, wake]);
    round.dispose(); wake.dispose();
  }
  const mat = new THREE.MeshBasicMaterial({
    color: laserBeam ? 0xfff5df : 0xffffff,
    vertexColors: !laserBeam,
    transparent: true,
    opacity: TRACER_OPACITY,
    depthWrite: false,
    blending: laserBeam ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 4;
  return mesh;
}

// Neutral mount used before the first model update.
const VIEWMODEL_Z = -0.98;
// Neutral startup pose; the measured per-model composition takes over on update.
const VIEWMODEL_X = 0.40;
const VIEWMODEL_Y = -0.53;
// Keep the gun and the matching first-person arms large and readable like the
// reference while world/player weapons retain their physical third-person scale.
const VIEWMODEL_SCALE = 1.80;
const MELEE_VIEWMODEL_SCALE = 0.96;
const VIEWMODEL_PITCH = 0.14;
const VIEWMODEL_YAW = 0.04;
const VIEWMODEL_ROLL = -0.015;
// The supplied reference uses a low right-side guard. It is not centred in
// front of the reticle: the grip enters through the lower-right edge while the
// oversized blade rises almost vertically and leaves the top of the frame.
// Keep this on the shared viewmodel root so skins and the complete blade move
// as one rigid object while third-person/world weapons remain unchanged.
const SWORD_VIEWMODEL_X = 0.26;
const SWORD_VIEWMODEL_Y = -0.29;
const SWORD_VIEWMODEL_Z = -0.62;
const SWORD_VIEWMODEL_PITCH = 1.53;
const SWORD_VIEWMODEL_YAW = -0.015;
const SWORD_VIEWMODEL_ROLL = SWORD_EDGE_ROLL - 0.035;
const REFERENCE_ASPECT = 16 / 9;

// First-person hand targets in each weapon model's local coordinate system.
// Procedural and authored weapons share the same forward convention (-Z), but
// their pistol grips do not share a depth. A single hand transform therefore
// made short weapons miss the palm and made rifles appear to float in front of
// it. These targets describe the centre of the physical grip/handguard; the
// rig converts them to wrist-group transforms below.
// Preserve the lower-right composition on landscape screens without pushing
// both gloves out of portrait/mobile view. Capped on ultrawide so the weapon
// does not drift all the way into the corner.
function viewmodelAspectScale(aspect) {
  return THREE.MathUtils.clamp((aspect || REFERENCE_ASPECT) / REFERENCE_ASPECT, 0.32, 1.15);
}

// Portrait and narrow low-FOV cameras crop the lower-right shoulder pocket far
// more aggressively than desktop. Lift only those layouts; the 16:9 reference
// coordinates remain untouched while mobile keeps the trigger hand on screen.
function viewmodelVerticalPosition(aspect, fov = 78) {
  const narrow = THREE.MathUtils.clamp((1.5 - (aspect || REFERENCE_ASPECT)) / 0.94, 0, 1);
  const lowFov = THREE.MathUtils.clamp((78 - (fov || 78)) / 18, 0, 1);
  return VIEWMODEL_Y + lowFov * 0.245 + narrow * (0.140 + lowFov * 0.040);
}

// Model-space scale is independent of the camera fit and third-person weapons.
function firearmViewmodelScale(def) {
  return def.kind === 'melee' ? MELEE_VIEWMODEL_SCALE : firearmPresentationScale(def);
}

function viewmodelReloadScale(aspect) {
  if (aspect < 1) return 0.38;
  if (aspect < 1.5) return 0.22;
  return 0.30;
}

// Normal EV-style zoom keeps the firearm full-size in its three-quarter carry
// while the world FOV narrows. The actual shot still follows the fixed centre
// reticle, so the weapon can sit lower without changing accuracy.
// Only a magnified sniper optic hands off to the full-screen scope overlay, and
// only after the gun has travelled most of the way there.
// This also gives scope-out a readable reverse animation instead of popping the
// complete gun-and-hands rig in and out on right mouse down/up.
export function shouldHideAdsViewmodel(def, scopeT, aimHeld = false) {
  void aimHeld;
  return !!def?.scoped && scopeT > 0.68;
}

// Ordinary right-click aim aligns each weapon's measured rear sight with the
// fixed centre reticle.  The sight stays far enough from the camera that the
// receiver does not fill the screen, while the wider FOV preserves peripheral
// awareness.  True sniper scopes still use their dedicated 28-degree overlay.
const ADS_SIGHT_DEPTH = -1.02;
const ADS_SIGHT_Y = -0.018;
// Keep the rear sight just below the reticle for a centered aiming picture.
const DEFAULT_ADS_FOV = 52;

const _adsBox = new THREE.Box3();
const _adsSpecialBox = new THREE.Box3();
const _adsPoint = new THREE.Vector3();
const _adsCorner = new THREE.Vector3();
const _adsInverse = new THREE.Matrix4();

// Measure a weapon's rear sight in its own coordinate system. Authored models
// can provide an exact `sight_point`; otherwise optic glass is preferred and a
// conservative top/rear point is inferred from the complete weapon. Measuring
// the actual asset keeps one shared ADS solver working for pickups and future
// models instead of maintaining a brittle list of hand-tuned screen offsets.
export function measureWeaponSight(group) {
  const declared = group?.getObjectByName?.('sight_point');
  const declaredSight = declared ? group.worldToLocal(declared.getWorldPosition(new THREE.Vector3())) : null;

  group.updateWorldMatrix(true, true);
  _adsInverse.copy(group.matrixWorld).invert();
  _adsBox.makeEmpty();
  _adsSpecialBox.makeEmpty();
  group.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox;
    if (!box) return;
    const role = object.material?.userData?.role;
    for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
      _adsCorner.set(
        ix ? box.max.x : box.min.x,
        iy ? box.max.y : box.min.y,
        iz ? box.max.z : box.min.z,
      ).applyMatrix4(object.matrixWorld).applyMatrix4(_adsInverse);
      _adsBox.expandByPoint(_adsCorner);
      if (role === 'special') _adsSpecialBox.expandByPoint(_adsCorner);
    }
  });

  const hasOptic = !_adsSpecialBox.isEmpty();
  const source = hasOptic ? _adsSpecialBox : _adsBox;
  if (source.isEmpty()) return new THREE.Vector3(0, 0.14, 0.05);
  source.getCenter(_adsPoint);
  // Optic glass centres define the axis directly. With iron sights, sit just
  // below the weapon's highest point so the front post remains visible.
  const y = hasOptic
    ? _adsPoint.y
    : THREE.MathUtils.lerp(_adsPoint.y, source.max.y, 0.88);
  // Imported pack models are a single mesh with no named optic. Their rear-most
  // Z point is the buttstock, not a sight; using it makes ADS stare directly at
  // the butt pad. Move the fallback anchor forward to the receiver/rail area.
  const z = hasOptic
    ? _adsPoint.z
    : source.max.z - (source.max.z - source.min.z) * 0.38;
  // Use authored optics exactly, not a bounding-box point above them.
  if (declaredSight) return declaredSight;
  // Imported emissive 'special' materials include ammo counters, not just optics.
  if (hasOptic) return new THREE.Vector3(0, Math.max(y, _adsBox.max.y + .015), z);
  // Imported guns have no sight nodes. Find the actual top/front sight
  // surface, excluding the rear ammo counter and buttstock. This anchors
  // the visible post instead of empty space above the whole weapon.
  let top = -Infinity, frontZ = z;
  const frontLimit = _adsBox.min.z + (_adsBox.max.z - _adsBox.min.z) * .45;
  const transform = new THREE.Matrix4();
  group.traverse(object => {
    if (!object.isMesh || !object.geometry?.attributes.position || object.name === 'outline') return;
    transform.multiplyMatrices(_adsInverse, object.matrixWorld);
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      _adsCorner.fromBufferAttribute(positions, i).applyMatrix4(transform);
      if (_adsCorner.z <= frontLimit && _adsCorner.y > top) {
        top = _adsCorner.y; frontZ = _adsCorner.z;
      }
    }
  });
  const muzzle = group.getObjectByName('muzzle') || group.getObjectByName('BIND_BULLET');
  const axisX = muzzle ? group.worldToLocal(muzzle.getWorldPosition(new THREE.Vector3())).x : 0;
  // A launcher housing can stand above its barrel. Use its upper rail
  // rather than placing the target behind the opaque launch tube.
  if (group.userData.weaponId === 'rpg' || _adsBox.max.y - top > .06) return new THREE.Vector3(axisX, _adsBox.max.y + .015, z);
  const sight = new THREE.Vector3(axisX, Number.isFinite(top) ? top + .005 : y, frontZ);
  sight.depthOffset = Math.min(0, frontZ - z);
  return sight;
}

export function adsMountForSight(
  sight,
  scale = VIEWMODEL_SCALE,
  depth = ADS_SIGHT_DEPTH,
) {
  return new THREE.Vector3(
    -sight.x * scale,
    -sight.y * scale + ADS_SIGHT_Y,
    depth + (sight.depthOffset || 0) * scale - sight.z * scale,
  );
}

// The dedicated viewmodel pass clears world depth first. Gun parts then use
// normal depth testing to hide rear surfaces without clipping against walls.
// Clone materials so viewmodel settings cannot affect pickups or remote guns.
export function prepareFirstPersonModel(group) {
  // The imported SMG is only 27cm long. Bringing that tiny mesh close to the
  // eye made its separately authored glove look enormous; fixed-depth ADS
  // then made the gun shrink away. Normalize its presentation mesh/markers
  // together before measuring the sight, leaving world models and arms alone.
  if (group.userData.weaponId === 'uzi' && group.userData.modelSource === 'blender-arsenal'
      && !group.userData.firstPersonNormalized) {
    const scale = 2;
    for (const child of group.children) {
      child.position.multiplyScalar(scale);
      child.scale.multiplyScalar(scale);
    }
    const pose = group.userData.authoredHandPose;
    group.userData.authoredHandPose = Object.fromEntries(Object.entries(pose).map(([key, value]) =>
      [key, Array.isArray(value) ? value.map(coordinate => coordinate * scale) : value]));
    // Seat the unscaled cupped palm under the enlarged front handguard.
    group.userData.authoredHandPose.viewmodelSupport = [.024, .063, -.185];
    group.userData.firstPersonNormalized = true;
  }
  // Quaternius firearms are authored for a left-side showcase render. In the
  // lower-right first-person carry that exposes the far side of the receiver,
  // making the whole gun read as backwards even though its muzzle still points
  // down -Z. Mirror only the lateral axis at the viewmodel boundary: forward,
  // scale, third-person carry, pickups and muzzle placement remain unchanged.
  if (group.userData.modelSource === 'quaternius') {
    group.scale.x = -Math.abs(group.scale.x || 1);
  }
  group.traverse((object) => {
    if (!object.isMesh) return;
    // Inverted-hull contours depend on world depth testing to reveal only the
    // rim. In a depth-independent viewmodel pass the enlarged back faces cover
    // the gun itself, producing the solid black slabs seen on the deployed GLBs.
    // The underlying gun already has strong material separation at ADS scale.
    if (object.name === 'outline') {
      object.visible = false;
      return;
    }
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material?.clone();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      material.depthTest = true;
      material.depthWrite = true;
    }
    object.renderOrder = 0;
    object.frustumCulled = false;
  });
}

export class WeaponSystem {
  constructor(camera, scene, audio) {
    this.camera = camera;
    this.scene = scene;
    this.audio = audio;

    // Every weapon model/state is kept so any can be brought into a match, but
    // the ACTIVE loadout is exactly one gun + one melee (set via setLoadout).
    this.allWeapons = WEAPONS;
    const defGun   = WEAPONS.find((w) => w.kind !== 'melee');
    const defMelee = WEAPONS.find((w) => w.kind === 'melee');
    this.loadout = [defGun, defMelee].filter(Boolean);
    this.keyMap = new Map();
    this._rebuildKeyMap();
    this.currentIndex = 0;
    this.mapGunId = null;
    this.state = new Map();
    for (const w of this.allWeapons) {
      this.state.set(w.id, {
        magAmmo: w.kind === 'melee' ? 0 : w.magSize,
        reserveAmmo: w.kind === 'melee' ? 0 : w.reserveMax,
        isReloading: false,
        reloadTimer: 0
      });
    }

    // Thrown-knife projectiles
    this.thrownKnives = [];
    this._knifeCooldown = 0;
    this._prevRightMouse = false;

    this.fireTimer = 0;
    this.prevMouseDown = false;
    this.kickPos = new THREE.Vector3();
    this.kickVel = new THREE.Vector3();   // recoil spring velocity
    this._springOut = new Float64Array(2);
    this.kickRotX = 0;
    this.kickRotXVel = 0;
    this.swingPhase = 1;
    this.scopeT = 0; // 0..1 zoom blend
    this._sprintT = 0; // 0..1 sprint carry blend
    this._movingFireT = 0; // 0..1 braced walking-fire presentation blend
    // smoothed viewmodel state (all frame-rate-independent) — the applied
    // transform eases toward these targets so nothing ever snaps.
    this._weaponInertia = createBodyDynamics();
    this._swayX = 0; this._swayY = 0;         // smoothed look-sway
    this._swayVelX = 0; this._swayVelY = 0;   // smoothed mouse velocity
    this._bobPhase = 0;                       // continuous bob phase (own clock)
    this._mountPos = new THREE.Vector3(
      VIEWMODEL_X * viewmodelAspectScale(camera.aspect),
      viewmodelVerticalPosition(camera.aspect, camera.fov), VIEWMODEL_Z);
    this._mountRot = new THREE.Vector3(VIEWMODEL_PITCH, VIEWMODEL_YAW, VIEWMODEL_ROLL);
    this._raiseT = 1;                         // 0=just switched (lowered) → 1=up
    this._wasGrounded = true;                 // viewmodel landing impulse edge
    this._landT = 0;                          // 0.22s settle after touching down
    this._landStrength = 0;                   // impact-scaled landing response
    this._fallSpeed = 0;                      // fastest downward speed this airtime
    this._shotBloom = 0;                      // sustained-fire accuracy cone

    this.tracers = [];
    this.muzzleSmoke = [];
    this.rockets = [];
    this.explosions = [];
    prepareExplosionLights(scene);
    this.shells = [];
    this._idleT = 0;
    this.weaponSkin = null;
    this.swordSkin = null;
    this.animTime = 0;
    this.flashLight = new THREE.PointLight(0xffcc66, 0, 8, 1.8);
    // (sky-only lighting) flashLight not added to scene

    // Visible muzzle flash sprite — two crossed quads for a star shape
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd65c, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    this._flashMeshes = [];
    for (let i = 0; i < 3; i++) {
      const shape = new THREE.Shape();
      for (let point = 0; point < 8; point++) {
        const angle = point * Math.PI / 4;
        const radius = point % 2 ? 0.018 : 0.10;
        if (point === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geo, flashMat.clone());
      mesh.rotation.z = (i / 3) * Math.PI;
      mesh.position.z = -.035;
      mesh.renderOrder = 1001;
      this._flashMeshes.push(mesh);
    }

    // The recorded rifle flash is a short orange fork projecting forward from
    // the bore, rather than a flat white star facing the player.
    const rifleFlare = new THREE.Shape();
    [[-.018,0],[-.045,-.08],[-.11,-.15],[-.028,-.14],[-.018,-.29],
      [.012,-.17],[.065,-.23],[.04,-.08],[.018,0]].forEach(([x,z], i) => {
      if (i === 0) rifleFlare.moveTo(x,z); else rifleFlare.lineTo(x,z);
    });
    rifleFlare.closePath();
    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.ShapeGeometry(rifleFlare);
      geometry.rotateX(Math.PI / 2);
      const material = flashMat.clone();
      material.blending = THREE.NormalBlending;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.rifleFlash = true;
      mesh.userData.flashCore = i === 2;
      mesh.rotation.z = i * Math.PI / 3;
      mesh.position.z = -.02;
      mesh.renderOrder = 1001;
      this._flashMeshes.push(mesh);
    }
    this._rifleRecoilPivot = new THREE.Vector3();
    this._rifleRecoilOffset = new THREE.Vector3();
    this._rifleRecoilRotation = new THREE.Quaternion();
    this._viewmodelAim = new ViewmodelAim();

    // Pre-allocated scratch vectors — avoids GC spikes from per-shot allocations
    this._camPos      = new THREE.Vector3();
    this._camDir      = new THREE.Vector3();
    this._rightVec    = new THREE.Vector3();
    this._upVec       = new THREE.Vector3();
    this._fwdVec      = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._pelletDir   = new THREE.Vector3();
    this._farVec      = new THREE.Vector3();
    this._raycaster   = new THREE.Raycaster();
    this._targets     = [];   // reused raycast target list (no per-shot allocation)

    // Shared shell casing geo/mat — created once, reused by every ejected casing
    this._shellGeo = new THREE.CylinderGeometry(0.0048, 0.0035, 0.02, 6);
    this._shellMat = new THREE.MeshStandardMaterial({ color: 0xd4a520, roughness: 0.28, metalness: 0.9 });

    this._buildViewmodels();
    this._lastSpawnedTracerHolder = scene;

    this.onShoot = null; // (weaponDef) => void
    this.onHitBot = null; // (bot, dmg, point) => void
    this.onHitWorld = null; // (point) => void
    this.onEmpty = null; // () => void
    this.onReloadStart = null;
    this.applyRecoilToPlayer = null; // (amount) => void
  }

  renderViewmodel(renderer, world) {
    if (!this.weaponMount.visible) return;
    const sources = [world._hemisphere, world._sun, world._rim];
    sources.forEach((source, index) => {
      const light = this.viewLights[index];
      light.visible = !!source;
      if (source) {
        light.color.copy(source.color);
        light.intensity = source.intensity;
        light.position.copy(source.position);
        if (source.groundColor) light.groundColor.copy(source.groundColor);
        if (source.target) light.target.position.copy(source.target.position);
      }
    });
    const parent = this.weaponMount.parent;
    const autoClear = renderer.autoClear;
    this.camera.updateWorldMatrix(true, false);
    this.viewAnchor.matrix.copy(this.camera.matrixWorld);
    this.viewAnchor.add(this.weaponMount);
    try {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(this.viewScene, this.camera);
    } finally {
      parent.add(this.weaponMount);
      renderer.autoClear = autoClear;
    }
  }

  _buildViewmodels() {
    this.viewScene = new THREE.Scene();
    this.viewAnchor = new THREE.Group();
    this.viewAnchor.matrixAutoUpdate = false;
    this.viewScene.add(this.viewAnchor);
    this.viewLights = [new THREE.HemisphereLight(), new THREE.DirectionalLight(), new THREE.DirectionalLight()];
    this.viewScene.add(...this.viewLights);
    this.weaponMount = new THREE.Object3D();
    // The reference rifle owns the lower-right quadrant but stays slim enough
    // to leave the arena readable. Keep the stock crossing the lower/right
    // edge instead of filling that whole quadrant like the previous 0.96 rig.
    // The weapon and visible trigger-side arm share this deeper mount. Moving
    // the model alone would clear the stock but detach the hand from its grip.
    this.weaponMount.position.set(
      VIEWMODEL_X * viewmodelAspectScale(this.camera.aspect),
      viewmodelVerticalPosition(this.camera.aspect, this.camera.fov),
      VIEWMODEL_Z);
    this.weaponMount.rotation.set(VIEWMODEL_PITCH, VIEWMODEL_YAW, VIEWMODEL_ROLL);
    this.weaponMount.scale.setScalar(firearmViewmodelScale(this.currentDef, this.camera.aspect));
    this.camera.add(this.weaponMount);

    // Dedicated viewmodel key light — a short-range light parented to the camera
    // that rakes across the gun so its metal/clearcoat highlights always read.
    this.vmLight = new THREE.PointLight(0xffffff, 4.5, 1.8, 2);
    this.vmLight.position.set(0.5, 0.35, 0.0);
    // (sky-only lighting) vmLight not added to scene
    // Cool fill from the other side to shape the form.
    this.vmFill = new THREE.PointLight(0x88aaff, 1.6, 1.8, 2);
    this.vmFill.position.set(-0.5, -0.1, -0.2);
    // (sky-only lighting) vmFill not added to scene

    this.swayGroup = new THREE.Object3D();
    this.weaponMount.add(this.swayGroup);

    this.kickGroup = new THREE.Object3D();
    this.swayGroup.add(this.kickGroup);

    this.models = new Map();
    for (const w of this.allWeapons) {
      const { group, muzzle } = buildWeaponModel(w);
      prepareFirstPersonModel(group);
      group.visible = false;
      this.kickGroup.add(group);
      const sight = measureWeaponSight(group);
      this.models.set(w.id, {
        group,
        muzzle,
        sight,
        adsMount: adsMountForSight(sight, VIEWMODEL_SCALE, ADS_SIGHT_DEPTH),
      });
    }
    this._setActiveModel(0);
    this._buildArm();
    preloadViewmodelArms((ready) => {
      if (ready) this._installAuthoredViewmodelArms();
    });

    // The viewmodels above are procedural (the GLB loads async and is rarely
    // ready this early). Swap in the detailed Blender models once it arrives.
    for (const weapon of this.allWeapons) {
      onWeaponModelReady(weapon.id, () => this._refreshModels(weapon.id));
    }
  }

  _installAuthoredViewmodelArms(armFactory = buildViewmodelArm) {
    this._handSurfaceMeshes = [];
    const makeArm = (side, support) => {
      const model = armFactory(side);
      if (!model) return null;
      const arm = new THREE.Group();
      arm.userData.viewmodelHand = support ? 'support' : 'trigger';
      arm.userData.authoredViewArm = true;
      arm.userData.sleeveLength = support ? 0.74 : 0.78;

      const grip = new THREE.Group();
      grip.name = 'viewmodel_grip';
      arm.add(grip);
      // The bake is wrist-centred, not palm-centred. Anchor the actual closed
      // glove, rather than guessing another offset whenever the camera changes.
      // The glove then closes around the same grip used by the third-person player.
      model.updateWorldMatrix(true, true);
      const palmBox = new THREE.Box3();
      model.traverse(o => { if (o.isMesh && /_Hand$/i.test(o.name)) palmBox.union(new THREE.Box3().setFromObject(o)); });
      if (palmBox.isEmpty()) return null;
      const palmCenter = palmBox.getCenter(new THREE.Vector3());
      model.worldToLocal(palmCenter);
      model.position.copy(palmCenter).negate();
      grip.add(model);

      model.traverse((object) => {
        if (!object.isMesh) return;
        const handSurface = /_Hand$/i.test(object.name);
        if (handSurface) {
          object.userData.viewmodelPart = 'glove';
          object.name = 'viewmodel_palm';
          object.userData.authoredViewArm = true;
          this._handSurfaceMeshes.push(object);
        } else if (/_(?:Upper)?Sleeve(?:_?\d+)?$/i.test(object.name)) {
          object.userData.viewmodelPart = 'sleeve';
          object.name = 'viewmodel_upper_sleeve';
        } else if (/ForearmGuard/i.test(object.name)) {
          object.userData.viewmodelPart = 'plate';
          object.name = 'viewmodel_gauntlet';
        }
        if (object.material?.userData.evArmMaterial) {
          const name = object.material.name;
          object.userData.viewmodelPart = /Undersuit/.test(name) ? (handSurface ? 'glove' : 'sleeve') : /orange/.test(name) ? 'plate' : /gray/.test(name) ? 'plate' : 'accent';
        }
        object.renderOrder = 0;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material.depthTest = true;
          material.depthWrite = true;
        }
      });
      if (support) {
        rigSupportWrist(arm, model);
        // The glove mesh was replaced by a skinned copy; keep layer management
        // pointed at the actual rendered surface.
        this._handSurfaceMeshes = this._handSurfaceMeshes.filter(mesh => mesh.parent);
        this._handSurfaceMeshes.push(arm.getObjectByName('viewmodel_palm'));
      }
      tintViewmodelArm(arm, this._armAppearance || {
        plate: 0xc4c6d4,
        sleeve: 0x202428,
        glove: 0x0d1013,
        accent: 0xc7ff34,
      });
      return arm;
    };

    const trigger = makeArm('Right', false);
    const support = makeArm('Left', true);
    if (!trigger || !support) return;
    if (this.armGroup) this.kickGroup.remove(this.armGroup);
    if (this.supportArmGroup) this.kickGroup.remove(this.supportArmGroup);
    this.armGroup = trigger;
    this.supportArmGroup = support;
    // GunIdle already supplies the shoulder/elbow bend and natural wrist roll.
    // Only a small local correction is needed here.  The old 0.78-radian
    // support-arm pitch stacked a second 45-degree bend onto the baked pose,
    // producing the long disconnected diagonal arm seen in first person.
    trigger.rotation.set(-0.02, 0.08, -0.04);
    support.rotation.set(0.18, -0.08, -0.06);
    this.kickGroup.add(trigger, support);
    this._applyViewmodelHandPose();
    this._updateViewmodelHandLayers();
  }

  // Rebuild every viewmodel (e.g. after the weapon GLB finishes loading),
  // preserving visibility and any applied cosmetic state.
  _refreshModels(weaponId = null) {
    for (const w of this.allWeapons) {
      if (weaponId && w.id !== weaponId) continue;
      const old = this.models.get(w.id);
      const { group, muzzle } = buildWeaponModel(w);
      prepareFirstPersonModel(group);
      group.visible = old ? old.group.visible : false;
      if (old) disposeModel(old.group);
      this.kickGroup.add(group);
      const sight = measureWeaponSight(group);
      this.models.set(w.id, {
        group,
        muzzle,
        sight,
        adsMount: adsMountForSight(sight, VIEWMODEL_SCALE, ADS_SIGHT_DEPTH),
      });
    }
    if (this._armoryMap) this.applyArmoryMap(this._armoryMap);
    if (this.weaponSkin) this.setWeaponSkin(this.weaponSkin);
    if (this.swordSkin) this.setSwordSkin(this.swordSkin);
    // A late GLB swap must finish with exactly the equipped model visible.
    // Preserving each old group's flag was vulnerable to transient hidden
    // states (map transition, respawn, or a model refresh during a switch),
    // which could leave every replacement hidden for the rest of the match.
    this._ensureActiveModelVisibility();
    this._applyViewmodelHandPose();
  }

  _buildArm() {
    this.sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x2d3540, roughness: 0.78, metalness: 0.05, envMapIntensity: 0.6,
    });
    this.gloveMat = new THREE.MeshStandardMaterial({
      color: 0x353e4a, roughness: 0.58, metalness: 0.08, envMapIntensity: 1.0,
    });
    this.cuffMat = new THREE.MeshStandardMaterial({
      color: 0x79cbd6, roughness: 0.48, metalness: 0.18,
      emissive: 0x79cbd6, emissiveIntensity: 0.05,
    });
    this.jointMat = new THREE.MeshStandardMaterial({
      color: 0x0c0e12, roughness: 0.66, metalness: 0.06,
    });
    this.armPlateMat = new THREE.MeshStandardMaterial({
      color: 0x657080, roughness: 0.5, metalness: 0.26, envMapIntensity: 0.8,
    });

    const rounded = (w, h, d, radius, material) => new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w * 0.22, h * 0.22, d * 0.22)),
      material,
    );
    this._handSurfaceMeshes = [];
    const up = new THREE.Vector3(0, 1, 0);
    const segment = (a, b, startRadius, endRadius, material, sides = 6) => {
      const direction = b.clone().sub(a);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(endRadius, startRadius, direction.length(), sides),
        material,
      );
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      return mesh;
    };
    const plateAlong = (a, b, width, depth, material, offset = new THREE.Vector3()) => {
      const direction = b.clone().sub(a);
      const mesh = rounded(width, direction.length(), depth, Math.min(width, depth) * 0.15, material);
      mesh.position.copy(a).add(b).multiplyScalar(0.5).add(offset);
      mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      return mesh;
    };

    // This is the first-person version of the authored KYX warrior arm: dark
    // fitted undersuit, flared hard-surface gauntlet, bright outer rail, dark
    // wrist seal, knuckle plate and an actually closed glove.  The previous
    // rig used one cylinder for each limb and one box for each hand, which is
    // why it never resembled the skinned player even when its colours matched.
    const gripArm = ({ side, position, rotation, elbow, support = false }) => {
      const sign = side === 'left' ? -1 : 1;
      const arm = new THREE.Group();
      arm.position.copy(position);
      arm.rotation.copy(rotation);
      arm.userData.viewmodelHand = support ? 'support' : 'trigger';
      const hand = new THREE.Group();
      hand.name = 'viewmodel_grip';
      arm.add(hand);

      // Palm and fingers sit around the physical contact point. The palm is
      // deliberately dark like the third-person glove; the armour colour is
      // reserved for the plate on the back of the hand and forearm.
      const palm = rounded(
        support ? 0.096 : 0.090,
        support ? 0.074 : 0.070,
        support ? 0.112 : 0.104,
        0.014, this.gloveMat,
      );
      palm.name = 'viewmodel_palm';
      palm.position.set(0, -0.004, -0.031);
      palm.rotation.set(support ? -0.14 : 0.08, 0, sign * (support ? 0.04 : 0.02));
      hand.add(palm);

      const handPlate = rounded(
        support ? 0.062 : 0.058,
        0.014,
        support ? 0.052 : 0.048,
        0.006, this.armPlateMat,
      );
      handPlate.name = 'viewmodel_hand_plate';
      handPlate.position.set(0, 0.035, -0.021);
      handPlate.rotation.copy(palm.rotation);
      hand.add(handPlate);

      // The connected lower finger pad supplies the closed silhouette; four
      // shallow finger segments on top make it read as a hand instead of the
      // floating cube seen in the reported screenshot.
      const fingerCurl = rounded(
        support ? 0.092 : 0.084,
        support ? 0.044 : 0.042,
        support ? 0.078 : 0.070,
        0.011, this.gloveMat,
      );
      fingerCurl.name = 'viewmodel_finger_curl';
      fingerCurl.position.set(0, -0.037, -0.057);
      fingerCurl.rotation.x = support ? 0.38 : 0.54;
      hand.add(fingerCurl);

      for (const x of [-0.030, -0.010, 0.010, 0.030]) {
        const knuckle = rounded(0.017, 0.013, 0.043, 0.005, this.gloveMat);
        knuckle.name = 'viewmodel_knuckle';
        knuckle.position.set(x, 0.039, -0.042);
        knuckle.rotation.set(palm.rotation.x - 0.06, 0, sign * -0.015);
        hand.add(knuckle);
      }

      const thumb = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.013, support ? 0.038 : 0.034, 4, 8),
        this.gloveMat,
      );
      thumb.name = 'viewmodel_thumb';
      thumb.position.set(sign * 0.047, -0.001, -0.025);
      thumb.rotation.set(support ? 0.72 : 0.62, 0.10, -sign * (support ? 0.88 : 0.78));
      hand.add(thumb);

      const wristBridge = segment(
        new THREE.Vector3(0, -0.005, 0.020),
        new THREE.Vector3(0, -0.031, 0.100),
        0.037,
        0.043,
        this.gloveMat,
        10,
      );
      wristBridge.name = 'viewmodel_wrist';
      arm.add(wristBridge);
      const wrist = new THREE.Vector3(0, -0.027, 0.084);
      const sleeveEnd = new THREE.Vector3(sign * elbow.x, elbow.y, elbow.z);
      // Only the forearm belongs in a first-person camera. Keep the anatomical
      // elbow at the lower frame edge, then let the unseen upper arm continue
      // outside the viewport. Putting an elbow halfway up the screen was what
      // made the old support limb look like a skinny upper-arm pole.
      const armorEnd = wrist.clone().lerp(sleeveEnd, support ? 0.64 : 0.58);
      arm.userData.sleeveLength = wrist.distanceTo(sleeveEnd);

      // Continuous dark anatomy underneath the armour. The wider elbow end and
      // ten-sided section match the faceted-but-human proportions of the live
      // Blender body without producing another featureless pole.
      const forearm = segment(
        wrist, armorEnd,
        support ? 0.054 : 0.050,
        support ? 0.088 : 0.080,
        this.sleeveMat,
        10,
      );
      forearm.name = 'viewmodel_forearm';
      forearm.visible = true;
      arm.add(forearm);

      // Authored KYX gauntlet: a broad white/skin-coloured outer shell, dark
      // wrist seal, thin accent rail and elbow cap. These proportions mirror
      // KYX_ForearmGuard and KYX_Gauntlet in the actual player asset.
      // The player's authored model has a compact flared cuff near the hand,
      // not a white plank covering the entire arm. Leave most of the shaped
      // dark forearm visible and armour only the wrist-side third.
      const guardStart = wrist.clone().lerp(armorEnd, 0.08);
      const guardEnd = wrist.clone().lerp(armorEnd, 0.40);
      const guard = plateAlong(
        guardStart, guardEnd,
        support ? 0.118 : 0.106,
        support ? 0.076 : 0.070,
        this.armPlateMat,
        new THREE.Vector3(0, 0.008, -0.012),
      );
      guard.name = 'viewmodel_gauntlet';
      arm.add(guard);
      const rail = plateAlong(
        wrist.clone().lerp(armorEnd, 0.16),
        wrist.clone().lerp(armorEnd, 0.36),
        0.016, 0.011, this.cuffMat,
        new THREE.Vector3(sign * (support ? 0.055 : 0.049), 0.011, -0.038),
      );
      rail.name = 'viewmodel_gauntlet_accent';
      arm.add(rail);

      const upperSleeve = segment(
        armorEnd, sleeveEnd,
        support ? 0.088 : 0.080,
        support ? 0.110 : 0.098,
        this.sleeveMat,
        10,
      );
      upperSleeve.name = 'viewmodel_upper_sleeve';
      upperSleeve.visible = true;
      arm.add(upperSleeve);
      const elbowJoint = new THREE.Mesh(
        new THREE.SphereGeometry(support ? 0.087 : 0.079, 10, 8), this.jointMat,
      );
      elbowJoint.name = 'viewmodel_elbow';
      elbowJoint.position.copy(armorEnd);
      elbowJoint.visible = true;
      arm.add(elbowJoint);
      const elbowCapStart = wrist.clone().lerp(armorEnd, 0.88);
      const elbowCap = plateAlong(
        elbowCapStart, armorEnd,
        support ? 0.122 : 0.110,
        support ? 0.078 : 0.072,
        this.armPlateMat,
        new THREE.Vector3(0, 0.006, -0.010),
      );
      elbowCap.name = 'viewmodel_elbow_plate';
      arm.add(elbowCap);

      const cuff = segment(
        new THREE.Vector3(0, -0.023, 0.071),
        new THREE.Vector3(0, -0.031, 0.104),
        0.048,
        0.049,
        this.jointMat,
        10,
      );
      cuff.name = 'viewmodel_cuff';
      arm.add(cuff);

      arm.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        // The separate viewmodel pass isolates world depth; retain internal
        // depth so sleeves, fingers and receiver occlude each other correctly.
        object.material.depthTest = true;
        object.material.depthWrite = true;
        const handSurface = object.name === 'viewmodel_palm'
          || object.name === 'viewmodel_hand_plate'
          || object.name === 'viewmodel_finger_curl'
          || object.name === 'viewmodel_knuckle'
          || object.name === 'viewmodel_thumb';
        object.renderOrder = 0;
        if (handSurface) this._handSurfaceMeshes.push(object);
        object.frustumCulled = false;
      });
      return arm;
    };

    const trigger = gripArm({
      side: 'right',
      position: new THREE.Vector3(0.012, -0.102, 0.165),
      rotation: new THREE.Euler(-0.08, 0.16, -0.08),
      // The trigger elbow bends toward the lower-right shoulder pocket instead
      // of vanishing behind the receiver as a straight wrist extension.
      elbow: new THREE.Vector3(0.46, -0.66, 0.12),
    });
    this.kickGroup.add(trigger);
    this.armGroup = trigger;

    const support = gripArm({
      side: 'left',
      position: new THREE.Vector3(-0.050, -0.095, -0.175),
      rotation: new THREE.Euler(-0.05, -0.22, -0.14),
      // A pronounced elbow turn gives the left arm two readable human segments:
      // forearm to handguard, upper arm to the lower-left edge.
      elbow: new THREE.Vector3(0.72, -0.68, 0.24),
      support: true,
    });
    support.scale.setScalar(0.72);
    support.visible = false;
    this.kickGroup.add(support);
    this.supportArmGroup = support;
    this._applyViewmodelHandPose();
  }

  _applyViewmodelHandPose() {
    if (!this.armGroup || !this.supportArmGroup) return;
    const def = this.currentDef;
    const model = this.models.get(def?.id)?.group;
    const pose = weaponHandPose(model?.userData?.weaponId ? model : def?.id);
    const portrait = this.camera.aspect < 1;
    const narrow = this.camera.aspect < 1.5;
    // The world camera also controls the user's gameplay FOV. Counter-scale
    // just the hand geometry around its fixed grip contacts so 60-degree FOV
    // does not turn a gauntlet into half the screen and 110-degree FOV does not
    // reduce it to a detached speck.
    const handFovScale = THREE.MathUtils.clamp(
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))
        / Math.tan(THREE.MathUtils.degToRad(78 * 0.5)),
      0.70,
      1.25,
    );

    // The fallback palm has a small internal centre offset. The authored arm is
    // palm-centred at installation, so it follows the physical contact without
    // inheriting the old hand-placement depth correction.
    const trigger = pose.trigger;
    // The closed fist wraps the longitudinal hilt, not a vertical pistol grip.
    this.armGroup.userData.restGripRotation ||= this.armGroup.rotation.clone();
    this.armGroup.rotation.copy(this.armGroup.userData.restGripRotation);
    if (def.id === 'sword') {
      this.armGroup.quaternion.copy(this.weaponMount.quaternion).invert()
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.10, 0.08, -0.15)));
    }
    const triggerAuthored = this.armGroup.userData.authoredViewArm;
    this.armGroup.position.set(
      trigger[0],
      // The wrist contact sits below the closed palm on a pistol grip. Seat
      // the glove 3cm above it so the fingers wrap the handle, not its base.
      trigger[1] + (def.id === 'sword' ? 0 : (triggerAuthored ? 0.030 : 0.006)),
      trigger[2] + (triggerAuthored ? 0 : 0.034),
    );
    this.armGroup.scale.set(
      (portrait ? 0.76 : (narrow ? 0.82 : 0.88)) * handFovScale,
      (portrait ? 0.96 : (narrow ? 0.86 : 0.88)) * handFovScale,
      (portrait ? 0.76 : (narrow ? 0.82 : 0.88)) * handFovScale,
    );

    this.supportArmGroup.userData.restGripRotation ||= this.supportArmGroup.rotation.clone();
    this.supportArmGroup.rotation.copy(this.supportArmGroup.userData.restGripRotation);
    if (def.id === 'sword') {
      this.supportArmGroup.quaternion.copy(this.weaponMount.quaternion).invert()
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.10, -0.18, 0.22)));
    }
    if (def.kind !== 'melee') {
      // Rotate the elbow beneath the fore-end around its fixed palm contact.
      this.supportArmGroup.rotation.z -= .40;
    }
    // Third-person contacts locate the character wrist; a palm-up viewmodel
    // may have a separately fitted cupped-palm centre beneath the fore-end.
    const support = pose.viewmodelSupport || pose.support;
    const supportAuthored = this.supportArmGroup.userData.authoredViewArm;
    const supportDepthComp = 0; // Responsive framing moves the mount, never the grip.
    const supportWidthScale = supportAuthored
      ? (portrait ? 0.57 : (narrow ? 0.76 : 0.86))
      : (portrait ? 0.43 : 0.54);
    const supportLengthScale = supportAuthored
      ? (portrait ? 0.70 : (narrow ? 0.80 : 0.86))
      : (portrait ? 0.52 : 0.54);
    this.supportArmGroup.position.set(
      support[0],
      support[1] + (supportAuthored ? 0 : 0.006),
      support[2] + (supportAuthored ? 0 : 0.034) + supportDepthComp,
    );
    this.supportArmGroup.scale.set(
      supportWidthScale * handFovScale,
      supportLengthScale * handFovScale,
      supportWidthScale * handFovScale,
    );
    if (def.kind !== 'melee') {
      this.armGroup.scale.multiplyScalar(.65);
      this.supportArmGroup.scale.multiplyScalar(supportAuthored ? .65 : .60);
    }
    // The launcher mesh/contacts were authored at 2.3x scale and its mount
    // cancels that enlargement. Arms are separate assets: compensate them too
    // so the supporting sleeve reaches the body instead of ending in midair.
    if (def.id === 'rpg') {
      this.armGroup.scale.multiplyScalar(2.3);
      this.supportArmGroup.scale.multiplyScalar(2.3);
    }
    // Only the left support arm is presented by the first-person firearm camera.
    // Keep the right grip transform intact; Avatar renders third-person hands.
    this.armGroup.visible = def.kind === 'melee';
    this.supportArmGroup.visible = def.kind !== 'melee' || pose.supportVisible !== false;
    this.armGroup.userData.gripTarget = trigger.slice();
    this.supportArmGroup.userData.gripTarget = support.slice();
  }

  _alignSupportArmToShoulder() {
    if (!this.supportArmGroup) return;
    if (this.currentDef.kind === 'melee') {
      this.supportArmGroup.userData.supportWrist?.quaternion.identity();
      return;
    }
    const arm = this.supportArmGroup;
    // The palm follows the gun, but the elbow belongs to the left shoulder.
    // Undo the carry/recoil rotation before orienting the sleeve in camera space;
    // otherwise a sideways sprint rifle drags the whole elbow across the receiver.
    this._supportCameraRotation ||= new THREE.Quaternion().setFromEuler(new THREE.Euler(.20, .08, -.46));
    arm.quaternion.copy(this.weaponMount.quaternion)
      .multiply(this.swayGroup.quaternion).multiply(this.kickGroup.quaternion)
      .invert().multiply(this._supportCameraRotation);
    arm.position.fromArray(arm.userData.gripTarget);
    // The palm stays up relative to the fore-end, independent of sprint yaw.
    // The elbow keeps its camera-space orientation and the sleeve bends between.
    if (arm.userData.supportWrist) {
      arm.userData.supportWrist.quaternion.copy(arm.quaternion).invert();
    }
    if (!arm.userData.authoredViewArm) {
      this._supportPalmOffset ||= new THREE.Vector3();
      this._supportPalmOffset.set(0, -.004, -.031).multiply(arm.scale).applyQuaternion(arm.quaternion);
      arm.position.sub(this._supportPalmOffset);
    }
  }

  _updateViewmodelHandLayers() {
    // Hands and gun share real depth in the isolated viewmodel pass.
    const handOrder = 0;
    for (const mesh of this._handSurfaceMeshes || []) {
      mesh.renderOrder = handOrder;
    }
  }

  /**
   * Tint the first-person arm to the player's character.
   *
   * Compatibility path for the legacy two-colour character skin. Equipped
   * armour uses setArmAppearance() with the model's authored plate, frame,
   * joint and glow colours instead.
   */
  setSkin(skin) {
    this.setArmAppearance({
      plate: skin.primary,
      sleeve: skin.secondary,
      glove: new THREE.Color(skin.secondary).multiplyScalar(0.45).getHex(),
      accent: skin.primary,
    });
  }

  /** Apply the exact equipped character palette to the first-person gauntlet. */
  setArmAppearance({ plate, sleeve, glove, accent, authored = false }) {
    this._armAppearance = { plate, sleeve, glove, accent, authored };
    // These values are already resolved from the equipped third-person body.
    // Applying another brightness multiplier here made the FPS gloves and
    // sleeves look like an unrelated skin.
    this.armPlateMat.color.setHex(plate);
    this.sleeveMat.color.setHex(sleeve);
    this.gloveMat.color.setHex(glove);
    this.jointMat.color.setHex(glove);
    this.cuffMat.color.setHex(accent);
    this.cuffMat.emissive.setHex(accent);
    this.cuffMat.emissiveIntensity = 0.05;
    if (this.armGroup?.userData.authoredViewArm) {
      tintViewmodelArm(this.armGroup, this._armAppearance);
    }
    if (this.supportArmGroup?.userData.authoredViewArm) {
      tintViewmodelArm(this.supportArmGroup, this._armAppearance);
    }
  }

  /** Apply a cosmetic weapon finish to all gun (non-melee) models. */
  setWeaponSkin(skin) {
    this.weaponSkin = skin;
    if (!skin) return;
    for (const w of this.allWeapons) {
      if (w.kind === 'melee') continue;
      applyWeaponSkin(this.models.get(w.id).group, skin);
    }
  }

  /** Apply a cosmetic finish to every melee model. */
  setSwordSkin(skin) {
    this.swordSkin = skin;
    if (!skin) return;
    for (const w of this.allWeapons) {
      if (w.kind !== 'melee') continue;
      applySwordSkin(this.models.get(w.id).group, skin);
    }
  }

  /**
   * Apply per-weapon skins from the Armory skin map.
   * Map<weaponId, { skin, isSword }> — each weapon gets its own individual finish.
   */
  applyArmoryMap(map) {
    this._armoryMap = map;
    for (const w of this.allWeapons) {
      const entry = map.get(w.id);
      if (!entry) continue;
      const { group } = this.models.get(w.id);
      if (entry.isSword) {
        this.swordSkin = entry.skin;
        applySwordSkin(group, entry.skin);
      } else {
        if (!this.weaponSkin) this.weaponSkin = entry.skin;
        applyWeaponSkin(group, entry.skin);
      }
    }
  }

  // Resolve the cosmetic skin currently applied to a given weapon: prefer the
  // per-weapon Armory entry, fall back to the global weapon/sword skin.
  _activeSkinFor(weaponId) {
    const entry = this._armoryMap?.get(weaponId);
    if (entry) return entry.skin;
    const def = this.loadout.find((w) => w.id === weaponId);
    return def?.kind === 'melee' ? this.swordSkin : this.weaponSkin;
  }

  _rebuildKeyMap() {
    // EV.IO keeps guns on the number row and reserves Z for melee.
    this.keyMap = new Map();
    let gunSlot = 1;
    this.loadout.forEach((w, i) => {
      if (w.kind === 'melee') this.keyMap.set('KeyZ', i);
      else {
        if (gunSlot <= 10) this.keyMap.set(`Digit${gunSlot % 10}`, i);
        gunSlot++;
      }
    });
  }

  /** Set the active loadout to a single gun + single melee weapon. */
  setLoadout(gunId, meleeId) {
    this.pendingEmptyDiscards = new Set();
    const gun = this.allWeapons.find((w) => w.id === gunId && isMainWeaponId(w.id))
             || this.allWeapons.find((w) => isMainWeaponId(w.id));
    const melee = this.allWeapons.find((w) => w.id === meleeId && w.kind === 'melee')
               || this.allWeapons.find((w) => w.kind === 'melee');
    this.loadout = [gun, melee].filter(Boolean);
    this._mainGunId = gun?.id ?? null;   // remembered so map power-weapons can be dropped on respawn
    this._meleeId   = melee?.id ?? null;
    this.mapGunId = null;
    this.currentIndex = 0;
    this._rebuildKeyMap();
    this._setActiveModel(0);
  }

  // Keep each distinct map weapon until death or switching away with no ammo. Duplicates stack their own
  // ammo without adding a slot or interrupting the currently equipped weapon.
  addMapGun(gunId) {
    const def = this.allWeapons.find((w) => w.id === gunId && isMatchPickupWeaponId(w.id));
    if (!def) return null;
    const main  = this.allWeapons.find((w) => w.id === this._mainGunId && w.kind !== 'melee')
               || this.loadout.find((w) => w.kind !== 'melee');
    const melee = this.allWeapons.find((w) => w.id === this._meleeId && w.kind === 'melee')
               || this.loadout.find((w) => w.kind === 'melee');
    const previousId = this.loadout[this.currentIndex]?.id;
    const alreadyOwned = this.loadout.some((w) => w.id === def.id);
    const slots = [];
    if (main) slots.push(main);
    slots.push(...this.loadout.filter((w) => isMatchPickupWeaponId(w.id)));
    if (!alreadyOwned) slots.push(def);
    if (melee) slots.push(melee);
    this.loadout = slots;
    this.mapGunId = def.id;
    if (!alreadyOwned) this.currentIndex = this.loadout.indexOf(def);
    this._rebuildKeyMap();
    const st = this.state.get(def.id);
    if (st && alreadyOwned) {
      st.reserveAmmo += def.magSize + def.reserveMax;
    } else if (st) {
      st.magAmmo = def.magSize;
      st.reserveAmmo = def.reserveMax;
      st.isReloading = false;
      st.reloadTimer = 0;
    }
    if (!alreadyOwned) {
      this._discardEmptyAfterSwitch(previousId);
      this._setActiveModel(this.currentIndex);
    }
    return def;
  }

  // Drop any picked-up power weapon — back to the base main gun + melee.
  resetLoadout() {
    this.setLoadout(this._mainGunId, this._meleeId);
  }

  _setActiveModel(index) {
    // Hide every model, then show the active loadout slot.
    for (const w of this.allWeapons) {
      const m = this.models.get(w.id);
      if (m) m.group.visible = false;
    }
    const cur = this.loadout[index];
    if (cur) this.models.get(cur.id).group.visible = true;
    // Seat the hands against this weapon's own grip and handguard. The same
    // contact table drives the remote Soldier's right/left hand targets.
    this._applyViewmodelHandPose();
    // Kick off the raise animation — the new gun eases up from lowered.
    this._raiseT = 0;
  }

  _ensureActiveModelVisibility() {
    const active = this.currentDef;
    if (!active) return;
    const knifeInFlight = active.kind === 'melee'
      && active.throwable && this._knifeCooldown > 0;
    for (const weapon of this.allWeapons) {
      const model = this.models.get(weapon.id)?.group;
      if (!model) continue;
      model.visible = weapon.id === active.id && !knifeInFlight;
    }
  }

  get currentDef() {
    return this.loadout[this.currentIndex];
  }

  get currentState() {
    return this.state.get(this.currentDef.id);
  }

  _discardEmptyAfterSwitch(previousId) {
    const selected = this.currentDef;
    const previous = this.allWeapons.find(w => w.id === previousId);
    const ammo = this.state.get(previousId);
    if (!selected || selected.id === previousId || !previous || previous.kind === 'melee'
      || previous.infiniteReserve || !ammo || ammo.magAmmo > 0 || ammo.reserveAmmo > 0) return;
    (this.pendingEmptyDiscards ??= new Set()).add(previousId);
    this.loadout = this.loadout.filter(w => w.id !== previousId);
    this.currentIndex = this.loadout.findIndex(w => w.id === selected.id);
    if (this.mapGunId === previousId) this.mapGunId = null;
    this._rebuildKeyMap();
  }

  switchTo(index) {
    if (index === this.currentIndex || index < 0 || index >= this.loadout.length) return;
    const previousId = this.currentDef.id;
    const st = this.currentState;
    if (st.isReloading) {
      st.isReloading = false;
    }
    this.currentIndex = index;
    this._discardEmptyAfterSwitch(previousId);
    this.fireTimer = Math.max(this.fireTimer, 0.12);
    this._shotBloom = 0;
    // Never carry an unfinished blade arc into the next equipped weapon.
    this.swingPhase = 1;
    this._setActiveModel(this.currentIndex);
    this.audio.playWeaponSwitch();
  }

  resetMotionState() {
    this._weaponInertia?.reset();
    this._strafeBodyRoll = this._strafeBodyX = 0;
    this._stanceFollow = this._stanceSettle = 0;
    this.kickPos.set(0, 0, 0);
    this.kickVel.set(0, 0, 0);
    this.kickRotX = 0;
    this.kickRotXVel = 0;
    this.swingPhase = 1;
    this.scopeT = 0;
    this._sprintT = 0;
    this._movingFireT = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._swayVelX = 0;
    this._swayVelY = 0;
    this._verticalLag = 0;
    this.swayGroup.position.y = 0;
    this._bobPhase = 0;
    this._bobAmt = 0;
    this._smoothGaitPose = null;
    this._idleT = 0;
    this._breathWeight = 0;
    this._raiseT = 1;
    this._wasGrounded = true;
    this._landT = 0;
    this._landStrength = 0;
    this._fallSpeed = 0;
    this._shotBloom = 0;
    this.prevMouseDown = false;
    this._mountPos.set(
      VIEWMODEL_X * viewmodelAspectScale(this.camera.aspect),
      viewmodelVerticalPosition(this.camera.aspect, this.camera.fov), VIEWMODEL_Z,
    );
    this._mountRot.set(VIEWMODEL_PITCH, VIEWMODEL_YAW, VIEWMODEL_ROLL);
    this.weaponMount?.position.copy(this._mountPos);
    this.weaponMount?.rotation.set(VIEWMODEL_PITCH, VIEWMODEL_YAW, VIEWMODEL_ROLL);
    this.swayGroup?.position.set(0, 0, 0);
    this.swayGroup?.rotation.set(0, 0, 0);
    this.kickGroup?.position.set(0, 0, 0);
    this.kickGroup?.rotation.set(0, 0, 0);
    if (this.kickGroup) this.kickGroup.visible = true;
  }

  resetState(baseFov) {
    this.currentIndex = 0;
    this._setActiveModel(0);
    for (const w of this.allWeapons) {
      const st = this.state.get(w.id);
      st.magAmmo = w.kind === 'melee' ? 0 : w.magSize;
      st.reserveAmmo = w.kind === 'melee' ? 0 : w.reserveMax;
      st.isReloading = false;
      st.reloadTimer = 0;
    }
    this.fireTimer = 0;
    this.resetMotionState();
    this._knifeCooldown = 0;
    this._prevRightMouse = false;
    this.camera.fov = baseFov;
    this.camera.updateProjectionMatrix();

    // drop any in-flight thrown knives from a previous round
    for (const k of this.thrownKnives) {
      this.scene.remove(k.mesh);
      k.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.thrownKnives.length = 0;

    // drop any in-flight rockets / explosions from a previous round
    for (const r of this.rockets) {
      this.scene.remove(r.mesh);
      r.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.rockets.length = 0;
    for (const e of this.explosions) {
      disposeExplosion(this.scene, e);
    }
    this.explosions.length = 0;
    for (const s of this.shells) {
      this.scene.remove(s.mesh);
    }
    this.shells.length = 0;
    for (const tr of this.tracers) {
      this.scene.remove(tr.mesh);
      tr.mesh.geometry.dispose();
      tr.mesh.material.dispose();
    }
    this.tracers.length = 0;
    for (const puff of this.muzzleSmoke) {
      this.scene.remove(puff.mesh);
      puff.mesh.geometry.dispose();
      puff.mesh.material.dispose();
    }
    this.muzzleSmoke.length = 0;
  }

  startReload() {
    const def = this.currentDef;
    const st = this.currentState;
    if (def.kind === 'melee' || st.isReloading) return;
    if (st.magAmmo >= def.magSize || (!def.infiniteReserve && st.reserveAmmo <= 0)) return;
    st.isReloading = true;
    st.reloadTimer = def.reloadTime;
    // Two-phase reload: mag drop immediately, rack/bolt halfway through
    this.audio.playReloadMag();
    setTimeout(() => { if (st.isReloading) this.audio.playReloadRack(); }, (def.reloadTime * 0.55) * 1000);
    if (this.onReloadStart) this.onReloadStart();
  }

  _completeReload() {
    const def = this.currentDef;
    const st = this.currentState;
    const needed = def.magSize - st.magAmmo;
    const transfer = def.infiniteReserve ? needed : Math.min(needed, st.reserveAmmo);
    st.magAmmo += transfer;
    if (!def.infiniteReserve) st.reserveAmmo -= transfer;
    st.isReloading = false;
  }

  _spawnTracer(from, to, weaponDef = this.currentDef, muzzle = null) {
    const laserBeam = !!weaponDef?.laserBeam;
    const mesh = createTracerMesh(laserBeam);
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance <= 0.001) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      return;
    }
    direction.multiplyScalar(1 / distance);
    // Presentation speed is independent of damage timing. The first frame is
    // always retained at the muzzle, including on lower-frame-rate devices.
    const speed = TRACER_VISUAL_SPEED;
    if (laserBeam) mesh.material.opacity = .96;
    const trailLength = laserBeam ? distance : Math.min(TRACER_LENGTH, distance);
    mesh.position.copy(from);
    // Keep the dedicated laser's existing 8.8cm radius.
    mesh.scale.set(laserBeam ? 4 : .25, laserBeam ? 4 : .25, trailLength);
    mesh.lookAt(to);
    if ((laserBeam || weaponDef?.energyBlast) && weaponDef?.energyColor) mesh.material.color.setHex(weaponDef.energyColor);
    this.scene.add(mesh);
    this.tracers.push({
      mesh,
      from: from.clone(),
      to: to.clone(),
      direction,
      distance,
      laserBeam,
      travelled: 0,
      speed,
      trailLength,
      fade: 1,
      endAge: 0,
      fresh: true,
      muzzle,
    });
  }

  /** Render a replicated shot without changing local ammo or applying damage. */
  showAuthoritativeTracer(weaponId, from, to) {
    const def = this.allWeapons.find((weapon) => weapon.id === weaponId) || this.currentDef;
    this._spawnTracer(from, to, def);
  }

  _flash() {
    triggerLegendaryShot(this.models.get(this.currentDef.id)?.group, this.animTime);
    const skinSound  = this._activeSkinFor?.(this.currentDef?.id)?.shootSound;
    const animeActive = CUTE_SOUNDS.has(skinSound);
    const fireActive  = FIRE_SOUNDS.has(skinSound);
    const legendary = this._activeSkinFor?.(this.currentDef?.id);
    const legendaryColor = legendary?.rarity === 'legendary' ? legendary.energyColor : null;
    const flashColor  = legendaryColor ?? (animeActive ? 0xff69b4 : fireActive ? 0xff4400 : this.currentDef.energyBlast ? 0xb6ff32 : 0xffcc66);
    const flashHex    = legendaryColor ?? (animeActive ? 0xff9de0 : fireActive ? 0xff6600 : this.currentDef.energyBlast ? 0xf1ffd0 : 0xfff0a0);
    this.flashLight.color.setHex(flashColor);
    this.flashLight.intensity = animeActive ? 12 : fireActive ? 14 : 8;
    this.models.get(this.currentDef.id).muzzle.getWorldPosition(this._muzzleWorld);
    this.camera.worldToLocal(this._muzzleWorld);
    const muzzleWorld = this._muzzleWorld;
    this.flashLight.position.copy(muzzleWorld);
    this._flashTimer = FLASH_LIFE;
    this._flashFresh = true;

    // Show sprite meshes at muzzle
    const muzzleObj = this.models.get(this.currentDef.id).muzzle;
    this._flashMeshes.forEach((m) => {
      const rifleFlash = this.currentDef.id === 'm4';
      if (!!m.userData.rifleFlash !== rifleFlash) {
        m.parent?.remove(m);
        return;
      }
      muzzleObj.add(m);
      m.material.color.setHex(rifleFlash && !legendaryColor && !animeActive && !fireActive
        ? (m.userData.flashCore ? 0xfff1a1 : 0xffa51c) : flashHex);
      m.material.opacity = 0.92;
      const scale = this.currentDef.muzzleFlashScale ?? 1;
      m.scale.setScalar(scale * (m.userData.flashCore ? .56 : 1) * (1.05 + Math.random() * 0.24));
      m.rotation.z += Math.random() * Math.PI;
    });
  }

  _spawnMuzzleSmoke() {
    const def = this.currentDef;
    if (!def.muzzleSmoke) return;
    this.models.get(def.id).muzzle.getWorldPosition(this._muzzleWorld);
    this.camera.getWorldDirection(this._fwdVec);
    this._upVec.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this._rightVec.setFromMatrixColumn(this.camera.matrixWorld, 0);
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.026 + Math.random() * 0.012, 1),
        new THREE.MeshBasicMaterial({
          color: 0xc9d2d4,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
      );
      mesh.position.copy(this._muzzleWorld);
      mesh.position.addScaledVector(this._rightVec, (Math.random() - 0.5) * 0.025);
      const velocity = this._fwdVec.clone().multiplyScalar(0.55 + Math.random() * 0.45);
      velocity.addScaledVector(this._upVec, 0.12 + Math.random() * 0.18);
      velocity.addScaledVector(this._rightVec, (Math.random() - 0.5) * 0.22);
      this.scene.add(mesh);
      this.muzzleSmoke.push({ mesh, velocity, age: 0, life: 0.13 + Math.random() * 0.08 });
    }
  }

  _updateMuzzleSmoke(dt) {
    for (let i = this.muzzleSmoke.length - 1; i >= 0; i--) {
      const puff = this.muzzleSmoke[i];
      puff.age += dt;
      puff.mesh.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(Math.exp(-5 * dt));
      const t = Math.min(1, puff.age / puff.life);
      puff.mesh.scale.setScalar(1 + t * 2.2);
      puff.mesh.material.opacity = 0.2 * (1 - t) * (1 - t);
      if (t >= 1) {
        this.scene.remove(puff.mesh);
        puff.mesh.geometry.dispose();
        puff.mesh.material.dispose();
        this.muzzleSmoke.splice(i, 1);
      }
    }
  }

  _spawnShell() {
    const mesh = new THREE.Mesh(this._shellGeo, this._shellMat);
    this.models.get(this.currentDef.id).muzzle.getWorldPosition(this._muzzleWorld);
    this._rightVec.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this._upVec.setFromMatrixColumn(this.camera.matrixWorld, 1);
    mesh.position.copy(this._muzzleWorld)
      .addScaledVector(this._rightVec, 0.12)
      .addScaledVector(this._upVec, -0.05);
    this.scene.add(mesh);
    const vel = this._rightVec.clone().multiplyScalar(2.8 + Math.random() * 1.4);
    vel.addScaledVector(this._upVec, 1.8 + Math.random() * 1.0);
    vel.x += (Math.random() - 0.5) * 0.8;
    vel.z += (Math.random() - 0.5) * 0.8;
    this.shells.push({ mesh, vel, life: 0.55 });
  }

  _spawnAnimeSparkles() {
    if (!this._animeSparkles) this._animeSparkles = [];
    const colors = [0xff69b4, 0xff1493, 0xffa0d0, 0xffd700, 0xffffff];
    this.models.get(this.currentDef.id).muzzle.getWorldPosition(this._muzzleWorld);
    const muzzleWorld = this._muzzleWorld;
    this._upVec.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this._rightVec.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = this._upVec, right = this._rightVec;
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.015 + Math.random() * 0.02, 4, 3);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true, opacity: 1.0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(muzzleWorld);
      this.scene.add(mesh);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        1.5 + Math.random() * 3,
        (Math.random() - 0.5) * 4
      );
      vel.addScaledVector(up,    Math.random() * 2.5);
      vel.addScaledVector(right, (Math.random() - 0.5) * 2);
      this._animeSparkles.push({ mesh, vel, life: 0.5 + Math.random() * 0.3, spin: Math.random() * 10 });
    }
  }

  _updateAnimeSparkles(dt) {
    if (!this._animeSparkles?.length) return;
    for (let i = this._animeSparkles.length - 1; i >= 0; i--) {
      const s = this._animeSparkles[i];
      s.vel.y -= 8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.z += s.spin * dt;
      s.life -= dt;
      s.mesh.material.opacity = Math.max(0, s.life / 0.5);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this._animeSparkles.splice(i, 1);
      }
    }
  }

  _spawnFireEmbers() {
    if (!this._fireEmbers) this._fireEmbers = [];
    const colors = [0xff2200, 0xff6600, 0xff9900, 0xffcc00, 0xff4400];
    this.models.get(this.currentDef.id).muzzle.getWorldPosition(this._muzzleWorld);
    const muzzleWorld = this._muzzleWorld;
    this._fwdVec.setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    this._upVec.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this._rightVec.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const fwd = this._fwdVec, up = this._upVec, right = this._rightVec;
    for (let i = 0; i < 12; i++) {
      const size = 0.012 + Math.random() * 0.022;
      const geo = new THREE.SphereGeometry(size, 4, 3);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true, opacity: 1.0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(muzzleWorld);
      this.scene.add(mesh);
      const spread = 0.8 + Math.random() * 1.6;
      const vel = fwd.clone().multiplyScalar(5 + Math.random() * 8);
      vel.addScaledVector(up,    (Math.random() - 0.3) * spread * 4);
      vel.addScaledVector(right, (Math.random() - 0.5) * spread * 4);
      this._fireEmbers.push({ mesh, vel, life: 0.28 + Math.random() * 0.22, spin: Math.random() * 14 });
    }
  }

  _updateFireEmbers(dt) {
    if (!this._fireEmbers?.length) return;
    for (let i = this._fireEmbers.length - 1; i >= 0; i--) {
      const s = this._fireEmbers[i];
      s.vel.y += 6 * dt; // embers rise
      s.vel.multiplyScalar(1 - dt * 3.5); // drag
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.z += s.spin * dt;
      s.life -= dt;
      const t = Math.max(0, s.life / 0.35);
      s.mesh.material.opacity = t;
      s.mesh.scale.setScalar(0.5 + t * 0.6); // shrink as they fade
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this._fireEmbers.splice(i, 1);
      }
    }
  }

  _updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 18;
      s.mesh.rotation.z += dt * 14;
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
      }
    }
  }

  _doHitscanShot(world, botMeshes, player, shotRounds = null) {
    const def = this.currentDef;
    const st = this.currentState;
    this.camera.getWorldPosition(this._camPos);
    this.camera.getWorldDirection(this._camDir);
    this._rightVec.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this._upVec.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.models.get(def.id).muzzle.getWorldPosition(this._muzzleWorld);

    this._raycaster.far = def.range;
    // Bots + collider VISUALS get an exact mesh raycast; the map's bare box
    // colliders are checked separately (world.raycastBoxHit) and the nearer of
    // the two wins.
    this._targets.length = 0;
    for (const m of botMeshes) this._targets.push(m);
    for (const m of world.raycastMeshes) this._targets.push(m);
    const targets = this._targets;

    const pelletCount = def.ammoPerShot > 1 ? (shotRounds ?? def.pellets) : (def.pellets || 1);
    const shotSpread = calculateShotSpread(def, this._shotBloom, this.scopeT,
      Math.hypot(player.velocity.x, player.velocity.z));
    let anyHitBot = false;
    let lastImpact = null;

    for (let i = 0; i < pelletCount; i++) {
      this._pelletDir.copy(this._camDir);
      if (shotSpread > 0) {
        const jx = (Math.random() - 0.5) * shotSpread;
        const jy = (Math.random() - 0.5) * shotSpread;
        this._pelletDir.addScaledVector(this._rightVec, jx).addScaledVector(this._upVec, jy).normalize();
      }
      this._raycaster.set(this._camPos, this._pelletDir);
      const hits = this._raycaster.intersectObjects(targets, true);
      let hit = hits.find((h) => !h.object.userData.noHit);
      // A bare box in front of the mesh hit blocks the shot (and if nothing was
      // hit at all, the box IS the hit) — cover you can see now stops bullets.
      const boxHit = world.raycastBoxHit(this._raycaster.ray, def.range);
      if (boxHit && (!hit || boxHit.distance < hit.distance)) {
        hit = { point: boxHit.point, distance: boxHit.distance, object: _BOX_OBJ };
      }
      if (hit) {
        lastImpact = hit.point;
        const bot = hit.object.userData.bot;
        if (bot) {
          anyHitBot = true;
          // Three body kinds, three ways to know you hit a head, in order of
          // how much the body actually knows:
          //   headshotY  a skinned body states its own head height. There is no
          //              per-part head mesh left to tag on one — it is a handful
          //              of merged meshes — so without this every head hit on
          //              the block/lofted chassis silently counts as a body hit.
          //   isHuman    the rigged soldier is one skinned mesh: height rule.
          //   isHead     the old parts-on-pivots bodies, which do tag a mesh.
          const ud = bot.mesh?.userData;
          const headY = ud?.headshotY;
          const isHead = typeof headY === 'number'
            ? (hit.point.y - bot.position.y) > headY
            : ud?.isHuman
              ? (hit.point.y - bot.position.y) > 1.5
              : !!hit.object.userData.isHead;
          const mult   = isHead && def.headshotMultiplier ? def.headshotMultiplier : 1;
          if (this.onHitBot) this.onHitBot(bot, def.damage * mult, hit.point, { headshot: isHead, hitscan: true });
        } else if (this.onHitWorld) {
          this.onHitWorld(hit.point);
        }
        this._spawnTracer(this._muzzleWorld, hit.point, def, this.models.get(def.id).muzzle);
      } else {
        this._farVec.copy(this._camPos).addScaledVector(this._pelletDir, def.range);
        this._spawnTracer(this._muzzleWorld, this._farVec, def, this.models.get(def.id).muzzle);
      }
    }

    return anyHitBot;
  }

  _doMeleeSwing(player, world, botManager) {
    const def = this.currentDef;
    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    const aimDir = new THREE.Vector3();
    this.camera.getWorldDirection(aimDir);
    const camDir = aimDir.clone();
    camDir.y = 0;
    camDir.normalize();

    let hitTarget = false;
    for (const bot of botManager.bots) {
      if (!bot.alive) continue;
      const toBot = new THREE.Vector3(bot.position.x - player.position.x, 0, bot.position.z - player.position.z);
      const dist = toBot.length();
      if (dist > def.range) continue;
      toBot.normalize();
      const dot = camDir.dot(toBot);
      if (dot > Math.cos(def.arc)) {
        hitTarget = true;
        const meshData = bot.mesh?.userData;
        const headY = typeof meshData?.headshotY === 'number'
          ? meshData.headshotY
          : (meshData?.isHuman ? 1.62 : 1.55);
        const headPoint = new THREE.Vector3(bot.position.x, bot.position.y + headY, bot.position.z);
        const toHead = headPoint.clone().sub(camPos).normalize();
        // A sword critical still requires deliberate head aim; the broad body
        // sweep remains 75 damage instead of turning the whole arc into a
        // one-hit zone.
        const isHead = Boolean(def.headshotMultiplier)
          && aimDir.dot(toHead) > Math.cos(0.18);
        const damage = def.damage * (isHead ? def.headshotMultiplier : 1);
        if (this.onHitBot) this.onHitBot(
          bot,
          damage,
          isHead ? headPoint : bot.position,
          { headshot: isHead, melee: true },
        );
      }
    }
    if (hitTarget && !this.authoritative) this.audio.playSwordImpact?.('armor');
    else if (!hitTarget && !this.authoritative) {
      // Empty-air swings stay quiet; only a wall in blade range clangs.
      this._raycaster.set(camPos, aimDir);
      this._raycaster.far = def.range;
      const wall = this._raycaster.intersectObjects(world.raycastMeshes || [], true)[0]
        || world.raycastBoxHit?.(this._raycaster.ray, def.range);
      if (wall) this.audio.playSwordImpact?.('metal');
    }
  }

  _makeThrownKnifeMesh(def) {
    const skin = this._activeSkinFor(def.id);
    const bladeColor = skin?.blade ?? 0xc0c6ce;
    const g = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({
      color: bladeColor, metalness: 0.9, roughness: 0.18,
      emissive: new THREE.Color(skin?.emissive ?? 0x000000),
      emissiveIntensity: skin?.emissiveIntensity ?? 0,
    });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.82, metalness: 0.1 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.26), bladeMat);
    blade.position.z = -0.1;
    g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.07, 6), bladeMat);
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.27;
    g.add(tip);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.1), gripMat);
    grip.position.z = 0.08;
    g.add(grip);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  _throwKnife(def) {
    const muzzleWorld = new THREE.Vector3();
    this.models.get(def.id).muzzle.getWorldPosition(muzzleWorld);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir).normalize();

    const mesh = this._makeThrownKnifeMesh(def);
    mesh.position.copy(muzzleWorld);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    this.scene.add(mesh);

    this.thrownKnives.push({
      mesh, pos: muzzleWorld.clone(), dir: dir.clone(),
      speed: def.throwSpeed || 40, life: 3, def
    });

    this._knifeCooldown = def.throwCooldown || 0.9;
    // hide the in-hand knife until a fresh one is pulled (cooldown end)
    const m = this.models.get(def.id);
    if (m) m.group.visible = false;
    if (this.audio.playSwing) this.audio.playSwing();
  }

  _updateThrownKnives(dt, world, botManager) {
    if (!this.thrownKnives.length) return;
    const worldMeshes = world.raycastMeshes;
    const botMeshes = botManager.getRaycastTargets();
    const ray = new THREE.Raycaster();
    const spinAxis = new THREE.Vector3(1, 0, 0);

    for (let i = this.thrownKnives.length - 1; i >= 0; i--) {
      const k = this.thrownKnives[i];
      const prev = k.pos.clone();
      const step = k.speed * dt;
      k.pos.addScaledVector(k.dir, step);
      k.life -= dt;

      let hitPoint = null, hitBot = null;
      ray.set(prev, k.dir);
      ray.far = step + 0.2;
      const hits = ray
        .intersectObjects([...botMeshes, ...worldMeshes], true)
        .filter((h) => !h.object.userData.noHit);
      if (hits.length) { hitPoint = hits[0].point; hitBot = hits[0].object.userData.bot; }
      // Bare box colliders stick the knife too (and win if they're nearer).
      const kBox = world.raycastBoxHit(ray.ray, ray.far);
      if (kBox && (!hitPoint || kBox.distance < hits[0].distance)) {
        hitPoint = kBox.point; hitBot = null;
      }

      const oob = Math.abs(k.pos.x) > world.arenaHalf || Math.abs(k.pos.z) > world.arenaHalf;
      if (!hitPoint && (k.pos.y <= 0.05 || oob || k.life <= 0)) hitPoint = k.pos.clone();

      if (hitPoint) {
        if (hitBot && this.onHitBot) {
          // one-hit kill + 3x reward (only thrown knives carry rewardMult)
          this.onHitBot(hitBot, k.def.throwDamage || 9999, hitPoint,
            { rewardMult: k.def.throwRewardMult || 3, thrown: true });
        }
        this.scene.remove(k.mesh);
        k.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        this.thrownKnives.splice(i, 1);
      } else {
        k.mesh.position.copy(k.pos);
        k.mesh.rotateOnAxis(spinAxis, dt * 24); // tumbling throw
      }
    }
  }

  _projectMuzzleBeforeTarget(from, target) {
    if (!this.camera) return from;
    this.camera.getWorldPosition(this._camPos);
    this.camera.getWorldDirection(this._camDir);
    this._farVec.subVectors(from, this._camPos);
    const muzzleDepth = this._farVec.dot(this._camDir);
    const hitDepth = this._pelletDir.subVectors(target, this._camPos).dot(this._camDir);
    // Viewmodel geometry has its own camera layer. Preserve its screen pixel
    // while pulling the origin in front of nearby cover, never behind the hit.
    if (hitDepth > this.camera.near * 2 && muzzleDepth > hitDepth * .8) {
      const depth = Math.max(this.camera.near * 1.5, hitDepth * .25);
      from.copy(this._camPos).addScaledVector(this._farVec, depth / muzzleDepth);
    }
    return from;
  }

  _spawnRocket(def, world = {}, botMeshes = []) {
    const muzzleWorld = new THREE.Vector3();
    this.models.get(def.id).muzzle.getWorldPosition(muzzleWorld);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const ray = new THREE.Raycaster(origin, dir, 0, def.range);
    const hits = ray.intersectObjects([...botMeshes, ...(world.raycastMeshes || [])], true);
    const meshHit = hits.find(hit => !hit.object.userData.noHit);
    const boxHit = world.raycastBoxHit?.(ray.ray, def.range);
    const hit = boxHit && (!meshHit || boxHit.distance < meshHit.distance) ? boxHit : meshHit;
    const target = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, def.range);

    const g = def.energyBlast ? createEnergyBlast() : def.id === 'concussion' ? createLauncherGrenade() : new THREE.Group();
    if (!def.energyBlast && def.id !== 'concussion') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b6f55, roughness: 0.6, metalness: 0.3 });
      const noseMat = new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.5, metalness: 0.3 });
      const finMat = new THREE.MeshStandardMaterial({ color: 0x222420, roughness: 0.7 });

      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), bodyMat);
      tube.rotation.x = Math.PI / 2;
      g.add(tube);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 10), noseMat);
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -0.16;
      g.add(nose);
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.06), finMat);
        fin.position.z = 0.1;
        fin.rotation.z = (i / 4) * Math.PI * 2;
        fin.position.x = Math.cos((i / 4) * Math.PI * 2) * 0.04;
        fin.position.y = Math.sin((i / 4) * Math.PI * 2) * 0.04;
        g.add(fin);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    }
    g.position.copy(muzzleWorld);
    g.quaternion.setFromUnitVectors(def.energyBlast || def.id === 'concussion' ? THREE.Object3D.DEFAULT_UP : new THREE.Vector3(0, 0, -1), dir);
    this.scene.add(g);

    this.rockets.push({
      mesh: g,
      muzzle: this.models.get(def.id).muzzle, target, fresh: true,
      pos: muzzleWorld.clone(),
      dir: dir.clone(),
      speed: def.rocketSpeed || 40,
      life: def.id === 'concussion' ? 15 : Math.min(5, def.range / (def.rocketSpeed || 40)),
      grenade: def.id === 'concussion' ? { x:muzzleWorld.x, y:muzzleWorld.y, z:muzzleWorld.z,
        vx:dir.x*def.rocketSpeed, vy:dir.y*def.rocketSpeed, vz:dir.z*def.rocketSpeed } : null,
      def
    });
  }

  _updateRockets(dt, world, botManager) {
    if (!this.rockets.length) return;
    const botMeshes = botManager.getRaycastTargets();
    const ray = new THREE.Raycaster();

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      if (r.fresh) {
        // Resolve after this frame's hold/recoil update, just like hitscan trails.
        r.muzzle.getWorldPosition(r.pos);
        this._projectMuzzleBeforeTarget(r.pos, r.target);
        r.dir.subVectors(r.target, r.pos).normalize();
        r.mesh.position.copy(r.pos);
        r.mesh.quaternion.setFromUnitVectors(r.def.energyBlast || r.grenade
          ? THREE.Object3D.DEFAULT_UP : new THREE.Vector3(0,0,-1), r.dir);
        if (r.grenade) Object.assign(r.grenade, { x:r.pos.x, y:r.pos.y, z:r.pos.z,
          vx:r.dir.x*r.speed, vy:r.dir.y*r.speed, vz:r.dir.z*r.speed });
        r.fresh = false; r.muzzle = null;
        continue; // Show the projectile at the barrel for its first rendered frame.
      }
      if (r.grenade) {
        stepGrenade(r.grenade, dt, (p, dx, dy, dz, length) => {
          ray.set(new THREE.Vector3(p.x,p.y,p.z), new THREE.Vector3(dx,dy,dz));
          const hit = world.raycastCollisionHit?.(ray.ray,length) || world.raycastBoxHit?.(ray.ray,length);
          if (!hit) return null;
          const n = hit.normal || THREE.Object3D.DEFAULT_UP;
          return {distance:hit.distance,nx:n.x,ny:n.y,nz:n.z};
        }, true);
        r.pos.set(r.grenade.x,r.grenade.y,r.grenade.z); r.mesh.position.copy(r.pos);
        r.mesh.rotation.x += Math.min(7,Math.hypot(r.grenade.vx,r.grenade.vy,r.grenade.vz))*dt;
        r.life -= dt;
        const settled = launcherShouldExplode(r.grenade);
        if (settled || r.life <= 0) {
          if (settled) this._explode(r.pos.clone(),r.def,botManager,world);
          this.scene.remove(r.mesh);
          r.mesh.traverse(o => { if(o.isMesh){o.geometry.dispose();o.material.dispose();} });
          this.rockets.splice(i,1);
        }
        continue;
      }
      const prev = r.pos.clone();
      const stepLen = r.speed * dt;
      r.pos.addScaledVector(r.dir, stepLen);
      r.life -= dt;

      let hitPoint = null;
      let hitDistance = Infinity;
      ray.set(prev, r.dir);
      ray.far = stepLen + 0.15;
      const hits = ray
        .intersectObjects(botMeshes, true)
        .filter((h) => !h.object.userData.noHit);
      if (hits.length) {
        hitPoint = hits[0].point;
        hitDistance = hits[0].distance;
      }
      // Use collision geometry for the world impact. This catches thin floors,
      // elevated platforms, and invisible gameplay hulls even when the visible
      // map mesh is simplified.
      const worldHit = world.raycastCollisionHit?.(ray.ray, ray.far)
        || world.raycastBoxHit(ray.ray, ray.far);
      if (worldHit && worldHit.distance < hitDistance) {
        hitPoint = worldHit.point;
        hitDistance = worldHit.distance;
      }

      const outOfBounds = Math.abs(r.pos.x) > world.arenaHalf || Math.abs(r.pos.z) > world.arenaHalf;
      if (!hitPoint && (r.pos.y <= 0.05 || outOfBounds)) hitPoint = r.pos.clone();
      if (!hitPoint && r.life <= 0) hitPoint = r.pos.clone();

      if (hitPoint) {
        this._explode(hitPoint, r.def, botManager, world);
        this.scene.remove(r.mesh);
        r.mesh.traverse((o) => {
          if (o.isMesh) {
            o.geometry.dispose();
            o.material.dispose();
          }
        });
        this.rockets.splice(i, 1);
      } else {
        r.mesh.position.copy(r.pos);
      }
    }
  }

  _explode(point, def, botManager, world = null) {
    this.showAuthoritativeExplosion(point, def.splashRadius || 5, def.energyBlast ? 'energy' : 'rocket');

    const radius = def.splashRadius || 5;
    const minF = def.splashMin !== undefined ? def.splashMin : 0.25;
    for (const bot of botManager.bots) {
      if (!bot.alive) continue;
      const bc = new THREE.Vector3(bot.position.x, bot.position.y + 0.9, bot.position.z);
      const d = bc.distanceTo(point);
      if (d <= radius) {
        // A blast expands through open space, not through solid walls.
        if (world?.raycastCollisionHit && d > 0.2) {
          const blastDir = bc.clone().sub(point).multiplyScalar(1 / d);
          const blastRay = new THREE.Ray(point.clone().addScaledVector(blastDir, 0.12), blastDir);
          const blocked = world.raycastCollisionHit(blastRay, Math.max(0, d - 0.18));
          if (blocked) continue;
        }
        const f = THREE.MathUtils.lerp(1, minF, THREE.MathUtils.clamp(d / radius, 0, 1));
        if (this.onHitBot) this.onHitBot(bot, def.damage * f, point);
      }
    }
  }

  /** Play a server-replicated blast without applying client-side damage. */
  showAuthoritativeExplosion(point, radius = 5, kind = 'rocket') {
    if (this.audio.playExplosion) {
      if (this.audio.playAt) this.audio.playAt(point, () => this.audio.playExplosion(kind));
      else this.audio.playExplosion(kind);
    }
    this.explosions.push(spawnExplosion(this.scene, point, radius, kind));
  }

  _updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      if (updateExplosion(e, dt)) {
        disposeExplosion(this.scene, e);
        this.explosions.splice(i, 1);
      }
    }
  }

  _applyViewmodelRecoil(amount, heavyHandCannon = false) {
    // The enlarged rifle sits close to the eye: use a short rearward stroke
    // while retaining its full upward kick, including during automatic fire.
    const rearwardStroke = this.currentDef?.id === 'm4' ? .6 : 1;
    this.kickPos.z += amount * (heavyHandCannon ? 5 : 2.2) * rearwardStroke;
    this.kickPos.y += amount * (heavyHandCannon ? 4 : 0.4);
    this.kickRotX  += amount * (heavyHandCannon ? 40 : 4.0);
    this.kickVel.z += amount * (heavyHandCannon ? 36 : 26) * rearwardStroke;
    this.kickVel.y += amount * (heavyHandCannon ? 26 : 6);
    this.kickRotXVel += amount * (heavyHandCannon ? 220 : 40);
  }

  _alignViewmodelAim(weight) {
    const def = this.currentDef;
    if (def.kind === 'melee' || weight < .01) return;
    this._viewmodelAim.align(this.camera, this.weaponMount,
      this.models.get(def.id), weight, this.scopeT * this.scopeT * (3 - 2 * this.scopeT));
  }

  showLegendaryKill(weaponId) {
    const skin = this._armoryMap?.get(weaponId)?.skin;
    if (!['legendary', 'mythic'].includes(skin?.rarity)) return null;
    triggerLegendaryKill(this.models.get(weaponId)?.group, this.animTime);
    return skin;
  }

  _fire(world, botMeshes, player, botManager) {
    const def = this.currentDef;
    const st = this.currentState;

    if (def.kind === 'melee') {
      this._swordCombo = ((this._swordCombo ?? -1) + 1) % 3;
      this.audio.playSwing(this._swordCombo);
      this._doMeleeSwing(player, world, botManager);
      if (this.models.get(def.id)?.group) triggerLegendaryShot(this.models.get(def.id).group, this.animTime);
      this.swingPhase = 0;
      this.fireTimer = scheduleNextShot(this.fireTimer, def.fireRate);
      if (this.onShoot) this.onShoot(def);
      return;
    }

    if (st.isReloading) return;
    if (st.magAmmo <= 0) {
      this.audio.playEmptyClick();
      if (this.onEmpty) this.onEmpty();
      this.startReload();
      return;
    }

    const shotRounds = Math.min(st.magAmmo, def.ammoPerShot || 1);
    st.magAmmo -= shotRounds;
    this.fireTimer = scheduleNextShot(this.fireTimer, def.fireRate);
    // A themed skin can override the fire SFX (anime pew, laser, fire whoosh).
    const activeSkin = this._activeSkinFor(def.id);
    const skinSound  = activeSkin?.shootSound;
    if (!(skinSound && this.audio.playSkinShot(skinSound))) {
      this.audio.playShot(def.sound || 'rifle', shotRounds);
    }
    // The Hand Cannon retains spent cases in its cylinder until reloading.
    // Keep shot-time casing visuals and impact audio off for the revolver.
    const retainsCases = def.id === 'magnum';
    // Shell casing clink (not for melee, rocket, or shotgun — they eject differently)
    if (def.kind !== 'rocket' && def.kind !== 'melee'
        && def.id !== 'levershotgun' && !retainsCases) {
      this.audio.playShellCasing();
    }
    if (def.kind === 'rocket') {
      if (!this.authoritative) this._spawnRocket(def, world, botMeshes);
    } else {
      this._doHitscanShot(world, botMeshes, player, shotRounds);
      if (def.spawnShells !== false && !retainsCases) {
        for (let i = 0; i < shotRounds; i++) this._spawnShell();
      }
    }
    this._flash();
    this._spawnMuzzleSmoke();
    // Kawaii skins: spawn pink sparkle hearts at the muzzle
    if (CUTE_SOUNDS.has(skinSound)) this._spawnAnimeSparkles();
    // Fire skins with fireEmbers flag: spawn orange ember burst
    const activeSkinDef = this._activeSkinFor?.(this.currentDef?.id);
    if (activeSkinDef?.fireEmbers) this._spawnFireEmbers();

    // The reference Hand Cannon snaps up/back, then settles on the same spring.
    // Stronger firearm kick; the already-heavy Hand Cannon gets a smaller boost.
    // ADS reduces visual kick without changing authoritative shot direction.
    const visualKick = Math.min(0.018, (def.recoil || 0.02) * (def.id === 'm4' ? 0.48 : 0.3))
      * (def.id === 'magnum' ? 1.15 : 1.5)
      * THREE.MathUtils.lerp(1, 0.35, this.scopeT);
    this._applyViewmodelRecoil(visualKick, def.id === 'magnum');
    if (this.applyRecoilToPlayer) {
      this.applyRecoilToPlayer((def.cameraRecoil ?? def.recoil * 0.6) * 1.3);
    }
    if (def.spreadMax != null) {
      this._shotBloom = Math.min(
        def.spreadMax,
        Math.max(def.spreadMin || 0, this._shotBloom) + (def.spreadBloomPerShot || 0),
      );
    }

    if (this.onShoot) this.onShoot(def);

    if (st.magAmmo <= 0 && (def.infiniteReserve || st.reserveAmmo > 0)) {
      this.startReload();
    }
  }

  update(dt, input, world, botManager, player, controlsEnabled = true) {
    // Menus suppress intent, not the animation clock or existing projectiles.
    if (!controlsEnabled) input = INACTIVE_WEAPON_INPUT;
    const sprinting = controlsEnabled && player.isSprinting && !player.weaponSprintBlocked;
    this.fireTimer = advanceFireCooldown(this.fireTimer, dt);
    // Re-evaluate after aspect/reload state changes so both palms remain fixed
    // to the weapon rather than drifting independently during animation.
    this._applyViewmodelHandPose();

    for (const [code, index] of this.keyMap) {
      if (input.consumeJustPressed(code)) this.switchTo(index);
    }
    // Scroll switches weapons only in FPS mode; in TPS the wheel zooms the camera.
    const touchSwap = input.consumeJustPressed('WeaponNext');
    if (touchSwap || (input.wheelDelta !== 0 && !(player?._camDist > 0))) {
      const dir = touchSwap || input.wheelDelta > 0 ? 1 : -1;
      this.switchTo((this.currentIndex + dir + this.loadout.length) % this.loadout.length);
    }

    if (input.consumeJustPressed('KeyR')) this.startReload();

    const st = this.currentState;
    if (st.isReloading) {
      st.reloadTimer -= dt;
      if (st.reloadTimer <= 0) this._completeReload();
    }

    const def = this.currentDef;
    // Keep first-person presentation self-healing. Network reconciliation and
    // asynchronous model replacement may happen between rendered frames, but
    // neither is allowed to strand the equipped firearm in a hidden state.
    this._ensureActiveModelVisibility();
    // A quick dip on touchdown gives jumps and grav-lifts visible weight in
    // first person. It is intentionally small—the camera already has its own
    // head motion—and only the viewmodel receives this impulse.
    const grounded = player?.onGround !== false;
    const fallingSpeed = Math.max(0, -(player?.velocity?.y || 0));
    if (!grounded) this._fallSpeed = Math.max(this._fallSpeed, fallingSpeed);
    if (grounded && !this._wasGrounded) {
      // Player.update has already zeroed velocity.y by the time the viewmodel
      // sees a landing, so retain the fastest downward speed from the airtime.
      // Tiny curb drops get a restrained settle; a hard fall gets the full dip.
      this._landStrength = THREE.MathUtils.clamp(this._fallSpeed / 14, 0.18, 1.2);
      this._landDuration = jumpLandingDuration(this._fallSpeed);
      this._landT = this._fallSpeed > 0.35 ? this._landDuration : 0;
      this._fallSpeed = 0;
    } else if (grounded) {
      this._fallSpeed = 0;
    }
    this._wasGrounded = grounded;
    if (this._landT > 0) this._landT = Math.max(0, this._landT - dt);
    const landP = this._landT > 0 ? 1 - this._landT / (this._landDuration || .22) : 1;
    const landPulse = (this._landT > 0 ? Math.sin(landP * Math.PI) : 0) * this._landStrength;

    this._shotBloom = Math.max(
      def.spreadMin || 0,
      this._shotBloom - (def.spreadRecovery || 0) * dt,
    );
    const triggerPulled = wantsTriggerShot(def.automatic, input.mouseDown, this.prevMouseDown);

    if (triggerPulled && this.fireTimer <= 0) {
      this._fire(world, botManager.getRaycastTargets(), player, botManager);
    }
    if (!input.mouseDown && this.fireTimer < 0) this.fireTimer = 0;
    this.prevMouseDown = input.mouseDown;

    // Knife throw (right-click): one-hit kill + 3x reward. Cooldown hides the
    // in-hand knife until a fresh one is pulled.
    if (this._knifeCooldown > 0) {
      this._knifeCooldown -= dt;
      if (this._knifeCooldown <= 0 && def.kind === 'melee') {
        const m = this.models.get(def.id);
        if (m) m.group.visible = true;
      }
    }
    const rightJustPressed = input.rightMouseDown && !this._prevRightMouse;
    if (def.kind === 'melee' && def.throwable && rightJustPressed && this._knifeCooldown <= 0) {
      this._throwKnife(def);
    }
    this._prevRightMouse = input.rightMouseDown;

    // Bring the weapon out of sprint carry quickly when the trigger is pulled.
    this._sprintT = expDamp(this._sprintT, sprinting ? 1 : 0, player.weaponSprintBlocked ? 18 : 9, dt);
    this._movingFireT = expDamp(
      this._movingFireT,
      isMovingAndFiring(player, input) ? 1 : 0,
      14,
      dt,
    );

    // Aim-enabled firearms remain visible and travel
    // onto their physical sight axis; snipers hand off to the overlay late in
    // the same motion rather than disappearing on the first held frame.
    const wantScope = canAimWeapon(def)
      && input.rightMouseDown
      && !sprinting
      && !st.isReloading;
    this.scopeT = expDamp(this.scopeT, wantScope ? 1 : 0, def.adsSpeed || 11, dt);
    this._updateViewmodelHandLayers();
    this.kickGroup.visible = !shouldHideAdsViewmodel(def, this.scopeT, wantScope);
    // Full ADS is a stable sight picture. Movement remains visible in the
    // world/camera, but viewmodel breathing, sway, and gait bob fade completely
    // instead of driving the receiver up and down across the target.
    const adsMotionScale = 1 - this.scopeT;
    const sprintFovBoost = this._sprintT * 6;
    const aimedFov = def.scoped ? 28 : (def.adsFov ?? DEFAULT_ADS_FOV);
    const targetFov = THREE.MathUtils.lerp(player.baseFov + sprintFovBoost, aimedFov, this.scopeT);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    // recoil spring-back — a damped spring (position + velocity) gives a
    // punchy kick that snaps back and settles smoothly, instead of a stiff
    // frame-rate-dependent linear decay.
    const K = 190, D = 25;   // stiffness / damping (~critically damped, tiny snap)
    const spring = this._springOut;
    springTo(spring, this.kickPos.x, this.kickVel.x, 0, K, D, dt);
    this.kickPos.x = spring[0]; this.kickVel.x = spring[1];
    springTo(spring, this.kickPos.y, this.kickVel.y, 0, K, D, dt);
    this.kickPos.y = spring[0]; this.kickVel.y = spring[1];
    springTo(spring, this.kickPos.z, this.kickVel.z, 0, K, D, dt);
    this.kickPos.z = spring[0]; this.kickVel.z = spring[1];
    springTo(spring, this.kickRotX, this.kickRotXVel, 0, K, D, dt);
    this.kickRotX = spring[0]; this.kickRotXVel = spring[1];
    // weapon-switch raise: the model eases up from lowered on every swap
    this._raiseT = expDamp(this._raiseT, 1, 14, dt);
    const raiseDrop = (1 - this._raiseT) * 0.28;
    const raiseTilt = (1 - this._raiseT) * 0.9;
    // The close shoulder view uses a compact recoil stroke to protect eye clearance.
    const shoulderRecoil = def.id === 'rpg' ? .22 : 1;
    this.kickGroup.position.set(this.kickPos.x, this.kickPos.y - raiseDrop, this.kickPos.z * shoulderRecoil);
    // Establish the complete base pose every frame. A reload or blade arc can
    // add roll/yaw below, but those axes must never leak into the next weapon.
    this.kickGroup.rotation.set(this.kickRotX * shoulderRecoil - raiseTilt, 0, 0);
    if (def.id === 'm4') {
      // 85.5s in the supplied recording: the receiver rises/back while the tip
      // moves much less. Rotate around the fore-end instead of lifting the tip.
      const pivot = this._rifleRecoilPivot;
      this.models.get(def.id).muzzle.getWorldPosition(pivot);
      this.kickGroup.worldToLocal(pivot);
      this._rifleRecoilRotation.set(Math.sin(-this.kickRotX / 2), 0, 0, Math.cos(this.kickRotX / 2));
      this._rifleRecoilOffset.copy(pivot).applyQuaternion(this._rifleRecoilRotation);
      this.kickGroup.position.add(pivot).sub(this._rifleRecoilOffset);
      this.kickGroup.rotation.x = -this.kickRotX - raiseTilt;
    }

    // sword swing animation — raise → fast overhand chop → recover
    if (def.kind === 'melee' && this.swingPhase < 1) {
      this.swingPhase = Math.min(1, this.swingPhase + dt / def.fireRate);
      const ph = this.swingPhase;
      if (def.id === 'knife') {
        const strike = ph < 0.34 ? ph / 0.34 : 1 - (ph - 0.34) / 0.66;
        const e = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(strike, 0, 1), 0, 1);
        this.kickGroup.rotation.set(-0.10 + e * 0.28, -0.28 + e * 0.62, 0.10 - e * 0.42);
        this.kickGroup.position.set(
          this.kickPos.x - e * 0.035,
          this.kickPos.y + e * 0.025,
          this.kickPos.z - e * 0.20,
        );
      } else if (def.id === 'sword') {
        const pose = swordSwingPose(ph);
        // Rotate around the wrist in camera space, independent of blade edge roll.
        const mount = this.weaponMount.quaternion;
        const inverse = mount.clone().invert();
        this.kickGroup.quaternion.copy(inverse)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.pitch))
          .multiply(mount);
        const rest = this.armGroup.userData.restGripRotation;
        if (rest) {
          this.armGroup.quaternion.copy(inverse)
            .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.10, 0.08, -0.15)));
          const wrist = inverse.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pose.pitch * 0.75))
            .multiply(mount);
          this.armGroup.quaternion.premultiply(wrist);
        }
        const grip = this.armGroup.position.clone();
        const offset = new THREE.Vector3(pose.x, pose.y, pose.z).applyQuaternion(inverse);
        this.kickGroup.position.copy(grip).sub(grip.clone().applyQuaternion(this.kickGroup.quaternion))
          .add(offset).add(this.kickPos);
      } else if (ph < 0.22) {
        // Lift the hilt and cock the blade back without sweeping across the
        // sightline before the attack begins.
        const w = ph / 0.22;
        const e = w * w * (3 - 2 * w);
        this.kickGroup.rotation.set(-0.22 * e, -0.08 * e, -0.05 * e);
        this.kickGroup.position.set(
          this.kickPos.x + 0.02 * e,
          this.kickPos.y + 0.08 * e,
          this.kickPos.z - 0.08 * e,
        );
      } else if (ph < 0.58) {
        // Drive the sword from above the shoulder down through the target.
        // Pitch owns the motion; small yaw/roll only keep the blade readable.
        const s = (ph - 0.22) / 0.36;
        const e = s * s * (3 - 2 * s);
        this.kickGroup.rotation.set(
          THREE.MathUtils.lerp(-0.22, 1.35, e),
          THREE.MathUtils.lerp(-0.08, 0.10, e),
          THREE.MathUtils.lerp(-0.05, 0.14, e),
        );
        this.kickGroup.position.set(
          this.kickPos.x + THREE.MathUtils.lerp(0.02, -0.10, e),
          this.kickPos.y + THREE.MathUtils.lerp(0.08, -0.22, e),
          this.kickPos.z + THREE.MathUtils.lerp(-0.08, -0.16, e),
        );
      } else {
        // Slower recovery lifts the blade precisely back into its right guard.
        const r = (ph - 0.58) / 0.42;
        const e = r * r * (3 - 2 * r);
        this.kickGroup.rotation.set(
          THREE.MathUtils.lerp(1.35, 0, e),
          THREE.MathUtils.lerp(0.10, 0, e),
          THREE.MathUtils.lerp(0.14, 0, e),
        );
        this.kickGroup.position.set(
          this.kickPos.x + THREE.MathUtils.lerp(-0.10, 0, e),
          this.kickPos.y + THREE.MathUtils.lerp(-0.22, 0, e),
          this.kickPos.z + THREE.MathUtils.lerp(-0.16, 0, e),
        );
      }
    } else if (def.kind === 'melee') {
      if (def.id === 'knife') this.kickGroup.rotation.set(-0.10, -0.28, 0.10);
      else this.kickGroup.rotation.set(0, 0, 0);
    }

    if (def.id === 'sword' && this._inspectTime !== undefined) {
      this._inspectTime += dt;
      const p = Math.min(1, this._inspectTime / 2.2);
      const envelope = Math.sin(Math.PI * p) ** 2;
      this.kickGroup.rotation.set(-.12 * envelope, -.24 * envelope, .28 * envelope);
      this.kickGroup.position.x -= .04 * envelope;
      this.kickGroup.position.y += .06 * envelope;
      if (p === 1) this._inspectTime = undefined;
    }

    // idle breathing / weapon settle — fades out during sprint. Its own smooth
    // clock (not tied to any snappy state).
    this._idleT += dt;
    if (def.kind !== 'melee') {
      const breathTarget=player.reduceMotion||st.isReloading?0:
        (1.0-this._sprintT)*Math.max(0,1-Math.hypot(player.velocity?.x||0,player.velocity?.z||0)/3);
      this._breathWeight=expDamp(this._breathWeight??0,breathTarget,5,dt);
      const breatheAmt = this._breathWeight * adsMotionScale;
      const breathe = Math.sin(this._idleT * 1.6) * 0.004 * breatheAmt;
      const swayB   = Math.cos(this._idleT * 1.1) * 0.003 * breatheAmt;
      this.kickGroup.position.y += breathe;
      this.kickGroup.rotation.z = swayB;

      // Three readable reload beats: lower/roll the rifle, seat the magazine,
      // then snap it back to ready. The whole viewmodel moves as one rigid
      // object, so authored weapon geometry never needs weapon-specific bones.
      if (st.isReloading) {
        const reloadFrameScale = viewmodelReloadScale(this.camera.aspect);
        const p = THREE.MathUtils.clamp(
          1 - st.reloadTimer / Math.max(0.01, def.reloadTime), 0, 1
        );
        const smooth = (x) => x * x * (3 - 2 * x);
        const enter = smooth(THREE.MathUtils.clamp(p / 0.18, 0, 1));
        const exit = 1 - smooth(THREE.MathUtils.clamp((p - 0.74) / 0.26, 0, 1));
        const hold = enter * exit;
        const seat = Math.sin(
          THREE.MathUtils.clamp((p - 0.36) / 0.30, 0, 1) * Math.PI
        );
        this.kickGroup.position.x += hold * 0.075 * reloadFrameScale;
        // The mount below already lowers for reload. Keep this local hand beat
        // compact so the magazine hand remains visible at 60-degree FOV.
        this.kickGroup.position.y -= (hold * 0.08 + seat * 0.015) * reloadFrameScale;
        this.kickGroup.position.z += hold * 0.055 * reloadFrameScale;
        this.kickGroup.rotation.x += (hold * 0.30 + seat * 0.07) * reloadFrameScale;
        this.kickGroup.rotation.y += hold * 0.16 * reloadFrameScale;
        this.kickGroup.rotation.z -= (hold * 0.52 + seat * 0.08) * reloadFrameScale;
      }
    }

    // viewmodel look-sway: smooth the raw mouse delta into a VELOCITY first
    // (normalised by dt so it's framerate-independent, no jitter), then ease
    // the sway offset toward it — two stages of damping = buttery lag.
    const invDt = dt > 1e-4 ? 1 / dt : 0;
    const mvX = THREE.MathUtils.clamp(-input.mouseDX * invDt * 0.000032, -0.06, 0.06);
    const mvY = THREE.MathUtils.clamp(-input.mouseDY * invDt * 0.000032, -0.05, 0.05);
    this._swayVelX = expDamp(this._swayVelX, mvX, 18, dt);
    this._swayVelY = expDamp(this._swayVelY, mvY, 18, dt);
    this._swayX = expDamp(this._swayX, this._swayVelX, 11, dt);
    this._swayY = expDamp(this._swayY, this._swayVelY, 11, dt);
    this.swayGroup.rotation.y = this._swayX * adsMotionScale;
    this.swayGroup.rotation.x = this._swayY * adsMotionScale;
    // Lean against lateral travel, then settle smoothly when movement stops.
    const lateralSpeed=(player.velocity?.x||0)*Math.cos(player.yaw||0)
      -(player.velocity?.z||0)*Math.sin(player.yaw||0);
    const motionScale=player.reduceMotion ? 0 : adsMotionScale;
    const inertia=this._weaponInertia.step({vx:controlsEnabled?(player.velocity?.x||0):0,
      vz:controlsEnabled?(player.velocity?.z||0):0,vy:player.velocity?.y||0,yaw:player.yaw||0,grounded},dt);

    this._strafeBodyRoll=expDamp(this._strafeBodyRoll||0,
      THREE.MathUtils.clamp(-lateralSpeed*0.005,-0.04,0.04)*motionScale,9,dt);
    this._strafeBodyX=expDamp(this._strafeBodyX||0,
      THREE.MathUtils.clamp(-lateralSpeed*0.002,-0.016,0.016)*motionScale,8,dt);


    // The weapon lags behind jumps and settles after landing; ADS damps the
    // motion so the sight remains usable. Velocity drives this, not key state.
    const airPose = jumpAirPose(grounded, player.velocity?.y || 0);
    const verticalLag = airPose.weaponY;
    this._verticalLag = expDamp(this._verticalLag ?? 0, verticalLag, 10, dt);
    this.swayGroup.position.y = this._verticalLag * adsMotionScale;
    this.swayGroup.rotation.x += airPose.weaponPitch * adsMotionScale;

    // Distance-driven steps use the same stride lengths as player footsteps.
    // The recording shows a steady low carry, with less vertical bounce in sprint.
    const moveSpeed = controlsEnabled ? Math.hypot(player.velocity?.x || 0, player.velocity?.z || 0) : 0;
    const stepping = player.onGround && !player.isSliding && moveSpeed > 0.5;
    const stepLength = player.isCrouching ? 1.2 : sprinting ? 2.35 : 2.0;
    // Camera, footsteps and held weapon share the resolved-travel clock.
    if (stepping) this._bobPhase = Number.isFinite(player.bobTime)
      ? player.bobTime * (player.isCrouching ? 1 : .8)
      : this._bobPhase + moveSpeed * dt / stepLength * Math.PI * (player.isCrouching ? 1 : .8);
    const bobAmtTarget = stepping && !player.reduceMotion
      ? (sprinting ? 0.006 : player.isCrouching ? 0.004 : 0.007)
        * Math.min(1, moveSpeed / 3) * adsMotionScale : 0;
    this._bobAmt = expDamp(this._bobAmt ?? 0, bobAmtTarget, 8, dt);
    const bobV = Math.sin(this._bobPhase * 2) * this._bobAmt * adsMotionScale;
    const bobH = Math.sin(this._bobPhase) * this._bobAmt * 0.45 * adsMotionScale;
    const targetPose=firstPersonBodyPose(inertia,this._bobPhase,this._bobAmt/.007,motionScale*THREE.MathUtils.clamp((115-this.camera.fov)/37,.12,1),this._sprintT);
    // A broad shoulder arc, with a small vertical rise rather than a sharp shake.
    const visibleStride=THREE.MathUtils.clamp(this._bobAmt/.007,0,1)*motionScale;
    const runWeight=1+this._sprintT*.3;
    targetPose.x+=Math.sin(this._bobPhase)*.005*visibleStride*runWeight;
    targetPose.y+=Math.sin(this._bobPhase*2)*.004*visibleStride*runWeight;
    targetPose.pitch+=Math.sin(this._bobPhase*2)*.004*visibleStride*runWeight;
    targetPose.roll+=Math.sin(this._bobPhase)*.009*visibleStride*runWeight;
    // Filter the complete pose so network travel corrections cannot snap the gun.
    const bodyPose=this._smoothGaitPose??={x:0,y:0,z:0,pitch:0,yaw:0,roll:0};
    for(const key of Object.keys(bodyPose)) bodyPose[key]=motionScale===0?0:expDamp(bodyPose[key],targetPose[key],9,dt);
    this.swayGroup.position.x=this._strafeBodyX+bodyPose.x;
    this.swayGroup.position.y+=bodyPose.y;
    this.swayGroup.position.z=bodyPose.z;
    this.swayGroup.rotation.x+=bodyPose.pitch;
    this.swayGroup.rotation.y+=bodyPose.yaw;
    this.swayGroup.rotation.z=this._strafeBodyRoll+bodyPose.roll;
    const stanceTarget=player.isCrouching?1:0;
    this._stanceFollow=expDamp(this._stanceFollow??stanceTarget,stanceTarget,9,dt);
    this._stanceSettle=expDamp(this._stanceSettle??0,stanceTarget-this._stanceFollow,15,dt);
    this.swayGroup.position.y+=this._stanceSettle*.025*motionScale;
    this.swayGroup.rotation.x+=this._stanceSettle*.04*motionScale;

    // Reload: the gun comes down and rolls over so the mag well faces you, with
    // a jolt as the bolt goes home. Reading the reload's OWN timer rather than
    // starting another one keeps this in step with the audio and with the
    // third-person body, which animates the same reload from the same number.
    // Without it the first-person view did nothing at all through a reload —
    // just the HUD counter and a sound.
    const rTime = def.reloadTime || 0;
    const reloadP = (st.isReloading && rTime > 0)
      ? THREE.MathUtils.clamp(1 - st.reloadTimer / rTime, 0, 1) : 0;
    const rBell = reloadP > 0 ? Math.sin(Math.PI * reloadP) : 0;
    const rack  = reloadP > 0 ? Math.exp(-Math.pow((reloadP - 0.62) / 0.055, 2)) : 0;
    const reloadFrameScale = viewmodelReloadScale(this.camera.aspect);
    const adsClearance = 1 - this.scopeT;
    const framedBell = rBell * reloadFrameScale * adsClearance;
    const framedRack = rack * reloadFrameScale * adsClearance;

    // ADS + sprint blends → SMOOTHED mount target, then eased (no snap on
    // start/stop sprint or scope in/out).
    const aspectScale  = viewmodelAspectScale(this.camera.aspect);
    const firearmCarry = def.kind !== 'melee';
    const swordGuard   = def.id === 'sword';
    const adsEase      = this.scopeT * this.scopeT * (3 - 2 * this.scopeT);
    // A moving shot is a combat pose, not a full sprint carry. Leave a small
    // amount of bob/cant so speed still reads, while keeping both hands and
    // the muzzle in a usable firing lane.
    const sprintCarry = this._sprintT * (1 - adsEase) * (1 - (firearmCarry ? 1 : .70) * this._movingFireT);
    const carryTargets = this._carryTargets ||= [0, 1].map(() => ({
      position: new THREE.Vector3(), rotation: new THREE.Vector3(),
    }));
    const activeViewmodelScale = swordGuard
      ? MELEE_VIEWMODEL_SCALE
      : firearmViewmodelScale(def, this.camera.aspect) * THREE.MathUtils.lerp(1, 0.78, adsEase);
    this.weaponMount.scale.setScalar(activeViewmodelScale);
    // Resolve ready and running holds separately. Correcting aim on a partly
    // turned carry used to swing the receiver left, then back across the screen.
    const resolveCarryTarget = (running, target) => {
      if (swordGuard) {
        target.position.set(
          SWORD_VIEWMODEL_X * THREE.MathUtils.clamp(aspectScale, .26, 1.08) - running * .025 * aspectScale,
          SWORD_VIEWMODEL_Y - running * .075,
          SWORD_VIEWMODEL_Z - running * .025,
        );
        target.rotation.set(
          SWORD_VIEWMODEL_PITCH - running * .055 + landPulse * .05,
          SWORD_VIEWMODEL_YAW + running * .025,
          SWORD_VIEWMODEL_ROLL - running * .06,
        );
      } else {
        this._framing ||= new ViewmodelFraming();
        this._framing.resolve(def.id, this.models.get(def.id), this.camera, activeViewmodelScale, running > .5, target);
        const sight = this.models.get(def.id)?.sight;
        this._adsFramingPosition ||= new THREE.Vector3();
        this._adsFramingPosition.set(
          sight ? -sight.x * activeViewmodelScale : 0,
          (sight ? -sight.y * activeViewmodelScale : 0) + ADS_SIGHT_Y,
          ADS_SIGHT_DEPTH + (sight?.depthOffset || 0) * activeViewmodelScale - (sight ? sight.z * activeViewmodelScale : 0),
        );
        target.position.lerp(this._adsFramingPosition, adsEase);
        target.rotation.multiplyScalar(1 - adsEase);
        target.rotation.x += .50 * framedBell + .14 * framedRack + landPulse * .12 * adsClearance + bobV * .35;
        target.rotation.z += .42 * framedBell + bobH * .25;
      }
      target.position.x += (bobH + .05 * framedBell) * aspectScale;
      target.position.y += bobV - .07 * framedBell - .015 * framedRack - landPulse * .055 * adsClearance;
    };
    resolveCarryTarget(firearmCarry ? 0 : sprintCarry, carryTargets[0]);
    resolveCarryTarget(1, carryTargets[1]);
    for (const axis of ['x', 'y', 'z']) {
      this._mountPos[axis] = expDamp(this._mountPos[axis], carryTargets[0].position[axis], axis === 'y' ? 22 : 20, dt);
      this._mountRot[axis] = expDamp(this._mountRot[axis], carryTargets[0].rotation[axis], 17, dt);
    }
    // The shared transform keeps gun and grip contacts together throughout the blend.
    this.weaponMount.position.set(this._mountPos.x, this._mountPos.y, this._mountPos.z);
    this.weaponMount.rotation.x = this._mountRot.x;
    this.weaponMount.rotation.y = this._mountRot.y;
    this.weaponMount.rotation.z = this._mountRot.z;

    // Keep the rendered bore on the reticle in this separate camera layer.
    // World hit distance must not tilt the hold as we look up at a ceiling;
    // actual shots still use their world hit point in _fire/updateEffects.
    // Aim the ready endpoint before blending the complete transform toward
    // the running endpoint. One carry weight drives position and rotation.
    // Firing still brings the bore onto the reticle on the very first shot.
    // ADS retains a low sight picture, so its bore also needs convergence.
    // Keep correction active throughout aiming in/out, not only hip fire.
    this._alignViewmodelAim(st.isReloading ? 0 : 1);
    if (firearmCarry && !input.mouseDown && sprintCarry > .00001) {
      const carryWeight = THREE.MathUtils.smoothstep(sprintCarry, 0, 1);
      this._carryRotation ||= new THREE.Quaternion();
      this._carryEuler ||= new THREE.Euler();
      this._carryEuler.set(carryTargets[1].rotation.x, carryTargets[1].rotation.y, carryTargets[1].rotation.z);
      this._carryRotation.setFromEuler(this._carryEuler);
      this.weaponMount.position.lerp(carryTargets[1].position, carryWeight);
      this.weaponMount.quaternion.slerp(this._carryRotation, carryWeight);
      this._viewmodelAim.ensureClearance(this.camera, this.weaponMount, this.models.get(def.id));
    }
    this._alignSupportArmToShoulder();
    this.updateEffects(dt, world, botManager);

    // skin animations (only on the currently visible weapon)
    this.animTime += dt;
    const activeGroup = this.models.get(def.id).group;
    // Per-weapon skin takes priority over the global skin
    const perSkin = this._armoryMap?.get(def.id)?.skin;
    const activeSkin = perSkin || (def.kind === 'melee' ? this.swordSkin : this.weaponSkin);
    if (activeSkin?.animated) {
      // Route by catalog shape: the sword wears the shared gun catalog
      // (body/accent/energy roles) — only legacy entries carry .blade.
      if (activeSkin.blade !== undefined) animateSwordSkin(activeGroup, activeSkin, this.animTime);
      else                                animateWeaponSkin(activeGroup, activeSkin, this.animTime);
    }
  }

  // World effects keep advancing while the menu blocks local weapon input.
  updateEffects(dt, world, botManager) {
    // muzzle flash decay
    if (this._flashTimer !== undefined && this._flashTimer > 0) {
      // Keep a new flash for its first rendered frame, even when a frame takes
      // longer than FLASH_LIFE (30 Hz used to erase it before it was shown).
      if (this._flashFresh) this._flashFresh = false;
      else this._flashTimer -= dt;
      const t = Math.max(0, this._flashTimer / FLASH_LIFE);
      this.flashLight.intensity = t * 8;
      this._flashMeshes.forEach((m) => { m.material.opacity = t * 0.92; });
      if (t === 0) {
        this._flashMeshes.forEach((m) => m.parent?.remove(m));
      }
    }

    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      // Shots are spawned before effects update in the same frame. Present the
      // first segment at the muzzle once before advancing it downrange.
      if (tr.fresh) {
        // Firing precedes the recoil/hold pose update. Start a local shot at
        // the muzzle actually rendered this frame, then let it fly freely.
        if (tr.muzzle) {
          tr.muzzle.getWorldPosition(tr.from);
          this._projectMuzzleBeforeTarget(tr.from, tr.to);
          tr.direction.subVectors(tr.to, tr.from);
          tr.distance = tr.direction.length();
          tr.direction.normalize();
          tr.trailLength = tr.laserBeam ? tr.distance : Math.min(TRACER_LENGTH, tr.distance);
          tr.mesh.position.copy(tr.from);
          tr.mesh.scale.z = tr.trailLength;
          tr.mesh.lookAt(tr.to);
          tr.muzzle = null;
        }
        tr.fresh = false;
        continue;
      }
      if (tr.laserBeam) {
        tr.endAge += dt;
        tr.mesh.material.opacity = Math.max(0, 1 - tr.endAge / 0.18);
        if (tr.endAge >= 0.18) {
          this.scene.remove(tr.mesh);
          tr.mesh.geometry.dispose();
          tr.mesh.material.dispose();
          this.tracers.splice(i, 1);
        }
        continue;
      }
      tr.travelled += tr.speed * dt;
      const progress = Math.min(tr.distance, tr.travelled);
      // A bullet stays compact at every frame rate. Stretching by speed * dt
      // turned the same round into an eight-metre beam on a 30 Hz device.
      const tail = Math.max(0, progress - tr.trailLength);
      const head = Math.min(tr.distance, Math.max(tr.trailLength, progress));
      const visibleLength = Math.max(0.001, head - tail);
      tr.mesh.position.copy(tr.from).addScaledVector(tr.direction, tail);
      tr.mesh.scale.z = visibleLength;
      if (tr.travelled >= tr.distance) tr.endAge += dt;
      tr.fade = Math.max(0, 1 - tr.endAge / TRACER_END_FADE);
      tr.mesh.material.opacity = tr.fade * TRACER_OPACITY;
      if (tr.fade <= 0) {
        this.scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        tr.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    // rockets + explosions + ejected shells + thrown knives
    this._updateRockets(dt, world, botManager);
    this._updateThrownKnives(dt, world, botManager);
    this._updateExplosions(dt);
    this._updateShells(dt);
    this._updateMuzzleSmoke(dt);
    this._updateAnimeSparkles(dt);
    this._updateFireEmbers(dt);

  }

  getHudInfo() {
    const def = this.currentDef;
    const st = this.currentState;
    const spreadMin = def.spreadMin ?? def.spread ?? 0;
    const spreadMax = def.spreadMax ?? def.spread ?? spreadMin;
    const spreadSpan = Math.max(1e-6, spreadMax - spreadMin);
    const info = this._hudInfo ||= {};
    if (this._hudSlotsLoadout !== this.loadout) {
      this._hudSlotsLoadout = this.loadout;
      let gunSlot = 1;
      this._hudSlots = this.loadout.map((w) => ({
        key: w.kind === 'melee' ? 'Z' : (gunSlot <= 10 ? String(gunSlot++ % 10) : (gunSlot++, '↕')),
        id: w.id,
        name: w.name,
        isMelee: w.kind === 'melee',
        infiniteReserve: !!w.infiniteReserve,
      }));
    }
    this._hudSlots.forEach((slot) => {
      const slotState = this.state.get(slot.id);
      slot.magAmmo = slotState?.magAmmo ?? 0;
      slot.reserveAmmo = slotState?.reserveAmmo ?? 0;
    });
    info.infiniteReserve = !!def.infiniteReserve;
    info.name = def.name;
    info.isMelee = def.kind === 'melee';
    info.magAmmo = st.magAmmo;
    info.reserveAmmo = st.reserveAmmo;
    info.isReloading = st.isReloading;
    info.reloadProgress = st.isReloading
      ? THREE.MathUtils.clamp(1 - st.reloadTimer / Math.max(0.01, def.reloadTime), 0, 1)
      : 0;
    info.reloadRemaining = Math.max(0, st.reloadTimer);
    info.reloadDuration = def.reloadTime || 0;
    info.aiming = this.scopeT;
    info.spreadRatio = spreadMax > spreadMin
      ? THREE.MathUtils.clamp((this._shotBloom - spreadMin) / spreadSpan, 0, 1)
      : 0;
    info.currentIndex = this.currentIndex;
    info.slots = this._hudSlots;
    return info;
  }
}

