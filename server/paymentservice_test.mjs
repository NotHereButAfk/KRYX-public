import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { PGlite } from '@electric-sql/pglite';
import { createPaymentService } from './paymentservice.mjs';
import { getNightMarket } from './nightmarket.mjs';
import { MAINNET_GENESIS, USDC_MINT, quoteUnits, validateTransfer } from './solanapayment.mjs';

const key = () => bs58.encode(randomBytes(32));
const merchant = key(), payer = key();
let now = Date.UTC(2026, 8, 17), userId = 1;
const db = new PGlite();
await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE user_skins(user_id BIGINT,skin_id TEXT,skin_kind TEXT,PRIMARY KEY(user_id,skin_id)); CREATE TABLE store_orders(id TEXT); INSERT INTO store_orders VALUES(\'legacy\');');
await db.exec(readFileSync(new URL('./migrations/001_e_economy.sql', import.meta.url),'utf8'));
let failGrant = false;
const pool = {
  async query(sql, args) {
    if (failGrant && sql.startsWith('INSERT INTO user_skins')) throw Error('simulated database failure');
    if (sql.includes('CREATE TABLE IF NOT EXISTS')) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
    const r = await db.query(sql, args); return { ...r, rowCount: sql.trim().startsWith('SELECT') ? r.rows.length : r.affectedRows };
  },
  async connect() { return { query: pool.query, release() {} }; },
};
const transactions = new Map();
let chain = MAINNET_GENESIS, stalePrice = false;
const service = createPaymentService({ pool, session: async () => userId ? { id: userId } : null }, {
  env: { SOLANA_MERCHANT_ADDRESS: merchant }, now: () => now, reconcileIntervalMs: 0,
  fetchImpl: async (url, opts) => {
    if (url.includes('coinbase')) return { ok: true, json: async () => ({ price: '150.00', time: new Date(now - (stalePrice ? 300000 : 0)).toISOString() }) };
    const { method, params } = JSON.parse(opts.body);
    let result;
    if (method === 'getGenesisHash') result = chain;
    if (method === 'getSignaturesForAddress') result = [...transactions.entries()].filter(([,t]) => t.transaction.message.accountKeys.includes(params[0])).map(([signature]) => ({ signature, err: null, confirmationStatus: 'finalized' }));
    if (method === 'getTransaction') { assert.equal(params[1].commitment, 'finalized'); result = transactions.get(params[0]) || null; }
    return { ok: true, json: async () => ({ result }) };
  },
});
await service.ready;
async function call(path, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = body === undefined ? 'GET' : 'POST'; req.headers = { host: 'game.test', ...headers };
  let status, data;
  await service(req, { writeHead(s) { status = s; }, end(s) { data = JSON.parse(s); } }, `/api/store/${path}`);
  return { httpStatus: status, ...data };
}
const skin = getNightMarket(now).items[0].id;
const orderBody = (asset = 'SOL') => ({ skinId: skin, asset, termsAccepted: true, termsVersion: '2026-09-17-K', amount: 0.001 });
assert.equal(quoteUnits(2000, 'SOL', '150.00'), '133333334');
assert.equal(quoteUnits(2000, 'USDC'), '20000000');
assert.throws(() => quoteUnits(2000, 'SOL', '0'));
assert.equal((await call('orders', orderBody(), { origin: 'https://evil.test' })).httpStatus, 403);
userId = 0; assert.equal((await call('orders', orderBody())).httpStatus, 401); userId = 1;
assert.equal((await call('orders', { ...orderBody(), termsAccepted: false })).httpStatus, 400);
assert.equal((await call('orders', { ...orderBody(), asset: 'ETH' })).httpStatus, 400);
chain = 'devnet'; assert.equal((await call('orders', orderBody())).httpStatus, 502); chain = MAINNET_GENESIS;
stalePrice = true; assert.equal((await call('orders', orderBody())).httpStatus, 502); stalePrice = false;
const created = await call('orders', orderBody()); assert.equal(created.httpStatus, 201);
const id = created.orderId;
assert.equal((await call('orders', orderBody())).orderId, id, 'active order reused');
const order = (await pool.query('SELECT * FROM solana_store_orders WHERE id=$1', [id])).rows[0];
assert.notEqual(order.amount_units, '1', 'client amount ignored');
assert.match(created.paymentUrl, /^solana:/);
userId = 2; assert.equal((await call(`orders/${id}`)).httpStatus, 404); userId = 1;

