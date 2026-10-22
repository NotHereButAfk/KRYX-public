import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__game?.world.currentMap, null, { timeout: 120000 });
  const initial = await page.evaluate(() => {
    const g = window.__game;
    cancelAnimationFrame(g._rafId);
    g._setRuntimeQuality('medium', true);
    return { width: g.canvas.width, height: g.canvas.height, aa: g.renderer.getContext().getContextAttributes().antialias };
  });
  assert.deepEqual(initial, { width: 1266, height: 585, aa: true }, 'mobile map should render at 1.5x with smooth edges');
  for (const [width, height] of [[390, 844], [844, 390], [1366, 1024]]) {
    await page.setViewportSize({ width, height });
    const result = await page.evaluate(() => {
      const g = window.__game;
      g._onResize();
      const medium = { width: g.canvas.width, height: g.canvas.height };
      g._setRuntimeQuality('low');
      g._onResize();
      const low = { width: g.canvas.width, height: g.canvas.height };
      g._setRuntimeQuality('high');
      g._onResize();
      const bloom = { width: Math.floor(g.composer.readBuffer.width), height: Math.floor(g.composer.readBuffer.height) };
      g._setRuntimeQuality('medium');
      g.renderer.render(g.world.scene, g.menuCamera);
      return { medium, low, bloom, error: g.renderer.getContext().getError() };
    });
    assert(result.medium.width * result.medium.height <= 2073600, 'default buffer exceeds budget');
    assert(result.low.width * result.low.height <= 1048576, 'fallback buffer exceeds budget');
    assert.deepEqual(result.bloom, result.medium, 'bloom scene must retain default detail after rotation');
    if (width * height < 1048576) assert.deepEqual(result.low, { width, height }, 'fallback must retain CSS resolution on phones');
    assert.equal(result.error, 0, 'mobile rendering produced a WebGL error');
    if (process.env.MOBILE_RENDER_SHOTS && width === 844) {
      await page.evaluate(() => {
        const g = window.__game;
        const c = g.canvas;
        c.style.cssText = 'position:fixed;inset:0;z-index:2147483647;filter:none;display:block;visibility:visible;';
        g.renderer.render(g.world.scene, g.menuCamera);
      });
      await page.screenshot({ path: process.env.MOBILE_RENDER_SHOTS, scale: 'css' });
    }
  }
  assert.deepEqual(errors, [], 'browser errors');
  console.log('mobile render passed: real map, DPR 3, MSAA, rotation, fallback and bloom pixel budgets');
} finally { await browser?.close(); await server.close(); }
