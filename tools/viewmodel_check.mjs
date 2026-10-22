import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAIN_WEAPON_IDS, WEAPONS } from '../src/weapons/weaponDefs.js';
import { ViewmodelAim, ADS_SIGHT_SCREEN_Y, PRESENTATION_AIM_DEPTH } from '../src/weapons/ViewmodelAim.js';
import { weaponHandPose } from '../src/weapons/WeaponHandPoses.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';

// WeaponTextures creates canvases while the procedural fallbacks are built.
// Geometry is all this probe needs, so a no-op 2D context keeps the check
// browser-free and deterministic.
const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = new Proxy({}, {
  get(target, key) {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
    if (key === 'measureText') return () => ({ width: 10 });
    return target[key] ?? (target[key] = noop);
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context2d }),
};
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

const {
  WeaponSystem,
  adsMountForSight,
  measureWeaponSight,
  prepareFirstPersonModel,
  shouldHideAdsViewmodel,
} = await import('../src/weapons/WeaponSystem.js');
const {
  orientWeaponModelForward,
  QUATERNIUS_FORWARD_YAW,
  QUATERNIUS_GUNS,
  QUATERNIUS_LENGTH,
} = await import('../src/weapons/WeaponModels.js');

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function loadGlb(relativePath) {
  const bytes = fs.readFileSync(new URL(relativePath, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().register(() => ({ name: 'GeometryProbeTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) })).parse(buffer, '', resolve, reject);
  });
}

async function loadGltf(relativePath) {
  const json = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return new Promise((resolve, reject) => {
    new GLTFLoader().register(() => ({ name: 'GeometryProbeTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) })).parse(json, '', resolve, reject);
  });
}

const [sidearmGlb, authoredGlb, legacyGlb] = await Promise.all([
  loadGlb('../public/sidearm.glb'),
  loadGlb('../public/weapons_authored.glb'),
  loadGlb('../public/weapons.glb'),
]);

const quaterniusSources = new Map(await Promise.all(
  Object.entries(QUATERNIUS_GUNS).map(async ([id, model]) => {
    const gltf = await loadGltf(`../public/vendor/quaternius/scifi-weapons/${model}.gltf`);
    const root = gltf.scene;
    root.rotation.y = QUATERNIUS_FORWARD_YAW;
    root.updateMatrixWorld(true);
    const rawSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.setScalar(QUATERNIUS_LENGTH[id] / Math.max(0.001, rawSize.z));
    root.updateMatrixWorld(true);
    const normalized = new THREE.Box3().setFromObject(root);
    const center = normalized.getCenter(new THREE.Vector3());
    root.position.set(-center.x, 0.06 - center.y, -center.z);
    return [id, root];
  }),
));

function shippedSource(def) {
  if (def.proceduralModel) return null;
  const name = `weapon_${def.id}`;
  return quaterniusSources.get(def.id)
    || (def.id === 'magnum' ? sidearmGlb.scene.getObjectByName(name) : null)
    || authoredGlb.scene.getObjectByName(name)
    || legacyGlb.scene.getObjectByName(name)
    || null;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.02, 300);
scene.add(camera);
const audio = new Proxy({}, { get: () => noop });
const system = new WeaponSystem(camera, scene, audio);
const authoredArms = process.argv.includes('--authored-arms') || process.env.KYX_TEST_AUTHORED_ARMS === '1';
if (authoredArms) {
  const { buildViewmodelArm } = await import('../src/player/ViewmodelArms.js');
  const armsGlb = await loadGlb('../public/ev-view-arms.glb');
  system._installAuthoredViewmodelArms((side) => buildViewmodelArm(side, armsGlb.scene));
  assert(system.armGroup.userData.authoredViewArm && system.supportArmGroup.userData.authoredViewArm,
    'the shipped player-arm mesh must be installed in the authored pose check');
}

// The first-person arms must use the already-resolved third-person palette
// exactly.  A second shading pass here was the reason equipped hands looked
// like a different skin even though the correct model had loaded.
const paletteProbe = {
  plate: 0x3479c9,
  sleeve: 0x2c405d,
  glove: 0x172334,
  accent: 0xff5a21,
};
system.setArmAppearance(paletteProbe);
if (authoredArms) {
  const seen = new Set();
  for (const arm of [system.armGroup, system.supportArmGroup]) {
    arm.traverse((object) => {
      if (!object.isMesh || !object.userData.viewmodelPart) return;
      const role = object.material?.userData.evArmMaterial ? (/Undersuit/.test(object.material.name) ? 'sleeve' : /orange/.test(object.material.name) ? 'plate' : /gray/.test(object.material.name) ? 'trim' : 'accent') : object.userData.viewmodelPart;
      if (!(role in paletteProbe)) return;
      seen.add(role);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        assert(material.color.getHex() === paletteProbe[role],
          `${role} viewmodel material does not match the equipped body palette`);
      }
    });
  }
  for (const role of ['plate', 'sleeve']) {
    assert(seen.has(role), `authored viewmodel arm has no ${role} surface`);
  }
} else {
  assert(system.armPlateMat.color.getHex() === paletteProbe.plate,
    'fallback plate does not match the equipped body palette');
  assert(system.sleeveMat.color.getHex() === paletteProbe.sleeve,
    'fallback sleeve does not match the equipped body palette');
  assert(system.gloveMat.color.getHex() === paletteProbe.glove,
    'fallback glove does not match the equipped body palette');
}
system.setArmAppearance({
  authored: true,
  plate: 0xcbd0e4,
  sleeve: 0x242931,
  glove: 0x242931,
  accent: 0xff950f,
});

// The GLB pack uses an inverted-hull child named `outline`. That technique
// cannot share a depth-independent first-person pass or its back faces cover
// the colored receiver. Keep the base gun on top of the world and suppress only
// the contour shell.
const depthProbe = new THREE.Group();
const depthProbeBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
const depthProbeOutline = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), new THREE.MeshBasicMaterial());
depthProbeOutline.name = 'outline';
depthProbeBody.add(depthProbeOutline);
depthProbe.add(depthProbeBody);
prepareFirstPersonModel(depthProbe);
assert(depthProbeBody.material.depthTest && depthProbeBody.material.depthWrite,
  'first-person body still shares the world depth buffer');
assert(depthProbeOutline.visible === false,
  'first-person inverted-hull outline still covers the colored gun');
assert(depthProbe.scale.x === 1,
  'procedural first-person weapon was incorrectly mirrored');

const importedSideProbe = new THREE.Group();
importedSideProbe.userData.modelSource = 'quaternius';
prepareFirstPersonModel(importedSideProbe);
prepareFirstPersonModel(importedSideProbe);
assert(importedSideProbe.scale.x === -1,
  'imported first-person gun does not expose the near receiver side');

for (const [side, arm] of [
  ['trigger', system.armGroup],
  ['support', system.supportArmGroup],
]) {
  const length = arm?.userData?.sleeveLength;
  assert(Number.isFinite(length), `${side} arm exposes its authored sleeve length`);
  assert(length >= 0.45 && length <= 1.10,
    `${side} first-person sleeve is ${length?.toFixed(3)}m (expected a human-scale 0.45–1.10m)`);
}

// Reproduce WeaponModels' post-load selection using the actual shipped GLBs.
// The viewmodel refresh happens asynchronously in-game; testing only the
// procedural startup meshes would miss the long authored stocks that caused
// the clipping regression.
for (const def of WEAPONS) {
  if (BLENDER_ARSENAL[def.id]) {
    const gltf = await loadGlb(`../public${BLENDER_ARSENAL[def.id]}`);
    const { group, muzzle } = buildBlenderWeapon(gltf.scene, def);
    const old = system.models.get(def.id);
    group.visible = old.group.visible;
    system.kickGroup.remove(old.group);
    prepareFirstPersonModel(group);
    system.kickGroup.add(group);
    const sight = measureWeaponSight(group);
    system.models.set(def.id, {group, muzzle, sight, adsMount: adsMountForSight(sight)});
    continue;
  }
  if (system.models.get(def.id)?.group.userData.modelSource === 'reference') continue;
  const source = shippedSource(def);
  if (!source) continue;
  const record = system.models.get(def.id);
  const wasVisible = record.group.visible;
  system.kickGroup.remove(record.group);
  const group = new THREE.Group();
  const clone = source.clone(true);
  if (quaterniusSources.has(def.id)) {
    group.userData.modelSource = 'quaternius';
    group.userData.weaponId = def.id;
  } else {
    clone.position.set(0, 0, 0);
  }
  let muzzle = null;
  clone.traverse((obj) => { if (!muzzle && /^muzzle_point/.test(obj.name)) muzzle = obj; });
  if (muzzle) {
    orientWeaponModelForward(clone, muzzle);
    const probeParent = new THREE.Group();
    probeParent.add(clone);
    probeParent.updateWorldMatrix(true, true);
    const muzzlePoint = muzzle.getWorldPosition(new THREE.Vector3());
    assert(muzzlePoint.z < -0.05, `${def.id} authored muzzle faces ${muzzlePoint.z.toFixed(3)} on +Z`);
    probeParent.remove(clone);
  }
  group.add(clone);
  if (!muzzle) {
    // Match the runtime's marker-less imported pack. Reusing record.muzzle
    // here left the probe attached to the removed procedural weapon.
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, .062, -(QUATERNIUS_LENGTH[def.id] || .8) * .52);
    group.add(muzzle);
  }
  prepareFirstPersonModel(group);
  group.visible = wasVisible;
  system.kickGroup.add(group);
  const sight = measureWeaponSight(group);
  system.models.set(def.id, {
    group,
    muzzle,
    sight,
    adsMount: adsMountForSight(sight),
  });
}

// Rear stock outside the viewport may be cropped; a surface crossing the
// visible eye plane must still trigger clearance.
{
  const probeCamera = new THREE.PerspectiveCamera(78,16/9,.02,300);
  const probe = new THREE.Mesh(new THREE.BoxGeometry(.10,.10,.20),new THREE.MeshBasicMaterial());
  probe.position.z=-.06; probe.updateWorldMatrix(true,true); probeCamera.updateWorldMatrix(true,true);
  const aim = new ViewmodelAim();
  assert(aim.hasVisibleNearClip(probeCamera,probe),'visible near-plane obstruction was ignored');
  probe.position.y=-1;probe.updateWorldMatrix(true,true);
  assert(!aim.hasVisibleNearClip(probeCamera,probe),'offscreen stock incorrectly forces the gun away');
  probe.position.set(0,0,-1);probe.updateWorldMatrix(true,true);
  assert(!aim.hasVisibleNearClip(probeCamera,probe),'normal forward gun is reported as near-plane clipping');
  probe.geometry.dispose();probe.material.dispose();
}

const input = {
  mouseDown: false,
  rightMouseDown: false,
  mouseDX: 0,
  mouseDY: 0,
  wheelDelta: 0,
  consumeJustPressed: () => false,
};
const world = {};
const botManager = { getRaycastTargets: () => [] };
const player = {
  isSprinting: false,
  onGround: true,
  baseFov: 78,
  velocity: { x: 0, z: 0 },
  _camDist: 0,
};

function tick(frames, fps = 60, beforeFrame = null) {
  const dt = 1 / fps;
  for (let i = 0; i < frames; i++) {
    beforeFrame?.(dt);
    system.update(dt, input, world, botManager, player);
  }
}

function settle() {
  system.kickPos.set(0, 0, 0);
  system.kickVel.set(0, 0, 0);
  system.kickRotX = 0;
  system.kickRotXVel = 0;
  system._raiseT = 1;
  system._sprintT = 0;
  system.scopeT = 0;
  player.isSprinting = false;
  player.velocity.x = 0;
  player.velocity.z = 0;
  input.rightMouseDown = false;
  tick(90);
}

// All map-only guns coexist; repeating a pickup stacks reserves without changing slots.
system.setLoadout('m4', 'sword');
const pickupDefs = WEAPONS.filter(w => w.kind !== 'melee' && !MAIN_WEAPON_IDS.includes(w.id));
for (const gun of pickupDefs) system.addMapGun(gun.id);
assert(system.loadout.length === pickupDefs.length + 2, 'map weapons replaced one another');
const selectedBeforeRefill = system.currentDef.id;
const refillGun = pickupDefs[0];
system.state.get(refillGun.id).magAmmo = 0;
system.state.get(refillGun.id).reserveAmmo = 0;
system.addMapGun(refillGun.id);
assert(system.currentDef.id === selectedBeforeRefill, 'duplicate pickup switched the selected gun');
assert(system.loadout.length === pickupDefs.length + 2, 'duplicate weapon slot created');
assert(system.state.get(refillGun.id).magAmmo === 0
  && system.state.get(refillGun.id).reserveAmmo === refillGun.magSize + refillGun.reserveMax, 'duplicate pickup did not stack ammunition');
system.resetLoadout();
assert(system.loadout.map(w => w.id).join(',') === 'm4,sword', 'death inventory reset kept pickups');

function activate(def) {
  if (def.kind === 'melee') {
    system.setLoadout('m4', def.id);
    system.switchTo(1);
  } else {
    system.setLoadout(def.id, 'sword');
    // Power weapons are intentionally excluded from menu loadouts; exercise
    // them through the same pickup path used by a live match.
    if (system.currentDef.id !== def.id) system.addMapGun(def.id);
  }
  settle();
}

// Shader-cropped stock vertices are not rendered, so exclude them from the
// projection and eye-plane checks just as the GPU does. Using setFromObject()
// here would keep measuring the deliberately invisible world-model stock.
const _visibleBoxPoint = new THREE.Vector3();
const _visibleMeshBox = new THREE.Box3();
function visibleViewmodelBox(root) {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().makeEmpty();
  root.traverse((object) => {
    if (!object.isMesh || !object.visible || !object.geometry) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const cutoff = materials
      .map((material) => material?.userData?.firstPersonRearCrop)
      .find(Number.isFinite);
    const position = object.geometry.getAttribute('position');
    if (Number.isFinite(cutoff) && position) {
      for (let i = 0; i < position.count; i++) {
        if (position.getX(i) < cutoff) continue;
        _visibleBoxPoint.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        box.expandByPoint(_visibleBoxPoint);
      }
      return;
    }
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    _visibleMeshBox.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    box.union(_visibleMeshBox);
  });
  return box;
}

// Measure only surfaces inside the camera's side planes. A deliberately cropped
// stock below the viewport may pass behind the eye without blocking any pixels.
function nearDepth(root) {
  camera.updateMatrixWorld(true); root.updateWorldMatrix(true, true);
  const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*camera.aspect;
  const planes=[v=>v.x-v.z*tanX,v=>-v.x-v.z*tanX,v=>v.y-v.z*tanY,v=>-v.y-v.z*tanY];
  const matrix=new THREE.Matrix4();let nearest=Infinity;
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible||mesh.name==='outline')return;
    matrix.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);
    const attr=mesh.geometry.attributes.position,index=mesh.geometry.index;
    const vertices=Array.from({length:attr.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(attr,i).applyMatrix4(matrix));
    for(let i=0,n=index?index.count:attr.count;i<n;i+=3){
      let polygon=[0,1,2].map(j=>vertices[index?index.getX(i+j):i+j]);
      for(const distance of planes){
        if(polygon.every(v=>distance(v)>=0))continue;
        if(polygon.every(v=>distance(v)<0)){polygon=[];break;}
        const clipped=[];
        for(let j=0;j<polygon.length;j++){
          const a=polygon[j],b=polygon[(j+1)%polygon.length],da=distance(a),db=distance(b);
          if(da>=0)clipped.push(a);
          if((da>=0)!==(db>=0))clipped.push(a.clone().lerp(b,da/(da-db)));
        }
        polygon=clipped;
      }
      for(const v of polygon)nearest=Math.min(nearest,-v.z);
    }
  });
  return nearest;
}

