import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import fs from 'node:fs';import * as THREE from 'three';
import {WEAPON_SKINS} from '../server/weaponskins.mjs';import {createLegendaryShot} from '../src/core/LegendaryAudio.js';import {configureLegendaryEffect,updateLegendaryEffect,triggerLegendaryShot,triggerLegendaryKill} from '../src/weapons/LegendaryEffects.js';
const hashes=new Set(),rate=24000, demo=new Float32Array(rate*5);
for(const [i,s] of WEAPON_SKINS.filter(s=>s.rarity==='legendary').entries()){
 const samples=createLegendaryShot(s.shootSound,rate);assert.ok(samples.length>2000);assert.ok(samples.every(Number.isFinite));assert.ok(Math.max(...samples.map(Math.abs))<=.59);assert.ok(Math.abs(samples.at(-1))<.001);
 hashes.add(createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex'));
 if(i<5)demo.set(samples,i*rate);
 const m=new THREE.MeshStandardMaterial();const before=m.onBeforeCompile;configureLegendaryEffect(m,s);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <emissivemap_fragment>'};m.onBeforeCompile(shader,{});assert.ok(shader.fragmentShader.includes('legendaryShot'));assert.ok(shader.uniforms.legendaryColor);
 const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),m));triggerLegendaryShot(g,1);updateLegendaryEffect(m,1);assert.equal(m.userData.legendaryEffect.shot.value,1);updateLegendaryEffect(m,2);assert.ok(m.userData.legendaryEffect.shot.value<.001);
 triggerLegendaryKill(g,2);updateLegendaryEffect(m,2);assert.equal(m.userData.legendaryEffect.kill.value,1);updateLegendaryEffect(m,4);assert.equal(m.userData.legendaryEffect.kill.value,0);
 configureLegendaryEffect(m,WEAPON_SKINS[0]);assert.equal(m.onBeforeCompile,before);assert.equal(m.userData.legendaryEffect,undefined);
}
assert.equal(hashes.size,new Set(WEAPON_SKINS.filter(s=>s.rarity==='legendary').map(s=>s.weaponId+':'+s.legendaryStyle)).size);assert.equal(createLegendaryShot('legendary:fake',rate),null);
const wav=Buffer.alloc(44+demo.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(demo.length*2,40);demo.forEach((x,i)=>wav.writeInt16LE(Math.round(x*32767),44+i*2));fs.mkdirSync('../../outputs/legendary-effects',{recursive:true});fs.writeFileSync('../../outputs/legendary-effects/firing-preview.wav',wav);
console.log(hashes.size+' distinct weapon/theme reports; bounded audio, isolated shader state and decay passed.');
