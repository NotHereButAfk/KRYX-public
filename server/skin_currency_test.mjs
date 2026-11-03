import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createEconomyService } from './economy/service.mjs';
import { STORE_ITEMS } from './storecatalog.mjs';
import { validateConfig } from './economy/config.mjs';
import { getNightMarket, WEEK_MS } from './nightmarket.mjs';
import { REAL_MONEY_PURCHASES_ENABLED, SKIN_PRICES } from '../src/core/SkinPrices.js';

// Real PostgreSQL SQL, constraints and rollback. Embedded Postgres has one
// connection, so transaction leases serialize as with a one-connection pg Pool.
const db = await PGlite.create({ parsers: { 1700: value => value } });
try {
  await db.exec(`
    CREATE TABLE users(id BIGINT PRIMARY KEY, username TEXT);
    CREATE TABLE user_skins(user_id BIGINT REFERENCES users(id), skin_id TEXT,
      skin_kind TEXT, PRIMARY KEY(user_id, skin_id));
    INSERT INTO users VALUES(1,'Buyer'),(2,'Underfunded'),(3,'Rollback'),
      (4,'OffMarket'),(5,'Retry'),(6,'DirectStore');
  `);
  const query = async (sql, args) => {
    const result = args === undefined ? (await db.exec(sql)).at(-1) : await db.query(sql, args);
    return { ...result, rowCount: result.rows?.length || result.affectedRows || 0 };
  };
  let available = Promise.resolve();
  const pool = {
    query,
    async connect() {
      const previous = available;
      let release;
      available = new Promise(resolve => { release = resolve; });
      await previous;
      return { query, release };
    },
  };
  let now = Date.UTC(2026, 10, 3), userId = 1, initialize;
  const accounts = {
    ready: new Promise(resolve => { initialize = resolve; }), pool,
    async session() {
      if (!userId) return null;
      return { id: userId, sessionId: 'skin-test-' + userId,
        ownedSkins: (await query('SELECT skin_id AS id, skin_kind AS kind FROM user_skins WHERE user_id=$1', [userId])).rows };
    },
  };
  const service = createEconomyService(accounts, { clock: () => now, serverId: 'skin-currency-test' });
  // Skip unrelated match/advisory-lock startup; retain actual store migrations
  // and every config/profile/purchase method used by the real HTTP handler.
  service.runtime.init = () => service.store.init();
  initialize();
  await service.ready;
  await query("UPDATE users SET e_balance='10000'");

  async function call(path, body, headers = {}) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    req.method = body === undefined ? 'GET' : 'POST';
    req.headers = { host: 'game.test', origin: 'https://game.test', ...headers };
    let status, data;
    const handled = await service.handler(req, {
      writeHead(value) { status = value; }, end(value) { data = JSON.parse(value); },
    }, path);
    assert.equal(handled, true);
    return { status, data };
  }
  const purchase = (itemId, key, extra = {}, headers = {}) =>
    call('/api/e/purchase', { itemId, key, ...extra }, headers);
  const wallet = async id => (await query('SELECT e_balance FROM users WHERE id=$1', [id])).rows[0].e_balance;
  const owned = async id => (await query('SELECT skin_id,skin_kind FROM user_skins WHERE user_id=$1 ORDER BY skin_id', [id])).rows;
  const ledger = async id => (await query('SELECT amount,previous_balance,new_balance,metadata FROM e_transactions WHERE user_id=$1 ORDER BY id', [id])).rows;
  const state = async () => Promise.all([
    query('SELECT id,e_balance FROM users ORDER BY id'),
    query('SELECT user_id,skin_id,skin_kind FROM user_skins ORDER BY user_id,skin_id'),
    query('SELECT user_id,amount,previous_balance,new_balance,metadata,idempotency_key FROM e_transactions ORDER BY id'),
  ]).then(results => results.map(result => result.rows));
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks++; console.log('ok   ' + name); };

  await check('fresh admin catalog validates and can be saved without losing cosmetic defaults', async () => {
    const { config, revision } = await service.store.config();
    validateConfig(config);
    assert(config.items.catalog.every(item => item.earningEnabled === false && item.earningMultiplier === '1'));
    await service.store.updateConfig(1, revision, config);
    validateConfig((await service.store.config()).config);
  });

  const prices = { common: 1000, rare: 1500, epic: 2000, legendary: 2500, mythic: 3000 };
  const market = getNightMarket(now);
  const item = market.items[0], otherItem = market.items[1];
  const price = prices[item.rarity];
  const expectedBalance = (10000 - price).toFixed(4);
  const persistedConfig = structuredClone((await query('SELECT config FROM e_config WHERE id=1')).rows[0].config);
  persistedConfig.items.rarityBonus.rare = '9';
  persistedConfig.items.rarityBonus.mythic = '22';
  persistedConfig.items.catalog = [{ ...item, priceE: '0.0001', earningEnabled: true, earningMultiplier: '1.75', bonusPercent: '3' }];
  await query('UPDATE e_config SET config=$1 WHERE id=1', [persistedConfig]);

  await check('five fixed rarity prices override stale prices while preserving earning configuration', async () => {
    assert.equal(REAL_MONEY_PURCHASES_ENABLED, false);
    assert.deepEqual(SKIN_PRICES, prices);
    const { config } = await service.store.config();
    for (const entry of STORE_ITEMS) {
      assert.equal(Number(entry.priceE), prices[entry.rarity]);
      assert.equal(Number(config.items.catalog.find(candidate => candidate.id === entry.id).priceE), prices[entry.rarity]);
    }
    assert.deepEqual(config.items.rarityBonus, persistedConfig.items.rarityBonus);
    assert.equal(config.items.catalog.find(entry => entry.id === item.id).earningMultiplier, '1.75');
    assert.equal(config.items.catalog.find(entry => entry.id === item.id).bonusPercent, '3');
    const profile = await call('/api/e/me');
    assert.equal(profile.status, 200);
    assert.equal(profile.data.kPurchases, true);
    assert.equal(Number(profile.data.catalog.find(entry => entry.id === item.id).priceE), price);
  });

  await check('auth, foreign-origin and cross-site rejection preserve all wallets and ownership', async () => {
    const before = await state();
    userId = null;
    assert.equal((await purchase(item.id, 'anonymous-key')).status, 401);
    userId = 1;
    assert.equal((await purchase(item.id, 'foreign-key', {}, { origin: 'https://evil.test' })).status, 403);
    assert.equal((await purchase(item.id, 'no-origin-key', {}, { origin: undefined })).status, 403);
    assert.equal((await purchase(item.id, 'cross-site-key', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.deepEqual(await state(), before);
  });

  await check('invalid keys, unknown skins and off-market skins cause no mutations', async () => {
    const before = await state();
    const offMarket = STORE_ITEMS.find(entry => !market.items.some(offered => offered.id === entry.id));
    assert.equal((await purchase(item.id, 'bad')).status, 400);
    assert.equal((await purchase('unknown-skin', 'unknown-item-key')).status, 400);
    assert.equal((await purchase(offMarket.id, 'off-market-key')).status, 400);
    assert.deepEqual(await state(), before);
  });

  await check('forged price and account ID cannot change the exact debit, ownership or ledger', async () => {
    const result = await purchase(item.id, 'first-purchase-key', {
      priceE: '0.0001', price: 0, cost: 0, currency: 'USD', userId: 2, owned: true,
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.balance, expectedBalance);
    assert.equal(await wallet(1), expectedBalance);
    assert.equal(await wallet(2), '10000.0000');
    assert.deepEqual(await owned(1), [{ skin_id: item.id, skin_kind: item.kind }]);
    assert.deepEqual(await ledger(1), [{ amount: (-price).toFixed(4), previous_balance: '10000.0000',
      new_balance: expectedBalance, metadata: { itemId: item.id } }]);
    const profile = await call('/api/e/me');
    assert.equal(profile.data.balance, expectedBalance);
    assert(profile.data.ownedSkins.some(skin => skin.id === item.id && skin.kind === item.kind));
  });

  await check('retries debit once; reused keys and already-owned skins cannot create another grant', async () => {
    const before = await state();
    const retry = await purchase(item.id, 'first-purchase-key');
    assert.equal(retry.status, 200);
    assert.equal(retry.data.balance, expectedBalance);
    assert.equal((await purchase(otherItem.id, 'first-purchase-key')).status, 400);
    const alreadyOwned = await purchase(item.id, 'different-key-same-skin');
    assert.equal(alreadyOwned.status, 400);
    assert.match(alreadyOwned.data.error, /already owned/i);
    assert.deepEqual(await state(), before);
  });

  await check('insufficient funds preserve every balance, grant and ledger row', async () => {
    userId = 2;
    await query('UPDATE users SET e_balance=$1 WHERE id=2', [(price - .0001).toFixed(4)]);
    const before = await state();
    const result = await purchase(item.id, 'insufficient-funds-key');
    assert.equal(result.status, 400);
    assert.match(result.data.error, /not enough/i);
    assert.deepEqual(await state(), before);
  });

  await check('a real SQL failure after grant and ledger insertion rolls back the entire purchase', async () => {
    userId = 3;
    await query("ALTER TABLE users ADD CONSTRAINT rollback_probe CHECK(id <> 3 OR e_balance >= 10000)");
    const before = await state();
    assert.equal((await purchase(item.id, 'database-rollback-key')).status, 400);
    assert.deepEqual(await state(), before);
    await query('ALTER TABLE users DROP CONSTRAINT rollback_probe');
  });

  await check('a completed purchase stays retryable after its Night Market rotation ends', async () => {
    now += WEEK_MS;
    assert(!getNightMarket(now).items.some(entry => entry.id === item.id));
    userId = 1;
    const before = await state();
    assert.equal((await purchase(item.id, 'first-purchase-key')).status, 200);
    userId = 4;
    assert.equal((await purchase(item.id, 'new-off-market-key')).status, 400);
    assert.deepEqual(await state(), before);
  });

  await check('concurrent duplicate requests grant one skin and make one exact ledger debit', async () => {
    userId = 5;
    const offered = getNightMarket(now).items[0];
    const results = await Promise.all([
      purchase(offered.id, 'concurrent-retry-key'), purchase(offered.id, 'concurrent-retry-key'),
    ]);
    assert(results.every(result => result.status === 200));
    assert.equal(await wallet(5), (10000 - prices[offered.rarity]).toFixed(4));
    assert.equal((await owned(5)).length, 1);
    assert.equal((await ledger(5)).length, 1);
    assert.deepEqual(results[0].data, results[1].data);
  });

  await check('direct store calls also ignore forged config prices', async () => {
    const result = await service.store.purchase(6, item.id, 'direct-authority-key', persistedConfig);
    assert.equal(result.balance, expectedBalance);
    assert.equal(await wallet(6), expectedBalance);
    assert.equal((await owned(6)).length, 1);
    assert.equal((await ledger(6))[0].amount, (-price).toFixed(4));
  });
  console.log('Skin currency purchase checks passed: ' + checks + ' database/API cases.');
} finally {
  await db.close();
}
