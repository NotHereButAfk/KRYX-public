import { ZombieSpawnQueue, survivalWave, zombieForWave, zombieStats } from './ZombieRoster.js';
import { Zombie } from './Zombie.js';

export class ZombieManager {
  constructor(world, scene, audio = null) {
    this.world   = world;
    this.scene   = scene;
    this.zombies = [];
    this.audio   = audio;
    this.spawnQueue = new ZombieSpawnQueue();
    this.spawned = 0;
    this.wave = 0;
    this.spawnCooldown = 0;
  }

  // Compatibility getter so WeaponSystem/grenade callbacks can use .bots
  get bots() { return this.zombies; }
  get pending() { return this.spawnQueue.pending; }

  /**
   * @param {number} count
   * @param {number} hpMult
   * @param {number} speedMult
   * @param {number} wave
   * @param {number} armedRatio  0..1 — fraction of zombies that carry guns
   */
  spawnWave(count, hpMult, speedMult, wave, armedRatio = 0, dmgMult = 1) {
    this.wave = wave;
    this.spawnQueue.add(wave, count);
    this._fillSlots(true);
  }

  _fillSlots(initial = false) {
    if (!this.pending || (!initial && this.spawnCooldown > 0)) return;
    const plan = survivalWave(this.wave);
    const alive = this.zombies.filter(z => z.alive).length;
    const count = Math.min(plan.maxActive - alive, this.pending, initial ? plan.maxActive : 2);
    for (let n = 0; n < count; n++) {
      const entry = this.spawnQueue.take();
      const i = this.spawned++;
      const base = this.world.spawnPoints[i % this.world.spawnPoints.length].clone();
      base.x += (Math.random() - 0.5) * 8;
      base.z += (Math.random() - 0.5) * 8;

      const design = zombieForWave(entry.wave, entry.index);
      const stats = zombieStats(entry.wave, design.type);
      const armedType = design.type === 'gunner' ? 'rifle' : null;
      const variant = design.type === 'runner' ? 'runner' : 'shambler';
      const z = new Zombie(this.world, base, 1, 1, entry.wave, armedType, variant, 1, design.id);
      z.spawnWave = entry.wave;
      z.maxHealth = z.health = stats.health;
      z.speed = stats.speed;
      z.attackDamage = stats.damage;
      z.audio = this.audio;
      this.scene.add(z.mesh);
      this.zombies.push(z);
    }
    if (count > 0) this.spawnCooldown = plan.spawnInterval;
  }

  allDead() {
    return this.spawned > 0 && this.pending === 0 && this.zombies.every(z => !z.alive);
  }

  getRaycastTargets() {
    return this.zombies.filter(z => z.alive).map(z => z.mesh);
  }

  update(dt, player, camera, onPlayerDamaged) {
    for (const z of this.zombies) z.update(dt, player, camera, onPlayerDamaged);
    // Keep the death animation, then release the instance before the next batch.
    this.zombies = this.zombies.filter(z => {
      if (z.alive || z._dying) return true;
      this.scene.remove(z.mesh);
      z.dispose();
      return false;
    });
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);
    this._fillSlots();
  }

  clear() {
    for (const z of this.zombies) { this.scene.remove(z.mesh); z.dispose(); }
    this.zombies = [];
    this.spawnQueue.clear();
    this.spawned = this.wave = this.spawnCooldown = 0;
  }
}
