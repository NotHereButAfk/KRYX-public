import assert from "node:assert/strict";
import { SurvivalRoom } from "../server/survivalroom.mjs";
import { createState } from "../src/sim/MoveSim.js";
import { calculateTargetPriority } from "../server/survival-bot-ai.mjs";
import { survivalBotConfig } from "../server/survival-bot-config.mjs";
import { EconomyRuntime } from "../server/economy/runtime.mjs";
import { DEFAULT_ECONOMY } from "../server/economy/config.mjs";
import { buildMatchRows } from "../src/core/MatchRows.js";
const flat = {
  id: "test",
  name: "test",
  half: 80,
  killY: -10,
  platforms: [],
  boxes: [],
  gravLifts: [],
  teleporters: [],
  spawns: [
    [0, 0, 0],
    [8, 0, 0],
    [-8, 0, 0],
    [0, 0, 10],
  ],
  pickups: [],
  groundHeightAt: (x, z) => (Math.abs(x) < 75 && Math.abs(z) < 75 ? 0 : -100),
  raycast: (x, y, z, dx, dy, dz, far) => far,
};
function room(config = {}) {
  return new SurvivalRoom(flat, { botConfig: { maximumBots: 10, botsCountAsAlive: true, ...config } });
}
// Production defaults leave human seats empty; zombies are the only AI population.
const publicRoom = new SurvivalRoom(flat);
publicRoom.add(() => {}, 'solo');
assert.equal(publicRoom.participants().length, 1);
assert.equal(publicRoom.participants().filter(p => p.isBot).length, 0);
publicRoom._rebalanceBots();
assert.equal(publicRoom.participants().length, 1);
assert.equal(publicRoom.botConfig.maximumBots, 0);
assert.equal(publicRoom.botConfig.botsCountAsAlive, false);
const r = room();
let latest;
const human = r.players.get(
  r.add((m) => {
    if (m.t === "snapshot") latest = m;
  }, "human"),
);
assert.equal(r.participants().length, 10);
assert.equal(r.participants().filter((p) => p.isBot).length, 9);
assert.equal(new Set(r.participants().map((p) => p.name)).size, 10);
const dead = r.participants().find((p) => p.isBot);
r._kill(dead);
const deadId = dead.id;
r.add(() => {}, "second");
assert(!r.players.has(deadId));
assert.equal(r.participants().length, 10);
for (let i = 0; i < 8; i++) assert(r.add(() => {}, "human" + i));
assert.equal(r.participants().filter((p) => p.isBot).length, 0);
assert.equal(
  r.add(() => {}, "overflow"),
  null,
);
r.remove(human.id);
assert.equal(r.participants().length, 10);
const fight = room({ desiredParticipants: 2 }),
  h = fight.players.get(fight.add(() => {}, "real")),
  bot = fight.participants().find((p) => p.isBot);
fight.nextWaveTick = 0;
fight.update();
assert.equal(fight.enemies().length, 5);
assert.equal(fight.participants().length, 2);
for (const p of fight.players.values()) p.invulnerableUntil = 0;
const enemy = fight.enemies()[0];
h.health = bot.health = 100;
fight._damage(bot, h, 30, false);
fight._damage(h, bot, 30, false);
assert.equal(h.health, 100);
assert.equal(bot.health, 100);
fight._damage(bot, enemy, 15, false);
assert.equal(bot.health, 85);
bot.state = createState(0, 0, 0);
enemy.state = createState(0, 0, -12);
fight.allyAI.reset(bot);
bot.survivalAI.yaw = 0;
assert(fight.allyAI.visible(bot, enemy, 42));
const wallArena = { ...flat, raycast: () => 0 };
fight.arena = wallArena;
assert(!fight.allyAI.visible(bot, enemy, 42));
for (let i = 0; i < 30; i++) {
  fight.tick++;
  fight.allyAI.update(bot);
  assert(!bot.fireReq);
}
fight.arena = flat;
enemy.attackingId = h.id;
const normal = calculateTargetPriority(
  bot,
  enemy,
  fight.participants(),
  fight.botConfig,
);
enemy.bossInstance = "boss";
assert(
  calculateTargetPriority(bot, enemy, fight.participants(), fight.botConfig) >
    normal,
);
delete enemy.bossInstance;
for (const e of fight.enemies().slice(1)) fight._remove(e.id, false);
enemy.health = 10000;
enemy.enemyDamage = 1;
enemy.state = createState(0, 0, -12);
h.state = createState(60, 0, 60);
fight.allyAI.reset(bot);
bot.survivalAI.yaw = 0;
let shots = 0,
  moves = 0,
  firstShot = null;
const original = fight.onFire.bind(fight);
fight.onFire = (id, m) => {
  shots++;
  firstShot ??= fight.tick;
  original(id, m);
  assert(!fight.players.get(id).fireReq?.botTargetId);
};
const start = fight.tick;
for (let i = 0; i < 240; i++) {
  fight.update();
  if (Math.hypot(bot._animVX, bot._animVZ) > 0.1) moves++;
}
assert(shots > 0, "visible enemy must draw actual weapon fire");
assert(firstShot - start >= 5, "reaction delay");
assert(moves > 10, "combat must move");
assert(
  bot.ammo.m4.mag + bot.ammo.m4.reserve <
    fight.weaponDefinition("m4").mag + fight.weaponDefinition("m4").reserve,
  "shots consume actual ammo",
);
assert(enemy.health < 10000, "production hitscan inflicts damage");
assert(bot.damageDealt > 0);
fight._kill(h, enemy);
fight.update();
assert.notEqual(fight.waveState, "GAME_OVER", "ally keeps match alive");
fight._kill(bot, enemy);
fight.update();
assert.equal(fight.waveState, "GAME_OVER");
assert.equal(bot.deadUntil, Infinity);
assert.equal(bot.survivalAI.state, "DEAD");
const kills = bot.kills;
fight.update();
assert.equal(bot.kills, kills);
const end = room({ desiredParticipants: 2, botsCountAsAlive: false });
const endHuman = end.players.get(end.add(() => {}, "real"));
end._kill(endHuman);
end.update();
assert.equal(end.waveState, "GAME_OVER");
const wave = room({
  desiredParticipants: 2,
  respawnRule: "wave",
  limitedLives: 2,
});
const wh = wave.players.get(wave.add(() => {}, "real")),
  wb = wave.participants().find((p) => p.isBot);
