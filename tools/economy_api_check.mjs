import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { createEconomyService } from "../server/economy/service.mjs";
const db = await PGlite.create({ parsers: { 1700: (v) => v } });
await db.exec(
  "CREATE TABLE users(id BIGSERIAL PRIMARY KEY);CREATE TABLE user_skins(user_id BIGINT,skin_id TEXT,skin_kind TEXT,PRIMARY KEY(user_id,skin_id));INSERT INTO users DEFAULT VALUES;INSERT INTO users DEFAULT VALUES;",
);
const query = async (sql, values) => {
  if (sql.includes("pg_try_advisory_lock"))
    return { rows: [{ locked: true }], rowCount: 1 };
  if (sql.includes("pg_advisory_unlock")) return { rows: [] };
  const r = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
  return { ...r, rowCount: r.affectedRows ?? r.rows?.length ?? 0 };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
const accounts = {
  pool,
  ready: Promise.resolve(),
  session: async (req) =>
    req.headers.cookie === "test=admin"
      ? { id: "1", sessionId: "admin", ownedSkins: [] }
      : req.headers.cookie === "test=player"
        ? { id: "2", sessionId: "player", ownedSkins: [] }
        : null,
};
process.env.E_ADMIN_USER_IDS = "1";
const economy = createEconomyService(accounts, { serverId: "security-test" });
await economy.ready;
const http = createServer(async (req, res) => {
  if (
    !(await economy.handler(
      req,
      res,
      new URL(req.url, "http://localhost").pathname,
    ))
  ) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${http.address().port}`;
const request = (path, { who = "player", data, origin = base } = {}) =>
  fetch(base + "/api/e/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      cookie: `test=${who}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
try {
  assert.equal((await request("me", { who: "guest" })).status, 401);
  assert.equal((await request("admin/config")).status, 403);
  assert.equal(
    (
      await request("admin/adjust", {
        data: {
          userId: 2,
          amount: "100000",
          key: "forged-123",
          description: "fake",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("add-e", { data: { amount: 100000 } })).status,
    404,
  );
  assert.equal(
    (
      await request("admin/config", {
        who: "admin",
        data: {},
        origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  const initial = await (
    await request("admin/config", { who: "admin" })
  ).json();
  const config = structuredClone(initial.config);
  config.E_PER_100_SCORE = "1.25";
  assert.equal(
    (
      await request("admin/config", {
        who: "admin",
        data: { revision: initial.revision, config },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("admin/config", {
        who: "admin",
        data: { revision: initial.revision, config },
      })
    ).status,
    400,
  );
  const updated = await (
    await request("admin/config", { who: "admin" })
  ).json();
  assert.equal(updated.config.E_PER_100_SCORE, "1.25");
  config.E_PER_100_SCORE = "-1";
  assert.equal(
    (
      await request("admin/config", {
        who: "admin",
        data: { revision: updated.revision, config },
      })
    ).status,
    400,
  );
  const adjustment = {
    userId: "2",
    amount: "2.1250",
    type: "ADMIN_ADJUSTMENT",
    description: "Test adjustment",
    key: "secure-request-123",
  };
  assert.equal(
    (await request("admin/adjust", { who: "admin", data: adjustment })).status,
    200,
  );
  assert.equal(
    (await request("admin/adjust", { who: "admin", data: adjustment })).status,
    200,
  );
  assert.equal((await (await request("me")).json()).balance, "2.1250");
  assert.equal(
    (await (await request("history")).json()).transactions.length,
    1,
  );
  assert.equal(
    (await request("equip", { data: { kind: "weapon", itemId: "forged" } }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("purchase", {
        data: { itemId: "forged", amount: "0", key: "purchase-123" },
      })
    ).status,
    400,
  );
  assert.equal((await request("admin/review")).status, 403);
  console.log(
    "E API security passed: account/admin authorization, CSRF, no add-E endpoint, config revisions, invalid rates, adjustment replay and forged items",
  );
} finally {
  await new Promise((resolve) => http.close(resolve));
  await economy.runtime.close();
  await db.close();
}
