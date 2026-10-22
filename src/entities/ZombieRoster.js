import { WALK_SPEED, SPRINT_MULT } from '../sim/MovementConfig.js';
// Shared cosmetic identity and wave scaling: the server owns the selected type.
const names = ['Quarantine','Riot Breaker','Deep Miner','Lost Medic','Cinder Husk',
  'Spore Bloom','Thornwalker','Cryo Subject','Reactor Leak','Sunken Diver',
  'Scrap Collector','Prison Warden','Track Runner','Dead Engineer','Parasite Host',
  'Bone Carapace','Signal Lost','Breach Unit','Crystal Revenant','Wasteland Scavenger'];
export const ZOMBIE_ROSTER = Object.freeze(names.map((name,id) => Object.freeze({
  id, name,
  type: [3,11,13,16].includes(id) ? 'gunner' : [6,7,12,19].includes(id) ? 'runner' : 'walker',
})));
export const SURVIVAL_WAVE_SECONDS = 60;

// Store one entry per incoming wave, not one object per zombie. Old entries
// retain their wave's type/stats when a new timed wave joins the queue.
export class ZombieSpawnQueue {
  constructor() { this.clear(); }
  clear() { this.batches = []; this.pending = 0; }
  add(wave, count = survivalWave(wave).total, boss = null) {
    count = Math.max(0, Math.floor(count));
    if (!count) return;
    this.batches.push({ wave, count, index: 0, boss });
    this.pending += count;
  }
  take() {
    const batch = this.batches[0];
    if (!batch) return null;
    const next = { wave: batch.wave, index: batch.index++, boss: batch.boss };
    this.pending--;
    if (batch.index === batch.count) this.batches.shift();
    return next;
  }
}
// The wave grows without a final round or a total-enemy cap. Only simultaneous
// enemies are bounded; the rest enter as reinforcements when slots open.
export function survivalWave(wave) {
  const w = Math.max(1, Math.floor(wave));
  const level = w - 1;
  const total = 5 + level * 3;
  const armedRatio = w < 4 ? 0 : .12 + .63 * (w - 4) / (w + 8);
  const gunners = Math.floor(total * armedRatio);
  const runners = w < 2 ? 0 : Math.floor((total - gunners) * (.25 + .2 * level / (level + 15)));
  return { total, gunners, runners, maxActive: 30, spawnInterval: .25 + .65 / (1 + level * .08) };
}
export function zombieForWave(wave, index) {
  const w = Math.max(1, Math.floor(wave));
  const plan = survivalWave(w);
  const i = Math.abs(Math.floor(index)) % plan.total;
  const priorGunners = Math.floor(i * plan.gunners / plan.total);
  const gunner = Math.floor((i + 1) * plan.gunners / plan.total) > priorGunners;
  const meleeIndex = i - priorGunners, meleeTotal = plan.total - plan.gunners;
  const runner = Math.floor((meleeIndex + 1) * plan.runners / meleeTotal) > Math.floor(meleeIndex * plan.runners / meleeTotal);
  const type = gunner ? 'gunner' : runner ? 'runner' : 'walker';
  const available = ZOMBIE_ROSTER.filter(z => z.type === type);
  return available[((w - 1) * 7 + i) % available.length];
}
export function zombieStats(wave, type = 'walker') {
  const level = Math.max(0, Math.floor(wave)-1);
  const runner = type === 'runner', gunner = type === 'gunner';
  return {
    health: Math.round((runner ? 75 : gunner ? 90 : 115) * (1 + level * .28 + level * level * .003)),
    damage: Math.ceil((gunner ? 7 : runner ? 12 : 18) + level * (gunner ? 1.1 : runner ? 1.8 : 2.7)),
    // Soft speed limit preserves escape routes while every wave gets faster.
    speed: WALK_SPEED * SPRINT_MULT * (runner ? 1.08 : 1) * (1 + .65 * level / (level + 12)),
    weapon: gunner ? 'm4' : 'sword',
  };
}