wave.nextWaveTick = 0;
wave.update();
wave._kill(wb);
assert.equal(wb.livesRemaining, 1);
for (const e of wave.enemies()) wave._remove(e.id, false);
wave.update();
wave.update();
assert(!wb.alive, 'clearing enemies must not respawn allies before the timed wave');
wave.tick = wave.nextWaveTick;
wave.update();
assert(wb.alive, "wave respawn");
wave._kill(wb);
assert.equal(wb.livesRemaining, 0);
wave.nextWaveTick = Infinity;
wave.waveState = "ACTIVE";
wave.update();
assert(!wb.alive, "exhausted lives");
const nav = room({ maximumBots: 0 });
assert.equal(
  nav.navigation.lane([74, 0, 0], [78, 0, 0]),
  null,
  "edge protection",
);
nav.arena = { ...flat, raycast: () => 0 };
assert.equal(
  nav.navigation.path([0, 0, 0], [10, 0, 0]).length,
  0,
  "blocked route",
);
r.update();
assert(latest === undefined); // original human disconnected
let snap;
const sr = room({ desiredParticipants: 2 });
sr.add((m) => {
  if (m.t === "snapshot") snap = m;
}, "real");
sr.nextWaveTick = 0;
sr.update();
assert.equal(snap.survival.participants, 2);
assert.equal(snap.survival.enemies, 5);
const rows = buildMatchRows({
  authClient: { roster: snap.players, you: 0 },
  isSurvival: true,
});
assert.equal(rows.length, 2);
assert(rows.some((p) => p.isBot));
assert(!snap.players.some((p) => p.botDebug));
assert.throws(() => survivalBotConfig({ targetScanInterval: 0 }));
assert.throws(() => survivalBotConfig({ accuracy: 1 }));
// Only real connections enter the E journal; optional friendly fire cannot generate E.
let clock = Date.now();
const e = new EconomyRuntime(
  { checkpoint: async () => {}, flag: async () => {},earningItems:async()=>[],reserveBoosters:async()=>[],profile:async()=>({balance:"0",sessionE:"0",dailyE:"0"}) },
  { mode: "survival", clock: () => clock },
);
e.config = structuredClone(DEFAULT_ECONOMY);

e.config.modes.survival.minimumPlayers = 1;
e.ready = true;
e.begin();
const er = room({ desiredParticipants: 2, survivalFriendlyBots: false }),
  eh = er.players.get(er.add(() => {}, "real"));
er.economy = e;
await e.join(eh.id, {id: "1", sessionId: "test"}, () => {});
clock += 60000;
e.activity(eh.id, true, 1000);
const eb = er.participants().find((p) => p.isBot);
er._kill(eb, eh);
assert.equal(e.preview(eh.id).finalE, "0.0000");
assert.equal(Object.keys(e.match.players).length, 1);
assert.equal(e.participant(eb.id), null);
er.nextWaveTick = 0;
er.update();
const ee = er.enemies()[0];
ee.invulnerableUntil = 0;
er._damage(ee, eh, 10000, false);
assert(
  Number(e.preview(eh.id).finalE) > 0,
  "legitimate PvE still earns through existing rules",
);
await e.queue;
// Recovery is delayed and never happens just because a route is blocked for a moment.
const stuck=room({desiredParticipants:2}),sh=stuck.add(()=>{},'real'),sb=stuck.participants().find(p=>p.isBot);
sb.state=createState(0,0,0);stuck.allyAI.reset(sb);stuck.waveState='ACTIVE';
stuck.navigation.steer=()=>[0,0];stuck._pickBotRoamTarget=()=>[20,0,0];
for(let i=0;i<120;i++){stuck.tick++;stuck.allyAI.update(sb);}assert.equal(sb.state.px,0);assert.equal(sb.survivalAI.recoveries,0);
for(let i=0;i<170;i++){stuck.tick++;stuck.allyAI.update(sb);}assert.equal(sb.survivalAI.recoveries,1);assert(Math.hypot(sb.state.px,sb.state.pz)>1);
// Workload uses the real imported collision arena and 10 allies plus 30 enemies.
const load = new SurvivalRoom(undefined, {
  botConfig: { desiredParticipants: 11, maximumBots: 10 },
});
load.add(() => {}, "load");
load.wave = 19;
load.nextWaveTick = 0;
const timings = [];
for (let i = 0; i < 80; i++) {
  const t = performance.now();
  load.update();
  timings.push(performance.now() - t);
}
timings.sort((a, b) => a - b);
console.log(
  "Imported-map 10 allies + 30 enemies tick ms",
  JSON.stringify({ median: timings[40], p95: timings[76], max: timings[79] }),
);
assert(timings[76] < 50, "20Hz server budget at p95");
console.log(
  "Survival bots passed: slots/replacement, PvE roles/friendly fire, LOS/reaction/movement/real damage/ammo, wave lives/game over, navigation safety, scoreboard and imported-map load.",
);
