import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEvMap,buildEvMapScene} from '../src/world/EvMapLoader.js';
import {getServerArena} from '../server/rookarena.mjs';
const b=readFileSync('public/maps/CopperCircuit.evmap');
const map=parseEvMap(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
assert.equal(map.bytesRead,b.length);
const scene=buildEvMapScene(map), arena=getServerArena('copper-circuit');
assert.equal(scene.spawnPoints.length,12);assert.equal(scene.weaponSpawnPoints.length,4);
assert(map.geometries.length<=16,'merge by material to limit draw calls');
for(const sign of [-1,1])for(let t=0;t<=12;t++){
  const x=sign*10,z=sign*(11+t),expected=t/3;
  assert(Math.abs(arena.groundHeightAt(x,z,expected+.1,expected)-expected)<.04,`ramp floor gap at ${x},${z}`);
}
// Follow three independent ground routes from the south approach to the north.
for(const x of [-28,0,28])for(let z=-36;z<=36;z+=1){
  if(x===0&&Math.abs(z)<6)continue; // reactor is intentional solid cover
  assert(arena.groundHeightAt(x,z,.15,0)>-.1,`lane has a void at ${x},${z}`);
}
assert(arena.raycast(8,2,0,-1,0,0,50)<6,'reactor must block gunfire');
assert(arena.raycast(0,2,38,0,0,1,20)<5,'perimeter must block gunfire');
console.log('Copper Circuit passed: shared binary, 12 spawns, grounded pickups, continuous ramps/lanes, solid cover and perimeter');
