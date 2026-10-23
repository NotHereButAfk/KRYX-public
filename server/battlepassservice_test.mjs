import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createBattlePassService } from './battlepassservice.mjs';
import { BP_MILESTONES } from '../src/sim/BattlePassCatalog.js';

const db = new PGlite();
await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,username TEXT,kills INTEGER DEFAULT 0,games INTEGER DEFAULT 0,e_balance NUMERIC DEFAULT 0);
  INSERT INTO users VALUES(1,'player1',80,0,12345),(2,'player2',0,0,99999),(3,'player3',1000,30,100);
  CREATE TABLE user_skins(user_id BIGINT REFERENCES users(id),skin_id TEXT,skin_kind TEXT,PRIMARY KEY(user_id,skin_id));
  INSERT INTO user_skins VALUES(1,'remake_153','character');`);
const pool = { async query(sql, args) {
  if (sql.includes('CREATE TABLE IF NOT EXISTS')) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
  const result = await db.query(sql, args); return { ...result, rowCount: result.affectedRows ?? result.rows.length };
} };
let currentUser = 1, flushes = 0;
const accounts = { pool, ready: Promise.resolve(), session: async () => currentUser ? { id: currentUser, username: 'player' + currentUser } : null };
const service = createBattlePassService(accounts, { flushProgress: async () => { flushes++; } });
await service.ready;
async function call(path = '/api/battlepass', body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify({ expectedUsername: 'player' + currentUser, ...body })]);
  req.method = body === undefined ? 'GET' : 'POST'; req.headers = { host: 'game.test', origin: 'https://game.test', ...headers };
  let status, data;
  await service.handler(req, { writeHead(code) { status = code; }, end(value) { data = JSON.parse(value); } }, path);
  return { status, data };
}
assert.equal((await call()).data.xp, 2000);
assert.deepEqual((await call()).data.owner, { id: '1', username: 'player1' });
assert.equal((await call('/api/battlepass/claim', { tier: 5, expectedUsername: 'player2' })).status, 409);
assert.equal((await db.query('SELECT * FROM battlepass_claims WHERE user_id=1')).rows.length, 0);
assert.equal((await call('/api/battlepass/claim', { tier: 5, expectedUsername: undefined })).status, 409);
assert.equal((await call('/api/battlepass/claim', { tier: 30, xp: 9999999 })).status, 409);
assert.equal((await call('/api/battlepass/claim', { tier: 5 }, { origin: 'https://evil.test' })).status, 403);
assert.equal((await call('/api/battlepass/claim', { tier: 5 }, { origin: undefined })).status, 403);
assert.equal((await call('/api/battlepass/claim', { tier: '5' })).status, 400);
assert.equal((await call('/api/battlepass/claim', { tier: 1 })).status, 400);
const claimed = await call('/api/battlepass/claim', { tier: 5, skinId: 'remake_181', userId: 3 });
assert.equal(claimed.status, 200);
assert.deepEqual(claimed.data.granted, [{ tier: 5, id: 'remake_110' }]);
assert.ok(claimed.data.ownedSkins.some(item => item.id === 'remake_153'));
assert.ok(claimed.data.ownedSkins.some(item => item.id === 'remake_110'));
assert.equal((await call('/api/battlepass/claim', { tier: 5 })).data.granted.length, 0);
assert.equal((await call('/api/battlepass/claim', { all: true })).status, 200);
assert.equal((await db.query('SELECT e_balance FROM users WHERE id=1')).rows[0].e_balance, '12345');
currentUser = 2;
assert.equal((await call()).data.claimed.length, 0);
assert.equal((await call('/api/battlepass/claim', { all: true })).status, 409);
currentUser = null;
assert.equal((await call()).status, 401);
assert.equal((await call('/api/battlepass/claim', { all: true })).status, 401);
currentUser = 3;
const simultaneous = await Promise.all([call('/api/battlepass/claim', { all: true }), call('/api/battlepass/claim', { all: true })]);
assert.ok(simultaneous.every(result => result.status === 200));
assert.equal(simultaneous.reduce((sum, result) => sum + result.data.granted.length, 0), 6);
assert.equal((await db.query('SELECT * FROM user_skins WHERE user_id=3')).rows.length, 6);
assert.equal((await db.query('SELECT * FROM battlepass_claims WHERE user_id=3')).rows.length, 6);
assert.equal((await db.query('SELECT e_balance FROM users WHERE id=3')).rows[0].e_balance, '100');
const restarted = createBattlePassService(accounts);
await restarted.ready;
const restored = await restarted.profile(3);
assert.equal(restored.claimed.length, 6);
assert.ok(BP_MILESTONES.every(reward => restored.ownedSkins.some(skin => skin.id === reward.id)));
// A failed entitlement write must roll back the claim, so retrying still works.
await db.exec(`INSERT INTO users VALUES(4,'player4',1000,30,500);
  ALTER TABLE user_skins ADD CONSTRAINT reject_test_grant CHECK(user_id<>4 OR skin_id<>'remake_181');`);
currentUser = 4;
const logError = console.error;
console.error = () => {};
try { assert.equal((await call('/api/battlepass/claim', { all: true })).status, 503); }
finally { console.error = logError; }
assert.equal((await db.query('SELECT * FROM battlepass_claims WHERE user_id=4')).rows.length, 0);
assert.equal((await db.query('SELECT * FROM user_skins WHERE user_id=4')).rows.length, 0);
await db.exec('ALTER TABLE user_skins DROP CONSTRAINT reject_test_grant');
assert.equal((await call('/api/battlepass/claim', { all: true })).data.granted.length, 6);
assert.ok(flushes > 0);
await db.close();
console.log('Battle pass service: authoritative lifetime XP, same-origin/authentication, atomic inventory grants, concurrent/repeated claims, persistence and unchanged balances passed.');