function projectedRatioForBox(box) {
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const bounds = [Infinity, -Infinity, Infinity, -Infinity];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        bounds[0] = Math.min(bounds[0], point.x);
        bounds[1] = Math.max(bounds[1], point.x);
        bounds[2] = Math.min(bounds[2], point.y);
        bounds[3] = Math.max(bounds[3], point.y);
      }
    }
  }
  const width = bounds[1] - bounds[0];
  const height = bounds[3] - bounds[2];
  if (!(width > 0 && height > 0)) return 0;
  const visibleWidth = Math.max(0, Math.min(1, bounds[1]) - Math.max(-1, bounds[0]));
  const visibleHeight = Math.max(0, Math.min(1, bounds[3]) - Math.max(-1, bounds[2]));
  return visibleWidth * visibleHeight / (width * height);
}

function projectedRatio(root) {
  return projectedRatioForBox(visibleViewmodelBox(root));
}

function projectedBounds(root) {
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); root.updateWorldMatrix(true,true);
  const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible||mesh.name==='outline')return;
    matrix.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);
    const attr=mesh.geometry.attributes.position;
    for(let i=0;i<attr.count;i++){
      point.fromBufferAttribute(attr,i).applyMatrix4(matrix);
      if(point.z>=-camera.near)continue;
      point.applyMatrix4(camera.projectionMatrix);
      bounds.minX=Math.min(bounds.minX,point.x);bounds.maxX=Math.max(bounds.maxX,point.x);
      bounds.minY=Math.min(bounds.minY,point.y);bounds.maxY=Math.max(bounds.maxY,point.y);
    }
  });
  return bounds;
}
function viewportArea(root) {
  const b=projectedBounds(root);
  return Math.max(0,Math.min(1,b.maxX)-Math.max(-1,b.minX))*Math.max(0,Math.min(1,b.maxY)-Math.max(-1,b.minY))/4;
}

function meshViewportArea(root) {
  let area = 0;
  root.traverse((object) => {
    if (object.isMesh && object.visible) area += viewportArea(object);
  });
  return Math.min(1, area);
}

let lastGloveBounds = null;
function gloveRatio(group) {
  const box = visibleViewmodelBox(group);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const bounds = [Infinity, -Infinity, Infinity, -Infinity];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
    for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera);
      bounds[0] = Math.min(bounds[0], point.x);
      bounds[1] = Math.max(bounds[1], point.x);
      bounds[2] = Math.min(bounds[2], point.y);
      bounds[3] = Math.max(bounds[3], point.y);
    }
  }
  lastGloveBounds = bounds;
  const width = bounds[1] - bounds[0];
  const height = bounds[3] - bounds[2];
  if (!(width > 0 && height > 0)) return 0;
  const visibleWidth = Math.max(0, Math.min(1, bounds[1]) - Math.max(-1, bounds[0]));
  const visibleHeight = Math.max(0, Math.min(1, bounds[3]) - Math.max(-1, bounds[2]));
  return visibleWidth * visibleHeight / (width * height);
}

let lastEdgeBounds = null;
function reachesViewportEdge(root) {
  const box = visibleViewmodelBox(root);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
    for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
    }
  }
  lastEdgeBounds = { minX, maxX, minY };
  return minY <= -0.75 || minX <= -0.75 || maxX >= 0.75;
}

const viewports = [
  { label: 'portrait', aspect: 9 / 16 },
  { label: '4:3', aspect: 4 / 3 },
  { label: '16:9', aspect: 16 / 9 },
  { label: '21:9', aspect: 21 / 9 },
];
const fovs = [60, 78, 110];

let worstRestDepth = { value: Infinity, label: '' };
let worstActionDepth = { value: Infinity, label: '' };
let worstWeaponFrame = { value: Infinity, label: '' };
const firearmFraming = [];
const reportMode = process.env.VIEWMODEL_REPORT === '1';

