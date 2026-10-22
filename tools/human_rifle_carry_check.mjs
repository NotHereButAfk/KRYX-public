import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetKyxLocomotionClips } from '../src/player/HumanSoldier.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createHumanActionPose, sampleHumanActionPose } from '../src/player/HumanActionMotion.js';
import {
  applyHumanRifleCarry,
  humanHandContacts,
  HUMAN_GRIP_LOCAL,
  HUMAN_HANDGUARD_LOCAL,
  HUMAN_LOW_READY_AIM,
  HUMAN_MAG_LOCAL,
  humanWeaponScale,
} from '../src/player/HumanRifleCarry.js';

// WeaponModels builds canvas-backed detail textures at module load. Node has
// no DOM, so provide an inert 2D surface before importing the production gun
// builders. This test must exercise the same full meshes the browser displays.
const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = new Proxy({}, {
  get(target, key) {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
    if (key === 'measureText') return () => ({ width: 10 });
    return target[key] ?? (target[key] = noop);
  },
  set(target, key, value) { target[key] = value; return true; },
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context2d }),
};

const { buildWeaponModel, preloadWeaponModels, onWeaponModelsReady } = await import('../src/weapons/WeaponModels.js');
const { WEAPONS } = await import('../src/weapons/weaponDefs.js');

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const smoothstep = (value) => {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const findBone = (root, name) => (
  root.getObjectByName(`mixamorig:${name}`)
  || root.getObjectByName(`mixamorig${name}`)
  || root.getObjectByName(name)
);
const worldPosition = (object) => object.getWorldPosition(new THREE.Vector3());

function roundedVolumePenetration(point, centre, radii) {
  const dx = (point.x - centre.x) / radii.x;
  const dy = (point.y - centre.y) / radii.y;
  const dz = (point.z - centre.z) / radii.z;
  const q = Math.hypot(dx, dy, dz);
  return q < 1 ? (1 - q) * Math.min(radii.x, radii.y, radii.z) : 0;
}

function sampleWeaponGeometry(weapon, sample) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const mid = new THREE.Vector3();
  weapon.traverse((mesh) => {
    const position = mesh.isMesh && mesh.geometry?.attributes?.position;
    if (!position) return;
    const index = mesh.geometry.index;
    const read = (vertex, out) => out.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) sample(read(i, a));
    // Vertices alone miss a broad stock whose corners all sit outside a rounded
    // shoulder while its faces pass through it. Sample triangle centres and
    // edge midpoints so a box cannot hide that penetration.
    const triangleIndices = index ? index.count : position.count;
    for (let i = 0; i + 2 < triangleIndices; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      read(ia, a); read(ib, b); read(ic, c);
      sample(mid.copy(a).add(b).add(c).multiplyScalar(1 / 3));
      sample(mid.copy(a).add(b).multiplyScalar(0.5));
      sample(mid.copy(b).add(c).multiplyScalar(0.5));
      sample(mid.copy(c).add(a).multiplyScalar(0.5));
    }
  });
}

function weaponSurfaceDistance(weapon, worldPoint) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  let nearest = Infinity;
  weapon.traverse((mesh) => {
    const position = mesh.isMesh && mesh.geometry?.attributes?.position;
    if (!position) return;
    const index = mesh.geometry.index;
    const triangleIndices = index ? index.count : position.count;
    const read = (vertex, out) => out.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i + 2 < triangleIndices; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      triangle.set(read(ia, a), read(ib, b), read(ic, c));
      triangle.closestPointToPoint(worldPoint, closest);
      const distance = closest.distanceTo(worldPoint);
      if (Number.isFinite(distance)) nearest = Math.min(nearest, distance);
    }
  });
  return nearest;
}

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

