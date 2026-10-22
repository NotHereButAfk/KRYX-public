import { readFileSync } from "node:fs";
export const SURVIVAL_BOT_DEFAULTS = Object.freeze({
  desiredParticipants: 10,
  maximumBots: 0,
  difficulty: "normal",
  survivalFriendlyBots: true,
  botsCountAsAlive: false,
  detectionRange: 42,
  fieldOfView: 140,
  reactionDelay: 0.55,
  targetMemory: 5,
  targetScanInterval: 0.3,
  targetSwitchCooldown: 1.2,
  targetSwitchRatio: 1.35,
  accuracy: 0.65,
  aimSpread: 0.045,
  trackingSpeed: 3.2,
  burstDuration: 0.65,
  burstPause: 0.5,
  idealCombatDistance: 14,
  retreatThreshold: 3,
  retreatHealth: 35,
  pathfindingInterval: 1.2,
  stuckTimeout: 3,
  recoveryTimeout: 12,
  scanBudget: 8,
  pathNodeBudget: 64,
  navigationBudgetMs: 3,
  navigationCell: 2.5,
  waveScaling: true,
  maximumWaveImprovement: 0.15,
  respawnRule: "none",
  limitedLives: null,
  gameOverSeconds: 8,
  replacement: "dead-then-distant",
  debug: false,
  names: [
    "Vortex",
    "NovaStrike",
    "Zephyr",
    "Onyx",
    "Cipher",
    "Echo",
    "Ranger",
    "Drift",
    "Karma",
    "Volt",
    "Frost",
    "Talon",
  ],
  weapons: ["m4"],
});
export function survivalBotConfig(overrides = {}) {
  const c = { ...structuredClone(SURVIVAL_BOT_DEFAULTS), ...overrides };
  if (!["easy", "normal", "hard"].includes(c.difficulty))
    throw new Error("Invalid Survival bot difficulty");
  for (const k of [
    "desiredParticipants",
    "maximumBots",
    "scanBudget",
    "pathNodeBudget",
  ])
    if (
      !Number.isInteger(c[k]) ||
      c[k] < (k === "maximumBots" ? 0 : 1) ||
      c[k] > (k === "pathNodeBudget" ? 256 : 32)
    )
      throw new Error(`Invalid ${k}`);
  for (const k of [
    "detectionRange",
    "fieldOfView",
    "reactionDelay",
    "targetMemory",
    "targetScanInterval",
    "targetSwitchCooldown",
    "targetSwitchRatio",
    "aimSpread",
    "trackingSpeed",
    "burstDuration",
    "burstPause",
    "idealCombatDistance",
    "retreatThreshold",
    "retreatHealth",
    "pathfindingInterval",
    "stuckTimeout",
    "recoveryTimeout",
    "navigationCell",
    "gameOverSeconds",
    "navigationBudgetMs",
  ])
    if (!Number.isFinite(c[k]) || c[k] <= 0 || c[k] > 360)
      throw new Error(`Invalid ${k}`);
  if (
    c.targetScanInterval < 0.2 ||
    c.pathfindingInterval < 0.5 ||
    c.recoveryTimeout < c.stuckTimeout ||
    c.navigationCell < 1
  )
    throw new Error("Unsafe AI timing/navigation configuration");
  for (const k of ["accuracy", "maximumWaveImprovement"])
    if (!Number.isFinite(c[k]) || c[k] < 0 || c[k] > 0.95)
      throw new Error(`Invalid ${k}`);
  for (const k of [
    "survivalFriendlyBots",
    "botsCountAsAlive",
    "waveScaling",
    "debug",
  ])
    if (typeof c[k] !== "boolean") throw new Error(`Invalid ${k}`);
  if (!["none", "wave"].includes(c.respawnRule))
    throw new Error("Invalid respawn rule");
  if (
    c.limitedLives !== null &&
    (!Number.isInteger(c.limitedLives) ||
      c.limitedLives < 1 ||
      c.limitedLives > 100)
  )
    throw new Error("Invalid lives");
  if (c.replacement !== "dead-then-distant")
    throw new Error("Invalid replacement policy");
  if (
    !Array.isArray(c.names) ||
    !c.names.length ||
    c.names.length > 500 ||
    c.names.some((n) => typeof n !== "string" || !/^[\w -]{1,20}$/.test(n))
  )
    throw new Error("Invalid bot names");
  if (
    !Array.isArray(c.weapons) ||
    !c.weapons.length ||
    c.weapons.some(
      (w) => !["m4", "battlerifle", "magnum", "energyshotgun", "plasmarifle", "levershotgun", "uzi"].includes(w),
    )
  )
    throw new Error("Invalid bot loadouts");
  // Debug data is never enabled by a browser query or on production services.
  c.debug = c.debug && process.env.NODE_ENV === "development";
  return c;
}
export function loadSurvivalBotConfig() {
  const overrides = process.env.SURVIVAL_BOT_CONFIG
    ? JSON.parse(readFileSync(process.env.SURVIVAL_BOT_CONFIG, "utf8")) : {};
  // Public Survival is humans versus zombies, even with an older server config.
  return survivalBotConfig({ ...overrides, maximumBots: 0, botsCountAsAlive: false });
}