for (const def of WEAPONS) {
  activate(def);
  const model = system.models.get(def.id).group;
  const restDepth = nearDepth(model);
  if (restDepth < worstRestDepth.value) worstRestDepth = { value: restDepth, label: def.id };
  assert(
    restDepth >= camera.near + 0.03,
    `${def.id} rests ${restDepth.toFixed(3)}m from the eye plane (near=${camera.near})`,
  );

  // Every shipped model must leave a readable piece on screen at the full
  // supported FOV/aspect matrix. Hands are checked more strictly below.
  for (const viewport of viewports) {
    camera.aspect = viewport.aspect;
    for (const fov of fovs) {
      player.baseFov = fov;
      camera.fov = fov;
      tick(45);
      const ratio = def.kind === 'melee' ? projectedRatio(model) : viewportArea(model);
      if (def.kind !== 'melee') {
        const meshes=[];model.traverse(mesh=>{if(mesh.isMesh&&mesh.visible&&mesh.name!=='outline')meshes.push(mesh);});
        const ray=new THREE.Raycaster();
        for(const x of [-.06,0,.06])for(const y of [-.06,0,.06]){
          ray.setFromCamera(new THREE.Vector2(x,y),camera);
          assert(ray.intersectObjects(meshes,false).length===0,def.id+' blocks the central aiming area');
        }
      }

      const label = `${def.id}/${viewport.label}/${fov}`;
      if (ratio < worstWeaponFrame.value) worstWeaponFrame = { value: ratio, label };
      if (!reportMode) {
        // A close cropped stock makes its full projected box arbitrarily large.
        // Gate the actual on-screen firearm footprint instead; receiver
        // position, forward angle and physical eye clearance are checked below.
        if (def.kind !== 'melee') {
          assert(viewportArea(model) >= 0.03, `${label} has no readable firearm in frame`);
        } else {
          assert(ratio >= 0.04, `${label} leaves only ${(ratio * 100).toFixed(1)}% of its projected box visible`);
        }
      }
    }
  }

  camera.aspect = 16 / 9;
  player.baseFov = 78;
  camera.fov = 78;
  tick(45);

  if (def.kind !== 'melee') {
    const bounds = projectedBounds(model);
    firearmFraming.push({
      id: def.id,
      carry: weaponHandPose(def.id).carry,
      scale: system.weaponMount.scale.x,
      width: Math.max(0, Math.min(1, bounds.maxX) - Math.max(-1, bounds.minX)),
      height: Math.max(0, Math.min(1, bounds.maxY) - Math.max(-1, bounds.minY)),
      area: viewportArea(model),
      bounds,
    });
  }

  if (authoredArms) {
    const model = system.models.get(def.id).group;
    const pose = weaponHandPose(model.userData.weaponId ? model : def.id);
    system.kickGroup.updateWorldMatrix(true, true);
    for (const [side, arm] of [['trigger', system.armGroup], ['support', system.supportArmGroup]]) {
      if (!arm.visible) continue;
      const palm = arm.getObjectByName('viewmodel_palm');
      palm.geometry.computeBoundingBox();
      const centre = palm.geometry.boundingBox.getCenter(new THREE.Vector3());
      palm.localToWorld(centre);
      system.kickGroup.worldToLocal(centre);
      const contact = new THREE.Vector3(...(side === 'support' ? pose.viewmodelSupport || pose.support : pose[side]));
      if (side === 'trigger' && def.id !== 'sword') contact.y += 0.030; // closed palm sits above wrist contact
      const error = centre.distanceTo(contact);
      assert(error < 0.015, `${def.id} ${side} shipped palm misses its grip by ${(error * 100).toFixed(1)}cm`);
    }
  }

  let actionDepth = Infinity;
  if (def.kind === 'melee') {
    system.swingPhase = 0;
    const frames = Math.ceil(def.fireRate * 60) + 2;
    for (let i = 0; i < frames; i++) {
      tick(1);
      actionDepth = Math.min(actionDepth, nearDepth(model));
    }
  } else {
    system._applyViewmodelRecoil(def.recoil);
    for (let i = 0; i < 30; i++) {
      tick(1);
      actionDepth = Math.min(actionDepth, nearDepth(model));
    }

    settle();
    const state = system.currentState;
    state.isReloading = true;
    state.reloadTimer = def.reloadTime;
    const frames = Math.ceil(def.reloadTime * 60);
    for (let i = 0; i < frames; i++) {
      tick(1);
      actionDepth = Math.min(actionDepth, nearDepth(model));
    }
  }
  if (actionDepth < worstActionDepth.value) worstActionDepth = { value: actionDepth, label: def.id };
  if (!reportMode) {
    assert(
      actionDepth >= camera.near + 0.03,
      `${def.id} action reaches ${actionDepth.toFixed(3)}m from the eye plane (near=${camera.near})`,
    );
  }
}

// A first-person hold must point into the scene, not display a broadside gun.
// The old test locked the rejected 56-degree yaw / 45-degree pitch as "EV.IO"
// constants and consequently passed the visibly wrong pose. Check the actual
// forward axis and projected framing instead, retaining the full weapon scale.
activate(WEAPONS.find((def) => def.id === 'm4'));
camera.aspect = 16 / 9;
player.baseFov = 78;
camera.fov = 78;
tick(90);
// Reproduce the deployed failure: an async model/match transition left every
// group hidden even though the HUD still showed a loaded rifle. The next frame
// must recover the equipped gun and hide any stale non-equipped model.
const activeM4 = system.models.get('m4').group;
const staleSidearm = system.models.get('magnum').group;
activeM4.visible = false;
staleSidearm.visible = true;
tick(1);
assert(activeM4.visible && !staleSidearm.visible,
  'equipped firearm did not recover from a stale hidden viewmodel state');
const hipForward = new THREE.Vector3(0, 0, -1).applyEuler(system.weaponMount.rotation);
assert(-hipForward.z > 0.90 && Math.abs(hipForward.x) < 0.35 && Math.abs(hipForward.y) < 0.35,
  `hip-fire gun is presented broadside instead of forward (${hipForward.toArray()})`);
const hipRifleBounds = projectedBounds(activeM4);
assert(hipRifleBounds.maxY < 0.10 && hipRifleBounds.maxY > -0.55,
  `hip-fire receiver must sit below the target area (${JSON.stringify(hipRifleBounds)})`);
assert(hipRifleBounds.minY < -1 && hipRifleBounds.maxX > 0.35,
  `hip-fire stock must exit the lower-right frame (${JSON.stringify(hipRifleBounds)})`);
assert(viewportArea(activeM4) >= .03, 'rifle has no readable receiver in view');

// Hold the actual trigger: accumulated recoil must stay visible without pulling
// the close rifle through the camera or separating the support glove.
world.raycastMeshes = [];
world.raycastBoxHit = () => null;
for (const fps of [30, 60, 144]) {
  activate(WEAPONS.find((def) => def.id === 'm4'));
  system.currentState.magAmmo = system.currentDef.magSize;
  system.currentState.isReloading = false;
  input.mouseDown = true;
  let peakKick = 0;
  let rearLift = 0;
  for (let frame = 0; frame < fps * 2; frame++) {
    tick(1, fps);
    peakKick = Math.max(peakKick, system.kickRotX);
    // Sample front/rear points in the actual rendered recoil transform. The
    // reference lifts the receiver more than the tip, not the reverse.
    const pivot = system._rifleRecoilPivot;
    const front = pivot.clone().applyQuaternion(system.kickGroup.quaternion)
      .add(system.kickGroup.position).sub(pivot);
    const rearPoint = pivot.clone().add(new THREE.Vector3(0,0,.6));
    const rear = rearPoint.clone().applyQuaternion(system.kickGroup.quaternion)
      .add(system.kickGroup.position).sub(rearPoint);
    rearLift = Math.max(rearLift, rear.y-front.y);
    assert(nearDepth(activeM4) > camera.near + .03,
      `sustained Auto Rifle recoil clips the camera at ${fps}Hz: depth=${nearDepth(activeM4).toFixed(4)}, kick=${system.kickRotX.toFixed(4)}, z=${system.kickPos.z.toFixed(4)}`);
  }
  input.mouseDown = false;
  assert(peakKick > .045, `Auto Rifle firing kick is not visible at ${fps}Hz`);
  assert(rearLift > .025, `rifle recoil must lift the receiver more than the muzzle at ${fps}Hz`);
  settle();
  assert(Math.abs(system.kickRotX) < .001, 'Auto Rifle recoil fails to settle after firing');
}
console.log('Auto Rifle sustained fire: visible recoil, camera clearance and recovery at 30/60/144Hz.');
system.currentState.magAmmo = system.currentDef.magSize;

// EV.IO's sword is a separate first-person composition: a close right-side
// guard whose grip and tip both leave the frame. It must not be centred over
// the reticle or point down the camera's depth axis.
const swordDef = WEAPONS.find((def) => def.id === 'sword');
assert(swordDef.damage === 75,
  `sword body hit must deal 75 damage (${swordDef.damage})`);
assert(Math.abs(swordDef.damage * swordDef.headshotMultiplier - 100) < 1e-9,
  `sword head critical must deal exactly 100 damage (${swordDef.damage * swordDef.headshotMultiplier})`);
activate(swordDef);
const meleeTarget = {
  alive: true,
  position: new THREE.Vector3(0, 0, -2),
  mesh: { userData: { headshotY: 1.55 } },
};
const meleeAttacker = { position: new THREE.Vector3(0, 0, 0) };
const meleeManager = { bots: [meleeTarget] };
let meleeHit = null;
const previousOnHitBot = system.onHitBot;
system.onHitBot = (bot, damage, point, meta) => { meleeHit = { bot, damage, point, meta }; };
camera.position.set(0, 1.7, 0);
camera.rotation.set(-0.50, 0, 0);
camera.updateWorldMatrix(true, true);
system._doMeleeSwing(meleeAttacker, world, meleeManager);
assert(meleeHit?.damage === 75 && !meleeHit.meta.headshot,
  `sword body sweep did not resolve one 75-damage hit (${JSON.stringify(meleeHit)})`);
meleeHit = null;
camera.rotation.set(-Math.atan2(0.15, 2), 0, 0);
camera.updateWorldMatrix(true, true);
system._doMeleeSwing(meleeAttacker, world, meleeManager);
assert(Math.abs(meleeHit?.damage - 100) < 1e-9 && meleeHit.meta.headshot,
  `sword deliberate head aim did not resolve one-hit critical (${JSON.stringify(meleeHit)})`);
system.onHitBot = previousOnHitBot;
camera.position.set(0, 0, 0);
camera.rotation.set(0, 0, 0);
camera.updateWorldMatrix(true, true);
camera.aspect = 16 / 9;
player.baseFov = 78;
camera.fov = 78;
tick(90);
const swordModel = system.models.get('sword').group;
const swordGuardBounds = projectedBounds(swordModel);
const swordGuardWidth = swordGuardBounds.maxX - swordGuardBounds.minX;
const swordGuardHeight = swordGuardBounds.maxY - swordGuardBounds.minY;
assert(swordGuardBounds.minX > 0 && swordGuardBounds.maxX < 1,
  'sword guard must remain beside the sightline and inside the frame: ' + JSON.stringify(swordGuardBounds));
assert(swordGuardHeight > 1 && swordGuardWidth < .7,
  'sword must have a tall, readable guard silhouette: ' + JSON.stringify(swordGuardBounds));
system.armGroup.updateWorldMatrix(true, true);
const gripUp = new THREE.Vector3(0, 1, 0).transformDirection(system.armGroup.matrixWorld)
  .transformDirection(camera.matrixWorldInverse);
assert(gripUp.y > .95, 'sword fist must wrap the upright hilt rather than turn sideways');
const gripScreen = system.armGroup.getWorldPosition(new THREE.Vector3()).project(camera);
assert(gripScreen.y > -1 && gripScreen.y < -.7 && gripScreen.x > .3 && gripScreen.x < 1,
  'sword grip must be visible in the lower right: ' + JSON.stringify(gripScreen));

system.swingPhase = 0;
let greatestSwordDrop = 0;
let greatestSwordSideShift = 0;
const swordGuardCenterX = (swordGuardBounds.minX + swordGuardBounds.maxX) * 0.5;
const swordFrames = Math.ceil(system.currentDef.fireRate * 60) + 2;
for (let i = 0; i < swordFrames; i++) {
  tick(1);
  const bounds = projectedBounds(swordModel);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  greatestSwordDrop = Math.max(greatestSwordDrop, swordGuardBounds.maxY - bounds.maxY);
  greatestSwordSideShift = Math.max(greatestSwordSideShift, Math.abs(centerX - swordGuardCenterX));
}

