import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createAccountService } from './accountservice.mjs';
import { accountClientAddress, AuthAttemptLimiter } from './auth-rate-limit.mjs';
import { authDestination } from '../src/core/AuthDestination.js';

// Synthetic requests only: these tests never contact a production account or
// mail provider, and all database state lives in a disposable in-memory DB.
async function request(service, path, data, { peer = '127.0.0.1', forwarded = '198.18.0.1', cookie = '', origin = 'https://fixture.test' } = {}) {
  const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []);
  req.method = data ? 'POST' : 'GET'; req.socket = { remoteAddress: peer };
  req.headers = { host: 'fixture.test', origin, cookie, 'x-forwarded-for': forwarded };
  let status, headers, body;
  await service(req, { writeHead(s, h) { status = s; headers = h; }, end(b) { body = JSON.parse(b); } }, '/api/account/' + path);
  return { status, body, cookie: headers['Set-Cookie']?.split(';')[0], headers };
}
const noUsers = () => createAccountService(null, { pool: { query: async () => ({ rows: [] }) }, trustedProxies: 'loopback' });
const wrong = identifier => ({ identifier, password: 'wrong-fixture-password' });
for (const kind of ['untrusted peer', 'forged proxy prefix']) {
  const service = noUsers(); await service.ready;
  for (let i = 0; i < 20; i++) {
    const options = kind === 'untrusted peer'
      ? { peer: '198.18.0.1', forwarded: '198.18.1.' + i }
      : { peer: '127.0.0.1', forwarded: `198.18.1.${i}, 198.18.0.1` };
    assert.equal((await request(service, 'login', wrong('unknown' + i), options)).status, i < 12 ? 401 : 429, kind);
  }
}
{
  const service = noUsers(); await service.ready;
  for (let i = 0; i < 20; i++) {
    assert.equal((await request(service, 'login', wrong('different-account' + i), { forwarded: '198.18.2.' + i })).status, 401);
  }
  for (let i = 0; i < 20; i++) {
    assert.equal((await request(service, 'login', wrong('same-target'), { forwarded: '198.18.3.' + i })).status, i < 12 ? 401 : 429);
  }
}
const proxyRequest = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '198.18.0.5, 10.0.0.2' } };
assert.equal(accountClientAddress(proxyRequest, 'loopback,10.0.0.2'), '198.18.0.5');
assert.equal(accountClientAddress(proxyRequest, 'loopback'), '10.0.0.2');
assert.equal(accountClientAddress(proxyRequest, ''), '127.0.0.1');
for (const invalid of ['arbitrary', '198.18.0.1,garbage', Array(18).fill('198.18.0.1').join(',')]) {
  proxyRequest.headers['x-forwarded-for'] = invalid;
  assert.equal(accountClientAddress(proxyRequest, 'loopback'), '127.0.0.1');
}
let now = 0;
const limiter = new AuthAttemptLimiter({ limit: 2, windowMs: 1000, maxEntries: 2, now: () => now });
assert(limiter.allow('a')); assert(limiter.allow('a')); assert(!limiter.allow('a'));
assert(limiter.allow('b')); assert(!limiter.allow('c')); assert.equal(limiter.entries.size, 2);
now = 1001; assert(limiter.allow('c')); assert.equal(limiter.entries.size, 1);
console.log('PASS spoof-resistant proxy/IP limits, account-wide limits across IPs, trusted proxy isolation, expiry and bounded fail-closed storage');

for (const next of ['/\\attacker.invalid', '//attacker.invalid', '/\t/attacker.invalid', '/\n/attacker.invalid', '\\attacker.invalid', 'https://attacker.invalid', 'javascript:alert(1)']) {
  assert.equal(authDestination('?next=' + encodeURIComponent(next), 'https://fixture.test/login'), '/', next);
}
assert.equal(authDestination('?next=' + encodeURIComponent('/?panel=profile#connections'), 'https://fixture.test/register'), '/?panel=profile#connections');
assert.equal(authDestination('', 'https://fixture.test/login'), '/');
console.log('PASS login/register destinations cannot escape the current origin after URL normalization');

const db = await PGlite.create();
let pauseLogin = false, releaseLogin, capturedLogin;
const captured = new Promise(resolve => { capturedLogin = resolve; });
const resume = new Promise(resolve => { releaseLogin = resolve; });
const query = async (sql, params) => {
  const result = params ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
  if (pauseLogin && sql.includes('SELECT id,username,email,password_hash,password_salt')) {
    pauseLogin = false; capturedLogin(); await resume;
  }
  return result;
};
let resetCode;
const accounts = createAccountService(null, {
  pool: { query, connect: async () => ({ query, release() {} }) }, trustedProxies: 'loopback',
  reset: { secret: 'isolated-audit-fixture-secret-'.repeat(2), send: async (_email, code) => { resetCode = code; } },
});
await accounts.ready;
let address = 0;
const call = (path, data, cookie) => request(accounts, path, data, { cookie, forwarded: '198.19.0.' + ++address });
try {
  const registered = await call('register', { username: 'AuditFixture', email: 'fixture@example.invalid', password: 'old-fixture-password' });
  assert.equal(registered.status, 201);
  assert.match(registered.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await request(accounts, 'login', wrong('AuditFixture'), { origin: 'https://attacker.invalid' })).status, 403);
  pauseLogin = true;
  const oldLogin = call('login', { identifier: 'auditfixture', password: 'old-fixture-password' });
  await captured;
  assert.equal((await call('reset/request', { email: 'fixture@example.invalid' })).status, 200);
  assert.match(resetCode, /^\d{6}$/);
  assert.equal((await call('reset/confirm', { email: 'fixture@example.invalid', code: '0000', password: 'new-fixture-password' })).status, 400);
  assert.equal((await call('reset/confirm', { email: 'fixture@example.invalid', code: resetCode, password: 'new-fixture-password' })).status, 200);
  releaseLogin();
  const obsolete = await oldLogin;
  assert.equal(obsolete.status, 401); assert.equal(obsolete.cookie, undefined);
  assert.equal((await call('me', null, registered.cookie)).status, 401);
  const valid = await call('login', { identifier: 'auditfixture', password: 'new-fixture-password' });
  assert.equal(valid.status, 200); assert.equal((await call('me', null, valid.cookie)).status, 200);
  // Twelve total attempts against a real identity, even alternating username/email.
  // Two attempts above already consumed the account bucket.
  for (let i = 0; i < 14; i++) {
    const attempt = await call('login', wrong(i % 2 ? 'fixture@example.invalid' : 'auditfixture'));
    assert.equal(attempt.status, i < 10 ? 401 : 429);
  }
  console.log('PASS reset revokes existing sessions and rejects in-flight old-password login; username/email aliases share the account limit');
} finally { releaseLogin(); await db.close(); }