// Load exactly the production assets, including Blender overrides and pickup
// models. Testing only procedural fallbacks can hide a detached hand on the
// model that actually appears after loading completes.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (path, onLoad, _progress, onError) {
  try {
    const bytes = fs.readFileSync(new URL(`../public${path}`, import.meta.url));
    const data = path.endsWith('.gltf') ? bytes.toString('utf8')
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.register(() => ({
      name: 'GeometryProbeTextures', loadTexture: () => Promise.resolve(new THREE.Texture()),
    })).parse(data, '', onLoad, onError);
  } catch (error) { onError?.(error); }
};
await new Promise(resolve => { onWeaponModelsReady(resolve); preloadWeaponModels(); });
GLTFLoader.prototype.load = originalLoad;

const bytes = fs.readFileSync(new URL('../public/kyx-player.glb', import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(buffer, '', resolve, reject);
});
const AUTHORED_KYX = !!gltf.scene.getObjectByName('KYX_HelmetShell');
const motionBytes = fs.readFileSync(new URL('../public/kyx-locomotion.glb', import.meta.url));
const motionGltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
  motionBytes.buffer.slice(motionBytes.byteOffset, motionBytes.byteOffset + motionBytes.byteLength),
  '', resolve, reject,
));
const clips = Object.fromEntries(
  retargetKyxLocomotionClips(motionGltf.animations).map((clip) => [clip.name, clip]),
);
for (const name of ['Idle', 'Walk', 'Run']) {
  assert(clips[name], `kyx-locomotion.glb is missing its ${name} clip`);
}

// Exercise the carry against frames that put the shoulders in materially
// different places. Reload samples cover hand departure, magazine seat, rack,
// and recovery; a single idle-frame fixture would miss reach failures caused
// by locomotion.
const CASES = [
  { name: 'low-ready',       clip: 'Idle', phase: 0.13, aim: HUMAN_LOW_READY_AIM,
    lowReady: true },
  { name: 'aim',             clip: 'Idle', phase: 0.47, aim: 1.00 },
  { name: 'walk + aim',      clip: 'Walk', phase: 0.31, aim: 0.72, sway: 0.03 },
  { name: 'run + aim',       clip: 'Run',  phase: 0.69, aim: 0.62, sway: -0.03 },
  { name: 'sprint tuck',     clip: 'Run',  phase: 0.18, aim: 0.00, sprint: 1.00, sway: 0.03 },
  { name: 'reload depart',   clip: 'Idle', phase: 0.21, aim: 0.35, reload: 0.28 },
  { name: 'reload seat',     clip: 'Idle', phase: 0.52, aim: 0.35, reload: 0.48 },
  { name: 'walk reload',     clip: 'Walk', phase: 0.63, aim: 0.20, reload: 0.60, sway: -0.03 },
  { name: 'reload rack',     clip: 'Idle', phase: 0.78, aim: 0.35, reload: 0.72 },
  { name: 'reload recover',  clip: 'Idle', phase: 0.38, aim: 0.35, reload: 0.88 },
  { name: 'aim up',          clip: 'Idle', phase: 0.33, aim: 1.00, pitch:  0.65 },
  { name: 'aim down',        clip: 'Idle', phase: 0.33, aim: 1.00, pitch: -0.65 },
];

const ARMORS = {
  assault: { scale: 1.00, spineLean:  0.00, headPitch:  0.00 },
  recon:   { scale: 0.97, spineLean: -0.04, headPitch: -0.06 },
  heavy:   { scale: 1.09, spineLean:  0.11, headPitch:  0.05 },
  stealth: { scale: 0.95, spineLean:  0.13, headPitch:  0.09 },
};

const actionPose = createHumanActionPose();
const actionEuler = new THREE.Euler();
const actionQuat = new THREE.Quaternion();
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);

function expectedSupportLocal(reload) {
  const support = HUMAN_HANDGUARD_LOCAL.clone();
  if (reload > 0) {
    const inT = smoothstep(reload / 0.28);
    const outT = smoothstep((reload - 0.74) / 0.26);
    support.lerp(HUMAN_MAG_LOCAL, inT * (1 - outT));
  }
  return support;
}

