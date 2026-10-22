// Manages zombie survival mode: grace period, escalating waves, player downed/revive.
import { SURVIVAL_WAVE_SECONDS, survivalWave, zombieStats } from '../entities/ZombieRoster.js';

const GRACE_TIME       = 60;   // seconds before first wave
const AUTO_REVIVE_SECS = 12;   // seconds until teammate auto-revives downed player

export class SurvivalManager {
  constructor() {
    this.AUTO_REVIVE_TIME = AUTO_REVIVE_SECS;
    this.reset();
  }

  reset() {
    this.wave          = 0;
    this.graceActive   = true;
    this.graceTimer    = GRACE_TIME;
    this.waveTimer     = 0;
    this.waveCleared   = false;
    this.isDowned      = false;
    this.downedTimer   = 0;
    this.revivesLeft   = 2;    // player gets 2 auto-revives per game
    this.gameOver      = false;
    this.elapsed       = 0;    // seconds survived this run (for best-time)

    // Callbacks — set by Game.js before calling update()
    this.onWaveStart  = null; // (wave, count, hpMult, speedMult, armedRatio, dmgMult) => void
    this.onWaveClear  = null; // (wave) => void
    this.onRevive     = null; // () => void
    this.onGameOver   = null; // () => void
    this.onGraceEnd   = null; // () => void
  }

  // Call when player HP hits 0 in survival
  playerDowned() {
    if (this.isDowned || this.gameOver) return;
    if (this.revivesLeft <= 0) {
      this.gameOver = true;
      this.onGameOver?.();
      return;
    }
    this.isDowned    = true;
    this.downedTimer = AUTO_REVIVE_SECS;
  }

  // Coin reward for killing a zombie: 0.10–0.27
  zombieKillReward() {
    return +( 0.10 + Math.random() * 0.17 ).toFixed(2);
  }

  // Escalating coin multiplier shown in the HUD; grows each wave.
  waveBonus() {
    return +Math.min(5, 1 + Math.max(0, this.wave) * 0.1).toFixed(1);
  }

  // Best survival time, persisted across runs.
  bestTime() {
    try { return Math.max(0, +localStorage.getItem('sio_survival_best') || 0); }
    catch { return 0; }
  }
  recordBest() {
    if (this.elapsed > this.bestTime()) {
      try { localStorage.setItem('sio_survival_best', String(Math.floor(this.elapsed))); } catch { /* ignore */ }
    }
  }

  _startNextWave() {
    this.wave++;
    this.waveTimer = SURVIVAL_WAVE_SECONDS;
    this.waveCleared = false;
    // The same endless progression drives local and authoritative Survival.
    const w = this.wave;
    const plan = survivalWave(w), base = zombieStats(1), stats = zombieStats(w);
    this.onWaveStart?.(w, plan.total, stats.health / base.health,
      stats.speed / base.speed, plan.gunners / plan.total, stats.damage / base.damage);
  }

  _waveClear() {
    this.waveCleared = true;
    this.onWaveClear?.(this.wave);
  }

  // allZombiesDead: ZombieManager.allDead() result passed in each frame
  update(dt, allZombiesDead) {
    if (this.gameOver) return;
    this.elapsed += dt;   // count total time survived

    // Grace period countdown
    if (this.graceActive) {
      this.graceTimer -= dt;
      if (this.graceTimer <= 0) {
        dt = -this.graceTimer;
        this.graceActive = false;
        this.onGraceEnd?.();
        this._startNextWave();
        allZombiesDead = false;
      } else return;
    }

    // Downed countdown (zombies keep moving while player is down)
    if (this.isDowned) {
      this.downedTimer -= dt;
      if (this.downedTimer <= 0) {
        this.isDowned = false;
        this.revivesLeft--;
        this.onRevive?.();
      }
      // Zombies keep moving while the player is downed.
    }

    // The next wave arrives on schedule even while older zombies are alive.
    this.waveTimer -= dt;
    let started = false;
    while (this.waveTimer <= 0) {
      const overtime = -this.waveTimer;
      this._startNextWave();
      this.waveTimer -= overtime;
      started = true;
    }
    if (!started && allZombiesDead && !this.waveCleared) {
      this._waveClear();
    }
  }
}
