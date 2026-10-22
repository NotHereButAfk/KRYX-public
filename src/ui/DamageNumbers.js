// Floating damage numbers (ev.io-style): when a shot lands on an enemy a number
// pops at the hit point and drifts up + fades. DOM/screen-space so the text stays
// crisp; the world hit point is projected to the screen once at spawn time.
import * as THREE from 'three';

export class DamageNumbers {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'damage-numbers';
    const host = document.getElementById('hud') || document.getElementById('app') || document.body;
    host.appendChild(this.container);
    this._v = new THREE.Vector3();
  }

  // worldPos: THREE.Vector3 hit point · amount: damage dealt · opts.headshot / opts.killed
  spawn(camera, worldPos, amount, opts = {}) {
    if (!camera || !worldPos) return;
    const amt = Math.round(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    this._v.copy(worldPos).project(camera);
    if (this._v.z < -1 || this._v.z > 1) return; // outside camera depth

    const w = window.innerWidth, h = window.innerHeight;
    const x = (this._v.x * 0.5 + 0.5) * w;
    const y = (-this._v.y * 0.5 + 0.5) * h;

    const anchor = document.createElement('div');
    anchor.className = 'dmg-anchor';
    anchor.style.left = `${x}px`;
    anchor.style.top  = `${y}px`;

    const el = document.createElement('div');
    el.className = 'dmg-num'
      + (opts.headshot ? ' dmg-head' : '')
      + (opts.killed   ? ' dmg-kill' : '');
    el.textContent = amt;
    const dx = (Math.random() * 2 - 1) * 26;
    el.style.setProperty('--dx', `${dx.toFixed(0)}px`);

    anchor.appendChild(el);
    while (this.container.childElementCount >= 32) this.container.firstElementChild.remove();
    this.container.appendChild(anchor);
    el.addEventListener('animationend', () => anchor.remove());
    setTimeout(() => anchor.remove(), 1100); // safety
  }

  clear() { this.container.innerHTML = ''; }
}
