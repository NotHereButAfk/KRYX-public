import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BotManager } from '../src/entities/BotManager.js';

const removed = [];
const manager = new BotManager({}, { remove: (mesh) => removed.push(mesh) });
const oldMesh = { name: 'player-bot' };
manager.bots.push({ mesh: oldMesh, displayName: 'PlayerBot' });

manager.setEnabled(false);
assert.equal(manager.count, 0, 'entering Survival must clear existing player-style bots');
assert.deepEqual(removed, [oldMesh], 'cleared Survival bot was not removed from the scene');
assert.equal(manager.addBot(), null, 'disabled Survival bot manager accepted a late player bot');
manager.spawnAll(7);
assert.equal(manager.count, 0, 'Survival bot fill repopulated player-style bots');

manager.setEnabled(true);
assert.equal(manager.enabled, true, 'leaving Survival did not restore normal arena bot population');

const game = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
assert.match(game, /this\.botManager\.setEnabled\(!this\._isSurvival\)/,
  'Game does not bind player-bot availability to the active Survival mode');
assert.match(game, /this\.botManager\.setEnabled\(true\)[\s\S]*?_menuBotsActive = true/,
  'returning to the menu does not explicitly restore spectator bots');
assert.doesNotMatch(game, /\$\{alive\} BOTS ALIVE/,
  'Survival HUD still describes zombies as generic player bots');
assert.match(game, /\$\{alive\} ZOMBIES ALIVE/,
  'Survival HUD does not identify its zombie-only enemy population');

console.log('survival population passed: zombies and real players only; player bots stay disabled');