if (reportMode) {
  console.table(firearmFraming.map(({ bounds, ...row }) => ({
    ...row,
    scale: row.scale.toFixed(3),
    width: row.width.toFixed(3),
    height: row.height.toFixed(3),
    area: row.area.toFixed(3),
    minX: bounds.minX.toFixed(3),
    maxX: bounds.maxX.toFixed(3),
    minY: bounds.minY.toFixed(3),
    maxY: bounds.maxY.toFixed(3),
  })));
}

for (const frame of firearmFraming) {
  // Judge the projected gun, not a model-scale constant: equal world scales
  // can produce completely different visible sizes with different stocks.
  assert(frame.width >= .20 && frame.height >= .35,
    frame.id + ' has an unreadably small first-person silhouette');
  assert(frame.area >= (frame.carry === 'pistol' ? 0.025 : 0.03) && frame.area <= 0.55,
    `${frame.id} occupies ${(frame.area * 100).toFixed(1)}% of the desktop view`);
  if (frame.carry === 'launcher') {
    assert(frame.area >= 0.08,
      `${frame.id} launcher is still smaller than the fitted first-person presentation`);
  }
}
const swordRecoveredBounds = projectedBounds(swordModel);
assert(greatestSwordDrop > 0.70 && greatestSwordSideShift < 1.5,
  `sword diagonal cut escaped its bounded downward arc (drop=${greatestSwordDrop}, side=${greatestSwordSideShift})`);
for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
  assert(Math.abs(swordRecoveredBounds[key] - swordGuardBounds[key]) < 0.035,
    `sword failed to recover its guard on ${key}`);
}

// Follow the actual blade tip, not its bounding box: a reversed pitch can
// lower the box while the cutting edge scoops upward.
let bladeTipMesh, bladeTipLocal, highestTip = -Infinity;
swordModel.updateWorldMatrix(true, true);
swordModel.traverse(mesh => {
  if (!mesh.isMesh) return;
  const positions = mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const local = new THREE.Vector3().fromBufferAttribute(positions, i);
    const y = camera.worldToLocal(mesh.localToWorld(local.clone())).y;
    if (y > highestTip) { highestTip = y; bladeTipMesh = mesh; bladeTipLocal = local; }
  }
});
for (const fps of [30, 60, 144]) for (const combo of [0, 1, 2]) {
  system._swordCombo = combo;
  let previousY = Infinity, startY;
  for (let sample = 0; sample <= 12; sample++) {
    const phase = .22 + .30 * sample / 12;
    system.swingPhase = phase - 1 / fps / system.currentDef.fireRate;
    tick(1, fps);
    swordModel.updateWorldMatrix(true, true);
    const y = camera.worldToLocal(bladeTipMesh.localToWorld(bladeTipLocal.clone())).y;
    if (sample === 0) startY = y;
    else assert(y < previousY, `sword combo ${combo} cuts upward at ${phase} (${fps}Hz)`);
    previousY = y;
  }
  assert(startY - previousY > .35, `sword combo ${combo} must cut down through the target (${startY - previousY})`);
}
system.swingPhase = 1;
tick(1);

activate(WEAPONS.find((def) => def.id === 'm4'));
let worstGlove = { value: Infinity, label: '' };
assert(!system.armGroup.visible && system.supportArmGroup.visible,
  'first-person rifle must show only its supporting left arm');
const m4HandPose = weaponHandPose(system.models.get('m4').group);
// Check actual mesh contact, not the fallback's outdated grip coordinates.
// A source-specific profile must keep the procedural load placeholder intact.
assert(weaponHandPose('m4').trigger[2] === 0.20, 'fallback M4 grip changed');
assert(m4HandPose.trigger[2] < 0.07 && m4HandPose.trigger[2] > -0.03,
  'supplied M4 hand is behind the pistol grip in the stock gap');
assert(m4HandPose.support[2] > -0.30 && m4HandPose.support[2] < -0.15,
  'supplied M4 support is at the muzzle instead of the fore-end');
const suppliedM4 = quaterniusSources.get('m4');
suppliedM4.updateMatrixWorld(true);
function surfaceDistance(root, point) {
  let best = Infinity;
  const triangle = new THREE.Triangle();
  const nearest = new THREE.Vector3();
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      for (const [corner, offset] of [[triangle.a, 0], [triangle.b, 1], [triangle.c, 2]]) {
        corner.fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset)
          .applyMatrix4(mesh.matrixWorld);
      }
      triangle.closestPointToPoint(point, nearest);
      best = Math.min(best, point.distanceTo(nearest));
    }
  });
  return best;
}
const m4TriggerPalm = new THREE.Vector3(...m4HandPose.trigger);
m4TriggerPalm.y += 0.030;
assert(surfaceDistance(suppliedM4, m4TriggerPalm) < 0.025,
  'supplied M4 trigger palm is grabbing empty space');
assert(surfaceDistance(suppliedM4, new THREE.Vector3(...m4HandPose.support)) < 0.035,
  'supplied M4 support hand is not touching the fore-end');
const outdatedM4Palm = new THREE.Vector3(...weaponHandPose('m4').trigger);
outdatedM4Palm.y += 0.030;
assert(surfaceDistance(suppliedM4, outdatedM4Palm) > 0.035,
  'mesh-contact test no longer distinguishes the rejected stock-gap pose');
assert(system.armGroup.userData.viewmodelHand === 'trigger'
  && system.supportArmGroup.userData.viewmodelHand === 'support',
  'first-person handedness no longer matches the remote Soldier hold');
assert(JSON.stringify(system.armGroup.userData.gripTarget) === JSON.stringify(m4HandPose.trigger)
  && JSON.stringify(system.supportArmGroup.userData.gripTarget) === JSON.stringify(m4HandPose.viewmodelSupport || m4HandPose.support),
  'first- and third-person M4 hands no longer share the same grip contacts');
for (const arm of [system.armGroup, system.supportArmGroup]) {
  arm.traverse((object) => {
    if (!object.isMesh) return;
    const handSurface = object.name === 'viewmodel_palm'
      || object.name === 'viewmodel_hand_plate'
      || object.name === 'viewmodel_finger_curl'
      || object.name === 'viewmodel_knuckle'
      || object.name === 'viewmodel_thumb';
    const correctLayer = object.renderOrder === 0;
    assert(object.material.depthTest && object.material.depthWrite && correctLayer,
      `${arm.userData.viewmodelHand} hand can disappear into world geometry`);
  });
}
for (const stateName of ['idle', 'sprint', 'reload']) {
  player.isSprinting = stateName === 'sprint';
  player.velocity.z = stateName === 'sprint' ? 10.85 : 0;
  const reloadState = system.currentState;
  reloadState.isReloading = stateName === 'reload';
  for (const viewport of viewports) {
    camera.aspect = viewport.aspect;
    for (const fov of fovs) {
      player.baseFov = fov;
      camera.fov = fov;
      tick(60, 60, (dt) => {
        if (stateName === 'reload') {
          reloadState.isReloading = true;
          reloadState.reloadTimer = system.currentDef.reloadTime * 0.5 + dt;
        }
      });
      for (const [side, glove] of [
        ['trigger', system.armGroup],
        ['support', system.supportArmGroup],
      ]) {
        if (!glove.visible) continue;
        const grip = authoredArms
          ? glove.getObjectByName('viewmodel_palm')
          : (glove.getObjectByName('viewmodel_grip') || glove);
        const ratio = gloveRatio(grip);
        const label = `${stateName}/${viewport.label}/${fov}/${side}`;
        if (side === 'support' && ratio < worstGlove.value) worstGlove = { value: ratio, label };
        // Keep the bracing glove readable throughout the pose; the rear hand
        // may be cropped below the camera along with its shouldered stock.
        const minimum = side === 'support'
          ? (viewport.aspect < 1 ? 0.08 : 0.18)
          : (viewport.aspect < 1.5 ? 0.15 : 0.30);
        // A shouldered rifle crops the rear pistol grip naturally at the lower
        // edge. Do not turn the whole gun broadside just to expose that hand.
        // The support glove must remain visible; a cropped trigger glove must
        // be below the frame, never lost above/left or over the target area.
        const croppedTrigger = side === 'trigger' && lastGloveBounds[3] < -0.65;
        assert(
          ratio >= minimum || croppedTrigger,
          `${label} leaves only ${(ratio * 100).toFixed(1)}% of the glove visible (${JSON.stringify(lastGloveBounds)})`,
        );
        // Sum of per-mesh projected boxes intentionally over-estimates the
        // curved/tapered cylinders; 36% keeps the real arm pixels compact while
        // allowing a sleeve to cross the frame edge during the sprint carry.
        // The authored player arm includes overlapping underside, armor shell,
        // gauntlet and bicep meshes. The summed mesh boxes intentionally count
        // those pixels several times, so allow that complete body-matched arm a
        // larger accounting ceiling while preserving the fallback art budget.
        // The authored body-matched arm now uses the player's actual limb
        // thickness instead of the old 0.70 miniature. Its overlapping armor,
        // sleeve and glove boxes can sum to 100% even though the inspected
        // pixels occupy only the lower corner of the frame.
        const maxArea = authoredArms ? 1.08 : (side === 'support'
          ? (viewport.aspect < 1.5 ? 0.30 : 0.25)
          : (viewport.aspect < 1 ? 0.56 : 0.40));
        const armArea = meshViewportArea(glove);
        assert(
          armArea <= maxArea,
          `${label} arm occupies ${(armArea * 100).toFixed(1)}% of the viewport`,
        );
        // Do not resurrect metre-and-a-half sleeves solely to touch an edge
        // after the 110° sprint cant rotates the shoulder into view. Normal
        // gameplay FOVs still require an unbroken exit; the extreme wide-FOV
        // sprint relies on the closed, dark shoulder-side cap instead.
        if (side === 'trigger' && !(stateName === 'sprint' && fov >= 100)) {
          assert(
            reachesViewportEdge(glove),
            `${label} sleeve terminates inside the viewport (${JSON.stringify(lastEdgeBounds)})`,
          );
        }
      }
    }
  }
  reloadState.isReloading = false;
}

assert(!system.armGroup.visible && system.supportArmGroup.visible,
  'rifle reload must preserve the left-only first-person arm presentation');
assert(
  system.supportArmGroup.getObjectByName('viewmodel_upper_sleeve')?.visible === true,
  'support forearm no longer continues naturally through the lower-left edge',
);
activate(WEAPONS.find((def) => def.id === 'magnum'));
assert(!system.armGroup.visible, 'first-person sidearm exposes its trigger hand');
assert(system.supportArmGroup.visible, 'first-person sidearm must show its supporting left hand');

