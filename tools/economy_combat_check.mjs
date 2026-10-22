import assert from "node:assert/strict";
import { SurvivalRoom } from "../server/survivalroom.mjs";
import { TeamRoom } from "../server/teamroom.mjs";
import { AuthRoom } from "../server/authroom.mjs";
import { DEFAULT_ECONOMY } from "../server/economy/config.mjs";
import { EconomyRuntime } from "../server/economy/runtime.mjs";
// A database initialization failure must not crash ordinary guest gameplay/disconnects.
const unavailable = new EconomyRuntime({});
assert.doesNotThrow(() => unavailable.leave(1));
assert.deepEqual(unavailable.award(1, "kill"), { score: 100, e: "0.0000" });
// Production combat hook: assists expire, self/duplicate deaths cannot score twice.
const room = new AuthRoom();
const a = room.players.get(room.add(() => {}, "a")),
  b = room.players.get(room.add(() => {}, "b")),
  victim = room.players.get(room.add(() => {}, "victim"));
for (const p of room.players.values()) p.invulnerableUntil = 0;
room._damage(victim, a, 10, false);
room.tick += 20;
room._damage(victim, b, 200, false);
assert.equal(a.assists, 1);
assert.equal(a.score, 10);
assert.equal(b.score, 100);
room._kill(victim, b);
assert.equal(b.score, 100);
victim.alive = true;
victim.health = 100;
room._damage(victim, a, 5, false);
room.tick += 101;
room._damage(victim, b, 200, false);
assert.equal(a.assists, 1);
// Server Survival spawns waves, validates melee damage, and suppresses friendly fire.
const survival = new SurvivalRoom(undefined,{botConfig:{maximumBots:0}});
const human = survival.players.get(survival.add(() => {}, "survivor"));
human.invulnerableUntil = 0;
survival.nextWaveTick = 0;
survival.update();
assert.equal(survival.wave, 1);
assert.equal([...survival.players.values()].filter((p) => p.isBot).length, 5);
const enemy = [...survival.players.values()].find((p) => p.isBot);
enemy.invulnerableUntil = 0;
const old = enemy.health;
const another = [...survival.players.values()].find(
  (p) => p.isBot && p !== enemy,
);
survival._damage(enemy, another, 100, false);
assert.equal(enemy.health, old);
survival._damage(enemy, human, 10000, false);
assert.equal(enemy.alive, false);
assert.equal(enemy.deadUntil, Infinity);
survival.update();
assert(!survival.players.has(enemy.id));
const team = new TeamRoom();
const ids = Array.from({ length: 4 }, (_, i) => team.add(() => {}, `t${i}`)),
  members = ids.map((id) => team.players.get(id));
for (const p of members) p.invulnerableUntil = 0;
team._damage(members[0], members[2], 90, false);
assert.equal(members[0].health, 100);
team._damage(members[0], members[1], 20, false);
assert.equal(members[0].health, 80);
members[1].score = 100;
members[1].kills = 1;
assert.deepEqual(team.winnerIds(), [members[1].id, members[3].id]);
// Boss spawn probabilities/restrictions and one-shot jackpot accounting.
const fake = { checkpoint: async () => {}, flag: async () => {} };
let now = Date.now();
const economy = new EconomyRuntime(fake, {
  mode: "survival",
  clock: () => now,
});
economy.ready = true;
economy.config = structuredClone(DEFAULT_ECONOMY);
economy.config.guestEarning = true;
economy.config.modes.survival.minimumPlayers = 1;
economy.config.bosses[0].enabled = true;
economy.config.bosses[0].spawnChance = "1";
economy.begin();
await economy.join(1, null, () => {});
economy.activity(1, true, 1000);
assert.equal(
  economy.spawnBoss(1, () => 0),
  null,
);
const boss = economy.spawnBoss(50, () => 0);
assert(boss);
economy.damageBoss(1, boss.instanceId, 10000);
economy.damageBoss(1, boss.instanceId, 10000);
assert.equal(economy.participant(1).direct.length, 1);
assert.equal(economy.participant(1).direct[0].amount, "10000");
await economy.queue;
console.log(
  "E combat passed: assist window, duplicate kills, Survival waves/enemies, friendly-fire rules, team wins and one-shot rare bosses",
);
