import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GUN_TIMBRES, EFFECT_NAMES, renderSound, playDesignedSound } from '../src/core/SoundEffects.js';
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
assert.equal(connected,audio.out,'bypassed positional mix');assert.equal(starts,disconnected,'audio source leaked');
console.log(`audio contract passed: ${tested} renders; 9 distinct weapons, variation, headroom, smooth boundaries, routing, bounded cache and cleanup.`);
