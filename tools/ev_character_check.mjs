import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { STATURE } from '../src/player/Proportions.js';
import { WALK_SPEED, SPRINT_MULT } from '../src/sim/MovementConfig.js';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const bytes = fs.readFileSync(new URL('../public/ev-default.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
installEvCharacter(gltf);
const a = buildEvCharacter(), b = buildEvCharacter();
const pos = (o) => o.getWorldPosition(new THREE.Vector3());
assert(a.userData.isEvCharacter);
assert.equal(a.userData.animationActions.length, 13);
assert.equal(Object.keys(a.userData.bones).length, 52);
assert.notEqual(a.userData.bones.Bip001_Head, b.userData.bones.Bip001_Head);
assert.notEqual(a.userData.animationMixer, b.userData.animationMixer);
let meshes = 0;
a.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  meshes++;
  const other = b.getObjectByName(o.name);
  assert.equal(o.geometry, other.geometry);
  assert.equal(o.geometry.userData.shared, true);
  assert.notEqual(o.material, other.material);
  assert.notEqual(o.skeleton, other.skeleton);
});
assert(meshes >= 2);
const untouched = b.userData.bones.Bip001_Pelvis.quaternion.clone();
const cases = [
  ['idle', 0, false, {}, 0],
  ['walk', 1.2, false, {}, 1],
  ['run', 6.2, true, {}, 1],
  ['normal-speed', WALK_SPEED, false, {}, 1],
  ['full-sprint', WALK_SPEED * SPRINT_MULT, true, {}, 1],
  ['shoot', 0, false, { firing: 1 }, 3],
  ['walk-shoot', 1.2, false, { firing: 1 }, 4],
  ['run-shoot', 6.2, true, { firing: 1 }, 4],
  ['crouch', 0, false, { crouch: 1 }, 7],
  ['crouch-shoot', 0, false, { crouch: 1, firing: 1 }, 8],
  ['crouch-walk', 1, false, { crouch: 1 }, 9],
  ['crouch-walk-shoot', 1, false, { crouch: 1, firing: 1 }, 10],
  ['jump-rise', 2, false, { vy: 8 }, 12, false],
  ['jump-fall', 2, false, { vy: -8 }, 12, false],
];
const results = [];
for (const [name, speed, sprint, state, clip, grounded = true] of cases) {
  const c = buildEvCharacter();
  const u = c.userData;
  u.setLocomotion(speed, grounded, sprint);
  u.setActionState({ crouch: 0, firing: 0, reload: 0, slide: 0, ...state });
  let low = Infinity, high = -Infinity;
  let muzzleZ = 0;
  for (let i = 0; i < 180; i++) {
    u.mixer.update(1 / 60);
    c.updateMatrixWorld(true);
    for (const bone of Object.values(u.bones)) {
      assert(bone.matrixWorld.elements.every(Number.isFinite), `${name}: finite bone transforms`);
      assert(Math.abs(bone.quaternion.length() - 1) < 1e-4, `${name}: unit bone rotations`);
    }
    if (i < 60 || i % 6) continue;
    const box = new THREE.Box3();
    c.traverse((o) => { if (o.isSkinnedMesh) box.union(new THREE.Box3().setFromObject(o, true)); });
    low = Math.min(low, box.min.y); high = Math.max(high, box.max.y);
    const muzzle = pos(c.getObjectByName('BIND_BULLET'));
    const grip = pos(c.getObjectByName('BIND_RIGHTHAND'));
    muzzleZ = muzzle.z - grip.z;
    assert(muzzleZ < -0.1, `${name}: muzzle faces forward -Z`);
  }
  assert.equal(u.activeAnimation, gltf.animations[clip].name, `${name}: authored animation selection`);
  if (grounded) assert(low > -0.025, `${name}: skinned feet penetrate the floor (${low})`);
  results.push({ name, low, high, cadence: u.animationCadence, stride: u.strideScale, muzzleZ });
}
const reset = buildEvCharacter();
reset.userData.setLocomotion(6, false, true, 1, 0, 1);
reset.userData.setAim(0.7, 0.4);
reset.userData.setActionState({ crouch: 1, firing: 1, reload: 0.5 });
reset.userData.triggerFire();
for (let i = 0; i < 60; i++) reset.userData.mixer.update(1 / 60);
reset.userData.triggerTeleport();
assert.equal(reset.userData.activeAnimation, gltf.animations[0].name, 'respawn returns directly to armed idle');
for (const [name, bone] of Object.entries(reset.userData.bones)) {
  const expected = b.userData.bones[name].quaternion.toArray();
  assert(bone.quaternion.toArray().every((v, i) => Math.abs(v - expected[i]) < 1e-6), `${name}: respawn clears aim/stride/action pose`);
}
assert(b.userData.bones.Bip001_Pelvis.quaternion.equals(untouched), 'animating an instance cannot move another skeleton');
console.log(JSON.stringify({ stature: STATURE, measuredSpeeds: a.userData.measuredSpeeds, states: results }, null, 2));
console.log('EV character: real asset clones, skeletons, finite animation states and forward-facing rifle passed');

