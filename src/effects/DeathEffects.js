import * as THREE from 'three';
import { ALL_WEAPON_SKINS } from '../weapons/WeaponSkins.js';
const legendaryPresets = new Map(ALL_WEAPON_SKINS.filter(s => ['legendary', 'mythic'].includes(s.rarity)).map(s => [s.id, ['gold', 'fire', 'electric', 'poison', 'void_fx'][s.legendaryStyle]]));

// Particle death effect — visual burst when a bot is eliminated.
// Preset type is chosen by the killer's active skin.

const N = 16; // particles per death

// upY: upward acceleration (positive = up); dnY: downward gravity; spd: launch speed
const PRESETS = {
  default:  { colors:[0x888888,0xaaaaaa,0x666666], upY:0,    dnY:5,   spd:3.5, life:0.80, sz:0.065 },
  fire:     { colors:[0xff4400,0xff8800,0xffcc44], upY:5,    dnY:1.5, spd:5.5, life:0.75, sz:0.080 },
  electric: { colors:[0x44ccff,0xffffff,0x00aaff], upY:0,    dnY:0.5, spd:9.5, life:0.50, sz:0.045 },
  void_fx:  { colors:[0x6600cc,0x330055,0xaa44ff], upY:2,    dnY:0.5, spd:3.0, life:1.05, sz:0.070 },
  rainbow:  { colors:null,                          upY:0,    dnY:3.5, spd:5.5, life:0.88, sz:0.070 },
  poison:   { colors:[0x44cc22,0x228811,0x66ee44], upY:0,    dnY:4.5, spd:3.5, life:1.00, sz:0.075 },
  ice:      { colors:[0xaaddff,0x88bbee,0xffffff], upY:0,    dnY:4.5, spd:4.5, life:0.72, sz:0.060 },
  gold:     { colors:[0xffcc00,0xffd700,0xffe066], upY:2,    dnY:4.0, spd:4.5, life:0.95, sz:0.065 },
  sacred:   { colors:[0xffffff,0xd0e8ff,0xfff0d0], upY:6,    dnY:0,   spd:3.5, life:0.78, sz:0.090 },
  blood:    { colors:[0xcc1111,0x880808,0xff2222], upY:0,    dnY:5.5, spd:4.0, life:0.88, sz:0.075 },
};

const ID_PRESET = {
  // Gun skins
  inferno:'fire',   plasma:'electric', prism:'rainbow',   void:'void_fx',
  crimson:'blood',  gold:'gold',       arctic:'ice',      emerald:'poison',
  rose:'gold',      obsidian:'void_fx',
  // Sword skins
  lava_blade:'fire',   soul_fire:'electric', storm:'electric',   corruption:'poison',
  void_blade:'void_fx',sacred:'sacred',      frostbite:'ice',    bloodstained:'blood',
  gilded:'gold',       phantom:'void_fx',    dawn:'gold',        silver:'ice',
  poison:'poison',     dragon:'blood',       polished:'default',
};

export class DeathEffectManager {
  constructor(scene) {
    this.scene = scene;
    this._fx = [];
  }

  spawn(position, weaponSkinId, swordSkinId, isMelee) {
    const key = isMelee ? (swordSkinId || weaponSkinId || '') : (weaponSkinId || '');
    const preset = PRESETS[legendaryPresets.get(key) || ID_PRESET[key] || 'default'];
    const parts = [];

    // expanding shockwave ring at the kill point
    const ringColor = preset.colors ? preset.colors[0] : 0xffffff;
    const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.22, 20), ringMat);
    ringMesh.position.set(position.x, position.y + 0.9, position.z);
    ringMesh.rotation.x = -Math.PI / 2;
    this.scene.add(ringMesh);

    for (let i = 0; i < N; i++) {
      const hex = preset.colors
        ? preset.colors[i % preset.colors.length]
        : new THREE.Color().setHSL(i / N, 0.95, 0.60).getHex();

      const r = preset.sz * (0.5 + Math.random() * 1.0);
      const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 4, 4), mat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.4,
        position.y + 0.9 + (Math.random() - 0.5) * 0.5,
        position.z + (Math.random() - 0.5) * 0.4
      );
      this.scene.add(mesh);

      // random unit-sphere direction
      const theta = Math.random() * Math.PI * 2;
      const cosP  = Math.random() * 2 - 1;
      const sinP  = Math.sqrt(1 - cosP * cosP);
      const s = preset.spd * (0.35 + Math.random() * 0.9);
      parts.push({ mesh, mat, vx: sinP * Math.cos(theta) * s, vy: cosP * s, vz: sinP * Math.sin(theta) * s });
    }
    this._fx.push({ parts, preset, t: 0, ring: { mesh: ringMesh, mat: ringMat } });
  }

  update(dt) {
    const ay_factor = dt;
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const f = this._fx[i];
      f.t += dt;
      const prog = Math.min(1, f.t / f.preset.life);
      const opacity = Math.max(0, 1 - prog * prog);
      const ay = (f.preset.upY - f.preset.dnY) * ay_factor;

      for (const p of f.parts) {
        p.vx *= 0.97; p.vz *= 0.97;
        p.vy += ay;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mat.opacity = opacity;
      }

      // shockwave ring expands fast and fades in the first half of the effect
      if (f.ring) {
        const rp = Math.min(1, f.t / (f.preset.life * 0.6));
        const scale = 1 + rp * 7;
        f.ring.mesh.scale.set(scale, scale, scale);
        f.ring.mat.opacity = Math.max(0, 0.9 * (1 - rp));
      }

      if (prog >= 1) {
        for (const p of f.parts) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mat.dispose();
        }
        if (f.ring) {
          this.scene.remove(f.ring.mesh);
          f.ring.mesh.geometry.dispose();
          f.ring.mat.dispose();
        }
        this._fx.splice(i, 1);
      }
    }
  }
}
