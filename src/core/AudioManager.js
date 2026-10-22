import { preloadFootsteps, playFootstepRecording } from './FootstepAudio.js';
// Original cached game audio. Positional playback shares the master limiter.
import { playDesignedSound } from './SoundEffects.js';
import { createLegendaryShot } from './LegendaryAudio.js';
import { playBlastImpact, playBladeSlice, playBladeImpact } from './WeaponSoundDesign.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._platformMuted ? 0 : (this._volume ?? 0.5);

    this._limiter = this.ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -7;
    this._limiter.knee.value = 8;
    this._limiter.ratio.value = 14;
    this._limiter.attack.value = 0.002;
    this._limiter.release.value = 0.16;
    this.master.connect(this._limiter).connect(this.ctx.destination);

    this.out = this.master;
    this._footstepsReady = preloadFootsteps(this.ctx);

  }

  /** Point the WebAudio listener at the camera. Call once per frame. */
  setListener(pos, forward, up) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.01);
      l.positionY.setTargetAtTime(pos.y, t, 0.01);
      l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(forward.x, t, 0.01);
      l.forwardY.setTargetAtTime(forward.y, t, 0.01);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.01);
      l.upX.setTargetAtTime(up.x, t, 0.01);
      l.upY.setTargetAtTime(up.y, t, 0.01);
      l.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {                                    // pre-2021 Safari
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /**
   * Play a sound AT a world position: `audio.playAt(p, () => audio.playShot())`.
   * Anything the callback emits routes through an HRTF panner, so you can hear
   * which side it came from. The report and tail share distance attenuation.
   */
  playAt(pos, fn) {
    if (!this.ctx) return;
    const p = this.ctx.createPanner();
    p.panningModel    = 'HRTF';
    p.distanceModel   = 'inverse';
    p.refDistance     = 3;
    p.maxDistance     = 60;
    p.rolloffFactor   = 1.6;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);

    const prev = this.out;
    this.out = p;
    try { fn(); } finally { this.out = prev; }

    setTimeout(() => { try { p.disconnect(); } catch {} }, 3000);
  }

  resume() {
    this.ensureContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.ensureContext();
    this._volume = Math.max(0, Math.min(1, v));
    this.master.gain.value = this._platformMuted ? 0 : this._volume;
  }

  setPlatformMuted(muted) {
    this._platformMuted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : (this._volume ?? 0.5);
  }

  _noiseBuffer(duration) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      low += .016 * (Math.random() * 2 - 1 - low);
      data[i] = low * (1.2 + .3 * Math.sin(2*Math.PI*t/duration))
        + .045 * Math.sin(2*Math.PI*55*t) + .02 * Math.sin(2*Math.PI*110*t);
    }
    const fade = Math.floor(ctx.sampleRate*.2);
    for (let i=0;i<fade;i++) {
      const index=data.length-fade+i, blend=i/(fade-1);
      data[index]=data[index]*(1-blend)+data[i]*blend;
    }
    return buffer;
  }

  _envGain(gainValue, attack, decay, startTime) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(gainValue, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);
    return gain;
  }

  playShot(kind = 'rifle', rounds = 3) {
    playDesignedSound(this, kind, rounds);
  }
  playAnimeShot() {
    playDesignedSound(this, 'anime');
  }

  playWaifuShot() {
    playDesignedSound(this, 'waifu');
  }

  playFireballShot() {
    playDesignedSound(this, 'fireball');
  }

  playLaserShot() {
    playDesignedSound(this, 'laser');
  }
  playFireShot() {
    playDesignedSound(this, 'fire');
  }

  playPrismShot() {
    playDesignedSound(this, 'prism');
  }

  playPyroShot() {
    playDesignedSound(this, 'pyro');
  }
  playSkinShot(soundId) {
    if (typeof soundId === 'string' && soundId.startsWith('legendary:')) {
      if (!this.ctx) return false;
      this._legendaryBuffers ||= new Map();
      let buffer = this._legendaryBuffers.get(soundId);
      if (!buffer) {
        const samples = createLegendaryShot(soundId, this.ctx.sampleRate);
        if (!samples) return false;
        buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
        buffer.copyToChannel(samples, 0);
        this._legendaryBuffers.set(soundId, buffer);
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = .985 + Math.random() * .03;
      source.connect(this.out || this.master);
      source.onended = () => source.disconnect();
      source.start();
      return true;
    }
    switch (soundId) {
      case 'anime': this.playAnimeShot(); return true;
      case 'waifu': this.playWaifuShot(); return true;
      case 'laser': this.playLaserShot(); return true;
      case 'fire':  this.playFireShot();  return true;
      case 'fireball': this.playFireballShot(); return true;
      case 'prism': this.playPrismShot(); return true;
      case 'pyro':  this.playPyroShot();  return true;
      case 'meow':  this.playMeowShot();  return true;
      case 'uwu':   this.playUwuShot();   return true;
      case 'bark':  this.playBarkShot();  return true;
      case 'sparkle': this.playSparkleShot(); return true;
      default: return false;
    }
  }

  playMeowShot() {
    playDesignedSound(this, 'meow');
  }
  playUwuShot() {
    playDesignedSound(this, 'uwu');
  }
  playBarkShot() {
    playDesignedSound(this, 'bark');
  }
  playSparkleShot() {
    playDesignedSound(this, 'sparkle');
  }

  playExplosion(kind = 'rocket') {
    if (!this.ctx) return;
    playBlastImpact(this, kind);
  }

  playSwing(variant = 0) { playBladeSlice(this, variant); }

  playSwordImpact(surface = 'armor') { playBladeImpact(this, surface); }

  playReload() {
    playDesignedSound(this, 'reload');
  }

  playHit() {
    playDesignedSound(this, 'hit');
  }

  playKill() {
    playDesignedSound(this, 'kill');
  }

  playHurt() {
    playDesignedSound(this, 'hurt');
  }

  playEmptyClick() {
    playDesignedSound(this, 'empty');
  }
  playFootstep(sprint = false) {
    playFootstepRecording(this, sprint);
  }
  playJump() {
    playDesignedSound(this, 'jump');
  }
  playLand(hard = false) {
    playFootstepRecording(this, hard, true);
  }
  playTeleport() {
    playDesignedSound(this, 'teleport');
  }
  playWeaponSwitch() {
    playDesignedSound(this, 'switch');
  }
  playShellCasing() {
    playDesignedSound(this, 'casing');
  }
  playReloadMag() {
    playDesignedSound(this, 'magazine');
  }
  playReloadRack() {
    playDesignedSound(this, 'rack');
  }
  playZombieGrowl() {
    playDesignedSound(this, 'growl');
  }
  playZombieDeath() {
    playDesignedSound(this, 'zombie-death');
  }
  playZombieAttack() {
    playDesignedSound(this, 'zombie-attack');
  }
  startAmbientCity() {
    if (!this.ctx || this._ambientRunning) return;
    this._ambientRunning = true;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(6.0);
    noise.loop = true;
    noise.loopStart = .2;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const ambGain = this.ctx.createGain();
    ambGain.gain.value = 0.055;
    noise.connect(lp).connect(ambGain).connect(this.out);
    noise.start();
    this._ambientNoise = noise;
    this._ambientNodes = [noise, lp, ambGain];

  }

  stopAmbientCity() {
    this._ambientRunning = false;
    for (const node of this._ambientNodes || []) node.disconnect();
    this._ambientNodes = null;
    if (this._ambientNoise) { try { this._ambientNoise.stop(); } catch {} this._ambientNoise = null; }
    if (this._sirenInterval) { clearInterval(this._sirenInterval); this._sirenInterval = null; }
  }
}