// Real external weapon geometry: verify the world axes, grip and blade arc.
const noop = () => {};
const ctx = new Proxy({}, { get(o,k) { if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({addColorStop:noop}); return o[k] ??= noop; } });
globalThis.document = { createElement: () => ({getContext: () => ctx}) };
const { buildWeaponModel } = await import('../src/weapons/WeaponModels.js');
const { BLENDER_ARSENAL, buildBlenderWeapon } = await import('../src/weapons/BlenderArsenal.js');
const { WEAPONS } = await import('../src/weapons/weaponDefs.js');
const { weaponHandPose } = await import('../src/weapons/WeaponHandPoses.js');
for (const def of WEAPONS) {
  const c = buildEvCharacter(), u = c.userData;
  let w = buildWeaponModel(def).group;
  if (BLENDER_ARSENAL[def.id]) {
    const data = fs.readFileSync(new URL('../public' + BLENDER_ARSENAL[def.id], import.meta.url));
    const asset = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    w = buildBlenderWeapon(asset.scene, def).group;
  }
  u.attachWeapon(w, def.kind === 'melee');
  if (def.kind !== 'melee') {
    u.setActionState({firing:1}); u.setAim(.35,.3); u.mixer.update(1/144);
    const tip=w.getObjectByName('BIND_BULLET') || w.getObjectByName('muzzle');
    if(tip && w.parent) assert(u.getMuzzleWorldPosition(new THREE.Vector3()).distanceTo(pos(tip))<1e-6, def.id+': visible barrel origin');
    if(w.parent) {
      const forward=new THREE.Vector3(0,0,-1).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
      const aim=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(.35,.3,0,'YXZ'));
      assert(forward.dot(aim)>.999,def.id+': first firing frame must match aim');
    }
    u.setActionState({firing:0});u.setAim(0);
  }
  for (const yaw of [0, 1.4, -2.5]) {
    c.rotation.y = yaw;
    u.setLocomotion(4, true, false); u.setAim(0);
    for (let i=0;i<45;i++) u.mixer.update(1/60);
    c.updateMatrixWorld(true);
    const q = w.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0,0,-1).applyQuaternion(q);
    const up = new THREE.Vector3(0,1,0).applyQuaternion(q);
    if (def.kind !== 'melee') {
      assert(up.y > .99, `${def.id}: upside-down third-person weapon`);
      assert(forward.dot(new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw))) > .99, `${def.id}: muzzle points away from aim`);
    } else if (def.id === 'sword') {
      assert(forward.y > .9, 'sword guard must point up');
      for (const phase of [1, .2, .55, .8]) {
        u.setActionState({swing:phase}); u.mixer.update(1/60); c.updateMatrixWorld(true);
        const support = new THREE.Vector3(...weaponHandPose(w).support).applyMatrix4(w.matrixWorld);
        assert(support.distanceTo(pos(u.bones.Bip001_L_Hand)) < .025, 'sword support hand must stay on hilt throughout slash');
      }
      u.setActionState({swing:.55}); u.mixer.update(1/60); c.updateMatrixWorld(true);
      const cutDirection = new THREE.Vector3(0,0,-1).applyQuaternion(w.getWorldQuaternion(q));
      assert(cutDirection.y < -.6, 'sword must cut down through the target');
      const cuttingEdge = new THREE.Vector3(-1,0,0).applyQuaternion(w.getWorldQuaternion(q));
      assert(cuttingEdge.y < -.6, 'sword must cut with its energy edge, not slap with its flat side');
      u.setActionState({swing:1});
    }
    if (def.id === 'rpg') {
      const saddle = new THREE.Vector3(0, -.018, .14).applyMatrix4(w.matrixWorld);
      assert(saddle.distanceTo(pos(u.bones.Bip001_R_UpperArm)) < .08, 'launcher saddle must stay on shoulder');
      const palm = new THREE.Vector3(...weaponHandPose(w).support).applyMatrix4(w.matrixWorld);
      assert(palm.distanceTo(pos(u.bones.Bip001_L_Hand)) < .04, 'launcher support hand must remain attached');
    }
    const grip = new THREE.Vector3(...weaponHandPose(w).trigger).applyMatrix4(w.matrixWorld);
    assert(grip.distanceTo(pos(u.bones.Bip001_R_Hand)) < .001, `${def.id}: trigger grip detached`);
  }
  if (def.kind !== 'melee' && def.id !== 'rpg') {
    let supportError=0, gripForward=Infinity;
    for (const [speed,sprint] of [[0,false],[4,false],[8,true]]) for (const aim of [-.6,0,.6]) {
      u.setLocomotion(speed,true,sprint); u.setAim(aim);
      for(let i=0;i<60;i++)u.mixer.update(1/60);
      c.updateMatrixWorld(true);
      const contacts=weaponHandPose(w);
      const grip=new THREE.Vector3(...contacts.trigger).applyMatrix4(w.matrixWorld);
      assert(grip.distanceTo(pos(u.bones.Bip001_R_Hand))<.001,`${def.id}: grip separates while moving/aiming`);
      const forward=new THREE.Vector3(0,0,-1).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
      gripForward=Math.min(gripForward,grip.clone().sub(pos(u.bones.Bip001_Spine1)).dot(forward));
      if(contacts.supportVisible!==false) {
        const palm=w.worldToLocal(pos(u.bones.Bip001_L_Hand));
        supportError=Math.max(supportError,Math.hypot(palm.x-contacts.support[0],palm.y-contacts.support[1]));
        assert(palm.z >= contacts.support[2]-.02 && palm.z <= contacts.trigger[2]-.04,
          `${def.id}: support palm must stay along the underside, ahead of the trigger`);
      }
    }
    assert(gripForward > .45,`${def.id}: grip is tucked back into the chest`);
    assert(supportError < .025,`${def.id}: support hand floats away from handguard (${supportError})`);
    console.log(`${def.id} carry: grip ahead of chest ${gripForward.toFixed(3)}m; support error ${supportError.toFixed(3)}m`);
  }
}
console.log('External weapons: upright gun axes, attached grips and downward sword arc passed');