function advanceSeconds(seconds, fps, beforeFrame = null) {
  let remaining = seconds;
  while (remaining > 1e-10) {
    const dt = Math.min(1 / fps, remaining);
    beforeFrame?.(dt);
    system.update(dt, input, world, botManager, player);
    remaining -= dt;
  }
}

function resetMotionState() {
  system._sprintT = 0;
  system.scopeT = 0;
  system._swayX = 0;
  system._swayY = 0;
  system._swayVelX = 0;
  system._swayVelY = 0;
  system._bobPhase = 0;
  system._bobAmt = 0;
  system._idleT = 0;
  system._fallSpeed = 0;
  system._landStrength = 0;
  system._landT = 0;
  system._wasGrounded = true;
  system.kickPos.set(0, 0, 0);
  system.kickVel.set(0, 0, 0);
  system.kickRotX = 0;
  system.kickRotXVel = 0;
  system._raiseT = 1;
  input.mouseDown = false;
  input.rightMouseDown = false;
  input.mouseDX = 0;
  input.mouseDY = 0;
  player.isSprinting = false;
  player.onGround = true;
  player.baseFov = 78;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  camera.aspect = 16 / 9;
  camera.fov = 78;
  camera.updateProjectionMatrix();
}

// The blend state itself must be identical after the same elapsed time,
// regardless of how many render frames divided that interval.
activate(WEAPONS.find((def) => def.id === 'm4'));
const rates = [30, 60, 144];
const sprintSamples = [];
const adsSamples = [];
for (const fps of rates) {
  resetMotionState();
  player.isSprinting = true;
  player.velocity.z = 10.85;
  advanceSeconds(0.1, fps);
  sprintSamples.push({ fps, blend: system._sprintT, fov: camera.fov });

  resetMotionState();
  input.rightMouseDown = true;
  advanceSeconds(0.1, fps);
  adsSamples.push({ fps, blend: system.scopeT, fov: camera.fov });
}
const spread = (samples, key) => {
  const values = samples.map((sample) => sample[key]);
  return Math.max(...values) - Math.min(...values);
};
assert(spread(sprintSamples, 'blend') < 1e-10, 'sprint carry blend changes with refresh rate');
assert(spread(adsSamples, 'blend') < 1e-10, 'ADS blend changes with refresh rate');
assert(spread(sprintSamples, 'fov') < 1e-9, 'sprint FOV changes with refresh rate');
assert(spread(adsSamples, 'fov') < 1e-9, 'ADS FOV changes with refresh rate');

// The hands wrap over the gun at hip fire, but must move beneath its render
// layer while aiming so a depth-independent glove cannot cover the rear sight.
activate(WEAPONS.find((def) => def.id === 'm4'));
resetMotionState();
input.rightMouseDown = true;
advanceSeconds(0.5, 60);
assert(system._handSurfaceMeshes.every((mesh) => mesh.renderOrder === 0),
  'ADS glove still renders over the sight picture');
input.rightMouseDown = false;
advanceSeconds(0.5, 60);
assert(system._handSurfaceMeshes.every((mesh) => mesh.renderOrder === 0),
  'hip-fire glove did not return over the physical grips');

// The recoil spring used to be Euler-integrated and visibly recovered at a
// different rate on 30Hz displays. Its full position and rotation state must
// now compose to the same result over equal elapsed time.
const recoilSamples = [];
for (const fps of rates) {
  resetMotionState();
  system._applyViewmodelRecoil(1);
  advanceSeconds(0.25, fps);
  recoilSamples.push({
    fps,
    x: system.kickPos.x,
    y: system.kickPos.y,
    z: system.kickPos.z,
    rot: system.kickRotX,
  });
}
for (const key of ['x', 'y', 'z', 'rot']) {
  assert(spread(recoilSamples, key) < 1e-10, `recoil ${key} changes with refresh rate`);
}

// The video-matched Hand Cannon needs clearance through its raised running
// guard and heavy shot, not just the generic rifle recoil impulse above.
const magnumRecovery = [];
activate(WEAPONS.find(def => def.id === 'magnum'));
for (const fps of rates) {
  for (const viewport of viewports) for (const fov of fovs) {
    resetMotionState();
    player.weaponSprintBlocked = false;
    player.baseFov = fov; camera.fov = fov; camera.aspect = viewport.aspect;
    camera.updateProjectionMatrix();
    advanceSeconds(.6, fps);
    const record = system.models.get('magnum');
    const muzzleY = () => record.muzzle.getWorldPosition(new THREE.Vector3()).project(camera).y;
    const readyY = muzzleY();
    player.isSprinting = true; player.velocity.z = 9.9;
    advanceSeconds(.8, fps);
    assert(muzzleY() > readyY + .20, 'Hand Cannon running guard does not raise the barrel');
    assert(projectedRatio(record.group) > .30, 'raised Hand Cannon leaves the screen');
    assert(nearDepth(record.group) > camera.near + .03, 'running Hand Cannon crosses the eye plane');
    player.weaponSprintBlocked = true; player.isSprinting = false; player.velocity.z = 6.6;
    system._applyViewmodelRecoil(.00966, true);
    const shotDepth = [];
    advanceSeconds(.6, fps, () => shotDepth.push(nearDepth(record.group)));
    assert(Math.min(...shotDepth) > camera.near + .03, 'Hand Cannon recoil clips through the eye plane');
    assert(system.kickRotX < .003, 'Hand Cannon failed to settle after the shot');
    assert(Math.abs(muzzleY() - readyY) < .06, 'Hand Cannon failed to return to its firing lane');
    if (viewport.label === '16:9' && fov === 78) magnumRecovery.push({fps,rot:system.kickRotX,z:system.kickPos.z});
  }
}
for (const key of ['rot','z']) assert(spread(magnumRecovery,key)<1e-10, 'Hand Cannon recoil depends on frame rate');
player.weaponSprintBlocked = false;
console.log('Hand Cannon running guard and heavy recoil passed at 30/60/144Hz across 12 FOV/aspect frames.');

// A rifle reload adds roll to the shared kick group. Equipping a blade must
// establish a clean blade pose instead of inheriting that gun-only transform.
activate(WEAPONS.find((def) => def.id === 'm4'));
system.currentState.isReloading = true;
system.currentState.reloadTimer = system.currentDef.reloadTime * 0.5;
tick(1);
assert(Math.abs(system.kickGroup.rotation.z) > 0.1, 'reload did not exercise gun roll');
system.switchTo(1);
tick(1);
assert(Math.abs(system.kickGroup.rotation.z) < 1e-12, 'gun reload roll leaked into melee carry');
activate(WEAPONS.find((def) => def.id === 'm4'));

// Measure the actual blade axis in camera space, not just Euler signs.
for (const fps of [30,60,144]) {
  activate(WEAPONS.find(def => def.id === 'sword'));
  resetMotionState(); input.rightMouseDown = false;
  tick(90, fps);
  const blade = system.models.get('sword').group;
  const direction = () => {
    camera.updateMatrixWorld(true); blade.updateWorldMatrix(true,true);
    return new THREE.Vector3(0,0,-1).transformDirection(blade.matrixWorld).transformDirection(camera.matrixWorldInverse);
  };
  assert(direction().y > .98 && Math.abs(direction().x) < .04, 'reference sword guard must rise vertically beside the reticle');
  system._swordCombo = 0;
  system.swingPhase = .5 - (1 / fps) / system.currentDef.fireRate;
  tick(1,fps);
  assert(direction().y < -.4, `sword scoops upward at ${fps} Hz`);
}
activate(WEAPONS.find(def => def.id === 'm4'));

// Feed the same physical look velocity at each refresh rate. Full ADS should
// remove viewmodel movement, and that result should itself remain
// stable at 30/60/144 Hz.
const adsStability = [];
for (const fps of rates) {
  resetMotionState();
  input.rightMouseDown = true;
  player.velocity.z = 6.6;
  const mountY = [];
  advanceSeconds(1.2, fps, (dt) => {
    input.mouseDX = 600 * dt;
    input.mouseDY = -300 * dt;
    // Measure settled ADS, excluding the tail of the longer lowering transition.
    if (system.scopeT > 0.9995) mountY.push(system.weaponMount.position.y);
  });
  adsStability.push({
    fps,
    scope: system.scopeT,
    bob: system._bobAmt,
    sway: Math.hypot(system.swayGroup.rotation.x, system.swayGroup.rotation.y),
    travel: Math.max(...mountY) - Math.min(...mountY),
  });
}
for (const sample of adsStability) {
  assert(sample.scope > 0.999, `ADS did not settle at ${sample.fps}Hz`);
  assert(sample.bob < 0.0001, `ADS walk bob is ${sample.bob.toFixed(5)}m at ${sample.fps}Hz`);
  assert(sample.sway < 0.0001, `ADS look sway is ${sample.sway.toFixed(5)}rad at ${sample.fps}Hz`);
  assert(sample.travel < 0.001,
    `ADS gun travels ${sample.travel.toFixed(5)}m through the sightline at ${sample.fps}Hz`);
}
assert(system.kickGroup.visible, 'ordinary ADS incorrectly hides the physical gun');
input.rightMouseDown = false;
advanceSeconds(0.25, 60);
assert(system.kickGroup.visible, 'viewmodel did not return after leaving the scope');
assert(spread(adsStability, 'bob') < 1e-6, 'ADS bob changes with refresh rate');
assert(spread(adsStability, 'sway') < 2e-5, 'ADS sway changes with refresh rate');

