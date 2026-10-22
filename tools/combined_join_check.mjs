import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    window.__loadRequests = [];
    const fetchOriginal = window.fetch;
    window.fetch = function (...args) {
      const url = String(args[0]?.url || args[0]);
      if (/matchmake|\.evmap/.test(url)) window.__loadRequests.push({
        url, gameLoaded: document.getElementById('connect-screen')?.classList.contains('hidden'),
      });
      return fetchOriginal.apply(this, args);
    };
  });
  const url = new URL(process.env.KYX_URL || 'http://127.0.0.1:5997/?authnet=ws://127.0.0.1:8788');
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__game?._authNet?.ready, null, { polling: 100, timeout: 60000 });
  const result = await page.evaluate(async () => {
    const g = window.__game;
    await g._startupReadyPromise;
    const bridge = g._authNet;
    const sequence = g._mapLoadingSequence;
    await g._prepareAuthoritativeMatch(g.player.name, 'deathmatch');
    return {
      map: g.world.currentMapId,
      serverMap: bridge.client.arena?.id,
      connected: bridge.client.connected,
      sameBridge: bridge === g._authNet,
      sameScreen: sequence === g._mapLoadingSequence,
      loaderHidden: document.getElementById('map-loading').classList.contains('hidden'),
      requests: window.__loadRequests,
    };
  });
  assert(result.map && result.connected);
  if (result.serverMap) assert.equal(result.map, result.serverMap);
  assert(result.sameBridge && result.sameScreen && result.loaderHidden, JSON.stringify(result));
  assert(result.requests.some(r => /matchmake/.test(r.url)), 'must test a real lobby connection');
  assert(result.requests.every(r => r.gameLoaded), 'match/map work started before game loading finished');
  console.log('combined join passed: game loaded first, real lobby and map ready together, PLAY reuses connection');
} finally {
  await browser.close();
}
