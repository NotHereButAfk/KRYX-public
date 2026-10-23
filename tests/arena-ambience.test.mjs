import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ArenaAmbience, renderAmbience } from '../src/core/ArenaAmbience.js';
import { AudioManager } from '../src/core/AudioManager.js';
import { playBufferVoice } from '../src/core/SoundEffects.js';
import { MAP_CATALOG } from '../src/world/MapRegistry.js';

const hash = pcm => createHash('sha256').update(Buffer.from(pcm.buffer)).digest('hex');
for (const rate of [24000, 48000]) {
  const hashes = new Set();
  for (const layer of ['air', 'machinery', 'movement']) {
    const pcm = renderAmbience(layer, rate);
    let power = 0, peak = 0;
    for (const sample of pcm) {
      assert(Number.isFinite(sample), `${layer}: finite PCM`);
      power += sample * sample; peak = Math.max(peak, Math.abs(sample));
    }
    assert(peak < .8, `${layer}: ample headroom`);
    const rms = Math.sqrt(power / pcm.length);
    assert(rms > .025 && rms < .18, `${layer}: restrained but audible bed (${rms})`);
    const seam = Math.round(rate * .2);
    assert.equal(pcm.at(-1), pcm[seam - 1], `${layer}: wrap continues the opening segment`);
    assert(Math.abs(pcm.at(-2) - pcm[seam - 2]) < .00001, `${layer}: smooth crossfade slope`);
    assert.equal(hash(pcm), hash(renderAmbience(layer, rate)), `${layer}: stable cache rendering`);
    hashes.add(hash(pcm));
  }
  assert.equal(hashes.size, 3, 'sound beds have distinct timbres');
}

function audioFixture() {
  const nodes = [], sources = [], buffers = [], panners = [];
  const param = (value = 0) => ({ value, events: [],
    setTargetAtTime(value, at, tau) { this.value = value; this.events.push({ value, at, tau }); },
    cancelScheduledValues() {},
  });
  const node = () => {
    const result = { connections: [], disconnected: 0,
      gain: param(), frequency: param(), Q: param(),
      connect(other) { this.connections.push(other); return other; },
      disconnect() { this.disconnected++; },
    };
    nodes.push(result); return result;
  };
  const audio = new AudioManager();
  audio.master = node(); audio.out = audio.master;
  audio.ctx = { currentTime: 0, sampleRate: 24000,
    createBuffer(channels, length, rate) {
      const buffer = { length, sampleRate: rate, copyToChannel() {} }; buffers.push(buffer); return buffer;
    },
    createGain: node, createBiquadFilter: node,
    createBufferSource() {
      const source = node(); source.playbackRate = param(1);
      source.start = () => { source.started = true; };
      source.stop = at => { source.stopAt = at; };
      sources.push(source); return source;
    },
    createPanner() {
      const panner = node();
      panner.positionX = param(); panner.positionY = param(); panner.positionZ = param();
      panners.push(panner); return panner;
    },
  };
  return { audio, nodes, sources, buffers, panners };
}