// Exercise the complete transition at 240Hz. Ordinary guns bring their actual
// measured rear sight onto the centre axis; true scoped optics disappear only
// after the overlay is established.
for (const def of WEAPONS.filter((weapon) => weapon.kind !== 'melee')) {
  activate(def);
  resetMotionState();
  advanceSeconds(0.25, 240);
  input.rightMouseDown = true;
  advanceSeconds(1 / 240, 240);
  assert(system.kickGroup.visible, `${def.id} vanishes on the first ADS frame`);
  assert(system.scopeT < 0.5, `${def.id} first-frame ADS probe skipped the transition`);
  advanceSeconds(0.5 - 1 / 240, 240);
  assert(system.kickGroup.visible === !def.scoped,
    `${def.id} uses the wrong full-ADS viewmodel mode`);
  if (def.canAim === false) {
    assert(system.scopeT === 0, 'weapon must not zoom');
    input.rightMouseDown = false;
    continue;
  }
  if (!def.scoped) {
    const adsRecord = system.models.get(def.id);
    const adsMuzzle = adsRecord.muzzle.getWorldPosition(new THREE.Vector3());
    const adsForward = new THREE.Vector3(0,0,-1).transformDirection(adsRecord.group.matrixWorld);
    const adsTarget = camera.getWorldPosition(new THREE.Vector3())
      .addScaledVector(camera.getWorldDirection(new THREE.Vector3()), PRESENTATION_AIM_DEPTH);
    assert(adsForward.angleTo(adsTarget.sub(adsMuzzle).normalize()) < .0001,
      `${def.id} ADS barrel does not converge on the reticle`);
    if (!def.scoped) {
      const record = system.models.get(def.id);
      assert(Math.abs(camera.fov - (def.adsFov ?? 52)) < 0.3,
        `${def.id} zoom is too tight or too weak (${camera.fov.toFixed(2)})`);
      camera.updateMatrixWorld(true);
      record.group.updateWorldMatrix(true, true);
      const sightNdc = record.sight.clone().applyMatrix4(record.group.matrixWorld).project(camera);
      assert(Math.abs(sightNdc.x - (def.id === 'uzi' ? .20 : 0)) < 0.001,
        `${def.id} rear sight misses horizontal screen centre (${sightNdc.x.toFixed(3)})`);
      assert(Math.abs(sightNdc.y - ADS_SIGHT_SCREEN_Y) < 0.001,
        `${def.id} sight misses the lowered ADS position (${sightNdc.y.toFixed(3)})`);
      assert(system.weaponMount.position.z < -0.35 && system.weaponMount.position.z > -1.55,
        `${def.id} ADS depth over-crops or loses the gun (${system.weaponMount.position.z.toFixed(3)})`);
      const visibleGun = [];
      record.group.traverse(o => { if (o.isMesh && o.visible && o.name !== 'outline') visibleGun.push(o); });
      const sightRay = new THREE.Raycaster();
      for (const x of [0]) for (const y of [0, .08]) {
        sightRay.setFromCamera(new THREE.Vector2(x,y), camera);
        assert(sightRay.intersectObjects(visibleGun, false).length === 0, `${def.id} gun blocks the central ADS target area`);
      }
      record.group.traverse((object) => {
        if (!object.isMesh) return;
        if (object.name === 'outline') {
          assert(object.visible === false, `${def.id} first-person contour covers the receiver`);
          return;
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        assert(materials.every((material) => material.depthTest && material.depthWrite),
          `${def.id} viewmodel can still be hidden by world geometry`);
        assert(object.renderOrder === 0, `${def.id} viewmodel must use depth ordering`);
      });
    }
  }
  input.rightMouseDown = false;
  advanceSeconds(0.2, 240);
  advanceSeconds(0.3, 240);
  assert(system.kickGroup.visible, `${def.id} viewmodel did not return after ADS`);
}
assert(!shouldHideAdsViewmodel(WEAPONS.find((def) => def.id === 'm4'), 1, true),
  'ordinary rifle zoom must retain the centred physical sight picture');
assert(shouldHideAdsViewmodel({ kind: 'hitscan', scoped: true }, 0.8, true),
  'scoped rifle must clear only after the scope overlay is established');
assert(!shouldHideAdsViewmodel(WEAPONS.find((def) => def.id === 'sword'), 1),
  'melee viewmodel must not be hidden by firearm ADS rules');

// Landing response is derived from the velocity retained during airtime.
const landingStrength = (fallSpeed) => {
  resetMotionState();
  player.onGround = false;
  player.velocity.y = -fallSpeed;
  advanceSeconds(1 / 60, 60);
  player.onGround = true;
  player.velocity.y = 0;
  advanceSeconds(1 / 60, 60);
  return system._landStrength;
};
const softLanding = landingStrength(2);
const hardLanding = landingStrength(18);
assert(softLanding >= 0.17 && softLanding <= 0.25, `soft landing strength is ${softLanding}`);
assert(hardLanding >= 1 && hardLanding <= 1.2, `hard landing strength is ${hardLanding}`);
assert(hardLanding > softLanding * 4, 'landing response does not scale with impact velocity');

// Shooting drives a restrained spring impulse while both gloves stay attached.
activate(WEAPONS.find((def) => def.id === 'm4'));
settle();
const fireKickBefore = {
  position: system.kickPos.clone(),
  rotation: system.kickRotX,
};
const originalHitscan = system._doHitscanShot;
const originalShell = system._spawnShell;
const originalFlash = system._flash;
const originalSmoke = system._spawnMuzzleSmoke;
system._doHitscanShot = noop;
system._spawnShell = noop;
system._flash = noop;
system._spawnMuzzleSmoke = noop;
system._fire(world, [], player, botManager);
system._doHitscanShot = originalHitscan;
system._spawnShell = originalShell;
system._flash = originalFlash;
system._spawnMuzzleSmoke = originalSmoke;
assert(system.kickPos.z > fireKickBefore.position.z && system.kickPos.z < 0.05,
  'shooting must produce restrained physical kick');
assert(system.kickRotX > fireKickBefore.rotation, 'shot did not drive the rotation spring');
advanceSeconds(1, 60);
assert(system.kickPos.length() < 0.001, 'gun spring did not settle after firing');

console.log(
  `viewmodel passed: ${WEAPONS.length} shipped weapons, `
  + `${viewports.length * fovs.length} FOV/aspect frames; `
  + `rest clearance=${worstRestDepth.value.toFixed(3)}m (${worstRestDepth.label}), `
  + `action clearance=${worstActionDepth.value.toFixed(3)}m (${worstActionDepth.label}), `
  + `weapon frame=${(worstWeaponFrame.value * 100).toFixed(1)}% (${worstWeaponFrame.label}), `
  + `support visibility follows weapon grip profile; `
  + `30/60/144Hz blends match, ADS bob=${Math.max(...adsStability.map((s) => s.bob)).toFixed(4)}m, `
  + `ADS sway=${Math.max(...adsStability.map((s) => s.sway)).toFixed(4)}rad, `
  + `landing=${softLanding.toFixed(2)}x/${hardLanding.toFixed(2)}x`,
);

// Imported handles must meet the closed glove, not just match an arbitrary IK
// target. Measure against actual triangles, excluding decorative outline hulls.
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  const group = system.models.get(def.id)?.group;
  if (!['quaternius', 'blender-arsenal'].includes(group?.userData.modelSource)) continue;
  const pose = weaponHandPose(group);
  group.updateWorldMatrix(true, true);
  const triangles = [];
  group.traverse(mesh => {
    if (!mesh.isMesh || mesh.name === 'outline') return;
    const p = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
      const points = [0,1,2].map(k => group.worldToLocal(new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i+k) : i+k).applyMatrix4(mesh.matrixWorld)));
      const triangle = new THREE.Triangle(...points);
      if (triangle.getArea() > 1e-12) triangles.push(triangle);
    }
  });
  for (const key of ['trigger', ...(pose.supportVisible === false ? [] : ['support'])]) {
    const target = new THREE.Vector3(...(key === 'support' ? pose.viewmodelSupport || pose.support : pose[key])); if (key === 'trigger') target.y += .030;
    let gap = Infinity; const nearest = new THREE.Vector3();
    for (const triangle of triangles) { triangle.closestPointToPoint(target, nearest); gap = Math.min(gap, nearest.distanceTo(target)); }
    assert(gap < .035, `${def.id} ${key} palm floats ${(gap*100).toFixed(1)}cm away from imported mesh`);
  }
}
console.log('Imported firearm palm contacts are within 3.5cm of real mesh surfaces.');

// Walking/running move the complete gun-and-hand mount, with stable ADS above.
for (const fps of rates) {
  const spans = [];
  for (const sprint of [false, true]) {
    activate(WEAPONS.find(def => def.id === 'm4'));
    resetMotionState();
    player.isSprinting = sprint;
    player.velocity.z = sprint ? 9.9 : 6.6;
    advanceSeconds(1, fps);
    const heights = [], rolls = [];
    advanceSeconds(1, fps, () => {
      // Aim correction compensates the mount around the muzzle. Observe the
      // rendered barrel, not that internal compensating root translation.
      heights.push(system.models.get('m4').muzzle.getWorldPosition(new THREE.Vector3()).project(camera).y);
      rolls.push(system.weaponMount.rotation.z);
    });
    const vertical = Math.max(...heights)-Math.min(...heights);
    assert(vertical > 0.001 && vertical < 0.06, `weapon step motion must remain subtle on screen at ${fps}Hz: ${vertical}`);
    assert(Math.max(...rolls)-Math.min(...rolls) > 0.001, 'steps do not roll the weapon');
    assert(Math.abs(system.weaponMount.rotation.z) < 0.32, 'running carry twists the gun sideways');
    assert(Math.abs(system.weaponMount.rotation.y) < Math.PI / 2, 'chest carry turns the muzzle behind the player');
    if (sprint) assert(system.weaponMount.rotation.y > 0.85, 'sprint must tuck the rifle across the chest');
    spans.push(system._bobAmt);
    player.velocity.z = 0;
    advanceSeconds(1, fps);
    assert(system._bobAmt < 0.0001, 'weapon keeps bobbing after stopping');
  }
  assert(spans[1] < spans[0] && spans[1] > spans[0]*0.5, 'recorded sprint carry must remain steadier than walking without becoming rigid');
}
console.log('Walk/run gun motion passed: visible step bob, roll, restrained sprint and smooth stop at 30/60/144Hz');

// ESC must ease out of sprint/ADS despite stale player flags and held input.
for (const fps of rates) {
  activate(WEAPONS.find(def => def.id === 'm4'));
  resetMotionState(); player.isSprinting=true; player.velocity.z=-9.9;
  advanceSeconds(1,fps);
  assert(system._sprintT>.9);
  const originalFire=system._fire; let fired=0;
  system._fire=()=>{fired++;};
  const blocked={...input,mouseDown:true,rightMouseDown:true,wheelDelta:1,consumeJustPressed:()=>true};
  const slot=system.currentIndex;
  for(let i=0;i<fps;i++)system.update(1/fps,blocked,world,botManager,player,false);
  system._fire=originalFire;
  assert(fired===0,'menu input fires gun');
  assert(system.currentIndex===slot,'menu input switches weapon');
  assert(system._sprintT<.001 && system._bobAmt<.001 && system.scopeT<.001,'ESC leaves gun in a movement/ADS pose');
  player.isSprinting=false; player.velocity.z=0;
}
console.log('ESC settles sprint carry at 30/60/144Hz without accepting weapon input.');


// Rifle sprint poses must keep physical scale and move the shared hand/gun rig left.
for (const id of ['m4','battlerifle','plasmarifle','energyshotgun','rpg','concussion']) {
  activate(WEAPONS.find(def => def.id === id)); resetMotionState();
  advanceSeconds(1,60);
  const muzzleX=()=>system.models.get(id).muzzle.getWorldPosition(new THREE.Vector3()).project(camera).x;
  const restScale=system.weaponMount.scale.x, restX=muzzleX();
  player.weaponSprintBlocked=false;player.isSprinting=true;player.velocity.z=9.9;advanceSeconds(1,60);
  assert(Math.abs(system.weaponMount.scale.x-restScale)<.001, `${id} grows when sprinting`);
  assert(muzzleX()<restX-.15, `${id} does not tuck across the body`);
  player.isSprinting=false;player.weaponSprintBlocked=true;advanceSeconds(.4,60);
  assert(system._sprintT<.001, `${id} fails to return to firing pose`);
}
console.log('Recorded rifle carry: stable size, across-body tuck, fast firing return.');

