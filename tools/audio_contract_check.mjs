import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GUN_TIMBRES, EFFECT_NAMES, renderSound, playDesignedSound, playBufferVoice, MAX_EFFECT_VOICES } from '../src/core/SoundEffects.js';
import { AudioManager } from '../src/core/AudioManager.js';
import { WEAPONS } from '../src/weapons/weaponDefs.js';
import { MovementAudio } from '../src/core/MovementAudio.js';
const movement = new MovementAudio(), steps=[], lands=[];
const foley={playFootstep:run=>steps.push(run),playLand:hard=>lands.push(hard)};
let previous={px:0,pz:0,onGround:true,vy:0};
const tick=(distance,sprint=false,extra={})=>{
  const next={...previous,px:previous.px+distance,...extra};
  movement.update(foley,previous,next,sprint,true,.05);previous=next;
};
for(let i=0;i<20;i++)tick(.2);
assert.equal(steps.length,2,'walking must produce distance-based footsteps');
for(let i=0;i<20;i++)tick(.5,true);
assert(steps.filter(Boolean).length>=4,'running must produce heavier footsteps');
const count=steps.length;
for(let i=0;i<20;i++)tick(0);
tick(100);tick(.2,false,{onGround:false,vy:-5});
for(let i=0;i<10;i++)tick(.2);
assert.equal(steps.length,count,'walls, teleporting and airborne travel must be silent');
tick(.1,false,{onGround:true,vy:0});
tick(0,false,{onGround:false,vy:-16});tick(0,false,{onGround:true,vy:0});
assert.deepEqual(lands,[false,true],'landing must play once with impact strength');
const hash = samples => createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex');
const hashes = new Set();
for (const weapon of WEAPONS.filter(w => w.kind !== 'melee')) {
  assert(GUN_TIMBRES[weapon.sound], weapon.id + ': missing sound');
  hashes.add(hash(renderSound(weapon.sound)));
}
assert.equal(hashes.size, 9, 'every firearm must have a distinct report');
let tested = 0;
for (const rate of [24000,48000]) for (const name of [...Object.keys(GUN_TIMBRES),...EFFECT_NAMES]) {
  const a = renderSound(name,rate,0), b = renderSound(name,rate,1);
  let peak=0, power=0;
  for (const x of a) { assert(Number.isFinite(x), name+': invalid PCM'); peak=Math.max(peak,Math.abs(x));power+=x*x; }
  assert(peak < .96 && peak > .05, name+': peak/headroom');
  assert(Math.sqrt(power/a.length)>.0005,name+': inaudible signal');
  assert(Math.abs(a[0])<.001 && Math.abs(a.at(-1))<.001,name+': abrupt buffer boundary');
  assert.notEqual(hash(a),hash(b),name+': identical variations');
  assert.equal(hash(a),hash(renderSound(name,rate,0)),name+': unstable cache rendering');
  tested++;
}
assert(renderSound('battlerifle',48000,0,3).length>renderSound('battlerifle',48000,0,1).length);
// Playback must remain bounded, respect positional routing, and free its source.
let connected, disconnected=0, starts=0;
const audio={out:{id:'positional'},ctx:{sampleRate:24000,
  createBuffer:(channels,length)=>({length,copyToChannel(){}}),
  createBufferSource:()=>({playbackRate:{},connect(out){connected=out;},disconnect(){disconnected++;},start(){starts++;this.onended();}})}};
for(let i=0;i<160;i++)playDesignedSound(audio,'hit'+i);
assert(audio._designedBuffers.size<=96,'unbounded buffer cache');
assert(audio._lastSoundVariants.size<=64,'unbounded variation history');
assert.equal(connected,audio.out,'bypassed positional mix');assert.equal(starts,disconnected,'audio source leaked');

// A crowded eight-bot fight cannot create an unlimited number of voices or
// replace local firing feedback with low-priority footsteps and casings.
const panners = [], sources = [], nodes = [];
const makeNode = () => {
  const node = { gain:{}, frequency:{}, Q:{}, disconnected:0,
    connect(){ return this; }, disconnect(){ this.disconnected++; } };
  nodes.push(node); return node;
};
const manager = new AudioManager();
manager.master = makeNode(); manager.out = manager.master;
manager.ctx = { sampleRate:24000,
  createBuffer:(channels,length)=>({ length, copyToChannel(){} }),
  createGain:makeNode, createBiquadFilter:makeNode,
  createPanner(){const p=makeNode();p.positionX={};p.positionY={};p.positionZ={};panners.push(p);return p;},
  createBufferSource(){const source=makeNode();source.playbackRate={};source.start=()=>{};source.stop=()=>{source.stopped=true;};sources.push(source);return source;},
};
const localShot = playBufferVoice(manager,{length:100},{priority:3});
for (let i=0;i<80;i++) manager.playAt({x:i,y:1,z:0},()=> {
  playBufferVoice(manager,{length:100},{priority:0,lowpass:1900,gain:.4});
});
assert.equal(manager._effectVoices.size,MAX_EFFECT_VOICES,'overloaded audio exceeded voice budget');
assert(manager._effectVoices.has(localShot),'remote Foley interrupted local shot');
assert.equal(panners.filter(p=>!p.disconnected).length,MAX_EFFECT_VOICES-1,'positional buses outlived their voices');
for(const voice of [...manager._effectVoices]) voice.source.onended();
assert.equal(manager._effectVoices.size,0,'finished voice retained');
assert(panners.every(p=>p.disconnected===1),'spatial sound leaked or disconnected its panner twice');
assert(sources.every(source=>source.disconnected===1),'source not released exactly once');
assert(nodes.filter(node=>node!==manager.master).every(node=>node.disconnected===1),'gain/filter leaked');
manager.playAt({x:0,y:0,z:0},()=>{});
assert.equal(panners.at(-1).disconnected,1,'silent positional event leaked');
manager.playAt({x:0,y:0,z:0},()=>{ manager.playDeath(); manager.playBodyImpact(.65); });
const deathBus = panners.at(-1), deathVoices=[...manager._effectVoices];
assert.equal(deathVoices.length,2,'fall and impact should remain distinct events');
deathVoices[0].source.onended();assert.equal(deathBus.disconnected,0,'ended first layer cut off remaining impact');
deathVoices[1].source.onended();assert.equal(deathBus.disconnected,1,'final death voice retained panner');
assert(renderSound('hit').length < .12*48000,'hit tick carries unnecessary silent tail');
assert.notEqual(hash(renderSound('death')),hash(renderSound('body-impact')),'death and floor contact sound identical');
console.log(`audio contract passed: ${tested} renders; 9 distinct weapons, variation, headroom, smooth boundaries, routing, bounded cache/voices and positional cleanup.`);
