import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARMOR_TYPES,
  PLAYABLE_ARMOR_IDS,
  loadArmorType,
  normalizeArmorType,
  saveArmorType,
} from '../src/player/ArmorTypes.js';
import { buildPreviewCharacter } from '../src/player/PreviewCharacter.js';
import { PLAYER_WORLD_MODEL_SCALE } from '../src/player/Proportions.js';

const expected = ['vanguard', 'striker', 'phantom'];
assert.deepEqual(PLAYABLE_ARMOR_IDS, expected,
  'the live armor roster must contain only connected exosuit chassis');
assert.deepEqual(ARMOR_TYPES.map((armor) => armor.id), expected,
  'the armor menu and runtime roster must share the same ids');

const legacy = {
  assault: 'vanguard',
  recon: 'striker',
  heavy: 'vanguard',
  stealth: 'phantom',
};
for (const [oldId, newId] of Object.entries(legacy)) {
  assert.equal(normalizeArmorType(oldId), newId, `${oldId} did not migrate to ${newId}`);
}
assert.equal(normalizeArmorType('not-a-model'), 'vanguard');

const values = new Map([['sio_armor_type', 'stealth']]);
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
assert.equal(loadArmorType(), 'phantom', 'saved legacy selection did not migrate on load');
assert.equal(values.get('sio_armor_type'), 'phantom');
saveArmorType('heavy');
assert.equal(values.get('sio_armor_type'), 'vanguard', 'save persisted a retired Soldier id');

for (const id of PLAYABLE_ARMOR_IDS) {
  const body = buildPreviewCharacter({ primary: 0x777777, secondary: 0x222222 }, id);
  assert.equal(body.userData?.isHero, true, `${id} did not build the connected weighted body`);
  assert.notEqual(body.userData?.isHuman, true, `${id} unexpectedly built the retired Soldier body`);
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

console.log('armor roster passed: 3 connected exosuits, legacy saves migrated, bots/remotes unified');