for (const speed of [1.2, 4.2, 6.2, 6.6, 8, 9.24, WALK_SPEED, WALK_SPEED*SPRINT_MULT]) for (const firing of [0,1]) {
  const c = buildEvCharacter(), u = c.userData;
  u.setLocomotion(speed, true, speed > 6); u.setActionState({firing});
  for (let i=0;i<60;i++) u.mixer.update(1/60);
  const index = u.animationActions.findIndex(a => a.getEffectiveWeight() > .99);
  const delivered = u.measuredSpeeds[index] * u.animationCadence * u.strideScale;
  assert(Math.abs(delivered-speed) < .05, `speed ${speed} firing ${firing}: gait delivery ${delivered}`);
}
console.log('Walking/running and firing strides track actual movement speed');

for (const fallSpeed of [2,12]) {
  const c = buildEvCharacter(), u = c.userData;
  u.setLocomotion(0,false,false);u.setActionState({vy:-fallSpeed});
  for(let i=0;i<20;i++)u.mixer.update(1/60);
  u.setLocomotion(0,true,false);u.setActionState({vy:0});
  for(let i=0;i<12;i++)u.mixer.update(1/60);
  assert.equal(u.activeAnimation,gltf.animations[fallSpeed===2?0:12].name,'landing recovery must scale with impact speed');
}
console.log('Landing recovery scales with actual falling speed');

// Powered takeoff is visible beneath both boots; walking off a ledge is not.
for(const fps of [30,60,144]) {
 const c=buildEvCharacter(),u=c.userData;
 u.setLocomotion(0,true,false);u.mixer.update(1/fps);
 const standingFoot=pos(u.bones.Bip001_L_Foot).y;
 u.setLocomotion(4,false,false);u.setActionState({vy:12});
 for(let i=0;i<Math.ceil(fps*.1);i++)u.mixer.update(1/fps);
 assert(c.getObjectByName('boot_jet_L').visible && c.getObjectByName('boot_jet_R').visible,'takeoff must show both jets');
 assert(pos(u.bones.Bip001_L_Foot).y > standingFoot+.1,'rising legs must tuck above standing pose');
 for(let i=0;i<Math.ceil(fps*.3);i++)u.mixer.update(1/fps);
 assert(!c.getObjectByName('boot_jet_L').visible,'jets must expire in midair');
 // Network interpolation can smooth the vertical impulse: the authoritative
 // second-jump marker must still replay takeoff, even without a large vy step.
 u.setActionState({vy:11.5,airJumpUsed:1});u.mixer.update(1/fps);
 assert(c.getObjectByName('boot_jet_L').visible,'double jump must replay remote takeoff');
 for(let i=0;i<Math.ceil(fps*.3);i++)u.mixer.update(1/fps);
 assert(!c.getObjectByName('boot_jet_L').visible,'double jump jets must expire');
 u.triggerTeleport();u.setLocomotion(0,false,false);u.setActionState({vy:-3});u.mixer.update(1/fps);
 assert(!c.getObjectByName('boot_jet_L').visible,'falling must not ignite jets');
}
console.log('Jump reference passed: tucked feet and short takeoff jets at 30/60/144Hz; no freefall flames.');

