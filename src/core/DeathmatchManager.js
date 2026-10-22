// Tracks kill streaks and calculates per-kill e-coin rewards for deathmatch mode.
// Base reward: 0.8–1.1 coins. Streak bonus: +current_streak coins on top.

const STREAK_RESET = 10; // seconds without a kill before streak resets

export class DeathmatchManager {
  constructor() {
    this.killStreak  = 0;
    this.streakTimer = 0;
  }

  reset() {
    this.killStreak  = 0;
    this.streakTimer = 0;
  }

  // Call on each confirmed kill. Returns { coins, streak }.
  onKill() {
    this.killStreak++;
    this.streakTimer = STREAK_RESET;
    const base  = 0.8 + Math.random() * 0.3;      // 0.80–1.10
    const bonus = this.killStreak;                 // +N for a streak of N
    return { coins: +(base + bonus).toFixed(2), streak: this.killStreak };
  }

  update(dt) {
    if (this.killStreak > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) this.killStreak = 0;
    }
  }
}
