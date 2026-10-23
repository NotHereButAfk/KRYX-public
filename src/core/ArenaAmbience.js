// Original, deterministic sound beds. Three quiet looping buffers cover every
// arena; changing maps only changes their mix, never builds a new audio graph.
const PROFILES = Object.freeze({
  'daytime-rook': { air: .043, machinery: .007, cutoff: 900 },
  'winter-graveyard': { air: .055, machinery: 0, cutoff: 1800 },
  evasion: { air: .038, machinery: .014, cutoff: 1050 },
  depot: { air: .027, machinery: .023, cutoff: 750 },
  gypsum: { air: .052, machinery: .003, cutoff: 1350 },
  checkpoint: { air: .037, machinery: .019, cutoff: 950 },
  fractal: { air: .018, machinery: .048, cutoff: 650 },
  ancient: { air: .047, machinery: 0, cutoff: 1150 },
  'little-town-2065': { air: .04, machinery: .008, cutoff: 1550 },
});
const LOOP_SECONDS = 4;
const LOOP_OVERLAP = .2;

/** Exported so headroom and loop seams can be verified without a browser. */
export function renderAmbience(layer, sampleRate = 24000) {
  const count = Math.round(sampleRate * LOOP_SECONDS);
  const data = new Float32Array(count);
  let seed = layer === 'air' ? 2971 : layer === 'machinery' ? 7183 : 9923;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  let low = 0, body = 0;
  const lowRate = 1 - Math.exp(-2 * Math.PI * 650 / sampleRate);
  const bodyRate = 1 - Math.exp(-2 * Math.PI * 100 / sampleRate);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate, noise = random();
    low += lowRate * (noise - low);
    body += bodyRate * (noise - body);
    const swell = .78 + .14 * Math.sin(2 * Math.PI * t / LOOP_SECONDS)
      + .08 * Math.sin(2 * Math.PI * t * .75 + 1.2);
    if (layer === 'machinery') {
      // A low ventilation bed and soft electrical harmonics, without alarms.
      data[i] = .17 * Math.sin(2 * Math.PI * 55 * t)
        + .065 * Math.sin(2 * Math.PI * 110 * t + .3)
        + .025 * Math.sin(2 * Math.PI * 165 * t) + body * .38;
    } else if (layer === 'movement') {
      // Broad, soft fabric/air texture. Footstep contacts remain independent.
      const cloth = .66 + .2 * Math.sin(2 * Math.PI * t * 2.5)
        + .14 * Math.sin(2 * Math.PI * t * 4.25 + .5);
      data[i] = (low - body * .65) * .72 * cloth;
    } else data[i] = (low * .5 + body * .65) * swell;
  }
  // The source loops from .2s. Its final .2s blends into the opening segment,
  // so the wrap continues at the next sample rather than clicking or dipping.
  const overlap = Math.round(sampleRate * LOOP_OVERLAP);
  for (let i = 0; i < overlap; i++) {
    const at = count - overlap + i;
    const blend = .5 - .5 * Math.cos(Math.PI * i / (overlap - 1));
    data[at] = data[at] * (1 - blend) + data[i] * blend;
  }
  return data;
}

function target(param, value, now, seconds) {
  param.setTargetAtTime(value, now, seconds);
}

export class ArenaAmbience {
  constructor(audio) {
    this.audio = audio;
    this.buffers = new Map();
    this.layers = null;
    this.mapId = 'evasion';
    this._elapsed = 0;
  }

  _layer(name, cutoff) {
    const { ctx, master } = this.audio;
    let buffer = this.buffers.get(name);
    if (!buffer) {
      const samples = renderAmbience(name, ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(name, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = LOOP_OVERLAP;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = cutoff; filter.Q.value = .3;
    const gain = ctx.createGain(); gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(master);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      source.disconnect(); filter.disconnect(); gain.disconnect();
      source.onended = null;
    };
    source.onended = dispose;
    source.start();
    return { source, filter, gain, dispose };
  }

  start(mapId = this.mapId) {
    if (!this.audio.ctx) return;
    this.mapId = mapId;
    if (!this.layers) {
      this.layers = {
        air: this._layer('air', 1000),
        machinery: this._layer('machinery', 360),
        movement: this._layer('movement', 1200),
      };
    }
    this.update({ mapId, active: false }, .05, true);
  }

  update({ mapId = this.mapId, speed = 0, sprinting = false, sliding = false, active = false } = {}, dt = 0, force = false) {
    if (!this.layers) return;
    const changedMap = mapId !== this.mapId;
    this.mapId = mapId;
    this._elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    // Schedule at 20Hz rather than adding new automation events every frame.
    // Pausing/death always silences movement immediately, even at high FPS.
    const changedActive = !!active !== this._active;
    if (!force && !changedMap && !changedActive && this._elapsed < .05) return;
    this._elapsed = 0;
    this._active = !!active;
    const { currentTime: now } = this.audio.ctx;
    const profile = PROFILES[mapId] || PROFILES.evasion;
    const speedMix = active && Number.isFinite(speed) ? Math.max(0, Math.min(1, (speed - .7) / 10)) : 0;
    const motion = speedMix * (sliding ? .071 : sprinting ? .055 : .032);
    const { air, machinery, movement } = this.layers;
    // The world remains gently audible under menus and the death camera.
    const presence = active ? 1 : .62;
    target(air.gain.gain, profile.air * presence, now, .8);
    target(air.filter.frequency, profile.cutoff, now, .8);
    target(machinery.gain.gain, profile.machinery * presence, now, .8);
    target(movement.gain.gain, motion, now, active ? .16 : .06);
    target(movement.filter.frequency, sliding ? 2400 : sprinting ? 1700 : 1150, now, .2);
    target(movement.source.playbackRate, sliding ? 1.15 : .86 + speedMix * .22, now, .2);
  }

  stop() {
    if (!this.layers) return;
    const now = this.audio.ctx.currentTime;
    const suspended = this.audio.ctx.state === 'suspended' || this.audio.ctx.state === 'closed';
    for (const { source, gain, dispose } of Object.values(this.layers)) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, .04);
      source.stop(suspended ? now : now + .3);
      // A suspended context cannot advance to an onended callback. Tear down
      // its silent graph immediately, including when leaving a muted tab.
      if (suspended) dispose();
    }
    this.layers = null;
    this._active = false;
    this._elapsed = 0;
  }
}
