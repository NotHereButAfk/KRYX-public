import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
let game, web;
async function stop() {
  await web?.close();
  game?.close();
}
try {
  const { makeAuthServer } = await import('../server/authserver.mjs');
  const { createServer } = await import('vite');
  // Explicitly disable account/payment services in the public local demo.
  game = makeAuthServer({ accountService: null, targetPopulation: 8 });
  await new Promise((resolve, reject) => {
    game.http.once('error', reject);
    game.http.listen(0, '127.0.0.1', resolve);
  });
  const backend = `http://127.0.0.1:${game.http.address().port}`;
  process.env.VITE_AUTH_WS_URL = backend.replace('http:', 'ws:');
  process.env.VITE_AUTH_WS_URLS = process.env.VITE_AUTH_WS_URL;
  process.env.VITE_AUTH_SURVIVAL_WS_URLS = `${process.env.VITE_AUTH_WS_URL}?mode=survival`;
  web = await createServer({
    root,
    server: { host: '127.0.0.1', port: 5173, proxy: { '/api': backend } },
  });
  await web.listen();
  console.log('\nKRYX local guest game ready. Accounts, purchases and payouts are disabled.');
  web.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await stop(); process.exit(0); });
  }
} catch (error) {
  console.error(error.code === 'ERR_MODULE_NOT_FOUND'
    ? 'Missing dependencies. Run npm ci and npm ci --prefix server, then npm start.'
    : error);
  await stop();
  process.exit(1);
}
