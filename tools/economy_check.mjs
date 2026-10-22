import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { EconomyStore } from "../server/economy/store.mjs";
import { EconomyRuntime } from "../server/economy/runtime.mjs";
import { DEFAULT_ECONOMY, validateConfig } from "../server/economy/config.mjs";
import { calculateEarnings } from "../server/economy/calculate.mjs";
import { units as u, decimal as d } from "../server/economy/money.mjs";
const config = structuredClone(DEFAULT_ECONOMY);
validateConfig(config);
const now = Date.now(),
  match = {
    id: randomUUID(),
    serverId: "test",
    mode: "deathmatch",
    startedAt: now - 180000,
    closedAt: now,
    config,
    players: {},
  },
  player = {
    userId: "1",
    sessionId: "test-session",
    score: 500,
    joinedAt: now - 180000,
    lastSeen: now,
    activeMs: 120000,
    items: [],
    actions: [{ kind: "kill", score: 500, wave: 1, at: now, allowed: true }],
    direct: [],
  };
assert.equal(
  calculateEarnings(match, player, config, { final: true }).finalE,
  "5.0000",
);
assert.equal(d(u("90000000000000.1234")), "90000000000000.1234");
assert.throws(() => u("1.00001"));
assert.throws(() => u("NaN"));
const items = [
  {
    kind: "character",
    earningEnabled: true,
    earningMultiplier: "1",
    rarity: "legendary",
  },
  {
    kind: "weapon",
    earningEnabled: true,
    earningMultiplier: "1",
    rarity: "legendary",
  },
];
assert.equal(
  calculateEarnings(match, { ...player, items }, config).finalE,
  "6.5000",
);
assert.equal(
  calculateEarnings(
    { ...match, mode: "survival" },
    {
      ...player,
      actions: [
        { ...player.actions[0], kind: "survival_kill", score: 100, wave: 30 },
      ],
    },
    config,
  ).finalE,
  "1.3000",
);
assert.equal(
  calculateEarnings(
    { ...match, mode: "survival" },
    {
      ...player,
      actions: [{ ...player.actions[0], kind: "assist", score: 10, wave: 50 }],
    },
    config,
  ).finalE,
  "0.1000",
);
assert.equal(
  calculateEarnings(
    match,
    { ...player, actions: [{ ...player.actions[0], kind: "bonus" }] },
    config,
  ).finalE,
  "0.0000",
);
assert.equal(
  calculateEarnings(match, { ...player, userId: null }, config).finalE,
  "0.0000",
);
assert.equal(
  calculateEarnings({ ...match, private: true }, player, config).finalE,
  "0.0000",
);
assert.equal(
  calculateEarnings(match, player, config, { dailyEarned: "4998" }).finalE,
  "2.0000",
);
assert.equal(
  calculateEarnings(match, { ...player, activeMs: 0 }, config, { final: true })
    .finalE,
  "0.0000",
);
const jackpot = {
  ...player,
  direct: [{ type: "BOSS_REWARD", amount: "10000", allowed: true }],
};
assert.equal(calculateEarnings(match, jackpot, config).finalE, "500.0000");
const fine = structuredClone(config);
fine.E_PER_100_SCORE = "0.0001";
assert.equal(
  calculateEarnings(
    match,
    {
      ...player,
      actions: Array.from({ length: 10 }, () => ({
        ...player.actions[0],
        kind: "assist",
        score: 10,
      })),
    },
    fine,
  ).finalE,
  "0.0001",
);
// Execute the actual migration and balance SQL in embedded PostgreSQL, not a SQL mock.
const db = await PGlite.create({ parsers: { 1700: (v) => v } });
await db.exec(
  "CREATE TABLE users(id BIGSERIAL PRIMARY KEY,username TEXT);CREATE TABLE user_skins(user_id BIGINT REFERENCES users(id),skin_id TEXT,skin_kind TEXT,PRIMARY KEY(user_id,skin_id));INSERT INTO users(username) VALUES('one'),('two');",
);
const query = async (sql, values) => {
  if (!values) {
    const rows = await db.exec(sql);
    const r = rows.at(-1);
    return { ...r, rowCount: r.affectedRows ?? r.rows?.length ?? 0 };
  }
  const r = await db.query(sql, values);
  return { ...r, rowCount: r.affectedRows ?? r.rows?.length ?? 0 };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
const store = new EconomyStore(pool);
await store.init();
await store.init();
match.players["1"] = player;
await store.checkpoint(match);
const first = await store.finalize(match, "1"),
  second = await store.finalize(match, "1");
assert.deepEqual(first, second);
assert.equal(first.balance, "5.0000");
assert.equal(
  (await query("SELECT COUNT(*)::int n FROM e_transactions")).rows[0].n,
  1,
);
const original = await store.profile("1", "test-session");
assert.equal(original.balance, "5.0000");
assert.equal(original.sessionE, "5.0000");
// A real PostgreSQL exception after the balance write rolls every statement back.
await assert.rejects(() =>
  store.transaction(async (c) => {
    await c.query("UPDATE users SET e_balance='100' WHERE id=1");
    await c.query(
      "INSERT INTO e_finalizations(match_id,user_id,summary) VALUES($1,$2,$3)",
      [match.id, 1, {}],
    );
  }),
);
assert.equal((await store.profile("1", "test-session")).balance, "5.0000");
const cap = structuredClone(config);
cap.DAILY_E_CAP = "6";
const another = { ...structuredClone(match), id: randomUUID(), config: cap };
await store.checkpoint(another);
const limited = await store.finalize(another, 1);
assert.equal(limited.finalE, "1.0000");
assert.equal(limited.balance, "6.0000");
const purchaseConfig = structuredClone(config);
purchaseConfig.items.catalog = [
  {
    id: "earned",
    kind: "character",
    earningEnabled: true,
    earningMultiplier: "1",
    rarity: "rare",
    priceE: "2",
  },
];
await store.purchase(1, "earned", "request-123", purchaseConfig);
await store.purchase(1, "earned", "request-123", purchaseConfig);
assert.equal((await store.profile(1, "test-session")).balance, "4.0000");
await assert.rejects(() =>
  store.equip(2, "character", "earned", purchaseConfig),
);
await store.equip(1, "character", "earned", purchaseConfig);
assert.equal((await store.earningItems(1, purchaseConfig)).length, 1);
const purchase = (
  await query("SELECT * FROM e_transactions WHERE type='SHOP_PURCHASE'")
).rows[0];
await store.adjust(
  1,
  1,
  "2",
  "Refund test",
  "refund-123",
  "REFUND",
  purchase.id,
);
await store.adjust(
  1,
  1,
  "2",
  "Refund test",
  "refund-123",
  "REFUND",
  purchase.id,
);
assert.equal((await store.profile(1, "test-session")).balance, "6.0000");
assert.equal((await store.earningItems(1, purchaseConfig)).length, 0);
await assert.rejects(() =>
  store.adjust(1, 1, "-10", "No negative balance", "adjust-123"),
);
// Leave/rejoin, repeated-victim tiers and independent ordinary score.
let time = now;
const rt = new EconomyRuntime(store, {
  serverId: "unit-runtime",
  clock: () => time,
});
rt.ready = true;
rt.config = structuredClone(config);
rt.config.killRewards.enabled = false; // Exercise legacy score-based matches.
rt.config.modes.deathmatch.minimumPlayers = 1;
rt.config.minimumMatchSeconds = 0;
rt.config.minimumActiveSeconds = 0;
rt.config.minimumScore = 0;
rt.begin();
await rt.queue;
await rt.join(9, { id: "1", sessionId: "runtime" }, () => {});
rt.activity(9, true, 1000);
time += 60000;
for (let i = 0; i < 11; i++) {
  rt.activity(9, true, 50);
  rt.award(9, "kill", { victim: 99 });
}
assert.equal(rt.participant(9).score, 1100);
assert.equal(rt.preview(9).finalE, "7.5000");
rt.leave(9);
await rt.queue;
await rt.join(10, { id: "1", sessionId: "runtime" }, () => {});
assert.equal(rt.participant(10).score, 1100);
assert.equal(rt.preview(10).finalE, "7.5000");
time += 31000;
assert.equal(rt.allowed(rt.participant(10)), false);
rt.activity(10, true, 50);
assert.equal(rt.allowed(rt.participant(10)), true);
await rt.finish();
await rt.queue;
assert.equal(
  (await query("SELECT COUNT(*)::int n FROM e_finalizations WHERE user_id=1"))
    .rows[0].n,
  3,
);
// Durable crash recovery pays the stored checkpoint once, including disconnected users.
const recoverMatch = {
  ...structuredClone(match),
  id: randomUUID(),
  serverId: "crash-test",
  closedAt: undefined,
  checkpointAt: now,
  journalRevision: 2,
};
await store.checkpoint(recoverMatch);
await store.checkpoint({ ...recoverMatch, journalRevision: 1, players: {} });
assert(
  (await query("SELECT state FROM e_matches WHERE id=$1", [recoverMatch.id]))
    .rows[0].state.players["1"],
);
await store.recover("crash-test");
await store.recover("crash-test");
assert.equal(
  (
    await query(
      "SELECT COUNT(*)::int n FROM e_finalizations WHERE match_id=$1",
      [recoverMatch.id],
    )
  ).rows[0].n,
  1,
);
// Expiring and mode-restricted multipliers, stackability, and event caps.
const eventConfig = structuredClone(config);
eventConfig.events = [
  {
    id: "double",
    enabled: true,
    startTime: new Date(now - 1000).toISOString(),
    endTime: new Date(now + 1000).toISOString(),
    modes: ["deathmatch"],
    multiplier: "2",
    stackable: true,
    maximumStack: 1,
    source: "weekend",
    dailyCap: "10000",
  },
];
assert.equal(calculateEarnings(match, player, eventConfig).finalE, "10.0000");
assert.equal(
  calculateEarnings({ ...match, mode: "survival" }, player, eventConfig).finalE,
  "5.0000",
);
assert.equal(
  calculateEarnings(
    match,
    { ...player, actions: [{ ...player.actions[0], at: now + 2000 }] },
    eventConfig,
  ).finalE,
  "5.0000",
);
const boosters = [
  { ...eventConfig.events[0], id: "best", multiplier: "1.5", stackable: false },
];
assert.equal(
  calculateEarnings(match, { ...player, boosters }, eventConfig).finalE,
  "10.0000",
);
assert.equal(calculateEarnings(match,{...player,userId:null},{...config,guestEarning:true}).finalE,"0.0000","legacy config cannot enable guest E");

// K kill rolls are server-owned, retain streak bounties, and survive early exit.
const kr = new EconomyRuntime(store, {serverId: "k-rewards", clock: () => time});
kr.ready = true; kr.begin(); await kr.queue;
await kr.join(55, {id: "1", sessionId: "k-test"}, () => {});
time += 2000; kr.activity(55, true, 50);
for (const [bot, streak, low, high] of [[true, 50, .7, 1], [false, 0, 1, 2], [false, 2, 1, 2], [false, 5, 4, 5]]) {
  kr.award(55, "kill", {victimIsBot: bot, victimStreak: streak});
  const amount = Number(kr.participant(55).actions.at(-1).killBaseK);
  assert(amount >= low && amount <= high);
}
const pending = kr.preview(55).finalE;
const closedId = kr.match.id;
const balanceBefore = u((await store.profile(1, "k-test")).balance);
kr.leave(55); await kr.queue;
await kr.finish(); await kr.queue;
assert.equal(u((await store.profile(1, "k-test")).balance) - balanceBefore, u(pending));
await store.finalize({id: closedId}, 1);
assert.equal(u((await store.profile(1, "k-test")).balance) - balanceBefore, u(pending));
// Upgrade an existing E-era configuration without rewriting balances or ledger.
const preservedBalance = (await store.profile(1, "k-test")).balance;
await query("UPDATE e_config SET config=config - 'killRewards'");
await store.init();
const upgraded = await store.config();
assert.deepEqual(upgraded.config.killRewards, DEFAULT_ECONOMY.killRewards);
assert.equal(upgraded.config.botEarning, true);
assert.equal(upgraded.config.modes.deathmatch.minimumPlayers, 1);
await store.init();
assert.equal((await store.config()).revision, upgraded.revision);
assert.equal((await store.profile(1, "k-test")).balance, preservedBalance);
// The reported FFA case must settle exactly the reward shown, including a win.
await query("INSERT INTO users(username) VALUES('reward-regression')");
await store.adjust(1, 3, '127', 'Opening fixture balance', 'opening-reward-regression');
const payout = new EconomyRuntime(store, { serverId: 'ffa-exact-payout', clock: () => time });
payout.config = structuredClone(DEFAULT_ECONOMY);
payout.config.minimumMatchSeconds = 0; payout.config.minimumActiveSeconds = 0;
payout.config.minimumScore = 0;
payout.config.killRewards.botMin = payout.config.killRewards.botMax = '0.77';
payout.ready = true; payout.begin(); await payout.queue;
await payout.join(77, { id: '3', sessionId: 'exact-payout' }, () => {});
time += 2000; payout.activity(77, true, 1000);
const killPayment = payout.award(77, 'kill', { victim: 444, victimIsBot: true });
assert.equal(killPayment.e, '0.7700');
const payoutMatchId = payout.match.id;
await payout.finish([77]); await payout.queue;
assert.equal((await store.profile(3, 'exact-payout')).balance, '127.7700');
await store.finalize({ id: payoutMatchId }, 3);
assert.equal((await store.profile(3, 'exact-payout')).balance, '127.7700');
// Simulate an existing deployment's default bonus and prove the migration runs
// once, preserves balances, and subsequently respects a custom admin setting.
await query("DELETE FROM economy_data_migrations WHERE id='ffa-kill-rewards-v1'");
await query("UPDATE e_config SET config=jsonb_set(config,'{modes,deathmatch,winE}','\"25\"'::jsonb)");
await store.init(); assert.equal((await store.config()).config.modes.deathmatch.winE, '0');
await query("UPDATE e_config SET config=jsonb_set(config,'{modes,deathmatch,winE}','\"7\"'::jsonb)");
await store.init(); assert.equal((await store.config()).config.modes.deathmatch.winE, '7');
assert.equal((await store.profile(3, 'exact-payout')).balance, '127.7700');
await db.close();
console.log(
  "E economy passed: exact decimals, eligibility, items, waves, caps, guests/private, real SQL migration/idempotency/rollback, ledger purchases/refunds, reconnect and farming tiers",
);
