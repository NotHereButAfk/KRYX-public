import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('https://pagead2.googlesyndication.com/**', r => r.fulfill({ body: '' }));
  await page.route('https://acceptable.a-ads.com/**', r => r.fulfill({ contentType: 'text/html', body: 'Ad fixture' }));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__game?.menu?.onSettingsSaved && document.querySelector('#connect-screen').classList.contains('hidden'), null, { timeout: 90000 });
  await page.evaluate(() => cancelAnimationFrame(__game._rafId));
  await page.locator('[data-panel="settings"]').first().click();
  const slider = async (id, value) => {
    await page.locator(id).fill(String(value));
    await page.locator(id).dispatchEvent('input');
  };
  await slider('#set-sens', 175);
  await slider('#set-fov', 93);
  await slider('#set-vol', 0);
  await slider('#set-hudscale', 125);
  for (const selector of ['[data-inv="on"]', '[data-q="low"]', '[data-xh="circle"]', '[data-xc="yellow"]', '[data-cb="tritanopia"]', '#reduce-motion-btns [data-on="on"]', '#reduce-flash-btns [data-on="on"]', '#contrast-btns [data-on="on"]', '#hitsound-btns [data-on="off"]']) { console.log('Checking', selector); await page.locator(selector).click(); }
  const state = await page.evaluate(() => {
    const g = __game, root = document.documentElement;
    const ring = getComputedStyle(document.getElementById('crosshair'), '::after');
    return { sens: g.player.sensitivityMult, fov: g.player.baseFov, volume: g.audio.master.gain.value, inv: g.player.invertY, quality: g._runtimeQuality,
      motion: g.player.reduceMotion, flash: g.hud.reduceFlashes, hit: g.hud.hitSound,
      scale: root.style.getPropertyValue('--hud-scale'), shape: root.dataset.xhair, color: root.dataset.xhairColor, cb: root.dataset.colorblind, contrast: root.dataset.contrast,
      ring: [ring.width, ring.height, ring.backgroundColor] };
  });
  assert.deepEqual(state, { sens: 1.75, fov: 93, volume: 0, inv: true, quality: 'low', motion: true, flash: true, hit: false, scale: '1.25', shape: 'circle', color: 'yellow', cb: 'tritanopia', contrast: '1', ring: ['16px', '16px', 'rgba(0, 0, 0, 0)'] });
  assert.equal(await page.locator('#panel-settings').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(4, 8, 12, 0.96)');
  const download = page.waitForEvent('download');
  await page.locator('#settings-export-btn').click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'kyx-settings.json');
  await page.locator('#settings-defaults-btn').click();
  assert.deepEqual(await page.evaluate(() => [__game.player.baseFov, __game.audio.master.gain.value, __game.player.reduceMotion]), [78, .5, false]);
  await page.locator('#settings-import-file').setInputFiles(await file.path());
  await page.waitForFunction(() => __game.player.baseFov === 93);
  await page.reload();
  await page.waitForFunction(() => window.__game?.menu?.onSettingsSaved, null, { timeout: 90000 });
  assert.deepEqual(await page.evaluate(() => [__game.player.baseFov, __game.player.sensitivityMult, __game.audio.master.gain.value, __game.hud.hitSound]), [93, 1.75, 0, false]);
  await page.evaluate(() => { cancelAnimationFrame(__game._rafId); __game.menu._togglePanel('settings'); });
  await page.locator('#settings-import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ fov: 999, volume: -20, quality: 'broken', reduceMotion: 'false', hudScale: null })) });
  await page.waitForFunction(() => __game.player.baseFov === 110);
  assert.deepEqual(await page.evaluate(() => [__game.player.baseFov, __game.audio.master.gain.value, __game._runtimeQuality, __game.player.reduceMotion]), [110, 0, 'medium', false]);
  await page.locator('#settings-import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('null') });
  await page.waitForFunction(() => document.getElementById('settings-save-btn').textContent === 'INVALID SETTINGS FILE');
  await page.locator('#settings-defaults-btn').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#settings-save-btn').click();
  await page.locator('#panel-settings [data-close-panel]').click();
  assert.equal(await page.locator('#panel-settings').isVisible(), false);
  await page.locator('#fullscreen-toggle').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.locator('#fullscreen-toggle').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  console.log('Settings passed: all 13 controls apply live, mute, defaults/import, reload persistence, invalid input, circular crosshair, mobile save/close, fullscreen.');
} finally { await browser.close(); await server.close(); }