function applyProductionTorsoLayers(rig, armor, reload, swap = 0) {
  for (const [bone, angle] of [
    [rig.spine, -0.15], [rig.s1, -0.15], [rig.s2, -0.09],
    [rig.neck, -0.18], [rig.head, 0.07],
  ]) bone?.quaternion.multiply(actionQuat.setFromAxisAngle(axisX, angle));
  rig.s1?.quaternion.multiply(actionQuat.setFromAxisAngle(axisX, armor.spineLean));
  rig.head?.quaternion.multiply(actionQuat.setFromAxisAngle(axisX, armor.headPitch));
  // These are the gun-specific layers applied immediately before
  // applyHumanRifleCarry() in HumanSoldier's armorTick.
  rig.s1?.quaternion.multiply(actionQuat.setFromAxisAngle(axisY, 0.10));
  rig.spine?.quaternion.multiply(actionQuat.setFromAxisAngle(axisX, 0.03));
  rig.lClav?.quaternion.multiply(actionQuat.setFromAxisAngle(axisX, -0.55));
  sampleHumanActionPose({ reload, swap }, actionPose);
  if (rig.spine && (actionPose.torsoX || actionPose.torsoZ)) {
    rig.spine.quaternion.multiply(actionQuat.setFromEuler(
      actionEuler.set(actionPose.torsoX, 0, actionPose.torsoZ)
    ));
  }
}