// Bot deaths move the entire frozen rig together and stay supported by the map.
const { Avatar } = await import('../src/player/Avatar.js');
for (const hz of [30, 60, 144]) for (const yaw of [0, 1.2, -2.4]) {
  const avatar = new Avatar(new THREE.Scene());
  const state = { position: new THREE.Vector3(2, 3, 4), yaw, alive: true, grounded: true, speed: 0 };
  avatar.update(1 / hz, state);
  const bones = avatar.group.userData.bones;
  const before = Object.values(bones).map(b => b.quaternion.clone());
  for (let t = 0; t < .95; t += 1 / hz) {
    avatar.update(1 / hz, { ...state, alive: false, isBot: true, deathFloor: 3 });
    Object.values(bones).forEach((b, i) => assert(b.quaternion.toArray().every((v, k) => Math.abs(v - before[i].toArray()[k]) < .000001), 'bot limbs moved independently during fall'));
    avatar.group.updateMatrixWorld(true);
    let bottom = Infinity;
    avatar.group.traverseVisible(m => {
      if (!m.isSkinnedMesh) return;
      m.skeleton.update();
      for (let i = 0; i < m.geometry.attributes.position.count; i++) {
        const v = m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld);
        bottom = Math.min(bottom, v.y);
      }
    });
    assert(bottom >= 2.999 && bottom < 3.02, `bot penetrated or floated above floor: ${bottom}`);
  }
}
console.log('whole-body bot falls preserve all bones and floor contact at 30/60/144Hz');

// Native-rifle fallback must return the live gun, never a discarded marker.
{
 const { Avatar } = await import('../src/player/Avatar.js');
 const avatar=Object.create(Avatar.prototype);
 avatar.group=buildEvCharacter();
 const replacement=new THREE.Group(); replacement.userData.weaponId='m4';
 avatar.weapon=replacement; avatar.muzzle=new THREE.Object3D(); replacement.add(avatar.muzzle);
 avatar.group.userData.attachWeapon(replacement);
 avatar.group.position.set(11,2,-5); avatar.group.rotation.y=1.2;
 avatar.group.userData.mixer.update(1/60);
 const expected=pos(avatar.group.getObjectByName('BIND_BULLET'));
 assert(avatar.getMuzzleWorldPosition(new THREE.Vector3()).distanceTo(expected)<1e-6,'native rifle muzzle must be authoritative for rendering');
}

// Server-authored momentum must also animate bot corpses, retaining rigid limbs.
{
 const {createDeathReaction,sampleDeathReaction}=await import('../src/sim/DeathReaction.js');
 for(const hz of [30,60,144]){
  const avatar=new Avatar(new THREE.Scene());
  const state={position:new THREE.Vector3(0,4,0),yaw:.7,alive:true,grounded:false,speed:0};
  avatar.update(1/hz,state);
  const bones=Object.values(avatar.group.userData.bones),pose=bones.map(b=>b.quaternion.clone());
  const deathReaction=createDeathReaction('levershotgun',{px:0,py:4,pz:0},{x:0,y:4,z:3},(x,y,z,dx,dy,dz,max)=>dy===-1?y:max);
  for(let i=0;i<hz;i++)avatar.update(1/hz,{...state,alive:false,isBot:true,deathReaction});
  const sampled=sampleDeathReaction(deathReaction,1,avatar._deathYaw);
  assert(Math.abs(avatar.group.position.z-sampled.z)<1e-6,'bot ignored death momentum');
  bones.forEach((b,i)=>assert(b.quaternion.toArray().every((v,k)=>Math.abs(v-pose[i].toArray()[k])<1e-6),'bot legs separated from body'));
  avatar.group.updateMatrixWorld(true);let bottom=Infinity;
  avatar.group.traverseVisible(m=>{if(!m.isMesh||!m.geometry?.attributes.position)return;if(m.isSkinnedMesh)m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++)bottom=Math.min(bottom,m.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(m.matrixWorld).y);});
  assert(Math.abs(bottom-(4+sampled.air))<.002,'bot did not descend toward real ground: '+bottom+' expected '+(4+sampled.air));
 }
}
