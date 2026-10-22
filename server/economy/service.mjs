import { EconomyStore } from "./store.mjs";
import { EconomyRuntime } from "./runtime.mjs";
const send = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 200000) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}
function sameOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  try {
    return (
      !!req.headers.origin &&
      new URL(req.headers.origin).host === req.headers.host
    );
  } catch {
    return false;
  }
}
export function createEconomyService(accounts, options = {}) {
  if (!accounts) return null;
  const store = new EconomyStore(accounts.pool),
    runtime = new EconomyRuntime(store, options);
  const admins = new Set(
    String(process.env.E_ADMIN_USER_IDS || "")
      .split(",")
      .filter((v) => /^\d+$/.test(v)),
  );
  const ready = Promise.resolve(accounts.ready).then(() => runtime.init());
  ready.catch((e) => console.error("[economy initialization]", e.message));
  const rate = new Map();
  async function handler(req, res, path) {
    if (!path.startsWith("/api/e/")) return false;
    try {
      await ready;
    } catch {
      send(res, 503, { error: "K temporarily unavailable" });
      return true;
    }
    try {
      const user = await accounts.session(req);
      if (!user) {
        send(res, 401, { error: "Registered account required" });
        return true;
      }
      const admin = admins.has(String(user.id));
      if (path.startsWith("/api/e/admin/") && !admin) {
        send(res, 403, { error: "Administrator access required" });
        return true;
      }
      if (req.method !== "GET") {
        if (!sameOrigin(req)) {
          send(res, 403, { error: "Same-origin request required" });
          return true;
        }
        const now = Date.now(),
          r = rate.get(user.id) || { at: now, count: 0 };
        if (now - r.at > 60000) {
          r.at = now;
          r.count = 0;
        }
        r.count++;
        rate.set(user.id, r);
        if (r.count > 30) {
          send(res, 429, { error: "Try again shortly" });
          return true;
        }
      }
      const { revision, config } = await store.config();
      if (req.method === "GET" && path === "/api/e/me") {
        send(res, 200, {
          ...(await store.profile(user.id, user.sessionId)),
          admin,
          catalog: config.items.catalog.map(item => ({...item, priceE: null})),
          kPurchases: false,
          ownedSkins: user.ownedSkins || [],
          dailyCap: config.DAILY_E_CAP,
          earningEnabled: config.enabled,
        });
        return true;
      }
      if (req.method === "GET" && path === "/api/e/history") {
        const rows = await store.pool.query(
          "SELECT id,match_id,amount,type,description,created_at,previous_balance,new_balance,game_mode,eligible_score,multiplier FROM e_transactions WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [user.id],
        );
        const summaries = await store.pool.query(
          "SELECT summary FROM e_finalizations WHERE user_id=$1 ORDER BY finalized_at DESC LIMIT 10",
          [user.id],
        );
        send(res, 200, {
          transactions: rows.rows,
          summaries: summaries.rows.map((r) => r.summary),
        });
        return true;
      }
      if (req.method === "GET" && path === "/api/e/admin/config") {
        send(res, 200, { revision, config });
        return true;
      }
      if (req.method === "GET" && path === "/api/e/admin/ledger") {
        const id = new URL(req.url, "http://localhost").searchParams.get(
          "userId",
        );
        if (!/^\d+$/.test(id || "")) throw new Error("User ID required");
        const rows = await store.pool.query(
          "SELECT * FROM e_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",
          [id],
        );
        send(res, 200, { transactions: rows.rows });
        return true;
      }
      if (req.method === "GET" && path === "/api/e/admin/review") {
        const flags = await store.pool.query(
          "SELECT * FROM e_flags ORDER BY created_at DESC LIMIT 200",
        );
        send(res, 200, { flags: flags.rows });
        return true;
      }
      const data = req.method === "POST" ? await body(req) : {};
      const key = () => {
        if (
          typeof data.key !== "string" ||
          !/^[-a-zA-Z0-9]{8,80}$/.test(data.key)
        )
          throw new Error("Invalid request key");
        return data.key;
      };
      if (req.method === "POST" && path === "/api/e/equip") {
        await store.equip(user.id, data.kind, data.itemId, config);
        send(res, 200, { ok: true });
        return true;
      }
      if (req.method === "POST" && path === "/api/e/purchase") {
        send(res, 410, { error: "Skin purchases with in-game currency are no longer available" });
        return true;
      }
      if (req.method === "POST" && path === "/api/e/admin/config") {
        send(
          res,
          200,
          await store.updateConfig(user.id, data.revision, data.config),
        );
        return true;
      }
      if (req.method === "POST" && path === "/api/e/admin/adjust") {
        if (!/^\d+$/.test(String(data.userId)))
          throw new Error("Invalid account ID");
        send(
          res,
          200,
          await store.adjust(
            user.id,
            data.userId,
            data.amount,
            data.description,
            key(),
            data.type,
            data.originalId,
          ),
        );
        return true;
      }
      if (req.method === "POST" && path === "/api/e/admin/review") {
        if (!/^\d+$/.test(String(data.id))) throw new Error("Invalid flag ID");
        await store.transaction(async (c) => {
          await c.query(
            "UPDATE e_flags SET reviewed_at=NOW(),reviewed_by=$1 WHERE id=$2",
            [user.id, data.id],
          );
          await c.query(
            "INSERT INTO e_admin_audit(user_id,action,data) VALUES($1,$2,$3)",
            [user.id, "REVIEW_FLAG", { id: data.id }],
          );
        });
        send(res, 200, { ok: true });
        return true;
      }
      send(res, 404, { error: "Unknown K operation" });
    } catch (e) {
      console.error("[economy request]", e.message);
      send(res, 400, {
        error: e.message?.includes("Expected decimal")
          ? "Invalid decimal"
          : e.message?.slice(0, 150) || "Request failed",
      });
    }
    return true;
  }
  return { handler, runtime, ready, store };
}