function measure(spec, armorName, armor, def) {
  const root = cloneSkeleton(gltf.scene);
  root.scale.setScalar(armor.scale);
  const body = new THREE.Group();
  const weapon = buildWeaponModel(def, { procedural: true }).group;
  weapon.scale.setScalar(humanWeaponScale(def.id));
  body.add(root, weapon);

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clips[spec.clip]);
  action.play();
  mixer.setTime(clips[spec.clip].duration * spec.phase);

  const rig = {
    spine: findBone(root, 'Spine'),
    s1: findBone(root, 'Spine1'),
    s2: findBone(root, 'Spine2'),
    neck: findBone(root, 'Neck'),
    head: findBone(root, 'Head'),
    lClav: findBone(root, 'LeftShoulder'),
    rClav: findBone(root, 'RightShoulder'),
    lArm: findBone(root, 'LeftArm'),
    rArm: findBone(root, 'RightArm'),
    lFore: findBone(root, 'LeftForeArm'),
    rFore: findBone(root, 'RightForeArm'),
    lHand: findBone(root, 'LeftHand'),
    rHand: findBone(root, 'RightHand'),
  };
  for (const name of ['spine', 's1', 'lArm', 'rArm', 'lFore', 'rFore', 'lHand', 'rHand']) {
    assert(rig[name], `kyx-player.glb is missing ${name}`);
  }

  applyProductionTorsoLayers(rig, armor, spec.reload || 0, spec.swap || 0);
  body.updateMatrixWorld(true);
  const leftReach = worldPosition(rig.lArm).distanceTo(worldPosition(rig.lFore))
    + worldPosition(rig.lFore).distanceTo(worldPosition(rig.lHand));
  const rightReach = worldPosition(rig.rArm).distanceTo(worldPosition(rig.rFore))
    + worldPosition(rig.rFore).distanceTo(worldPosition(rig.rHand));

  applyHumanRifleCarry(body, rig, weapon, spec);
  body.updateMatrixWorld(true);
  const rightTarget = humanHandContacts(weapon).trigger.clone().applyMatrix4(weapon.matrixWorld);
  const leftTarget = (
    weapon.userData.humanSupportLocal?.clone()
    || expectedSupportLocal(spec.reload || 0)
  ).applyMatrix4(weapon.matrixWorld);
  const leftShoulderDistance = worldPosition(rig.lArm).distanceTo(leftTarget);
  const rightShoulderDistance = worldPosition(rig.rArm).distanceTo(rightTarget);
  const muzzle = new THREE.Vector3(0, 0, -1).applyQuaternion(
    weapon.getWorldQuaternion(new THREE.Quaternion())
  );
  const muzzlePitch = Math.asin(THREE.MathUtils.clamp(muzzle.y, -1, 1));
  const leftShoulder = worldPosition(rig.lArm);
  const rightShoulder = worldPosition(rig.rArm);
  const shoulderMid = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const receiver = weapon.getWorldPosition(new THREE.Vector3());
  body.worldToLocal(leftShoulder);
  body.worldToLocal(rightShoulder);
  body.worldToLocal(shoulderMid);
  body.worldToLocal(receiver);

  // Check the complete gun mesh, not only its origin. These volumes follow the
  // live skeleton and deliberately include the armored shoulder pocket. A
  // stock may touch that pocket, but it may not pass through it or the chest.
  // The KYX GLB's shoulder bone sits near the deltoid centre and its compact
  // armor shell is ~7cm deep. The legacy Soldier rig used a much broader
  // synthetic 12.5cm pocket; applying that volume to KYX falsely labels a
  // correctly seated stock as being 5-8cm inside the body.
  const shoulderRadius = (AUTHORED_KYX ? 0.045 : 0.125) * armor.scale;
  const torsoCentre = shoulderMid.clone().add(
    new THREE.Vector3(0, -0.205 * armor.scale, 0.018)
  );
  const torsoRadii = new THREE.Vector3(
    Math.max(0.145 * armor.scale, Math.abs(rightShoulder.x - leftShoulder.x) * 0.47),
    0.275 * armor.scale,
    0.125 * armor.scale,
  );
  let torsoPenetration = 0;
  let shoulderPenetration = 0;
  sampleWeaponGeometry(weapon, (worldPoint) => {
    const point = body.worldToLocal(worldPoint.clone());
    torsoPenetration = Math.max(
      torsoPenetration,
      roundedVolumePenetration(point, torsoCentre, torsoRadii),
    );
    for (const shoulder of [leftShoulder, rightShoulder]) {
      const penetration = shoulderRadius - point.distanceTo(shoulder);
      shoulderPenetration = Math.max(shoulderPenetration, penetration);
    }
  });

  return {
    name: `${def.id} ${armorName} ${spec.name}`,
    reload: spec.reload || 0,
    supportLocal: weapon.userData.humanSupportLocal?.toArray(),
    rightError: worldPosition(rig.rHand).distanceTo(rightTarget),
    leftError: worldPosition(rig.lHand).distanceTo(leftTarget),
    rightReach,
    leftReach,
    rightShoulderDistance,
    leftShoulderDistance,
    requestedPitch: spec.pitch || 0,
    muzzlePitch,
    carryFamily: weapon.userData.humanCarryFamily,
    lowReady: spec.lowReady === true,
    receiverBelowShoulders: shoulderMid.y - receiver.y,
    receiverRightOfShoulders: receiver.x - shoulderMid.x,
    receiverAheadOfShoulders: shoulderMid.z - receiver.z,
    shoulderHalfWidth: Math.abs(rightShoulder.x - leftShoulder.x) * 0.5,
    torsoPenetration: Math.max(0, torsoPenetration),
    shoulderPenetration: Math.max(0, shoulderPenetration),
    rightSurfaceDistance: weaponSurfaceDistance(weapon, rightTarget),
    leftSurfaceDistance: weaponSurfaceDistance(weapon, leftTarget),
  };
}

