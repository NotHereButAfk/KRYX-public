import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'url';
import { makeAuthServer } from './authserver.mjs';

const PORT = 8798;
const staticRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const { close } = makeAuthServer({ port: PORT, staticRoot });

await new Promise((resolve) => setTimeout(resolve, 80));
let failed = false;

async function check(name, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) failed = true;
}

try {
  const match = await fetch(`http://127.0.0.1:${PORT}/api/matchmake`);
  const matchState = await match.json();
  await check('matchmaker reports the authoritative arena before map loading',
    match.status === 200 && matchState.available === true
      && typeof matchState.mapId === 'string' && matchState.capacity === 8);
  await check('matchmaker response cannot be cached', match.headers.get('cache-control') === 'no-store');

  const home = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await home.text();
  await check('serves the built game at /', home.status === 200 && /<!doctype html>/i.test(html));
  await check('sets the HTML content type', home.headers.get('content-type')?.startsWith('text/html'));
  await check('game keeps platform embedding while blocking plugin objects and base URL changes',
    home.headers.get('content-security-policy') === "base-uri 'self'; object-src 'none'"
      && !home.headers.has('x-frame-options'));
  await check('does not cache HTML indefinitely', home.headers.get('cache-control') === 'no-cache');
  await check('compresses the HTML application shell', home.headers.get('content-encoding') === 'gzip');

  const mapHead = await fetch(`http://127.0.0.1:${PORT}/maps/RookLit_0.evmap`, {
    method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' },
  });
  await check('serves EV maps with their own MIME type',
    mapHead.headers.get('content-type') === 'application/x-evmap');
  await check('compresses multi-megabyte EV maps', mapHead.headers.get('content-encoding') === 'gzip');
  await check('caches version-stable game assets',
    /max-age=86400/.test(mapHead.headers.get('cache-control') || '') && Boolean(mapHead.headers.get('etag')));
  const cachedMap = await fetch(`http://127.0.0.1:${PORT}/maps/RookLit_0.evmap`, {
    method: 'HEAD', headers: { 'If-None-Match': mapHead.headers.get('etag') || '' },
  });
  await check('revalidates cached game assets without retransmitting them', cachedMap.status === 304);
  const compressedMap = await fetch(`http://127.0.0.1:${PORT}/maps/RookLit_0.evmap`, {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  const decodedMap = await compressedMap.arrayBuffer();
  await check('streams a complete compressed EV map response',
    compressedMap.status === 200 && compressedMap.headers.get('content-encoding') === 'gzip'
      && decodedMap.byteLength > 1_000_000);

  for (const route of ['/login', '/register', '/privacy', '/terms', '/earnings', '/economy-admin']) {
    const page = await fetch(`http://127.0.0.1:${PORT}${route}`);
    const pageHtml = await page.text();
    await check(`serves clean HTML route ${route}`, page.status === 200 && /<!doctype html>/i.test(pageHtml));
    if (['/login', '/register', '/earnings', '/economy-admin'].includes(route)) {
      await check(`blocks cross-origin framing on ${route}`,
        page.headers.get('content-security-policy')?.includes("frame-ancestors 'self'")
          && page.headers.get('x-frame-options') === 'SAMEORIGIN');
      const direct = await fetch(`http://127.0.0.1:${PORT}${route}.html`);
      await check(`blocks cross-origin framing on ${route}.html`,
        direct.headers.get('x-frame-options') === 'SAMEORIGIN');
    }
  }

  for (const route of ['/withdrawal', '/withdrawal.html']) {
    const legacy = await fetch(`http://127.0.0.1:${PORT}${route}`, { redirect: 'manual' });
    await check(`redirects obsolete route ${route} to internal earnings`, legacy.status === 302 && legacy.headers.get('location') === '/earnings');
  }
  const missing = await fetch(`http://127.0.0.1:${PORT}/not-a-real-file`);
  await check('returns 404 for missing files', missing.status === 404);

  const traversal = await fetch(`http://127.0.0.1:${PORT}/%2e%2e%2fpackage.json`);
  await check('blocks encoded path traversal', traversal.status === 403);

  const post = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST' });
  await check('static handler rejects non-read methods', post.status === 405);
} finally {
  await close();
}

process.exitCode = failed ? 1 : 0;

// Prove protection when sensitive files actually exist in the public root.
const fixture = mkdtempSync(join(tmpdir(), 'kryx-static-'));
const sensitive = ['.env', '.git/config', 'server/config.json', 'src/main.js',
  'node_modules/module/index.js', 'assets/main.js.map', 'backup.sql', 'wallet.key', 'package.json'];
for (const name of sensitive) {
  const file = join(fixture, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'private-test-sentinel');
}
writeFileSync(join(fixture, 'index.html'), '<!doctype html><html>public</html>');
const protectedServer = makeAuthServer({ port: PORT + 1, staticRoot: fixture });
try {
  for (const path of [...sensitive, '%2eenv', 'server%2fconfig.json']) {
    const result = await fetch(`http://127.0.0.1:${PORT + 1}/${path}`);
    await check(`blocks existing private file ${path}`, result.status === 404 && !(await result.text()).includes('private-test-sentinel'));
  }
  const page = await fetch(`http://127.0.0.1:${PORT + 1}/`);
  await check('public HTML still served with nosniff', page.status === 200 && page.headers.get('x-content-type-options') === 'nosniff');
} finally {
  await protectedServer.close();
  rmSync(fixture, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
