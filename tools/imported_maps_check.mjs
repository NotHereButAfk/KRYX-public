import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEvMap,buildEvMapScene} from '../src/world/EvMapLoader.js';
for(const [file,count] of [['HUT8Evasion_0.evmap',13],['Depot_2.evmap',8]]) {
 const b=await readFile(new URL('../public/maps/'+file,import.meta.url));
 const parsed=parseEvMap(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 assert.equal(parsed.bytesRead,parsed.byteLength,`${file}: complete binary decoding`);
 assert.equal(parsed.playerSpawns.length,count);
 const scene=buildEvMapScene(parsed);
 assert.equal(scene.spawnPoints.length,count,`${file}: authored spawn pads are available`);
 assert(scene.spawnPoints.every(p=>Number.isFinite(p.spawnYaw)));
}
console.log('Imported maps: legacy yaw and team-only spawn compatibility passed');