const firearms = WEAPONS.filter((def) => def.kind !== 'melee');
// The Blender-authored KYX character is the default Vanguard silhouette. The
// other legacy Soldier scale variants are not constructed from this GLB.
const activeArmors = AUTHORED_KYX ? { assault: ARMORS.assault } : ARMORS;
const results = firearms.flatMap((def) => Object.entries(activeArmors).flatMap(([name, armor]) =>
  CASES.map((spec) => measure(spec, name, armor, def))
));
if (process.env.KYX_CARRY_REPORT) fs.writeFileSync(process.env.KYX_CARRY_REPORT, JSON.stringify(results, null, 2));
const EXPECTED_CARRY_FAMILY = Object.freeze({
  sidearm: 'pistol', magnum: 'pistol',
  uzi: 'compact', needler: 'compact', plasmarifle: 'compact',
  levershotgun: 'shotgun', energyshotgun: 'shotgun',
  m4: 'rifle', m16: 'rifle', rifle: 'rifle',
  lmg: 'support',
  boltsniper: 'precision', battlerifle: 'precision', dmr: 'precision',
  rpg: 'launcher', fuelrod: 'launcher', concussion: 'launcher',
});
for (const def of firearms) {
  const families = new Set(results
    .filter((result) => result.name.startsWith(`${def.id} `))
    .map((result) => result.carryFamily));
  assert(families.size === 1 && families.has(EXPECTED_CARRY_FAMILY[def.id]),
    `${def.id} does not use its required soldier carry family (`
      + `${[...families].join(', ') || 'missing'})`);
}
const MAX_GRIP_ERROR = 0.008;
const MAX_MESH_PENETRATION = 0.004;
// Mixamo hand bones sit at the wrist, not at the palm/finger contact patch.
// An adult wrist-to-fingertip span is roughly 18cm, so this proves some part of
// the actual hand can close on the mesh rather than treating the wrist as a
// zero-size point that must live inside the gun.
const MAX_GRIP_SURFACE_DISTANCE = 0.18;
const MAX_REACH_FRACTION = 0.9951;
const MIN_LOW_READY_DROP = 0.060;
const MIN_LOW_READY_FORWARD = 0.150;
const MIN_LATERAL_SHOULDER_RATIO = 1.00;
const LOW_READY_PITCH_RANGE = Object.freeze({
  pistol: [3, 18],
  compact: [15, 30],
  shotgun: [22, 38],
  rifle: [22, 38],
  support: [14, 28],
  precision: [18, 34],
  launcher: [3, 20],
});
let failures = 0;
const failedResults = [];
for (const result of results) {
  const rightOk = result.rightError <= MAX_GRIP_ERROR;
  const leftOk = result.leftError <= MAX_GRIP_ERROR;
  const leftReachOk = result.leftShoulderDistance <= result.leftReach * MAX_REACH_FRACTION;
  const rightReachOk = result.rightShoulderDistance <= result.rightReach * MAX_REACH_FRACTION;
  const pitchOk = Math.abs(result.requestedPitch) < 0.01
    || (Math.sign(result.muzzlePitch) === Math.sign(result.requestedPitch)
        && Math.abs(result.muzzlePitch) > 0.25);
  // This is the regression that put the receiver/stock through the face: wrist
  // IK could still be numerically perfect while the whole weapon sat above the
  // real Soldier's shoulders. The production idle pose must remain low-ready.
  const minimumDrop = result.carryFamily === 'pistol' ? 0.02
    : result.carryFamily === 'launcher' ? -0.02 : MIN_LOW_READY_DROP;
  const heightOk = !result.lowReady || result.receiverBelowShoulders >= minimumDrop;
  // Guard the actual loaded Soldier path, not only the procedural fallback:
  // idle must visibly carry muzzle-down instead of looking almost ADS.
  const [minPitch, maxPitch] = LOW_READY_PITCH_RANGE[result.carryFamily]
    || LOW_READY_PITCH_RANGE.rifle;
  const soldierCarryOk = !result.lowReady
    || (result.muzzlePitch < -THREE.MathUtils.degToRad(minPitch)
      && result.muzzlePitch > -THREE.MathUtils.degToRad(maxPitch));
  // Keep the receiver outside the torso silhouette, at or beyond the right
  // shoulder line. A forward-only offset can be physically clear yet still
  // look embedded from the normal rear camera, which was the reported defect.
  const minimumRight = result.carryFamily === 'pistol'
    ? 0.04 : result.shoulderHalfWidth * MIN_LATERAL_SHOULDER_RATIO;
  const bodyClearOk = result.receiverRightOfShoulders >= minimumRight
    && (!result.lowReady || result.receiverAheadOfShoulders >= MIN_LOW_READY_FORWARD);
  const meshClearOk = result.torsoPenetration <= MAX_MESH_PENETRATION
    && result.shoulderPenetration <= MAX_MESH_PENETRATION;
  const surfaceContactOk = result.rightSurfaceDistance <= MAX_GRIP_SURFACE_DISTANCE
    && result.leftSurfaceDistance <= (result.reload > 0 ? MAX_GRIP_SURFACE_DISTANCE : 0.04);
  const ok = rightOk && leftOk && leftReachOk && rightReachOk && pitchOk
    && heightOk && soldierCarryOk && bodyClearOk && meshClearOk && surfaceContactOk;
  if (!ok) { failures++; failedResults.push(result); }
}

