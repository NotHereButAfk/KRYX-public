import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { getNightMarket } from './nightmarket.mjs';
import { STORE_ITEMS } from './storecatalog.mjs';
import { address, decimalAmount, MAINNET_GENESIS, paymentUrl, quoteUnits, validateTransfer } from './solanapayment.mjs';

const PRICE = { common: '20.00', rare: '30.00', epic: '40.00', legendary: '60.00', mythic: '80.00' };
const TERMS_VERSION = '2026-09-17-K';
const items = new Map(STORE_ITEMS.map(s => [s.id, { ...s, cents: Number(PRICE[s.rarity].replace('.', '')) }]));
const send = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value)); return true;
};
async function readBody(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new Error('Body too large'); }
  return JSON.parse(body || '{}');
}
function sameOrigin(req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  try { return !req.headers.origin || new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

export function createPaymentService(accounts, { fetchImpl = fetch, env = process.env, now = Date.now, reconcileIntervalMs = 30000 } = {}) {
  if (!accounts?.pool || !accounts?.session) return null;
  let privateConfig = {};
  try { privateConfig = JSON.parse(readFileSync(new URL('./.solana.json', import.meta.url), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[store] Invalid payment configuration'); }
  env = { ...privateConfig, ...env };
  let merchant = '';
  try { merchant = address(env.SOLANA_MERCHANT_ADDRESS); } catch { /* disabled until configured */ }
  const rpcUrl = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const configured = !!merchant && /^https:\/\//.test(rpcUrl);
  const initialized = Promise.resolve(accounts.ready).then(() => accounts.pool.query(`
    CREATE TABLE IF NOT EXISTS solana_store_orders (
      id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skin_id VARCHAR(80) NOT NULL, skin_kind VARCHAR(16) NOT NULL,
      asset VARCHAR(4) NOT NULL CHECK (asset IN ('SOL','USDC')),
      amount_units NUMERIC(30,0) NOT NULL CHECK (amount_units > 0), amount_cents INTEGER NOT NULL,
      reference VARCHAR(44) NOT NULL UNIQUE, merchant VARCHAR(44) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending', signature VARCHAR(88) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      checked_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, terms_version VARCHAR(20) NOT NULL,
      quote JSONB NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS solana_orders_pending ON solana_store_orders(status,checked_at);
    CREATE INDEX IF NOT EXISTS solana_orders_user ON solana_store_orders(user_id,created_at);
  `));
  initialized.catch(() => console.error('[store] Payment database unavailable'));
  let chainChecked = false;
  async function rpc(method, params = []) {
    const response = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('RPC unavailable');
    const data = await response.json();
    if (data.error) throw new Error('RPC rejected request');
    return data.result;
  }
  async function checkChain() {
    if (chainChecked) return;
    if (await rpc('getGenesisHash') !== MAINNET_GENESIS) throw new Error('Solana mainnet required');
    chainChecked = true;
  }
  function publicOrder(o) {
    return { ok: true, orderId: o.id, skinId: o.skin_id, kind: o.skin_kind, asset: o.asset,
      amount: decimalAmount(o.amount_units, o.asset === 'SOL' ? 9 : 6), status: o.status,
      expiresAt: new Date(o.expires_at).toISOString(), merchant: o.merchant, network: 'Solana mainnet',
      paymentUrl: o.status === 'pending' && new Date(o.expires_at).getTime() > now() ? paymentUrl(o) : null,
      signature: o.signature };
  }
  const checking = new Map();
  async function verify(order) {
    if (order.status !== 'pending') return order;
    if (checking.has(order.id)) return checking.get(order.id);
    const task = (async () => {
      await accounts.pool.query('UPDATE solana_store_orders SET checked_at=$2 WHERE id=$1', [order.id, new Date(now())]);
      await checkChain();
      const signatures = await rpc('getSignaturesForAddress', [order.reference, { commitment: 'finalized', limit: 100 }]);
      for (const entry of signatures || []) {
        if (entry.err || entry.confirmationStatus !== 'finalized') continue;
        const tx = await rpc('getTransaction', [entry.signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 }]);
        if (tx?.transaction?.signatures?.[0] !== entry.signature || !validateTransfer(tx, order)) continue;
        const paidAt = tx.blockTime * 1000;
        if (paidAt < new Date(order.created_at).getTime() - 2000) continue;
        const status = paidAt > new Date(order.expires_at).getTime() ? 'needs_review' : 'completed';
        const client = await accounts.pool.connect();
        try {
          await client.query('BEGIN');
          const locked = (await client.query('SELECT * FROM solana_store_orders WHERE id=$1 FOR UPDATE', [order.id])).rows[0];
          if (locked.status !== 'pending') { await client.query('COMMIT'); return locked; }
          const result = await client.query('UPDATE solana_store_orders SET status=$2,signature=$3,completed_at=NOW() WHERE id=$1 RETURNING *', [order.id, status, entry.signature]);
          if (status === 'completed') await client.query('INSERT INTO user_skins(user_id,skin_id,skin_kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [order.user_id, order.skin_id, order.skin_kind]);
          await client.query('COMMIT'); return result.rows[0];
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      }
      await accounts.pool.query('UPDATE solana_store_orders SET checked_at=$2 WHERE id=$1', [order.id, new Date(now())]);
      return order;
    })();
    checking.set(order.id, task);
    try { return await task; } finally { checking.delete(order.id); }
  }
  let reconciling = null;
  async function reconcile() {
    if (!configured || reconciling) return reconciling;
    reconciling = (async () => {
      await initialized;
      const result = await accounts.pool.query("SELECT * FROM solana_store_orders WHERE status='pending' AND created_at>$1 ORDER BY checked_at NULLS FIRST LIMIT 20", [new Date(now() - 7 * 86400000)]);
      for (const order of result.rows) { try { await verify(order); } catch { console.error('[store] Payment reconciliation deferred'); } }
    })();
    try { await reconciling; } finally { reconciling = null; }
  }
  const timer = configured && reconcileIntervalMs > 0 ? setInterval(() => reconcile().catch(() => console.error('[store] Reconciliation unavailable')), reconcileIntervalMs) : null;
  timer?.unref();
  const handler = async (req, res, pathname) => {
    if (!pathname.startsWith('/api/store/')) return false;
    try {
      await initialized;
      if (req.method === 'GET' && pathname === '/api/store/night-market') return send(res, 200, { ok: true, ...getNightMarket(now()) });
      if (req.method === 'GET' && pathname === '/api/store/config') return send(res, 200, { ok: true, configured, assets: ['SOL','USDC'], kPurchases: false, network: 'Solana mainnet', prices: PRICE });
      if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { ok: false, err: 'Cross-site checkout is not allowed' });
      const user = await accounts.session(req);
      if (!user) return send(res, 401, { ok: false, err: 'Log in to purchase skins' });
      if (req.method === 'POST' && pathname === '/api/store/purchase-k') {
        return send(res, 410, { ok: false, err: 'Skin purchases with in-game currency are no longer available' });
      }
      if (!configured) return send(res, 503, { ok: false, err: 'Solana checkout is awaiting merchant configuration' });
      if (req.method === 'POST' && pathname === '/api/store/orders') {
        const body = await readBody(req);
        if (body.termsAccepted !== true || body.termsVersion !== TERMS_VERSION) return send(res, 400, { ok: false, err: 'Accept the current purchase terms' });
        const item = items.get(body.skinId);
        if (!item || !getNightMarket(now()).items.some(o => o.id === item.id) || !['SOL','USDC'].includes(body.asset)) return send(res, 400, { ok: false, err: 'Select an available skin and payment currency' });
        await checkChain();
        let price;
        if (body.asset === 'SOL') {
          const response = await fetchImpl('https://api.exchange.coinbase.com/products/SOL-USD/ticker', { signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('Price unavailable');
          price = await response.json();
          const age = now() - Date.parse(price.time);
          if (!Number.isFinite(age) || age < -30000 || age > 120000) throw new Error('Stale price');
        }
        const units = quoteUnits(item.cents, body.asset, price?.price);
        const client = await accounts.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
          if ((await client.query('SELECT 1 FROM user_skins WHERE user_id=$1 AND skin_id=$2', [user.id, item.id])).rowCount) {
            await client.query('ROLLBACK'); return send(res, 409, { ok: false, err: 'Skin already owned' });
          }
          const pending = (await client.query("SELECT * FROM solana_store_orders WHERE user_id=$1 AND skin_id=$2 AND status='pending' AND expires_at>$3 ORDER BY created_at DESC LIMIT 1", [user.id, item.id, new Date(now())])).rows[0];
          if (pending) { await client.query('COMMIT'); return send(res, 200, publicOrder(pending)); }
          const recent = await client.query('SELECT COUNT(*) AS count FROM solana_store_orders WHERE user_id=$1 AND created_at>$2', [user.id, new Date(now() - 3600000)]);
          if (Number(recent.rows[0].count) >= 10) { await client.query('ROLLBACK'); return send(res, 429, { ok: false, err: 'Too many checkout attempts. Try again later.' }); }
          const result = await client.query(`INSERT INTO solana_store_orders(id,user_id,skin_id,skin_kind,asset,amount_units,amount_cents,reference,merchant,created_at,expires_at,terms_version,quote)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [randomUUID(), user.id, item.id, item.kind, body.asset, units, item.cents, bs58.encode(randomBytes(32)), merchant,
            new Date(now()), new Date(now() + 600000), TERMS_VERSION, JSON.stringify(price ? { source: 'Coinbase SOL-USD', price: price.price, time: price.time } : { denomination: 'USDC' })]);
          await client.query('COMMIT'); return send(res, 201, publicOrder(result.rows[0]));
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      }
      const match = pathname.match(/^\/api\/store\/orders\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && match) {
        let order = (await accounts.pool.query('SELECT * FROM solana_store_orders WHERE id=$1 AND user_id=$2', [match[1], user.id])).rows[0];
        if (!order) return send(res, 404, { ok: false, err: 'Order not found' });
        if (!order.checked_at || now() - new Date(order.checked_at).getTime() >= 10000) order = await verify(order);
        return send(res, 200, publicOrder(order));
      }
      return send(res, 404, { ok: false, err: 'Not found' });
    } catch { return send(res, 502, { ok: false, err: 'Payment verification is temporarily unavailable. Do not send another payment; try again shortly.' }); }
  };
  handler.ready = initialized;
  handler.reconcile = reconcile;
  handler.close = async () => { clearInterval(timer); await reconciling; await Promise.allSettled([...checking.values()]); };
  return handler;
}
