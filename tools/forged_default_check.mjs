import fs from 'node:fs';import assert from 'node:assert/strict';
const read=p=>{const b=fs.readFileSync(p),n=b.readUInt32LE(12);return{json:JSON.parse(b.subarray(20,20+n)),bin:b.subarray(28+n)}};
const a=read('art/player-skins/rig-source.glb'),b=read('public/ev-default.glb');
assert.deepEqual(b.json.animations,a.json.animations,'default animation channels must remain identical');
assert(b.bin.subarray(0,a.bin.length).equals(a.bin),'published animation buffers must remain byte-identical');
for(const i of a.json.skins[0].joints)assert.deepEqual(b.json.nodes[i],a.json.nodes[i],'published joints must not move');
assert(b.json.scenes[0].extras.rigBounds.height>2,'retain rig normalization independent of armor silhouette');
console.log('Forged default: original animation channels, binary tracks, bone transforms and rig scale preserved.');
