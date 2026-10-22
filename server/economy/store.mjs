import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULT_ECONOMY, validateConfig } from "./config.mjs";
import { calculateEarnings, activeEvents } from "./calculate.mjs";
import { units as u, decimal as d, min, max } from "./money.mjs";
export class EconomyStore {
  constructor(pool) {
    this.pool = pool;
  }
  async init() {
    await this.pool.query(
      readFileSync(
        new URL("../migrations/001_e_economy.sql", import.meta.url),
        "utf8",
      ),
    );
    await this.pool.query(
      "INSERT INTO e_config(id,config) VALUES(1,$1) ON CONFLICT DO NOTHING",
      [DEFAULT_ECONOMY],
    );
    // Keep existing decimal balances and ledger IDs. Upgrade configuration once.
    await this.pool.query(`UPDATE e_config SET config = jsonb_set(config || $1::jsonb,
      '{modes,deathmatch,minimumPlayers}', '1'::jsonb),
      revision=revision+1, updated_at=NOW() WHERE NOT (config ? 'killRewards')`,
      [JSON.stringify({killRewards: DEFAULT_ECONOMY.killRewards, botEarning: true})]);

    await this.pool.query(readFileSync(new URL('../migrations/004_ffa_kill_rewards.sql', import.meta.url), 'utf8'));
  }
  async transaction(fn) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async config() {
    return (
      await this.pool.query("SELECT revision,config FROM e_config WHERE id=1")
    ).rows[0];
  }
  async updateConfig(userId, revision, config) {
    validateConfig(config);
    return this.transaction(async (c) => {
      const r = await c.query(
        "UPDATE e_config SET config=$1,revision=revision+1,updated_at=NOW() WHERE id=1 AND revision=$2 RETURNING revision",
        [config, revision],
      );
      if (!r.rowCount) throw new Error("Config changed; reload before saving");
      await c.query(
        "INSERT INTO e_admin_audit(user_id,action,data) VALUES($1,$2,$3)",
        [userId, "CONFIG_UPDATE", { revision: r.rows[0].revision, config }],
      );
      return r.rows[0];
    });
  }
  async checkpoint(match) {
    await this.pool.query(
      `INSERT INTO e_matches(id,server_id,mode,state,closed) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,closed=EXCLUDED.closed,updated_at=NOW() WHERE NOT e_matches.closed AND (EXCLUDED.closed OR COALESCE((e_matches.state->>'journalRevision')::bigint,0)<=COALESCE((EXCLUDED.state->>'journalRevision')::bigint,0))`,
      [match.id, match.serverId, match.mode, match, !!match.closedAt],
    );
  }
  async profile(userId, sessionId) {
    const [user, daily, session, equipment] = await Promise.all([
      this.pool.query("SELECT e_balance FROM users WHERE id=$1", [userId]),
      this.pool.query(
        "SELECT earned FROM e_daily WHERE user_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date",
        [userId],
      ),
      this.pool.query(
        "SELECT COALESCE(SUM(amount),0)::text AS earned FROM e_transactions WHERE user_id=$1 AND session_id=$2 AND type IN ('MATCH_EARNING','WIN_REWARD','BOSS_REWARD','EVENT_REWARD')",
        [userId, sessionId],
      ),
      this.pool.query("SELECT kind,item_id FROM e_equipment WHERE user_id=$1", [
        userId,
      ]),
    ]);
    if (!user.rows[0]) throw new Error("Account unavailable");
    return {
      balance: user.rows[0].e_balance,
      dailyE: daily.rows[0]?.earned || "0.0000",
      sessionE: session.rows[0].earned,
      equipment: equipment.rows,
    };
  }
  async earningItems(userId, config) {
    const result = await this.pool.query(
      "SELECT e.item_id,e.kind FROM e_equipment e JOIN user_skins s ON s.user_id=e.user_id AND s.skin_id=e.item_id AND s.skin_kind=e.kind WHERE e.user_id=$1",
      [userId],
    );
    return result.rows
      .map((row) =>
        config.items.catalog.find(
          (i) => i.id === row.item_id && i.kind === row.kind,
        ),
      )
      .filter(Boolean);
  }
  async reserveBoosters(userId, match, config) {
    return this.transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      const active = [];
      for (const b of config.boosters) {
        if (
          !b.enabled ||
          (b.userIds?.length && !b.userIds.map(String).includes(String(userId))) ||
          Date.parse(b.startTime) > Date.now() ||
          Date.parse(b.endTime) <= Date.now() ||
          (b.modes.length && !b.modes.includes(match.mode))
        )
          continue;
        const exists = await c.query(
          "SELECT 1 FROM e_boost_usage WHERE user_id=$1 AND booster_id=$2 AND match_id=$3",
          [userId, b.id, match.id],
        );
        const count = await c.query(
          "SELECT COUNT(*)::int AS n FROM e_boost_usage WHERE user_id=$1 AND booster_id=$2",
          [userId, b.id],
        );
        if (
          !exists.rowCount &&
          b.numberOfMatches != null &&
          count.rows[0].n >= b.numberOfMatches
        )
          continue;
        await c.query(
          "INSERT INTO e_boost_usage(user_id,booster_id,match_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [userId, b.id, match.id],
        );
        active.push(b);
      }
      return active;
    });
  }
  async flag(matchId, userId, reason, metadata = {}) {
    await this.pool.query(
      "INSERT INTO e_flags(match_id,user_id,reason,metadata) VALUES($1,$2,$3,$4)",
      [matchId, userId || null, reason, metadata],
    );
  }
  async finalize(match, userId) {
    return this.transaction(async (c) => {
      // Same lock order for all balance writers. This serializes daily caps across rooms.
      const user = (
        await c.query("SELECT id,e_balance FROM users WHERE id=$1 FOR UPDATE", [
          userId,
        ])
      ).rows[0];
      if (!user) throw new Error("Account unavailable");
      const prior = (
        await c.query(
          "SELECT summary FROM e_finalizations WHERE match_id=$1 AND user_id=$2",
          [match.id, userId],
        )
      ).rows[0];
      if (prior) return prior.summary;
      const stored = (
        await c.query(
          "SELECT state,closed FROM e_matches WHERE id=$1 FOR UPDATE",
          [match.id],
        )
      ).rows[0];
      if (!stored?.closed) throw new Error("Match not closed");
      match = stored.state;
      const player = match.players[String(userId)];
      if (!player?.userId || String(player.userId) !== String(userId))
        throw new Error("No match participation");
      const day = (
        await c.query("SELECT (NOW() AT TIME ZONE 'UTC')::date::text AS day")
      ).rows[0].day;
      await c.query(
        "INSERT INTO e_daily(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [userId, day],
      );
      const daily = (
        await c.query(
          "SELECT earned FROM e_daily WHERE user_id=$1 AND day=$2 FOR UPDATE",
          [userId, day],
        )
      ).rows[0];
      const summary = calculateEarnings(match, player, match.config, {
        dailyEarned: daily.earned,
        final: true,
      });
      let balance = u(user.e_balance),
        remaining = u(summary.finalE);
      const parts = [
        ["MATCH_EARNING", d(u(summary.baseE) + u(summary.bonusE))],
        ["BOSS_REWARD", summary.bossRewards],
        ["WIN_REWARD", summary.winReward],
        ["EVENT_REWARD", summary.eventRewards],
      ];
      for (const [type, value] of parts) {
        const amount = min(remaining, max(0n, u(value)));
        remaining -= amount;
        if (amount === 0n) continue;
        const previous = balance;
        balance += amount;
        await c.query(
          `INSERT INTO e_transactions(id,user_id,match_id,amount,type,description,previous_balance,new_balance,game_mode,eligible_score,multiplier,server_id,session_id,metadata,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            randomUUID(),
            userId,
            match.id,
            d(amount),
            type,
            `${match.mode} match reward`,
            d(previous),
            d(balance),
            match.mode,
            summary.eligibleScore,
            summary.itemMultiplier,
            match.serverId,
            player.sessionId,
            summary,
            `${match.id}:${userId}:${type}`,
          ],
        );
      }
      await c.query("UPDATE users SET e_balance=$1 WHERE id=$2", [
        d(balance),
        userId,
      ]);
      await c.query(
        "UPDATE e_daily SET earned=earned+$1 WHERE user_id=$2 AND day=$3",
        [summary.finalE, userId, day],
      );
      summary.balance = d(balance);
      summary.matchId = match.id;
      summary.finalized = true;
      summary.guest = false;
      await c.query(
        "INSERT INTO e_finalizations(match_id,user_id,summary) VALUES($1,$2,$3)",
        [match.id, userId, summary],
      );
      return summary;
    });
  }
  async recover(serverId) {
    const rows = (
      await this.pool.query(
        `SELECT state,closed FROM e_matches m WHERE server_id=$1 AND (NOT closed OR EXISTS(SELECT 1 FROM jsonb_each(m.state->'players') p WHERE p.value->>'userId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM e_finalizations f WHERE f.match_id=m.id AND f.user_id::text=p.value->>'userId')))`,
        [serverId],
      )
    ).rows;
    for (const row of rows) {
      const m = row.state;
      if (!row.closed) {
        m.closedAt = m.checkpointAt || m.startedAt;
        await this.checkpoint(m);
      }
      for (const p of Object.values(m.players))
        if (p.userId) await this.finalize(m, p.userId);
    }
  }
  async equip(userId, kind, itemId, config) {
    if (!["character", "weapon"].includes(kind))
      throw new Error("Invalid slot");
    if (itemId === null) {
      await this.pool.query(
        "DELETE FROM e_equipment WHERE user_id=$1 AND kind=$2",
        [userId, kind],
      );
      return;
    }
    if (!config.items.catalog.some((i) => i.id === itemId && i.kind === kind))
      throw new Error("Unknown item");
    const r = await this.pool.query(
      "INSERT INTO e_equipment(user_id,kind,item_id) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM user_skins WHERE user_id=$1 AND skin_id=$3 AND skin_kind=$2) ON CONFLICT(user_id,kind) DO UPDATE SET item_id=EXCLUDED.item_id RETURNING item_id",
      [userId, kind, itemId],
    );
    if (!r.rowCount) throw new Error("Item not owned");
  }
  async purchase(userId, itemId, key, config, { beforePurchase } = {}) {
    const item = config.items.catalog.find(
      (i) => i.id === itemId && i.priceE != null,
    );
    if (!item) throw new Error("Item unavailable");
    return this.transaction(async (c) => {
      const user = (
        await c.query("SELECT e_balance FROM users WHERE id=$1 FOR UPDATE", [
          userId,
        ])
      ).rows[0];
      const idem = `purchase:${userId}:${key}`;
      const prior = (
        await c.query("SELECT * FROM e_transactions WHERE idempotency_key=$1", [
          idem,
        ])
      ).rows[0];
      if (prior) {
        if (prior.metadata.itemId !== itemId)
          throw new Error("Request key reused");
        return { balance: prior.new_balance };
      }
      if (beforePurchase) await beforePurchase(c);
      const owned = await c.query(
        "SELECT 1 FROM user_skins WHERE user_id=$1 AND skin_id=$2",
        [userId, itemId],
      );
      if (owned.rowCount) throw new Error("Already owned");
      const balance = u(user.e_balance),
        price = u(item.priceE);
      if (balance < price) throw new Error("Not enough E");
      await c.query(
        "INSERT INTO user_skins(user_id,skin_id,skin_kind) VALUES($1,$2,$3)",
        [userId, itemId, item.kind],
      );
      await c.query(
        `INSERT INTO e_transactions(id,user_id,amount,type,description,previous_balance,new_balance,metadata,idempotency_key) VALUES($1,$2,$3,'SHOP_PURCHASE',$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          userId,
          d(-price),
          `E item: ${itemId}`,
          d(balance),
          d(balance - price),
          { itemId },
          idem,
        ],
      );
      await c.query("UPDATE users SET e_balance=$1 WHERE id=$2", [
        d(balance - price),
        userId,
      ]);
      return { balance: d(balance - price) };
    });
  }
  async adjust(
    adminId,
    userId,
    amount,
    description,
    key,
    type = "ADMIN_ADJUSTMENT",
    originalId = null,
  ) {
    if (
      !["ADMIN_ADJUSTMENT", "REFUND"].includes(type) ||
      !description?.trim() ||
      description.length > 500
    )
      throw new Error("Invalid adjustment");
    const delta = u(amount);
    if (type === "REFUND" && delta <= 0n) throw new Error("Invalid refund");
    return this.transaction(async (c) => {
      const user = (
        await c.query("SELECT e_balance FROM users WHERE id=$1 FOR UPDATE", [
          userId,
        ])
      ).rows[0];
      if (!user) throw new Error("Unknown user");
      const idem =
        type === "REFUND" ? `refund:${originalId}` : `admin:${adminId}:${key}`;
      const prior = (
        await c.query("SELECT * FROM e_transactions WHERE idempotency_key=$1", [
          idem,
        ])
      ).rows[0];
      if (prior) {
        if (
          String(prior.user_id) !== String(userId) ||
          u(prior.amount) !== delta
        )
          throw new Error("Request key reused");
        return prior;
      }
      if (type === "REFUND") {
        const purchase = (
          await c.query(
            "SELECT * FROM e_transactions WHERE id=$1 AND user_id=$2 AND type='SHOP_PURCHASE'",
            [originalId, userId],
          )
        ).rows[0];
        if (!purchase || -u(purchase.amount) !== delta)
          throw new Error("Refund must match purchase");
        await c.query(
          "DELETE FROM user_skins WHERE user_id=$1 AND skin_id=$2",
          [userId, purchase.metadata.itemId],
        );
        await c.query(
          "DELETE FROM e_equipment WHERE user_id=$1 AND item_id=$2",
          [userId, purchase.metadata.itemId],
        );
      }
      const next = u(user.e_balance) + delta;
      if (next < 0n) throw new Error("Balance cannot be negative");
      const r = await c.query(
        `INSERT INTO e_transactions(id,user_id,amount,type,description,previous_balance,new_balance,metadata,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          randomUUID(),
          userId,
          d(delta),
          type,
          description,
          user.e_balance,
          d(next),
          { adminId, originalId },
          idem,
        ],
      );
      await c.query("UPDATE users SET e_balance=$1 WHERE id=$2", [
        d(next),
        userId,
      ]);
      await c.query(
        "INSERT INTO e_admin_audit(user_id,action,data) VALUES($1,$2,$3)",
        [adminId, type, { userId, amount, description }],
      );
      return r.rows[0];
    });
  }
}
