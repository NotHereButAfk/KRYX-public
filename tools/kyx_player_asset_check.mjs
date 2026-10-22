import assert from 'node:assert/strict';
import fs from 'node:fs';

const buffer = fs.readFileSync(new URL('../public/kyx-player.glb', import.meta.url));
assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'player asset is not a GLB');

const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const nodeNames = new Set((gltf.nodes || []).map((node) => node.name));
const actionNames = new Set((gltf.animations || []).map((action) => action.name));

const sockets = [
  'KYX_WeaponSocket_R',
  'KYX_SupportSocket_L',
  'KYX_SwordSocket_R',
  'KYX_BackHolsterSocket',
];
const actions = [
  'Idle', 'Walk', 'Run', 'CrouchIdle', 'CrouchWalk',
  'JumpStart', 'JumpLoop', 'JumpLand', 'GunIdle',
  'GunAimDown', 'GunAimNeutral', 'GunAimUp', 'Fire', 'Reload',
  'SwordIdle', 'SwordAttack', 'HitChest', 'HitHead', 'DodgeRoll', 'Death',
];

for (const name of sockets) assert(nodeNames.has(name), `missing weapon socket ${name}`);
for (const name of actions) assert(actionNames.has(name), `missing animation ${name}`);

console.log(`player asset passed: ${sockets.length} weapon sockets, ${actions.length} gameplay actions, ${gltf.nodes.length} nodes`);
