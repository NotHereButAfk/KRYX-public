import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createAccountService } from './accountservice.mjs';
import { createAchievementService } from './achievementservice.mjs';
import { createBattlePassService } from './battlepassservice.mjs';
import { createEconomyService } from './economy/service.mjs';
import { STORE_ITEMS } from './storecatalog.mjs';
import { BP_MILESTONES } from '../src/sim/BattlePassCatalog.js';

// Exercise real session lookup and SQL against disposable synthetic accounts.
// No production connection, HTTP listener, payment or payout worker is started.
const db = await PGlite.create();
const query = async (sql, args) => {
  const result = args ? await db.query(sql, args) : (await db.exec(sql)).at(-1);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
const accounts = createAccountService(null, { pool, trustedProxies: '' });
await accounts.ready;
await db.exec(`
  ALTER TABLE users ADD COLUMN e_balance NUMERIC NOT NULL DEFAULT 0;
  CREATE TABLE e_transactions(id TEXT PRIMARY KEY,user_id BIGINT REFERENCES users(id),amount NUMERIC,
    type TEXT,description TEXT,previous_balance NUMERIC,new_balance NUMERIC,idempotency_key TEXT UNIQUE,metadata JSONB);
  CREATE TABLE e_equipment(user_id BIGINT REFERENCES users(id),kind TEXT,item_id TEXT,PRIMARY KEY(user_id,kind));
`);
const achievements = createAchievementService(accounts);
const battlepass = createBattlePassService(accounts, { flushProgress: () => achievements.flush() });
const equipment = createEconomyService(accounts);
// This test uses the real equip handler/store query, but initializes only its
// inventory tables. Match-economy startup and unrelated jobs are out of scope.
equipment.runtime.init = async () => {};
equipment.store.config = async () => ({ revision: 1, config: { items: { catalog: STORE_ITEMS } } });
await Promise.all([achievements.ready, battlepass.ready, equipment.ready]);

async function request(service, path, { body, cookie = '', origin = 'https://fixture.test', headers = {}, method } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method || (body === undefined ? 'GET' : 'POST');
  req.url = path; req.socket = { remoteAddress: '198.18.0.1' };
  req.headers = { host: 'fixture.test', origin, cookie, ...headers };
  let status, responseHeaders, data;
  const handled = await (service.handler || service)(req, {
    writeHead(code, values) { status = code; responseHeaders = values; },
    end(value) { data = JSON.parse(value); },
  }, new URL(path, 'https://fixture.test').pathname);
  assert.equal(handled, true, path);
  return { status, data, cookie: responseHeaders?.['Set-Cookie']?.split(';')[0] };
}
const stats = id => db.query('SELECT id,kills,deaths,score,games,e_balance FROM users WHERE id=$1', [id]).then(r => r.rows[0]);

try {
  const beta = await request(accounts, '/api/account/register', { body: {
    username: 'AuthorityBeta', email: 'beta@example.invalid', password: 'synthetic-beta-password',
  } });
  const alpha = await request(accounts, '/api/account/register', { body: {
    username: 'AuthorityAlpha', email: 'alpha@example.invalid', password: 'synthetic-alpha-password',
    id: beta.data.user.id, userId: beta.data.user.id, kills: 999999, deaths: 0, score: 999999,
    games: 999999, e_balance: 999999, admin: true, ownedSkins: STORE_ITEMS.slice(0, 2),
  } });
  assert.equal(alpha.status, 201); assert.equal(beta.status, 201);
  const alphaId = alpha.data.user.id, betaId = beta.data.user.id;
  assert.notEqual(alphaId, betaId);
  assert.deepEqual(await stats(alphaId), { id: alphaId, kills: 0, deaths: 0, score: 0, games: 0, e_balance: '0' });
  const alphaCall = (service, path, body, options = {}) => request(service, path, { cookie: alpha.cookie, body, ...options });
  const betaCall = (service, path, body) => request(service, path, { cookie: beta.cookie, body });
  const character = STORE_ITEMS.find(item => item.kind === 'character' && item.id === 'remake_153');
  const weapon = STORE_ITEMS.find(item => item.kind === 'weapon');
  assert(character && weapon);
  await query('INSERT INTO user_skins(user_id,skin_id,skin_kind) VALUES($1,$2,$3),($4,$5,$6)',
    [betaId, character.id, 'character', alphaId, weapon.id, 'weapon']);

  const me = await alphaCall(accounts, `/api/account/me?userId=${betaId}`, undefined,
    { headers: { 'x-user-id': String(betaId), authorization: `Bearer ${betaId}` } });
  assert.equal(me.status, 200); assert.equal(me.data.user.id, alphaId);
  assert.deepEqual(me.data.user.ownedSkins, [{ id: weapon.id, kind: 'weapon' }]);
  assert.equal(me.data.user.password_hash, undefined); assert.equal(me.data.user.sessionId, undefined);
  for (const path of ['/api/account/me', '/api/account/stats', '/api/account/profile']) {
    assert.equal((await alphaCall(accounts, path, { userId: betaId, kills: 999999, ownedSkins: STORE_ITEMS.slice(0, 2) })).status, 404);
  }
  assert.equal((await alphaCall(achievements, '/api/achievements/record', { userId: betaId, kills: 999999 })).status, 404);
  for (const [service, path] of [[accounts, '/api/account/me'], [achievements, '/api/achievements'], [battlepass, '/api/battlepass'], [equipment, '/api/e/equip']]) {
    const options = path.endsWith('/equip') ? { body: { kind: 'character', itemId: character.id, userId: betaId } } : {};
    assert.equal((await request(service, path, { ...options, cookie: 'kyx_session=forged-session-value', headers: { 'x-user-id': String(betaId) } })).status, 401);
  }
  console.log('PASS real session identity defeats forged IDs/headers and registration/profile mass assignment; private session fields stay private');

  // Only authoritative server progress can unlock a quest. Payload counters,
  // reward amounts and another account ID have no effect on eligibility.
  assert.equal((await alphaCall(achievements, '/api/achievements/claim', {
    id: 'kills-1', userId: betaId, stats: { kills: 999999 }, complete: true, coins: 999999, reward_kind: 'cosmetic',
  })).status, 409);
  const betaBefore = await stats(betaId);
  achievements.record(alphaId, { kills: 1, score: 10, unknownCounter: 999999 });
  await achievements.flush();
  const claim = { id: 'kills-1', userId: betaId, coins: 999999, amount: 999999, reward_kind: 'cosmetic' };
  assert.equal((await alphaCall(achievements, '/api/achievements/claim', claim, { origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await alphaCall(achievements, '/api/achievements/claim', claim, { origin: null })).status, 403);
  const claims = await Promise.all(Array.from({ length: 4 }, () => alphaCall(achievements, '/api/achievements/claim', claim)));
  assert(claims.every(result => result.status === 200));
  assert.equal((await stats(alphaId)).e_balance, '25');
  assert.deepEqual(await stats(betaId), betaBefore);
  assert.equal((await db.query('SELECT * FROM e_transactions')).rows.length, 1);
  assert.equal((await db.query('SELECT reward_kind FROM achievement_claims WHERE user_id=$1', [alphaId])).rows[0].reward_kind, 'coins');
  assert.equal((await alphaCall(achievements, '/api/achievements')).data.stats.unknownCounter, undefined);
  assert.deepEqual((await betaCall(achievements, `/api/achievements?userId=${alphaId}`)).data.claimed, []);

  // Atomic failure must not burn the claim or partially credit a balance.
  achievements.record(alphaId, { kills: 9 }); await achievements.flush();
  await db.exec("ALTER TABLE e_transactions ADD CONSTRAINT reject_fixture_reward CHECK(metadata->>'achievement' <> 'kills-2')");
  const logError = console.error; console.error = () => {};
  try { assert.equal((await alphaCall(achievements, '/api/achievements/claim', { id: 'kills-2' })).status, 503); }
  finally { console.error = logError; }
  assert.equal((await stats(alphaId)).e_balance, '25');
  assert.equal((await db.query("SELECT * FROM achievement_claims WHERE achievement_id='kills-2'")).rows.length, 0);
  await db.exec('ALTER TABLE e_transactions DROP CONSTRAINT reject_fixture_reward');
  assert.equal((await alphaCall(achievements, '/api/achievements/claim', { id: 'kills-2' })).status, 200);
  assert.equal((await stats(alphaId)).e_balance, '75');
  console.log('PASS authoritative quest progress, canonical reward amounts, account isolation, concurrent/repeated claims and transactional rollback');

  // New coin rewards do not grant legacy badges. A legacy entitlement owned by
  // another user also cannot be borrowed by forging the request's user ID.
  const badge = { kind: 'badge', id: 'badge:kills-1', userId: betaId };
  assert.equal((await alphaCall(achievements, '/api/achievements/equip', badge)).status, 403);
  await query("INSERT INTO achievement_claims(user_id,achievement_id,reward_kind) VALUES($1,'kills-1','cosmetic')", [betaId]);
  assert.equal((await alphaCall(achievements, '/api/achievements/equip', badge)).status, 403);
  assert.equal((await betaCall(achievements, '/api/achievements/equip', { ...badge, userId: alphaId })).status, 200);
  assert.equal((await betaCall(achievements, '/api/achievements')).data.equipped.badge, badge.id);
  assert.equal((await alphaCall(achievements, '/api/achievements')).data.equipped.badge, null);
  assert.equal((await alphaCall(achievements, '/api/achievements/equip', { ...badge, kind: 'title' })).status, 400);
  assert.equal((await alphaCall(equipment, '/api/e/equip', { userId: betaId, kind: 'character', itemId: character.id, ownedSkins: [character] })).status, 400);
  assert.equal((await alphaCall(equipment, '/api/e/equip', { kind: 'character', itemId: weapon.id })).status, 400);
  assert.equal((await alphaCall(equipment, '/api/e/equip', { userId: betaId, kind: 'weapon', itemId: weapon.id })).status, 200);
  assert.deepEqual((await db.query('SELECT user_id,kind,item_id FROM e_equipment')).rows,
    [{ user_id: alphaId, kind: 'weapon', item_id: weapon.id }]);
  assert.equal((await betaCall(equipment, '/api/e/equip', { kind: 'weapon', itemId: null, userId: alphaId })).status, 200);
  assert.equal((await db.query('SELECT * FROM e_equipment')).rows.length, 1);
  console.log('PASS inventory/legacy cosmetic ownership and kind checks; forged account IDs cannot equip or clear another account');

  const milestone = BP_MILESTONES[0];
  const payload = { expectedUsername: 'AuthorityAlpha', tier: milestone.tier, xp: 999999, kills: 999999, userId: betaId, skinId: character.id };
  assert.equal((await alphaCall(battlepass, '/api/battlepass/claim', payload)).status, 409);
  achievements.record(alphaId, { kills: 70 }); await achievements.flush();
  const passClaims = await Promise.all(Array.from({ length: 3 }, () => alphaCall(battlepass, '/api/battlepass/claim', payload)));
  assert(passClaims.every(result => result.status === 200));
  assert.equal(passClaims.reduce((sum, result) => sum + result.data.granted.length, 0), 1);
  const owner = (await alphaCall(battlepass, `/api/battlepass?userId=${betaId}`)).data;
  assert.equal(owner.owner.id, String(alphaId));
  assert(owner.ownedSkins.some(skin => skin.id === milestone.id));
  assert(!owner.ownedSkins.some(skin => skin.id === character.id));
  assert.equal((await betaCall(battlepass, '/api/battlepass')).data.claimed.length, 0);
  assert.deepEqual(await stats(betaId), betaBefore);
  assert.equal((await stats(alphaId)).e_balance, '75');
  console.log('PASS real-session battle-pass claims use server XP and canonical skins, grant exactly once and never mutate another account');
} finally {
  await db.close();
}