const { audio, nodes, sources, buffers } = audioFixture();
audio.setPlatformMuted(true);
audio.startAmbientCity('fractal');
const ambience = audio._ambience;
assert(ambience instanceof ArenaAmbience);
assert.equal(sources.length, 3);
assert.equal(buffers.length, 3);
assert.equal(audio.master.gain.value, 0, 'starting ambience cannot unmute the master');
for (const layer of Object.values(ambience.layers)) {
  assert.equal(layer.gain.connections[0], audio.master, 'all ambience respects master volume');
  assert.equal(layer.source.loopStart, .2);
}
const mix = state => {
  audio.updateEnvironment({ active: true, ...state }, .05);
  return Object.fromEntries(Object.entries(ambience.layers).map(([name, layer]) => [name, layer.gain.gain.value]));
};
const fractal = mix({ mapId: 'fractal' }), ancient = mix({ mapId: 'ancient' });
assert(fractal.machinery > ancient.machinery, 'Fractal has a quiet electrical room tone');
assert(ancient.air > fractal.air, 'outdoor arenas carry more breeze');
for (const map of MAP_CATALOG) {
  audio.startAmbientCity(map.id);
  mix({ mapId: map.id, speed: 12, sprinting: true });
}
assert.equal(sources.length, 3, 'map changes do not allocate new loops');
assert.equal(buffers.length, 3, 'map changes keep a bounded buffer cache');
const stopped = mix({ speed: 0, sprinting: true });
const walk = mix({ speed: 5 }), sprint = mix({ speed: 10, sprinting: true });
const slide = mix({ speed: 10, sliding: true });
assert.equal(stopped.movement, 0, 'holding sprint against a wall adds no movement noise');
assert(walk.movement > 0 && walk.movement < sprint.movement && sprint.movement < slide.movement);
assert(slide.movement < .072, 'movement layer cannot mask combat');
audio.updateEnvironment({ active: false, speed: 12, sliding: true }, .001);
assert.equal(ambience.layers.movement.gain.gain.value, 0, 'menu/death immediately targets silence');
assert.equal(ambience.layers.movement.gain.gain.events.at(-1).tau, .06, 'inactivity fades without a click');
assert.equal(mix({ speed: NaN }).movement, 0, 'invalid motion cannot poison the audio graph');
const automationCount = ambience.layers.air.gain.gain.events.length;
for (let i = 0; i < 100; i++) audio.updateEnvironment({ active: true, speed: 5 }, .001);
assert(ambience.layers.air.gain.gain.events.length <= automationCount + 2, 'automation is throttled to 20Hz');
assert.equal(sources.length, 3, 'updates allocate no nodes');
audio.setVolume(.3);
assert.equal(audio.master.gain.value, 0, 'volume changes preserve platform mute');
audio.setPlatformMuted(false);
assert.equal(audio.master.gain.value, .3, 'unmute restores user volume');
audio.stopAmbientCity(); audio.stopAmbientCity();
for (const source of sources) {
  assert.equal(source.stopAt, .3, 'stopping allows a short graceful fade');
  source.onended();
}
assert(nodes.filter(node => node !== audio.master).every(node => node.disconnected === 1), 'all loop nodes released once');
audio.startAmbientCity('fractal');
assert.equal(buffers.length, 3, 'restart reuses cached sound beds');
audio.ctx.state = 'suspended';
audio.stopAmbientCity();
assert(nodes.filter(node => node !== audio.master).every(node => node.disconnected === 1), 'suspended contexts release loops without waiting for audio time');

const spatial = audioFixture(), a = spatial.audio;
const listener = { x: 0, y: 1.7, z: 0 };
a.setListener(listener, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
listener.x = 100;
let queries = 0, obstruction = 2;
a.setWorld({ raycastCollisionDistance(ray, far) {
  queries++;
  assert(Math.abs(ray.direction.length() - 1) < .00001, 'collision ray is normalized');
  assert(far <= 60, 'collision query is bounded');
  assert(ray.origin.x < 1, 'listener position is copied, not retained by reference');
  return obstruction === null ? far : obstruction;
} });
const shot = () => playBufferVoice(a, { length: 1200 });
a.playAt({ x: 10, y: 1.7, z: 0 }, () => { shot(); shot(); });
assert.equal(queries, 1, 'one occlusion query serves all layers in an event');
const bus = spatial.panners.at(-1), filter = bus.connections[0], gain = filter.connections[0];
assert.equal(filter.frequency.value, 2600, 'cover softly muffles distant reports');
assert.equal(gain.gain.value, .72);
assert.equal(gain.connections[0], a.master);
const voices = [...a._effectVoices];
voices[0].source.onended();
assert.equal(bus.disconnected, 0, 'first layer ending preserves remaining sound');
voices[1].source.onended();
for (const node of [bus, filter, gain]) assert.equal(node.disconnected, 1, 'cover processing follows voice cleanup');
obstruction = null;
a.playAt({ x: 10, y: 1.7, z: 0 }, () => {});
assert.equal(spatial.panners.at(-1).connections[0], a.master, 'clear line of sight remains full bandwidth');
const beforeNear = queries;
a.playAt({ x: .3, y: 1.7, z: 0 }, () => {});
a.playAt({ x: 90, y: 1.7, z: 0 }, () => {});
assert.equal(queries, beforeNear, 'close and inaudibly distant sounds skip ray queries');
a.setPlatformMuted(true);
a.playAt({ x: 10, y: 1.7, z: 0 }, () => {});
assert.equal(queries, beforeNear, 'muted audio skips occlusion work');
a.setPlatformMuted(false);
for (let i = 0; i < 40; i++) a.playAt({ x: 10, y: 1.7, z: 0 }, () => {});
assert.equal(queries, 12, 'crowded event bursts cannot exceed query budget');
a.ctx.currentTime = .06;
a.playAt({ x: 10, y: 1.7, z: 0 }, () => {});
assert.equal(queries, 13, 'occlusion budget recovers for next events');
a.setWorld({ colliders: [{ mesh: null }] });
a.playAt({ x: 10, y: 1.7, z: 0 }, () => {});
assert.equal(queries, 13, 'missing collision API falls back without touching nullable meshes');
assert(spatial.nodes.filter(node => node !== a.master).every(node => node.disconnected === 1), 'spatial events leave no disconnected-node leaks');
console.log('Arena audio passed: seamless deterministic beds, map mixes, movement fades, mute, bounded sources/queries and cover cleanup.');
