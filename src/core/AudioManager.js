import { preloadFootsteps, playFootstepRecording } from './FootstepAudio.js';
// Original cached game audio. Positional playback shares the master limiter.
import { playDesignedSound, playBufferVoice } from './SoundEffects.js';
import { createLegendaryShot } from './LegendaryAudio.js';
import { playBlastImpact, playBladeSlice, playBladeImpact } from './WeaponSoundDesign.js';
import { Ray, Vector3 } from 'three';
import { ArenaAmbience } from './ArenaAmbience.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._listenerPosition = new Vector3();
    this._occlusionRay = new Ray();
    this._hasListener = false;
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._platformMuted ? 0 : (this._volume ?? 0.5);

    this._connectMasterOutput();
    this.out = this.master;
    this._footstepsReady = preloadFootsteps(this.ctx);
  }

  _connectMasterOutput() {
    this._limiter = this.ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -7;
    this._limiter.knee.value = 8;
    this._limiter.ratio.value = 14;
    this._limiter.attack.value = 0.002;
    this._limiter.release.value = 0.16;
    // Compression has an attack time, so coincident gun reports can still clip
    // for a few samples. A soft output ceiling catches only those brief peaks.
    this._ceiling = this.ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= .8 ? a : .8 + .18 * (1 - Math.exp(-((a - .8) / .18))));
    }
    this._ceiling.curve = curve;
    this._ceiling.oversample = '2x';
    this.master.connect(this._limiter).connect(this._ceiling).connect(this.ctx.destination);
  }

  /** Point the WebAudio listener at the camera. Call once per frame. */
  setListener(pos, forward, up) {
    this._listenerPosition.copy(pos);
    this._hasListener = true;
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

  setWorld(world) {
    this._world = world;
  }

  _soundBehindCover(pos) {
    const world = this._world;
    if (!this._hasListener || !world?.raycastCollisionDistance || this._platformMuted || this._volume === 0) return false;
    const ray = this._occlusionRay;
    ray.origin.copy(this._listenerPosition);
    ray.direction.subVectors(pos, ray.origin);
    const distance = ray.direction.length();
    if (!Number.isFinite(distance) || distance < .8 || distance > 60) return false;
    // One octree query per event, capped during unusually crowded bursts.
    const window = Math.floor((this.ctx.currentTime || 0) * 20);
    if (window !== this._occlusionWindow) { this._occlusionWindow = window; this._occlusionQueries = 0; }
    if (this._occlusionQueries++ >= 12) return false;
    ray.direction.multiplyScalar(1 / distance);
    ray.origin.addScaledVector(ray.direction, .15);
    const far = distance - .35;
    const hit = world.raycastCollisionDistance(ray, far);
    return Number.isFinite(hit) && hit >= 0 && hit < far - .02;
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
    const nodes = [p];
    if (this._soundBehindCover(pos)) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = .35;
      const gain = this.ctx.createGain(); gain.gain.value = .72;
      p.connect(filter).connect(gain).connect(this.master);
      nodes.push(filter, gain);
    } else p.connect(this.master);

    let voices = 0, scheduled = false, disconnected = false;
    const release = () => {
      if (!scheduled || voices || disconnected) return;
      disconnected = true;
      for (const node of nodes) node.disconnect();
    };
    p._retainVoice = () => { voices++; };
    p._releaseVoice = () => { voices = Math.max(0, voices - 1); release(); };

    const prev = this.out;
    this.out = p;
    try { fn(); } finally { this.out = prev; scheduled = true; release(); }
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
      playBufferVoice(this, buffer, { rate:.985 + Math.random() * .03,
        priority:this.out === this.master ? 3 : 1 });
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

  playDeath() {
    playDesignedSound(this, 'death');
  }

  playBodyImpact(strength = 1) {
    const weight = Number.isFinite(strength) ? Math.max(.25, Math.min(1, strength)) : 1;
    playDesignedSound(this, 'body-impact', 1, { gain:weight });
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
  startAmbientCity(mapId) {
    if (!this.ctx) return;
    this._ambientRunning = true;
    this._ambience ||= new ArenaAmbience(this);
    this._ambience.start(mapId);
  }

  updateEnvironment(state, dt) {
    this._ambience?.update(state, dt);
  }

  stopAmbientCity() {
    this._ambientRunning = false;
    this._ambience?.stop();
  }
}
