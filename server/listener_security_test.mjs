import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { makeAuthServer } from './authserver.mjs';

// Real listeners, no production account or database. Reserve an ephemeral port
// first because embedded callers use port:0 to defer listening themselves.
async function checkBinding(host, expected) {
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const { port } = reserve.address();
  await new Promise(resolve => reserve.close(resolve));
  const app = makeAuthServer({ port, ...(host ? { host } : {}), accountService: null });
  try {
    await once(app.http, 'listening');
    assert.equal(app.http.address().address, expected);
    const response = await fetch(`http://127.0.0.1:${port}/api/matchmake`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).available, true);
  } finally {
    await app.close();
  }
}

const savedHost = process.env.BIND_HOST;
delete process.env.BIND_HOST;
try {
  await checkBinding(undefined, '127.0.0.1');
  await checkBinding('0.0.0.0', '0.0.0.0');
  process.env.BIND_HOST = '127.0.0.1';
  await checkBinding(undefined, '127.0.0.1');
  console.log('Listener security: loopback default, explicit override, and matchmaking pass.');
} finally {
  if (savedHost === undefined) delete process.env.BIND_HOST;
  else process.env.BIND_HOST = savedHost;
}
