import assert from 'node:assert/strict';
import { AudioManager } from '../src/core/AudioManager.js';
import { playBufferVoice, renderSound, GUN_TIMBRES } from '../src/core/SoundEffects.js';
import { spatialAudioProfile, selectVoiceToSteal } from '../src/core/SpatialAudioProfile.js';

const node = () => ({ connect() { return this; }, disconnect() {}, gain: {}, frequency: {}, Q: {}, positionX: {}, positionY: {}, positionZ: {} });
function manager() {
  const m = new AudioManager(), ctx = { sampleRate: 24000, currentTime: 0, listener: { setPosition() {}, setOrientation() {} },
    createGain: node, createBiquadFilter: node, createPanner: node,
    createBuffer: (c, l) => ({ length: l, copyToChannel() {} }),
    createBufferSource: () => { const s = node(); s.playbackRate = {}; s.start = () => {}; s.stop = () => {}; return s; }
  };
  m.ctx = ctx; m.master = node(); m.out = m.master;
  return m;
}

for (const distance of [-1, -0.5, NaN, Infinity]) assert.equal(spatialAudioProfile(distance).audible, true);
let previous = spatialAudioProfile(4).cutoff;
for (let d = 5; d <= 85; d++) { const cutoff = spatialAudioProfile(d).cutoff; assert(cutoff < previous); previous = cutoff; }
assert.equal(spatialAudioProfile(85).audible, true);
assert.equal(spatialAudioProfile(86).audible, false);
assert.equal(spatialAudioProfile(4).gain, 1);
assert.equal(spatialAudioProfile(4, true).gain, 0.68);
assert(spatialAudioProfile(20, true).cutoff <= 2200);
assert.equal(selectVoiceToSteal([{ priority: 3 }, { priority: 0 }], 3).priority, 0);

const m = manager();
const local = playBufferVoice(m, { length: 100 }, { priority: 3 });
const remotes = [];
for (let i = 0; i < 31; i++) remotes.push(playBufferVoice(m, { length: 100 }, { priority: 0 }));
assert.equal(m._effectVoices.size, 32);
const replacement = playBufferVoice(m, { length: 100 }, { priority: 3 });
assert(replacement && m._effectVoices.has(local), 'new local shot cut off the previous local shot instead of quiet Foley');
assert(!m._effectVoices.has(remotes[0]) && m._effectVoices.has(remotes[1]), 'equal priority steals oldest first');
assert.equal(m._effectVoices.size, 32);
const full = manager();
for (let i = 0; i < 32; i++) playBufferVoice(full, { length: 100 }, { priority: 3 });
assert.equal(playBufferVoice(full, { length: 100 }, { priority: 0 }), null);
for (const voice of [...m._effectVoices, ...full._effectVoices]) voice.source.onended?.();
assert.equal(m._effectVoices.size, 0);
assert.equal(full._effectVoices.size, 0);

const culled = manager();
culled.setListener({x:0,y:0,z:0}, {x:0,y:0,z:-1}, {x:0,y:1,z:0});
let panners = 0, queries = 0, called = 0;
culled.ctx.createPanner = () => { panners++; return node(); };
culled.setWorld({ raycastCollisionDistance() { queries++; return 0; } });
for (const position of [null, {x:NaN,y:0,z:0}, {x:86,y:0,z:0}]) {
  culled.playAt(position, () => called++);
}
assert.equal(called, 0); assert.equal(panners, 0); assert.equal(queries, 0);
assert.equal(culled._effectVoices?.size || 0, 0);

// Shotgun pellets must not pile up ten overlapping contact noises. Rejected
// distant/invalid events must not consume the next audible impact's cooldown.
const impacts = manager(), point = {x:1,y:0,z:0};
impacts.playBulletImpactAt(null);
for (let i = 0; i < 10; i++) impacts.playBulletImpactAt(point);
assert.equal(impacts._effectVoices.size, 1);
impacts.ctx.currentTime = .044; impacts.playBulletImpactAt(point);
assert.equal(impacts._effectVoices.size, 1);
impacts.ctx.currentTime = .046; impacts.playBulletImpactAt(point);
assert.equal(impacts._effectVoices.size, 2);
for (const voice of [...impacts._effectVoices]) voice.source.onended();
assert.equal(impacts._effectVoices.size, 0);

// Design buffers may reserve ample space; the cached playback must release
// its resources promptly after the actual waveform decays.
for (const name of Object.keys(GUN_TIMBRES)) {
  const pcm = renderSound(name, 48000);
  let end = pcm.length - 1;
  while (end > 0 && Math.abs(pcm[end]) < .00001) end--;
  assert(pcm.length - end <= 386, name + ': long silent tail retains a voice');
}
console.log('Spatial audio passed: priority regression, distance/cover, early culling, impact rate cap and silent-tail release.');