function transfer(o, token = false) {
  const signature = bs58.encode(randomBytes(64));
  const destination = token ? key() : o.merchant;
  const keys = token ? [payer, key(), USDC_MINT, destination, o.reference, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'] : [payer, destination, o.reference, '11111111111111111111111111111111'];
  const data = Buffer.alloc(token ? 10 : 12);
  if (token) { data[0] = 12; data.writeBigUInt64LE(BigInt(o.amount_units), 1); data[9] = 6; }
  else { data.writeUInt32LE(2); data.writeBigUInt64LE(BigInt(o.amount_units), 4); }
  return { blockTime: Math.floor(now / 1000), transaction: { signatures: [signature], message: { header: { numRequiredSignatures: 1 }, accountKeys: keys,
    instructions: [{ programIdIndex: token ? 5 : 3, accounts: token ? [1,2,3,0,4] : [0,1,2], data: bs58.encode(data) }] } },
    meta: { err: null, preBalances: [100000000000,0,0,0], postBalances: [0,Number(o.amount_units),0,0], preTokenBalances: [],
      postTokenBalances: token ? [{ accountIndex: 3, mint: USDC_MINT, owner: o.merchant, uiTokenAmount: { amount: o.amount_units } }] : [] } };
}
const tx = transfer(order);
assert.equal(validateTransfer(tx, order), true);
for (const mutate of [t => t.meta.err = {}, t => t.transaction.message.accountKeys[1] = key(), t => t.transaction.message.instructions[0].accounts.pop(), t => t.meta.postBalances[1] = 0, t => t.transaction.message.header.numRequiredSignatures = 0]) {
  const wrong = structuredClone(tx); mutate(wrong); assert.equal(validateTransfer(wrong, order), false);
}
const underpaid = structuredClone(tx);
const underpaidData = Buffer.from(bs58.decode(underpaid.transaction.message.instructions[0].data));
underpaidData.writeBigUInt64LE(1n, 4);
underpaid.transaction.message.instructions[0].data = bs58.encode(underpaidData);
assert.equal(validateTransfer(underpaid, order), false);
transactions.set(tx.transaction.signatures[0], tx);
failGrant = true; assert.equal((await call(`orders/${id}`)).httpStatus, 502);
assert.equal((await pool.query('SELECT status FROM solana_store_orders WHERE id=$1', [id])).rows[0].status, 'pending', 'grant failure rolls back order');
failGrant = false;
now += 11000;
assert.equal((await call(`orders/${id}`)).status, 'completed');
assert.equal((await call(`orders/${id}`)).status, 'completed');
assert.equal((await pool.query('SELECT * FROM user_skins')).rowCount, 1);
assert.equal((await call('orders', orderBody())).httpStatus, 409);
userId = 2;
const usdc = await call('orders', orderBody('USDC')); assert.equal(usdc.httpStatus, 201);
const tokenOrder = (await pool.query('SELECT * FROM solana_store_orders WHERE id=$1', [usdc.orderId])).rows[0];
const tokenTx = transfer(tokenOrder, true);
assert.equal(validateTransfer(tokenTx, tokenOrder), true);
const counterfeit = structuredClone(tokenTx); counterfeit.meta.postTokenBalances[0].mint = key();
assert.equal(validateTransfer(counterfeit, tokenOrder), false);
const stolen = structuredClone(tokenTx); stolen.meta.postTokenBalances[0].owner = key();
assert.equal(validateTransfer(stolen, tokenOrder), false);
transactions.set(tokenTx.transaction.signatures[0], tokenTx);
now += 700000; await service.reconcile();
assert.equal((await call(`orders/${usdc.orderId}`)).status, 'completed', 'in-window transfer recovered after expiry');
await assert.rejects(pool.query('UPDATE solana_store_orders SET signature=$1 WHERE id=$2', [tx.transaction.signatures[0], usdc.orderId]), /unique/i);
const otherSkin = getNightMarket(now).items.find(s => s.id !== skin).id;
const late = await call('orders', { ...orderBody('USDC'), skinId: otherSkin });
const lateOrder = (await pool.query('SELECT * FROM solana_store_orders WHERE id=$1', [late.orderId])).rows[0];
now += 700000;
const lateTx = transfer(lateOrder, true);
transactions.set(lateTx.transaction.signatures[0], lateTx);
await service.reconcile();
assert.equal((await call(`orders/${late.orderId}`)).status, 'needs_review');
assert.equal((await pool.query('SELECT * FROM user_skins WHERE skin_id=$1', [otherSkin])).rowCount, 0);
assert.equal((await pool.query('SELECT * FROM store_orders')).rows[0].id, 'legacy');
assert.equal((await call('client-token', {})).httpStatus, 404);
const kBody={skinId:otherSkin,requestId:'k-purchase-test-123456',termsAccepted:true,termsVersion:'2026-09-17-K',price:1};
await pool.query('UPDATE users SET e_balance=100000 WHERE id=2');
assert.equal((await call('config')).kPurchases,false);
assert.equal((await call('purchase-k',kBody)).httpStatus,410);
assert.equal((await call('purchase-k',kBody)).httpStatus,410,'old clients cannot retry a currency purchase');
assert.equal(Number((await pool.query('SELECT e_balance FROM users WHERE id=2')).rows[0].e_balance),100000);
assert.equal((await pool.query("SELECT * FROM e_transactions WHERE type='SHOP_PURCHASE' AND user_id=2")).rows.length,0);
assert.equal((await pool.query('SELECT * FROM user_skins WHERE user_id=2 AND skin_id=$1',[otherSkin])).rowCount,0);
await service.close(); await db.close();
console.log('PASS Solana checkout: integer quotes, auth, origin, terms, mainnet, freshness, references, SOL/USDC validation, rollback, replay, background recovery, legacy data');
