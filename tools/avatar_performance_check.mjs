import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { getSkin, BOT_SKIN } from '../src/player/skins.js';
import { PLAYER_WORLD_MODEL_SCALE } from '../src/player/Proportions.js';
import { BLENDER_ARSENAL, buildBlenderWeapon } from '../src/weapons/BlenderArsenal.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';

const moduleArg = process.argv.indexOf('--module');
const { installEvCharacter, buildEvCharacter } = await import(moduleArg >= 0
  ? process.argv[moduleArg + 1] : '../src/player/EvCharacter.js');

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
// Textures do not participate in CPU pose evaluation and need no DOM decoder.
loader.register(() => ({ name: 'CPU_POSE_TEXTURES', loadTexture: async () => new THREE.Texture() }));
async function asset(path) {
  const bytes = fs.readFileSync(new URL('../public' + path, import.meta.url));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
installEvCharacter(await asset('/ev-default.glb'));
const skins = [getSkin('default'), BOT_SKIN];
for (const skin of skins) installAuthoredSkin(skin.id, await asset(skin.model));
const weapons = new Map();
for (const id of ['m4', 'uzi', 'rpg', 'sword']) {
  const def = WEAPONS.find(w => w.id === id);
  weapons.set(id, { def, asset: await asset(BLENDER_ARSENAL[id]) });
}
async function character(id, skin, index = 0) {
  const body = buildEvCharacter(skin);
  assert.equal(await body.userData.skinReady, true, `${skin.name}: authored skin did not load`);
  assert.equal(body.userData.authoredSkinId, skin.id, `${skin.name}: base-rig appearance is not the requested skin`);
  const armor = body.getObjectByName('Blender authored armor');
  assert(armor?.children.length > 0 && armor.visible, `${skin.name}: authored surfaces are missing`);
  assert(armor.children.every(mesh => mesh.isSkinnedMesh && mesh.visible
    && mesh.skeleton.bones.every(bone => body.userData.bones[bone.name] === bone)),
  `${skin.name}: armor must render on this character's animated skeleton`);
  body.scale.multiplyScalar(PLAYER_WORLD_MODEL_SCALE);
  const source = weapons.get(id);
  const weapon = buildBlenderWeapon(source.asset.scene, source.def).group;
  body.userData.attachWeapon(weapon, source.def.kind === 'melee');
  body.position.set(index * 2, 0, -index * 3);
  return { body, weapon, armor };
}
function drive({ body }, frame, index = 0) {
  const t = frame / 60, mode = Math.floor(frame / 90) % 10;
  const grounded = mode !== 5;
  const sprint = mode === 2 || mode === 3;
  const speed = mode === 0 ? 0 : sprint ? 6.2 : 2;
  body.position.x = index * 2 + Math.sin(t * .2) * 2;
  body.position.z = -index * 3 - t * speed;
  body.rotation.y = Math.sin(t * .3) * .4;
  body.userData.setLocomotion(speed, grounded, sprint, 0, mode === 3 ? 0 : mode === 4 ? -1 : 1, mode === 3 ? 1 : 0);
  body.userData.setAim(Math.sin(t * .8) * .45, Math.sin(t * .5) * .2);
  body.userData.setActionState({
    firing: mode === 6 ? 1 : 0, crouch: mode === 7 ? 1 : 0,
    slide: mode === 8 ? 1 : 0, reload: mode === 9 ? (frame % 90) / 90 : 0,
    swing: (frame % 60) / 60, vy: grounded ? 0 : 5 - (frame % 90) / 9,
  });
  if (mode === 6 && frame % 12 === 0) body.userData.triggerFire();
  body.userData.mixer.update(1 / 60);
  body.updateMatrixWorld(true);
}
const fixtures = [];
function snapshot(id, frame, actor) {
  const objects = [...Object.values(actor.body.userData.bones), actor.weapon, ...actor.armor.children];
  const values = objects.flatMap(object => object.matrixWorld.toArray());
  assert(values.every(Number.isFinite), id + ': finite animated transforms');
  fixtures.push({ id, frame, values });
}
for (const skin of skins) for (const weaponId of weapons.keys()) {
  const id = `${skin.id}/${weaponId}`;
  const actor = await character(weaponId, skin);
  for (let frame = 0; frame < 900; frame++) {
    drive(actor, frame);
    if (frame % 30 !== 0) continue;
    snapshot(id, frame, actor);
  }
  for (let frame = 0; frame < 90; frame++) {
    actor.body.userData.setDeathState(Math.max(.0001, frame / 60), 1, frame / 60);
    actor.body.userData.mixer.update(1 / 60);
    actor.body.updateMatrixWorld(true);
    if (frame % 15 === 0) snapshot(id, 900 + frame, actor);
  }
  actor.body.userData.triggerTeleport();
  actor.body.updateMatrixWorld(true);
  snapshot(id, 1000, actor);
}
const save = process.argv.indexOf('--save');
if (save >= 0) fs.writeFileSync(process.argv[save + 1], JSON.stringify(fixtures));
const compare = process.argv.indexOf('--compare');
let maxPoseError = 0;
if (compare >= 0) {
  const expected = JSON.parse(fs.readFileSync(process.argv[compare + 1], 'utf8'));
  assert.equal(fixtures.length, expected.length);
  for (let f = 0; f < fixtures.length; f++) {
    const actual = fixtures[f], before = expected[f];
    assert.equal(actual.id, before.id); assert.equal(actual.frame, before.frame);
    actual.values.forEach((v, n) => { maxPoseError = Math.max(maxPoseError, Math.abs(v - before.values[n])); });
  }
  assert(maxPoseError < 1e-8, `animation pose changed (${maxPoseError})`);
}

// Four Default Reforged players and four Bot Reforged bots, using the current
// authored meshes on the shared animation rig. No GPU/FPS claims come from this.
const actors = await Promise.all(Array.from({ length: 8 }, (_, i) =>
  character([...weapons.keys()][i % 4], skins[Math.floor(i / 4)], i)));
for (let frame = 0; frame < 180; frame++) actors.forEach((actor, i) => drive(actor, frame, i));
const matrixMultiply = THREE.Matrix4.prototype.multiplyMatrices;
let matrixMultiplies = 0;
THREE.Matrix4.prototype.multiplyMatrices = function(a, b) { matrixMultiplies++; return matrixMultiply.call(this, a, b); };
actors.forEach((actor, i) => drive(actor, 240, i));
THREE.Matrix4.prototype.multiplyMatrices = matrixMultiply;
// The shipped Reforged fixtures require 7,608 multiplies here (10,640 before
// optimization). Unlike wall-clock timing this budget is deterministic; review
// it alongside any intentional skeleton/mesh changes instead of adding slack.
if (moduleArg < 0) assert(matrixMultiplies <= 7608,
  `eight avatars repeated unnecessary hierarchy work (${matrixMultiplies} matrix multiplications)`);
const samples = [];
for (let run = 0; run < 5; run++) {
  const start = performance.now();
  for (let frame = 0; frame < 600; frame++) actors.forEach((actor, i) => drive(actor, frame, i));
  samples.push((performance.now() - start) / 600);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ actors: 8, skins: skins.map(skin => skin.name), poseSamples: fixtures.length, maxPoseError,
  matrixMultipliesPerFrame: matrixMultiplies, cpuMsPerFrame: { median: samples[2], min: samples[0], max: samples[4] } }, null, 2));
