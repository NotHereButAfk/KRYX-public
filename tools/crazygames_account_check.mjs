import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { createAccountService } from '../server/accountservice.mjs';
import { createCrazyGamesVerifier } from '../server/crazygames.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const now = Math.floor(Date.now() / 1000);
const token = (claims = {}, algorithm = 'RS256') => {
  const data = [ { alg: algorithm, typ: 'JWT' }, { userId: 'player-one', gameId: '123', username: 'Player.One', iat: now, exp: now + 3600, ...claims } ]
    .map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url');
};
const verify = createCrazyGamesVerifier({ gameId: '123', fetchKey: async () => publicKey });
assert.equal((await verify(token())).userId, 'player-one');
if (!process.env.CRAZYGAMES_GAME_ID) {
  const productionVerifier = createCrazyGamesVerifier({ fetchKey: async () => publicKey });
  assert.equal((await productionVerifier(token({ gameId: '139186' }))).userId, 'player-one');
  await assert.rejects(productionVerifier(token({ gameId: '38e21277-c54d-4f92-8c18-2d6125432cf2' })), /game_mismatch/);
}
await assert.rejects(verify(token({ gameId: 'other' })), e => e.message === 'game_mismatch' && e.gameId === 'other');
await assert.rejects(createCrazyGamesVerifier({ gameId: '123', fetchKey: async () => { throw new Error('network'); } })(token()), /key_unavailable/);
for (const bad of [token({ gameId: 'other' }), token({ exp: now - 1 }), token({ iat: now + 900 }), token({ nbf: now + 900 }), token({}, 'HS256'), 'bad.token', token({ userId: '' })]) await assert.rejects(verify(bad));
await assert.rejects(createCrazyGamesVerifier({ gameId: '', fetchKey: async () => publicKey })(token()), /not_configured/);
const original = token();
const segments = original.split('.');
segments[1] = Buffer.from(JSON.stringify({ userId: 'victim', gameId: '123', username: 'Victim', exp: now + 3600, iat: now })).toString('base64url');
await assert.rejects(verify(segments.join('.')));

const db = await PGlite.create();
const query = async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1);
const service = createAccountService(null, { pool: { query }, crazygames: { gameId: '123', fetchKey: async () => publicKey } });
await service.ready;
const server = createServer((req, res) => service(req, res, new URL(req.url, 'http://localhost').pathname));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let attempts = 0;
async function request(path, data, cookie = '', origin = base) {
  const response = await fetch(base + '/api/account/' + path, { method: data ? 'POST' : 'GET', headers: { origin, cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': `127.0.1.${++attempts}` }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}
try {
  const normal = await request('register', { username: 'NormalPlayer', password: 'a-safe-password', email: 'normal@example.com' });
  assert.equal(normal.status, 201);
  assert.match(normal.cookie, /SameSite=Lax/);
  assert(!normal.cookie.includes('Partitioned'));
  const first = await request('crazygames', { token: token() });
  assert.equal(first.status, 200);
  assert.match(first.cookie, /HttpOnly; Secure; SameSite=None; Partitioned/);
  assert.notEqual(first.data.user.id, normal.data.user.id);
  await query('UPDATE users SET kills=7,score=250 WHERE id=$1', [first.data.user.id]);
  const again = await request('crazygames', { token: token({ username: 'Renamed.Player' }) });
  assert.equal(again.data.user.id, first.data.user.id);
  assert.equal(again.data.user.kills, 7);
  assert.equal(again.data.user.username, 'Renamed.Player');
  const second = await request('crazygames', { token: token({ userId: 'player-two', username: 'Renamed.Player' }) });
  assert.notEqual(second.data.user.id, first.data.user.id);
  assert.equal(second.data.user.kills, 0);
  assert.equal((await request('me', null, again.cookie.split(';')[0])).data.user.kills, 7);
  assert.equal((await request('crazygames', { token: token({ gameId: 'different-game' }) })).status, 401);
  assert.equal((await request('crazygames', { token: token() }, '', 'https://evil.test')).status, 403);
  const guest = await request('crazygames/guest', {});
  assert.match(guest.cookie, /Partitioned; Max-Age=0/);
  assert.equal((await request('me', null, normal.cookie.split(';')[0])).data.user.id, normal.data.user.id);
  console.log('PASS CrazyGames signed-token verification, wrong-game/expiry/tamper rejection, stable accounts, separate identities, retained stats, embedded cookie and ordinary-login isolation');
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await db.close(); }