console.log('real Soldier full-arsenal carry (centimetres)');
for (const def of firearms) {
  const weaponResults = results.filter((result) => result.name.startsWith(`${def.id} `));
  const weaponFailed = failedResults.some((result) => result.name.startsWith(`${def.id} `));
  const max = (key) => Math.max(...weaponResults.map((result) => result[key]));
  console.log(
    `  ${weaponFailed ? 'FAIL' : 'ok  '} ${def.id.padEnd(15)} ${String(weaponResults.length).padStart(2)} poses `
    + `hands R${(max('rightError') * 100).toFixed(2)}`
    + `/L${(max('leftError') * 100).toFixed(2)}cm `
    + `surface R${(max('rightSurfaceDistance') * 100).toFixed(1)}`
    + `/L${(max('leftSurfaceDistance') * 100).toFixed(1)}cm `
    + `mesh T${(max('torsoPenetration') * 100).toFixed(1)}`
    + `/S${(max('shoulderPenetration') * 100).toFixed(1)}cm`
  );
}
for (const result of failedResults) {
  console.error(
    `FAIL ${result.name}: hands R${(result.rightError * 100).toFixed(2)}`
    + `/L${(result.leftError * 100).toFixed(2)}cm, `
    + `surface R${(result.rightSurfaceDistance * 100).toFixed(1)}`
    + `/L${(result.leftSurfaceDistance * 100).toFixed(1)}cm, `
    + `mesh T${(result.torsoPenetration * 100).toFixed(1)}`
    + `/S${(result.shoulderPenetration * 100).toFixed(1)}cm, `
    + `${result.carryFamily} pitch=${THREE.MathUtils.radToDeg(result.muzzlePitch).toFixed(1)}deg `
    + `drop=${(result.receiverBelowShoulders * 100).toFixed(1)}cm `
    + `right=${(result.receiverRightOfShoulders * 100).toFixed(1)}cm `
    + `ahead=${(result.receiverAheadOfShoulders * 100).toFixed(1)}cm`
  );
}

const worstRight = Math.max(...results.map((result) => result.rightError));
const worstLeft = Math.max(...results.map((result) => result.leftError));
const leastReceiverRight = Math.min(...results.map((result) => result.receiverRightOfShoulders));
const leastReceiverAhead = Math.min(...results.map((result) => result.receiverAheadOfShoulders));
const leastShoulderRatio = Math.min(...results.map(
  (result) => result.receiverRightOfShoulders / Math.max(0.001, result.shoulderHalfWidth)
));
const worstTorsoPenetration = Math.max(...results.map((result) => result.torsoPenetration));
const worstShoulderPenetration = Math.max(...results.map((result) => result.shoulderPenetration));
if (failures) {
  console.error(`\n${failures} rifle carry state(s) failed the real-rig grip/reach gate`);
  process.exit(1);
}
console.log(
  `\nhuman rifle carry passed: ${firearms.length} firearms, ${results.length} production Soldier poses, `
  + `worst wrist error `
  + `R=${(worstRight * 100).toFixed(2)}cm L=${(worstLeft * 100).toFixed(2)}cm; `
  + `minimum receiver clearance right=${(leastReceiverRight * 100).toFixed(1)}cm `
  + `ahead=${(leastReceiverAhead * 100).toFixed(1)}cm, `
  + `lateral shoulder ratio=${leastShoulderRatio.toFixed(2)}x; `
  + `mesh penetration torso=${(worstTorsoPenetration * 100).toFixed(1)}cm `
  + `shoulder=${(worstShoulderPenetration * 100).toFixed(1)}cm`
);