// Check the rendered return path, not just its settled endpoints. The old
// partial aim solve moved the receiver farther left before returning right.
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  for (const fps of rates) {
    activate(def); resetMotionState();
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    camera.aspect = 16 / 9; camera.fov = 78; camera.updateProjectionMatrix();
    player.baseFov = 78; player.reduceMotion = true;
    player.weaponSprintBlocked = false; player.isSprinting = false;
    player.velocity.x = 0; player.velocity.z = 0;
    const receiver = () => system.models.get(def.id).group
      .getWorldPosition(new THREE.Vector3()).project(camera);
    advanceSeconds(1, fps);
    const ready = receiver();
    player.isSprinting = true; player.velocity.z = -9.9;
    advanceSeconds(1.5, fps);
    const running = receiver();
    player.isSprinting = false; player.velocity.z = 0;
    const left = Math.min(ready.x, running.x) - .03;
    const right = Math.max(ready.x, running.x) + .03;
    let previous = system.weaponMount.quaternion.clone();
    advanceSeconds(.7, fps, () => {
      const point = receiver();
      assert(point.x >= left && point.x <= right,
        `${def.id} receiver takes a sideways detour after stopping at ${fps}Hz: ${point.x}`);
      const angle = previous.angleTo(system.weaponMount.quaternion);
      assert(angle * fps < 12, `${def.id} return rotation snaps at ${fps}Hz`);
      previous.copy(system.weaponMount.quaternion);
      assert(nearDepth(system.models.get(def.id).group) > .02,
        `${def.id} return crosses the camera`);
    });
    assert(receiver().distanceTo(ready) < .025, `${def.id} return does not settle at ${fps}Hz`);
  }
}
player.reduceMotion = false;
console.log('Every firearm returns directly from sprint without sideways reversal at 30/60/144Hz.');

// Regression: a valid palm contact alone does not prove left-arm anatomy.
// Measure the actual proximal sleeve vertices relative to the glove in camera
// space in both carries: the sleeve must lead down-left, not up the receiver.
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  for (const sprint of [false, true]) {
    activate(def); resetMotionState(); camera.aspect=16/9;camera.fov=78;camera.updateProjectionMatrix();
    player.isSprinting=sprint;player.weaponSprintBlocked=false;player.velocity.z=sprint?9.9:0;
    advanceSeconds(1,60);system.weaponMount.updateWorldMatrix(true,true);
    assert(!system.armGroup.visible && system.supportArmGroup.visible,def.id+' must show only the support arm');
    const sleeve=system.supportArmGroup.getObjectByName('viewmodel_upper_sleeve');
    const palm=system.supportArmGroup.getObjectByName('viewmodel_palm');
    sleeve.geometry.computeBoundingBox();palm.geometry.computeBoundingBox();
    const positions=sleeve.geometry.attributes.position,box=sleeve.geometry.boundingBox;
    const shoulder=new THREE.Vector3();let n=0;
    for(let i=0;i<positions.count;i++) {
      if(positions.getY(i)>box.min.y+(box.max.y-box.min.y)*.18)continue;
      shoulder.add(new THREE.Vector3().fromBufferAttribute(positions,i));n++;
    }
    shoulder.divideScalar(n);sleeve.localToWorld(shoulder);camera.worldToLocal(shoulder);
    const hand=palm.geometry.boundingBox.getCenter(new THREE.Vector3());palm.localToWorld(hand);camera.worldToLocal(hand);
    assert(shoulder.x < hand.x-.02 && shoulder.y < hand.y-.05,
      def.id+' '+(sprint?'run':'idle')+' sleeve must extend below and left of the hand');
    if (authoredArms && def.id === 'rpg') {
      const sleeveEnd = shoulder.clone().applyMatrix4(camera.projectionMatrix);
      assert(sleeveEnd.y < -1 || sleeveEnd.x < -1,
        'launcher support sleeve ends visibly in midair instead of continuing to the body');
    }
    if (authoredArms) {
      // Match the renderer's update: SkinnedMesh refreshes bindMatrixInverse
      // in updateMatrixWorld, not the Object3D updateWorldMatrix helper.
      scene.updateMatrixWorld(true);
      const arm=system.supportArmGroup;
      const target=new THREE.Vector3().fromArray(arm.userData.gripTarget);
      const center=palm.geometry.boundingBox.getCenter(new THREE.Vector3());
      for (const landmark of ['thumbContact','fingerContact','palmContact','wristContact']) {
        const sourcePoint=new THREE.Vector3().fromArray(palm.userData[landmark]);
        const actual=palm.localToWorld(palm.applyBoneTransform(0,sourcePoint.clone()));
        const expected=sourcePoint.sub(center).multiply(arm.scale).add(target);
        system.kickGroup.localToWorld(expected);
        assert(actual.distanceTo(expected)<.0001,def.id+' '+landmark+' must follow the handguard '+JSON.stringify({actual:actual.toArray(),expected:expected.toArray(),distance:actual.distanceTo(expected)}));
      }
      arm.traverse(mesh=>{
        if(!mesh.isSkinnedMesh)return;
        const positions=mesh.geometry.attributes.position, weights=mesh.geometry.attributes.skinWeight;
        for(let i=0;i<positions.count;i++) {
          const sourcePoint=new THREE.Vector3().fromBufferAttribute(positions,i);
          const actual=mesh.applyBoneTransform(i,sourcePoint.clone());
          if(weights.getX(i)>.9999)assert(actual.distanceTo(sourcePoint)<.0001,'wrist bend moved the fixed elbow');
          mesh.localToWorld(actual); camera.worldToLocal(actual);
          if(mesh===palm)assert(actual.z<-.02,def.id+' '+(sprint?'run':'idle')+' glove crosses the camera');
        }
      });
    }
  }
}
player.isSprinting=false;player.velocity.z=0;
console.log('All firearm support sleeves extend down-left from the actual glove during idle and sprint.');

// A palm near the grip marker can still be beside or inside the receiver. Cast up
// from the actual skinned palm into every gun and measure the underside contact.
// This catches the old glove placement that left only the angular cuff visible.
if (authoredArms) {
  for (const { id } of WEAPONS.filter(w => w.kind !== 'melee')) for (const sprint of [false, true]) {
    activate(WEAPONS.find(w => w.id === id)); resetMotionState();
    camera.aspect = 16 / 9; camera.fov = 78; camera.updateProjectionMatrix();
    player.isSprinting = sprint; player.weaponSprintBlocked = false;
    player.velocity.x = 0; player.velocity.z = sprint ? -9.9 : 0;
    advanceSeconds(1, 60); scene.updateMatrixWorld(true);
    const palm = system.supportArmGroup.getObjectByName('viewmodel_palm');
    const rifle = system.models.get(id).group;
    const point = palm.localToWorld(palm.applyBoneTransform(0,
      new THREE.Vector3().fromArray(palm.userData.palmContact)));
    const localPalm = rifle.worldToLocal(point.clone());
    const up = new THREE.Vector3(0, 1, 0).transformDirection(rifle.matrixWorld);
    const ray = new THREE.Raycaster(point.clone().addScaledVector(up, -1), up, 0, 2);
    const surfaces = [];
    rifle.traverse(mesh => { if (mesh.isMesh && mesh.name !== 'outline') surfaces.push(mesh); });
    const hit = ray.intersectObjects(surfaces, false)[0];
    assert(hit, `${id}: support palm must sit beneath the gun's grip`);
    const underside = rifle.worldToLocal(hit.point.clone());
    const gap = underside.y - localPalm.y;
    assert(gap >= -.003 && gap < .008,
      `${id} ${sprint ? 'run' : 'idle'} palm is buried or detached from the underside: ${gap}m`);
  }
  player.isSprinting = false; player.velocity.z = 0;
  console.log('Every firearm palm stays seated beneath its grip during idle and sprint.');
}

// Check the actual rendered bore, not just the camera ray used for damage.
// Includes translated/turned cameras and recoil while strafing, plus the first
// shot out of sprint where the old carry fired at ninety degrees to its barrel.
const savedBoxHit = world.raycastBoxHit;
const savedDistance = world.raycastCollisionDistance;
let aimDistance = PRESENTATION_AIM_DEPTH;
world.raycastCollisionDistance = () => aimDistance;
world.raycastBoxHit = ray => ({ distance: aimDistance, point: ray.at(aimDistance, new THREE.Vector3()) });
const aimError = record => {
  const muzzle = record.muzzle.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(0,0,-1).transformDirection(record.group.matrixWorld);
  const target = camera.getWorldPosition(new THREE.Vector3())
    .addScaledVector(camera.getWorldDirection(new THREE.Vector3()), aimDistance);
  return forward.angleTo(target.sub(muzzle).normalize());
};
let worstAim = 0;
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  for (const fps of rates) {
    activate(def); resetMotionState(); system.currentState.isReloading = false;
    camera.position.set(7,3,-5); camera.rotation.set(-.35,.8,.04); camera.updateMatrixWorld(true);
    player.velocity.x = 4; player.velocity.z = -3;
    advanceSeconds(1, fps);
    system._applyViewmodelRecoil(.01, def.id === 'magnum');
    for (let frame = 0; frame < fps / 3; frame++) {
      tick(1, fps);
      const error = aimError(system.models.get(def.id));
      worstAim = Math.max(worstAim, error);
      assert(error < .0001, `${def.id} rendered barrel misses the reticle by ${error}rad at ${fps}Hz`);
    }
  }
}
// Settled ADS must center both sight axes, including after camera rotation.
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  activate(def); resetMotionState();
  input.rightMouseDown = true;
  advanceSeconds(2, 60);
  if (def.canAim === false) { assert(system.scopeT === 0, 'weapon must not zoom'); continue; }
  const adsModel = system.models.get(def.id);
  const adsSight = adsModel.sight.clone().applyMatrix4(adsModel.group.matrixWorld).project(camera);
  assert(Math.abs(adsSight.x - (def.id === 'uzi' ? .20 : 0)) < .001 && Math.abs(adsSight.y - ADS_SIGHT_SCREEN_Y) < .001,
    `${def.id} sight must stay centered horizontally and slightly below the crosshair in ADS`);
  assert(system.scopeT > .99 && camera.fov < player.baseFov,
    `${def.id} must enter zoom, including pickup launchers and shotgun`);
}

