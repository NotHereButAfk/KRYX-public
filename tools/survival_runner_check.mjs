import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter, buildEvCharacter } from '../src/player/EvCharacter.js';
import { survivalWave, zombieStats } from '../src/entities/ZombieRoster.js';
globalThis.ProgressEvent ??= class { constructor(type,data){Object.assign(this,{type},data);} };
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
const body=buildEvCharacter();
body.userData.setLocomotion(4.8,true,true,0,1,0);
body.userData.setActionState({zombieReach:true});
for(let i=0;i<60;i++)body.userData.mixer.update(1/60);
for(const side of ['L','R']) {
  const hand=body.worldToLocal(body.userData.bones[`Bip001_${side}_Hand`].getWorldPosition(new THREE.Vector3()));
  assert.ok(side === 'R' ? hand.x > .1 : hand.x < -.1, 'hands stay on their own side');
  assert.ok(hand.y>1.1 && hand.z<-.35, `${side} arm must reach forward at chest height: ${hand.toArray()}`);
}
assert.ok(body.userData.animationCadence>0,'running gait advances');
for(const type of ['walker','runner','gunner']) {
  assert.ok(zombieStats(1,type).speed>=4.3);
  assert.ok(zombieStats(20,type).speed>zombieStats(1,type).speed);
  assert.ok(zombieStats(20,type).health>zombieStats(1,type).health);
}
assert.ok(survivalWave(20).total>survivalWave(1).total);
assert.equal(survivalWave(1).gunners,0);
assert.ok(survivalWave(4).gunners>0);
const bridge=fs.readFileSync(new URL('../src/net/AuthNetBridge.js',import.meta.url),'utf8');
assert.doesNotMatch(bridge,/this\.client\.survival\s*=\s*snapshot\.survival/,'retain client receipt timestamp for countdown');
console.log('Survival runners passed: default bot rig, raised arms, animated gait, escalating health/speed/count, later guns, timestamp preservation.');
