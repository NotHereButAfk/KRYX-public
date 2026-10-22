import { units } from "./money.mjs";
const mode = (earningEnabled, winE = "0") => ({
  earningEnabled,
  multiplier: "1",
  winE,
  maxEPerMatch: null,
  minimumPlayers: 2,
});
export const DEFAULT_ECONOMY = {
  enabled: true,
  E_PER_100_SCORE: "1",
  DAILY_E_CAP: "5000",
  MAX_E_PER_MATCH: "500",
  minimumMatchSeconds: 60,
  minimumActiveSeconds: 20,
  minimumScore: 100,
  guestEarning: false,
  privateEarning: false,
  assistWindowSeconds: 5,
  afkSeconds: 30,
  maximumEPerMinute: "200",
  maximumKillsPerMinute: 30,
  botEarning: true,
  killRewards: { enabled: true, botMin: "0.7", botMax: "1", playerMin: "1", playerMax: "2", streakThreshold: 2, streakBonus: "1" },
  sameNetworkEarning: false,
  repeatedVictim: {
    windowSeconds: 180,
    fullKills: 5,
    reducedKills: 10,
    reducedMultiplier: "0.5",
  },
  modes: {
    deathmatch: { ...mode(true, "0"), minimumPlayers: 1 },
    teamslayer: mode(true, "20"),
    ctf: mode(true),
    koth: mode(true),
    survival: mode(true),
    battle_royale: mode(true, "100"),
    private: mode(false),
    training: mode(false),
  },
  actions: {
    kill: { score: 100, earnsE: true, wave: false },
    headshot: { score: 150, earnsE: true, wave: false },
    assist: { score: 10, earnsE: true, wave: false },
    objective: { score: 250, earnsE: true, wave: false },
    survival_kill: { score: 100, earnsE: true, wave: true },
    boss: { score: 2000, earnsE: true, wave: true },
    special_boss: { score: 0, earnsE: true, wave: true },
    match_action: { score: 100, earnsE: true, wave: false },
    event_bonus: { score: 100, earnsE: true, wave: false },
    bonus: { score: 50, earnsE: false, wave: false },
  },
  survival: {
    baseMultiplier: "1",
    waveIncrement: "0.10",
    waveInterval: 10,
    maxMultiplier: "1.50",
  },
  items: {
    stacking: "additive",
    maximumMultiplier: "2",
    rarityBonus: {
      common: "0",
      rare: "5",
      epic: "10",
      legendary: "15",
      mythic: "15",
    },
    catalog: [],
  },
  boosters: [],
  events: [],
  bosses: [
    {
      id: "relic",
      enabled: false,
      spawnChance: "0.001",
      health: 10000,
      damage: 50,
      scoreReward: 0,
      directE: "10000",
      minimumWave: 50,
      modes: ["survival"],
      announce: true,
    },
  ],
};
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
export function validateConfig(c) {
  if (!object(c)) throw new Error("Config must be an object");
  const bool = (v, k) => {
    if (typeof v !== "boolean") throw new Error(`${k} must be boolean`);
  };
  const integer = (v, k, lo = 0, hi = 1000000) => {
    if (!Number.isSafeInteger(v) || v < lo || v > hi)
      throw new Error(`Invalid ${k}`);
  };
  const money = (v, k, lo = 0n, hi = 1000000000000n) => {
    const n = units(v);
    if (n < lo || n > hi) throw new Error(`Invalid ${k}`);
  };
  const mult = (v, k) => money(v, k, 0n, 1000000n);
  for (const k of [
    "enabled",
    "guestEarning",
    "privateEarning",
    "botEarning",
    "sameNetworkEarning",
  ])
    bool(c[k], k);
  for (const k of ["E_PER_100_SCORE", "maximumEPerMinute"]) money(c[k], k);
  for (const k of ["DAILY_E_CAP", "MAX_E_PER_MATCH"])
    if (c[k] !== null) money(c[k], k);
  for (const k of [
    "minimumMatchSeconds",
    "minimumActiveSeconds",
    "minimumScore",
    "assistWindowSeconds",
    "afkSeconds",
    "maximumKillsPerMinute",
  ])
    integer(c[k], k);
  if (
    !object(c.modes) ||
    !object(c.actions) ||
    !object(c.items) ||
    !object(c.survival)
  )
    throw new Error("Missing economy sections");
  for (const [id, m] of Object.entries(c.modes)) {
    if (!/^[a-z_]{1,40}$/.test(id)) throw new Error("Invalid mode");
    bool(m.earningEnabled, id);
    mult(m.multiplier, id);
    money(m.winE, id);
    integer(m.minimumPlayers, id, 1, 100);
    if (m.maxEPerMatch !== null) money(m.maxEPerMatch, id);
  }
  for (const [id, a] of Object.entries(c.actions)) {
    integer(a.score, id);
    bool(a.earnsE, id);
    bool(a.wave, id);
  }
  for (const id of Object.keys(DEFAULT_ECONOMY.actions))
    if (!c.actions[id]) throw new Error(`Missing action ${id}`);
  mult(c.survival.baseMultiplier, "survival base");
  mult(c.survival.waveIncrement, "wave increment");
  mult(c.survival.maxMultiplier, "wave max");
  integer(c.survival.waveInterval, "wave interval", 1, 1000);
  if (c.killRewards) {
    const k = c.killRewards;
    bool(k.enabled, "kill rewards");
    for (const key of ["botMin", "botMax", "playerMin", "playerMax", "streakBonus"]) money(k[key], key);
    integer(k.streakThreshold, "streak threshold", 0, 1000);
    if (units(k.botMin) > units(k.botMax) || units(k.playerMin) > units(k.playerMax)) throw new Error("Invalid kill reward range");
  }
  const r = c.repeatedVictim;
  integer(r.fullKills, "full kills");
  integer(r.reducedKills, "reduced kills", r.fullKills);
  integer(r.windowSeconds, "farming window", 1);
  mult(r.reducedMultiplier, "farming multiplier");
  if (!["additive", "multiplicative"].includes(c.items.stacking))
    throw new Error("Invalid item stacking");
  mult(c.items.maximumMultiplier, "maximum item multiplier");
  if (units(c.items.maximumMultiplier) < 10000n)
    throw new Error("Item maximum must be at least 1");
  for (const v of Object.values(c.items.rarityBonus))
    money(v, "rarity percent", 0n, 1000000n);
  for (const key of ["catalog"])
    if (!Array.isArray(c.items[key]) || c.items[key].length > 2000)
      throw new Error("Invalid item catalog");
  const unique = (list) => {
    const seen = new Set();
    for (const v of list) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(v.id) || seen.has(v.id))
        throw new Error("Invalid or duplicate ID");
      seen.add(v.id);
    }
  };
  unique(c.items.catalog);
  for (const item of c.items.catalog) {
    if (!["character", "weapon"].includes(item.kind))
      throw new Error("Invalid item kind");
    bool(item.earningEnabled, item.id);
    mult(item.earningMultiplier, item.id);
    if (item.bonusPercent != null)
      money(item.bonusPercent, item.id, 0n, 1000000n);
    if (item.priceE != null) money(item.priceE, item.id);
    if (item.priceE != null && units(item.priceE) <= 0n)
      throw new Error("Item price must be positive");
  }
  for (const key of ["boosters", "events", "bosses"]) {
    if (!Array.isArray(c[key]) || c[key].length > 100)
      throw new Error(`Invalid ${key}`);
    unique(c[key]);
  }
  for (const b of [...c.boosters, ...c.events]) {
    mult(b.multiplier, b.id);
    bool(b.enabled, b.id);
    bool(b.stackable, b.id);
    integer(b.maximumStack, b.id, 1, 10);
    if (
      !Number.isFinite(Date.parse(b.startTime)) ||
      !Number.isFinite(Date.parse(b.endTime)) ||
      Date.parse(b.endTime) <= Date.parse(b.startTime)
    )
      throw new Error("Invalid event times");
    if (!Array.isArray(b.modes) || b.modes.some((m) => !c.modes[m]))
      throw new Error("Invalid event modes");
    if (
      b.userIds &&
      (!Array.isArray(b.userIds) ||
        b.userIds.some((id) => !/^\d+$/.test(String(id))))
    )
      throw new Error("Invalid booster account IDs");
    if (
      b.bossIds &&
      (!Array.isArray(b.bossIds) ||
        b.bossIds.some((id) => !c.bosses.some((boss) => boss.id === id)))
    )
      throw new Error("Invalid event boss IDs");
    if (b.directDropChance != null) money(b.directDropChance, b.id, 0n, 10000n);
    if (b.numberOfMatches != null) integer(b.numberOfMatches, b.id, 1, 10000);
    for (const k of ["dailyCap", "maxEPerMatch", "winE", "directE"])
      if (b[k] != null) money(b[k], k);
    if (b.description && b.description.length > 500)
      throw new Error("Description too long");
  }
  for (const b of c.bosses) {
    bool(b.enabled, b.id);
    money(b.spawnChance, b.id, 0n, 10000n);
    integer(b.health, b.id, 1, 100000000);
    integer(b.damage, b.id, 0, 100000);
    integer(b.scoreReward, b.id);
    integer(b.minimumWave, b.id, 1);
    money(b.directE, b.id);
    if (!Array.isArray(b.modes) || b.modes.some((m) => !c.modes[m]))
      throw new Error("Invalid boss modes");
  }
  if(c.guestEarning) throw new Error("E earning requires a registered login; guest earning cannot be enabled");
  return structuredClone(c);
}