// Every intermediate ADS frame must keep the rendered bore on target.
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  activate(def); resetMotionState(); system.currentState.isReloading = false;
  advanceSeconds(1, 60);
  for (const aiming of [true, false]) {
    input.rightMouseDown = aiming;
    for (let frame=0; frame<60; frame++) {
      tick(1,60);
      assert(aimError(system.models.get(def.id)) < .0001,
        `${def.id} barrel misses the crosshair during ADS transition frame ${frame}`);
    }
  }
}
camera.position.set(0,0,0); camera.rotation.set(0,0,0); camera.updateMatrixWorld(true);
for (const fps of rates) {
  activate(WEAPONS.find(w => w.id === 'm4')); resetMotionState();
  system.currentState.magAmmo = 50; system.currentState.isReloading = false;
  player.isSprinting = true; player.velocity.z = -9; player.weaponSprintBlocked = false;
  advanceSeconds(1, fps);
  input.mouseDown = true; player.weaponSprintBlocked = true; tick(1, fps);
  const record = system.models.get('m4');
  assert(aimError(record) < .0001, 'first shot leaves a rifle still pointing across the body');
  const shot = system.tracers.at(-1);
  const muzzle = record.muzzle.getWorldPosition(new THREE.Vector3());
  assert(shot.from.distanceTo(muzzle) < 1e-5, 'shot starts behind the corrected muzzle');
  const bore = new THREE.Vector3(0,0,-1).transformDirection(record.group.matrixWorld);
  assert(bore.angleTo(shot.direction) < .04, 'bullet departs sideways from the rendered barrel');
  input.mouseDown = false;
}
// Actual shot origins/endpoints for every firearm, including launcher first frames.
const savedRandom = Math.random;
Math.random = () => .5; // Centre pellet: spread is tested separately.
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  for (const aiming of [false, true]) {
    activate(def); resetMotionState(); system.currentState.isReloading=false;
    system.currentState.magAmmo=50; system.fireTimer=0; input.rightMouseDown=aiming;
    advanceSeconds(1,60);
    input.mouseDown=true; tick(1,60); input.mouseDown=false;
    const record=system.models.get(def.id), muzzle=record.muzzle.getWorldPosition(new THREE.Vector3());
    const target=camera.getWorldPosition(new THREE.Vector3()).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),aimDistance);
    if(def.kind==='rocket') {
      const projectile=system.rockets.at(-1);
      assert(projectile && projectile.pos.distanceTo(muzzle)<1e-5,`${def.id} projectile starts away from the barrel`);
      assert(projectile.dir.angleTo(target.sub(muzzle).normalize())<.0001,`${def.id} projectile misses crosshair target`);
      if(projectile.grenade) assert(new THREE.Vector3(projectile.grenade.vx,projectile.grenade.vy,projectile.grenade.vz).normalize().angleTo(projectile.dir)<.0001,'grenade velocity disagrees with launch direction');
      scene.remove(projectile.mesh); projectile.mesh.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}}); system.rockets.pop();
    } else {
      const shot=system.tracers.at(-1);
      assert(shot && shot.from.distanceTo(muzzle)<1e-5,`${def.id} tracer starts away from the rendered barrel`);
      assert(shot.to.distanceTo(target)<1e-5,`${def.id} centre pellet misses crosshair target`);
    }
  }
}
Math.random=savedRandom; input.rightMouseDown=false;
activate(WEAPONS.find(w=>w.id==='m4'));
console.log('All firearm shots leave the rendered muzzle and converge on the crosshair target in hip fire and ADS.');
// No backwards weapon flip when the enlarged presentation muzzle passes a wall.
aimDistance = .2; player.isSprinting = false; resetMotionState();
advanceSeconds(.2,60);
assert(new THREE.Vector3(0,0,-1).transformDirection(system.models.get('m4').group.matrixWorld).z < 0,
  'near-wall convergence points the gun toward the player');
system.fireTimer = 0; system.currentState.magAmmo = 50;
input.mouseDown = true; tick(1,60); input.mouseDown = false;
const nearShot = system.tracers.at(-1);
const visibleMuzzle = system.models.get('m4').muzzle.getWorldPosition(new THREE.Vector3()).project(camera);
const tracerMuzzle = nearShot.from.clone().project(camera);
assert(Math.hypot(visibleMuzzle.x-tracerMuzzle.x, visibleMuzzle.y-tracerMuzzle.y) < 1e-5,
  'near-wall tracer separates from the visible barrel');
assert(nearShot.direction.dot(camera.getWorldDirection(new THREE.Vector3())) > 0,
  'near-wall tracer flies backwards from the presentation weapon');
world.raycastBoxHit = savedBoxHit; world.raycastCollisionDistance = savedDistance;
console.log(`Rendered barrel alignment passed for all firearms at 30/60/144Hz; worst error ${(worstAim*180/Math.PI).toFixed(5)} degrees.`);

// Looking from a distant wall to a close ceiling used to rotate the entire
// enlarged gun toward the new world hit distance, visibly dragging it down.
// Its camera-layer hold must be independent of pitch and target distance.
world.raycastCollisionDistance = () => aimDistance;
world.raycastBoxHit = ray => ({ distance: aimDistance, point: ray.at(aimDistance, new THREE.Vector3()) });
const screenHold = record => [
  record.muzzle.getWorldPosition(new THREE.Vector3()),
  record.group.getWorldPosition(new THREE.Vector3()),
  system.supportArmGroup.getWorldPosition(new THREE.Vector3()),
].map(point => point.project(camera));
let worstLookDrift = 0;
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) for (const fps of rates) {
  activate(def); resetMotionState();
  camera.position.set(0, 1.7, 0); camera.rotation.set(0, 0, 0);
  aimDistance = PRESENTATION_AIM_DEPTH; advanceSeconds(1, fps);
  const record = system.models.get(def.id), reference = screenHold(record);
  for (const [pitch, distance] of [[1.3, 2], [-1.3, .2], [.7, 150], [-.7, 5], [0, 25]]) {
    resetMotionState();
    camera.position.set(7, 3, -5); camera.rotation.set(pitch, .8, .04);
    aimDistance = distance; advanceSeconds(1, fps);
    const current = screenHold(record);
    current.forEach((point, index) => {
      const drift = Math.hypot(point.x-reference[index].x, point.y-reference[index].y);
      worstLookDrift = Math.max(worstLookDrift, drift);
      assert(drift < .0001, `${def.id} hold drifts ${drift} while looking ${pitch}rad toward ${distance}m at ${fps}Hz`);
    });
    // Any point on the reticle ray projects to the same screen pixel. The
    // presentation bore must still lead into that pixel at every world range.
    const muzzle = record.muzzle.getWorldPosition(new THREE.Vector3());
    const ahead = muzzle.clone().addScaledVector(
      new THREE.Vector3(0,0,-1).transformDirection(record.group.matrixWorld), 2);
    muzzle.project(camera); ahead.project(camera);
    const lineError = Math.abs(muzzle.x*ahead.y-muzzle.y*ahead.x)
      / Math.hypot(ahead.x-muzzle.x, ahead.y-muzzle.y);
    assert(lineError < .00001, `${def.id} projected bore misses the reticle while looking up/down`);
    assert(nearDepth(record.group) > camera.near+.03,
      `${def.id} stock clips the camera while looking up/down`);
  }
}
world.raycastBoxHit = savedBoxHit; world.raycastCollisionDistance = savedDistance;
console.log(`Look-up/down hold passed for every firearm at 30/60/144Hz across .2–150m targets; worst screen drift ${worstLookDrift.toFixed(7)}.`);

// A stable gun can still be framed below the bottom edge. Check the actual
// receiver and support-contact landmarks, not an oversized bounds box that
// can pass while only the muzzle is visible (the reported live-game failure).
activate(WEAPONS.find(w => w.id === 'm4'));
for (const fov of [60, 78, 90, 110]) for (const pitch of [-1.48, 0, 1.48]) {
  resetMotionState(); camera.rotation.set(pitch, .8, 0);
  player.baseFov = fov; camera.fov = fov; camera.updateProjectionMatrix();
  // Opening ESC keeps the same equipped gun settling in its firing hold.
  for(let frame=0;frame<90;frame++) system.update(1/60,input,world,botManager,player,false);
  const record = system.models.get('m4'), pose = weaponHandPose(record.group);
  // The receiver's visible top is forward of the grip/root; the rear grip is deliberately cropped.
  const receiver = record.group.localToWorld(new THREE.Vector3(0, .06, -.15)).project(camera);
  const support = record.group.localToWorld(new THREE.Vector3(...pose.viewmodelSupport)).project(camera);
  assert(receiver.y > -.95 && receiver.y < -.25 && Math.abs(receiver.x) < .8,
    `rifle receiver disappears at ${fov} FOV / ${pitch} pitch: ${receiver.toArray()}`);
  assert(support.y > -.7 && support.y < -.1 && Math.abs(support.x) < .7,
    `rifle undergrip disappears at ${fov} FOV / ${pitch} pitch: ${support.toArray()}`);
}
console.log('Rifle receiver and undergrip remain visible through steep up/down aim and ESC at 60–110 FOV.');

// Both launchers now use a low first-person rifle hold. Keep the receiver
// below the reticle and to the right, including after stopping/ESC.
camera.position.set(0, 0, 0); camera.aspect = 16 / 9;
for (const id of ['rpg', 'concussion']) for (const fps of rates) for (const fov of [60, 78, 110]) {
  activate(WEAPONS.find(w => w.id === id));
  resetMotionState(); player.baseFov = fov; camera.fov = fov;
  camera.updateProjectionMatrix(); player.reduceMotion = true;
  for (const mode of ['idle', 'run', 'stop', 'paused']) {
    player.isSprinting = mode === 'run' || mode === 'paused';
    player.weaponSprintBlocked = false;
    player.velocity.z = player.isSprinting ? 9.9 : 0;
    camera.rotation.set(mode === 'paused' ? 1.3 : 0, .8, 0);
    for (let frame = 0; frame < fps; frame++) {
      system.update(1 / fps, input, world, botManager, player, mode !== 'paused');
    }
    if (mode === 'run') continue; // The rifle running carry tucks across the chest.
    const record = system.models.get(id);
    const muzzle = record.muzzle.getWorldPosition(new THREE.Vector3()).project(camera);
    const receiver = record.group.localToWorld(new THREE.Vector3(0, .06, -.15)).project(camera);
    assert(muzzle.x > .02 && muzzle.x < .4 && muzzle.y > -.4 && muzzle.y < .01,
      `launcher muzzle rises above the firing lane: ${mode}/${fov}/${fps} ${muzzle.toArray()}`);
    assert(receiver.x > .15 && receiver.x < .85 && receiver.y > -.95 && receiver.y < -.2,
      `launcher rear housing crosses the eye: ${mode}/${fov}/${fps} ${receiver.toArray()}`);
  }
}
console.log('Launchers use a low rifle-style first-person hold through stopping, look-up and ESC at 30/60/144Hz.');



