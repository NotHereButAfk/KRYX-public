import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';

const url = process.env.KYX_URL || 'http://127.0.0.1:5995/';
const output = process.env.KYX_CARRY_SHOT || 'rifle-carry.png';
const extension = extname(output) || '.png';
const stem = output.slice(0, output.length - extension.length);
mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.abort());
await page.addInitScript(() => {
  let lockedElement = null;
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => lockedElement,
  });
  Element.prototype.requestPointerLock = function requestPointerLock() {
    lockedElement = this;
    queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
    return Promise.resolve();
  };
  document.exitPointerLock = () => {
    lockedElement = null;
    queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
  };
});

try {
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('#play-btn', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.querySelector('#play-btn')?.click());
  await page.waitForFunction(
    () => !document.getElementById('hud')?.classList.contains('hidden'),
    null,
    { timeout: 30000 },
  );

  const staged = await page.evaluate(() => {
    const g = window.__game || window.game;
    const bot = g.botManager.bots.find((entry) => !entry._isSwordBot);
    if (!bot) return null;
    g.serverSim?.stop();
    g.pickupSystem?.dispose();
    g.pickupSystem = null;
    if (g.world._mapRoot) g.world._mapRoot.visible = false;
    if (g.world.currentMap?.root) g.world.currentMap.root.visible = false;
    g.world.scene.background?.set?.(0xd8dde2);
    g.world.scene.fog = null;
    g.player.velocity.set(0, 0, 0);
    g.player._camDist = 0;
    g.player.camera.fov = 36;
    g.player.camera.updateProjectionMatrix();
    g.__carryCamera = { x: 1.65, y: 1.22, z: -1.65, tx: 0, ty: 0.98, tz: 0 };
    g.player.update = () => {
      const c = g.__carryCamera;
      g.player.camera.position.set(c.x, c.y, c.z);
      g.player.camera.lookAt(c.tx, c.ty, c.tz);
      g.player.camera.updateMatrixWorld(true);
    };

    bot.position.set(0, 0, 0);
    bot.mesh.position.copy(bot.position);
    bot.mesh.rotation.set(0, 0, 0);
    bot._provoked = false;
    bot._provokedByPlayer = false;
    bot._targetEntity = null;
    bot.update(1 / 60, g.player, g.player.camera, () => {}, g.world);
    bot.position.set(0, 0, 0);
    bot.mesh.position.copy(bot.position);
    bot.mesh.rotation.set(0, 0, 0);
    bot.healthBarGroup.visible = false;
    bot.update = () => {};
    g.botManager.update = () => {};

    const visible = new Set([bot.mesh]);
    for (const child of g.world.scene.children) {
      child.visible = child === g.player.camera || child.isLight || visible.has(child);
    }
    if (g.weaponSystem.weaponMount) g.weaponSystem.weaponMount.scale.setScalar(0);
    g.nameplates.update = () => {};
    g.nameplates.container.remove();
    document.getElementById('hud')?.classList.add('hidden');
    document.getElementById('connect-screen')?.classList.add('hidden');
    document.getElementById('map-loading')?.classList.add('hidden');
    for (const id of ['top-nav', 'nav-side', 'share-game', 'social-icons', 'center-play']) {
      const element = document.getElementById(id);
      element?.classList.add('hidden');
      element?.style.setProperty('display', 'none', 'important');
    }
    g.state = 'playing';
    g._menuOpen = false;
    g.menu?.hidePause?.();
    return {
      armorTypeId: bot.mesh.userData?.armorTypeId,
      weaponId: bot._weaponMesh?.userData?.weaponId,
    };
  });
  if (!staged?.armorTypeId || !staged.weaponId) {
    throw new Error(`failed to stage firearm player: ${JSON.stringify(staged)}`);
  }

  const views = [
    ['front', 0, 1.22, -2.35],
    ['quarter', 1.65, 1.22, -1.65],
    ['side', 2.35, 1.22, 0],
  ];
  for (const [name, x, y, z] of views) {
    await page.evaluate(({ x: cx, y: cy, z: cz }) => {
      const g = window.__game || window.game;
      Object.assign(g.__carryCamera, { x: cx, y: cy, z: cz });
      g.state = 'playing';
      g._menuOpen = false;
      const bot = g.botManager.bots.find((entry) => !entry._isSwordBot);
      const visible = new Set(bot ? [bot.mesh] : []);
      for (const child of g.world.scene.children) {
        child.visible = child === g.player.camera || child.isLight || visible.has(child);
      }
      if (g.weaponSystem.weaponMount) g.weaponSystem.weaponMount.scale.setScalar(0);
      g.player.update();
    }, { x, y, z });
    await page.waitForTimeout(200);
    // Map streaming can attach a new root after the match first becomes
    // playable. Reapply the isolated carry stage after that async edge so the
    // first frame is as clean as the later views.
    await page.evaluate(() => {
      const g = window.__game || window.game;
      const bot = g.botManager.bots.find((entry) => !entry._isSwordBot);
      const visible = new Set(bot ? [bot.mesh] : []);
      for (const child of g.world.scene.children) {
        child.visible = child === g.player.camera || child.isLight || visible.has(child);
      }
      g.player.update();
    });
    await page.screenshot({ path: `${stem}-${name}${extension}` });
  }
  console.log(
    `rifle carry visual passed: ${staged.armorTypeId}/${staged.weaponId} -> `
    + views.map(([name]) => `${stem}-${name}${extension}`).join(', '),
  );
} finally {
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
