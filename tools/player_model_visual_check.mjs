import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';

const url = process.env.KYX_URL || 'http://127.0.0.1:5995/';
const output = process.env.KYX_PLAYER_MODEL_SHOT || 'artifacts/player-model.png';
const extension = extname(output) || '.png';
const stem = output.slice(0, output.length - extension.length);
mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.abort());

try {
  const qaUrl = new URL(url);
  qaUrl.searchParams.set('qa', '1');
  await page.goto(qaUrl.href, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('#play-btn', { state: 'attached', timeout: 30000 });
  // The deployed build has real map/network initialization in front of the
  // menu. Wait for the game object, not an arbitrary delay or the static HTML.
  await page.waitForFunction(() => !!(window.__game || window.game)?.menu,
    null, { timeout: 45000 });
  // Do not open Inventory while its startup/map shell is still rebuilding the
  // menu. That can replace the preview canvas after the renderer captured it.
  await page.waitForSelector('#connect-screen', { state: 'hidden', timeout: 60000 });
  await page.waitForSelector('#map-loading', { state: 'hidden', timeout: 60000 });
  await page.evaluate(() => {
    const game = window.__game || window.game;
    if (game?.menu?._togglePanel) game.menu._togglePanel('loadout');
    else document.querySelector('[data-panel="loadout"]')?.click();
  });
  await page.waitForFunction(() => {
    const game = window.__game || window.game;
    return !!game?.menu?._armorPreview?._group;
  }, null, { timeout: 30000 });

  await page.evaluate(() => {
    const game = window.__game || window.game;
    const preview = game.menu._armorPreview;
    preview.stop();
    preview._renderer.setPixelRatio(1);
    preview._renderer.setSize(600, 600, false);
    // setSize already updates the WebGL drawing buffer. Assigning canvas.width
    // afterward clears that buffer and left the regression plate blank.
    preview._canvas.style.cssText = 'position:fixed;left:20px;top:20px;width:600px;height:600px;z-index:999999;visibility:visible';
    preview._camera.aspect = 1;
    // The production preview camera is framed for a 220px panel. Pull it back
    // slightly for the QA plate so crown and soles remain visible in every view.
    preview._camera.position.set(0, 1.15, 5.25);
    preview._camera.lookAt(0, 1.15, 0);
    preview._camera.updateProjectionMatrix();
    document.body.style.background = '#0a0e16';
    // Keep the preview's ancestors renderable. Hiding body children also hides
    // descendants even when the canvas itself is set back to visible.
    for (const el of document.body.querySelectorAll('*')) {
      if (el === preview._canvas || el.contains(preview._canvas)) continue;
      if (el instanceof HTMLElement) el.style.opacity = '0';
    }
  });

  for (const [name, yaw] of [['front', 0], ['quarter', Math.PI / 4], ['side', Math.PI / 2]]) {
    await page.evaluate((rotation) => {
      const game = window.__game || window.game;
      const preview = game.menu._armorPreview;
      preview._group.rotation.y = preview._baseYaw + rotation;
      preview._scene.updateMatrixWorld(true);
      preview._renderer.render(preview._scene, preview._camera);
      if (preview._renderer.info.render.calls === 0) {
        throw new Error('Player preview rendered no draw calls');
      }
    }, yaw);
    await page.waitForTimeout(120);
    await page.locator('#armor-preview-canvas').screenshot({
      path: `${stem}-${name}${extension}`,
    });
  }
  console.log(`player model visual passed -> ${stem}-{front,quarter,side}${extension}`);
} finally {
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
