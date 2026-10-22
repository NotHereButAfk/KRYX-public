// Floating enemy nameplates (ev.io-style): a name + health bar above each living
// opponent, projected to the screen each frame. Replaces the 3D bar on bots so
// the plate stays crisp and always faces the camera.
import * as THREE from 'three';
import { isNameplateOccluded } from './NameplateOcclusion.js';

const MAX_DIST = 90;   // don't show plates for very distant bots

export class Nameplates {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'nameplates';
    (document.getElementById('hud') || document.body).appendChild(this.container);
    this._labels = new Map();   // bot -> element
    this._v   = new THREE.Vector3();
    this._cam = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._live = new Set();
    this._occlusion = new WeakMap();
  }

  update(camera, bots, world) {
    if (!camera || !bots) return;
    const w = window.innerWidth, h = window.innerHeight;
    camera.getWorldPosition(this._cam);
    const live = this._live;
    live.clear();
    const now = performance.now();

    for (const bot of bots) {
      if (!bot.alive || !bot.mesh) continue;
      // Hide the bot's built-in 3D health bar; the DOM plate replaces it.
      if (bot.healthBarGroup) bot.healthBarGroup.visible = false;

      this._target.set(bot.position.x, bot.position.y + 2.15, bot.position.z);
      const distSq = this._cam.distanceToSquared(this._target);
      this._v.copy(this._target);
      this._v.project(camera);
      const onScreen = this._v.z < 1 &&
        this._v.x > -1.05 && this._v.x < 1.05 && this._v.y > -1.05 && this._v.y < 1.05;
      let el = this._labels.get(bot);

      // Projection and squared-distance rejection are cheap. Only raycast for
      // nameplates that could actually be drawn, and stagger those queries at
      // 10Hz so eight opponents do not generate 480 world raycasts per second.
      if (!onScreen || distSq > MAX_DIST * MAX_DIST) {
        if (el) el.style.display = 'none';
        if (bot.alive) live.add(bot);
        continue;
      }
      let visibility = this._occlusion.get(bot);
      if (!visibility || now >= visibility.nextCheck) {
        visibility = {
          occluded: isNameplateOccluded(world, this._cam, this._target, this._raycaster),
          nextCheck: now + 100,
        };
        this._occlusion.set(bot, visibility);
      }
      if (visibility.occluded) {
        if (el) el.style.display = 'none';
        live.add(bot);
        continue;
      }
      live.add(bot);

      if (!el) {
        el = document.createElement('div');
        el.className = 'nameplate';
        el.innerHTML = '<div class="np-name"><span class="np-nametext"></span></div>' +
                       '<div class="np-bar"><div class="np-bar-fg"></div></div>';
        el._name = el.querySelector('.np-nametext');
        el._fg   = el.querySelector('.np-bar-fg');
        el._name.textContent = bot.displayName || 'Enemy';
        this.container.appendChild(el);
        this._labels.set(bot, el);
      }
      el.style.display = 'block';
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      const dist = Math.sqrt(distSq);
      const s = Math.max(0.6, Math.min(1.1, 16 / dist));
      el.style.left = '0';
      el.style.top = '0';
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${s})`;
      const healthWidth = `${Math.max(0, (bot.health / bot.maxHealth) * 100)}%`;
      if (el._fg.style.width !== healthWidth) el._fg.style.width = healthWidth;
    }

    // Remove plates for dead / despawned bots.
    for (const [bot, el] of this._labels) {
      if (!live.has(bot)) { el.remove(); this._labels.delete(bot); }
    }
  }

  clear() {
    this.container.innerHTML = '';
    this._labels.clear();
  }
}
