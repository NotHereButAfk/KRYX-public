import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  ARMOR_TYPES,
  PLAYABLE_ARMOR_IDS,
  loadArmorType,
  normalizeArmorType,
  saveArmorType,
} from '../src/player/ArmorTypes.js';
import { buildPreviewCharacter } from '../src/player/PreviewCharacter.js';
import { installEvCharacter } from '../src/player/EvCharacter.js';
import { installAuthoredSkin } from '../src/player/AuthoredSkins.js';
import { getSkin, BOT_SKIN } from '../src/player/skins.js';
import { disposeModel } from '../src/core/ModelResources.js';
import { Avatar } from '../src/player/Avatar.js';
import { Bot } from '../src/entities/Bot.js';
import { PLAYER_WORLD_MODEL_SCALE } from '../src/player/Proportions.js';

const expected = ['vanguard'];
assert.deepEqual(PLAYABLE_ARMOR_IDS, expected,
  'the live armor roster must contain only the current Reforged rig');
assert.deepEqual(ARMOR_TYPES.map((armor) => armor.id), expected,
  'the armor menu and runtime roster must share the same ids');

const legacy = ['assault', 'recon', 'heavy', 'stealth', 'striker', 'phantom'];
for (const oldId of legacy) {
  assert.equal(normalizeArmorType(oldId), 'vanguard', `${oldId} did not migrate to the current rig`);
}
assert.equal(normalizeArmorType('not-a-model'), 'vanguard');

const values = new Map([['sio_armor_type', 'stealth']]);
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
assert.equal(loadArmorType(), 'vanguard', 'saved legacy selection did not migrate on load');
assert.equal(values.get('sio_armor_type'), 'vanguard');
assert.equal(ARMOR_TYPES[0].name, 'Default Reforged');
saveArmorType('heavy');
assert.equal(values.get('sio_armor_type'), 'vanguard', 'save persisted a retired Soldier id');

// An early render cannot flash a retired body while the current rig loads.
const pending = buildPreviewCharacter(getSkin('default'), 'phantom');
assert.equal(pending.userData.loadingCharacter, true);
let pendingMeshes = 0;
pending.traverse(node => { if (node.isMesh) pendingMeshes++; });
assert.equal(pendingMeshes, 0, 'loading placeholder rendered old armor');
const scene = new THREE.Scene();
const earlyAvatar = new Avatar(scene, { skin: getSkin('default'), armorTypeId: 'phantom', weaponId: 'm4' });
const avatarPosition = new THREE.Vector3(4, 2, -9);
earlyAvatar.group.position.copy(avatarPosition);
earlyAvatar.group.rotation.y = 0.7;
assert.equal(earlyAvatar.weapon, null, 'loading avatar exposed a floating gun');
assert.equal(earlyAvatar.group.children.length, 0, 'loading avatar exposed retired body geometry');
const earlyBot = new Bot({}, new THREE.Vector3(-3, 1, 8));
scene.add(earlyBot.mesh);
earlyBot.mesh.rotation.y = -0.4;
earlyBot.health = 37;
earlyBot.healthBarFg.scale.x = 0.37;
const botPosition = earlyBot.mesh.position.clone();
const healthBar = earlyBot.healthBarGroup;
assert.equal(earlyBot._weaponMesh, null, 'loading bot exposed a floating gun');
assert.deepEqual(earlyBot.mesh.children, [healthBar], 'loading bot contains unexpected character geometry');

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const load = async (path) => {
  const bytes = readFileSync(new URL('../public' + path, import.meta.url));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};
installEvCharacter(await load('/ev-default.glb'));
for (const skin of [getSkin('default'), BOT_SKIN]) installAuthoredSkin(skin.id, await load(skin.model));
earlyAvatar.update(0, { position: avatarPosition, yaw: 0.7, pitch: 0, alive: true, speed: 0, grounded: true });
earlyBot.refreshWeaponModel();
await Promise.all([earlyAvatar.group.userData.skinReady, earlyBot.mesh.userData.skinReady]);
assert.equal(earlyAvatar.group.userData.authoredSkinId, getSkin('default').id);
assert.equal(earlyBot.mesh.userData.authoredSkinId, BOT_SKIN.id);
assert(earlyAvatar.group.position.distanceTo(avatarPosition) < 1e-9, 'avatar upgrade lost its position');
assert(earlyBot.mesh.position.distanceTo(botPosition) < 1e-9, 'bot upgrade lost its position');
assert.equal(earlyBot.mesh.rotation.y, -0.4, 'bot upgrade lost its facing');
assert.equal(earlyBot.health, 37, 'bot upgrade reset health');
assert.equal(earlyBot.healthBarGroup, healthBar, 'bot upgrade replaced its health bar');
assert.equal(healthBar.parent, earlyBot.mesh, 'bot upgrade detached its health bar');
assert.equal(earlyBot.healthBarFg.scale.x, 0.37);
assert.equal(earlyAvatar.group.scale.x, PLAYER_WORLD_MODEL_SCALE);
assert.equal(earlyBot.mesh.scale.x, PLAYER_WORLD_MODEL_SCALE);
assert(earlyAvatar.getMuzzleWorldPosition(new THREE.Vector3()), 'upgraded avatar did not attach a gun');
assert(earlyBot.mesh.userData.getMuzzleWorldPosition(new THREE.Vector3()), 'upgraded bot did not attach a gun');
earlyAvatar.dispose();
disposeModel(earlyBot.mesh);
for (const skin of [getSkin('default'), BOT_SKIN]) {
  for (const id of [...PLAYABLE_ARMOR_IDS, ...legacy]) {
    const body = buildPreviewCharacter(skin, id);
    assert.equal(body.userData?.isEvCharacter, true, `${id} did not build the current rig`);
    await body.userData.skinReady;
    assert.equal(body.userData.authoredSkinId, skin.id, `${id} changed the current ${skin.name} appearance`);
    disposeModel(body);
  }
}

assert.equal(PLAYER_WORLD_MODEL_SCALE, 1.0,
  'rendered players and bots must match the gameplay camera/capsule stature');
const bridgeSource = readFileSync(new URL('../src/net/AuthNetBridge.js', import.meta.url), 'utf8');
assert.match(bridgeSource, /modelScale:\s*PLAYER_WORLD_MODEL_SCALE/,
  'network humans and bots do not apply the shared gameplay scale');
assert.match(bridgeSource, /isBot\s*\?\s*BOT_SKIN\s*:/,
  'network bots do not render with the default player skin');
assert.match(bridgeSource, /DEFAULT_REMOTE_BOT_ARMOR_ID\s*=\s*'vanguard'/,
  'network bots do not render with the default player armor');

const botSource = readFileSync(new URL('../src/entities/Bot.js', import.meta.url), 'utf8');
assert.match(botSource, /DEFAULT_BOT_SKIN\s*=\s*BOT_SKIN/,
  'local bots do not use the default player skin');
assert.match(botSource, /DEFAULT_BOT_ARMOR_ID\s*=\s*'vanguard'/,
  'local bots do not use the default player armor');

assert.match(bridgeSource, /PLAYABLE_ARMOR_IDS/,
  'network players do not consume the shared playable armor roster');
for (const path of ['../src/entities/Bot.js', '../src/net/AuthNetBridge.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\['assault',\s*'recon',\s*'heavy',\s*'stealth'\]/,
    `${path} still hard-codes the retired Soldier roster`);
  assert.match(source, /allowHuman:\s*true/,
    `${path} does not request the shared authored player model`);
}

console.log('armor roster passed: current Reforged rig only, every old chassis migrated, player/bot skins preserved');
