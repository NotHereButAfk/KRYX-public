import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.env.KYX_URL || 'http://127.0.0.1:5994/';
const output = process.env.KYX_ROSTER_SHOT || 'roster-models.png';
mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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

  const roster = await page.evaluate(() => {
    const g = window.__game || window.game;
    g.serverSim?.stop();
    g.pickupSystem?.dispose();
    g.pickupSystem = null;
    g.player.position.set(0, 0, 4.2);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.pitch = 0;
    g.player._camDist = 0;
    if (g.world._mapRoot) g.world._mapRoot.visible = false;
    if (g.world.currentMap?.root) g.world.currentMap.root.visible = false;
    g.world.scene.background?.set?.(0x252a31);
    g.world.scene.fog = null;
    g.player.camera.fov = 45;
    g.player.camera.updateProjectionMatrix();
    g.player.update = () => {
      g.player.camera.position.set(0, 1.25, 4.2);
      g.player.camera.rotation.order = 'YXZ';
      g.player.camera.rotation.set(0, 0, 0);
      g.player.camera.updateMatrixWorld(true);
    };
    const firearmBots = g.botManager.bots.filter((bot) => !bot._isSwordBot);
    const spacing = 0.92;
    const firstSlot = -spacing * (firearmBots.length - 1) * 0.5;
    let firearmIndex = 0;
    for (let i = 0; i < g.botManager.bots.length; i++) {
      const bot = g.botManager.bots[i];
      const x = firstSlot + spacing * firearmIndex;
      bot.position.set(bot._isSwordBot ? 0 : x, 0, 0);
      bot.mesh.position.copy(bot.position);
      bot._provoked = false;
      bot._provokedByPlayer = false;
      bot._targetEntity = null;
      bot.update(1 / 60, g.player, g.player.camera, () => {}, g.world);
      bot.position.set(bot._isSwordBot ? 0 : x, 0, 0);
      bot.mesh.position.copy(bot.position);
      bot.mesh.rotation.set(0, Math.PI, 0);
      bot.mesh.visible = !bot._isSwordBot;
      if (!bot._isSwordBot) firearmIndex++;
      bot.healthBarGroup.visible = false;
      bot.update = () => {};
    }
    g.botManager.update = () => {};
    const visibleBots = new Set(firearmBots.map((bot) => bot.mesh));
    for (const child of g.world.scene.children) {
      child.visible = child === g.player.camera || child.isLight || visibleBots.has(child);
    }
    if (g.weaponSystem.weaponMount) g.weaponSystem.weaponMount.scale.setScalar(0);
    g.nameplates.update = () => {};
    g.nameplates.container.remove();
    document.getElementById('connect-screen')?.classList.add('hidden');
    document.getElementById('map-loading')?.classList.add('hidden');
    for (const id of ['top-nav', 'nav-side', 'share-game', 'social-icons', 'center-play']) {
      const element = document.getElementById(id);
      element?.classList.add('hidden');
      element?.style.setProperty('display', 'none', 'important');
    }
    g._menuOpen = false;
    g.menu?.hidePause?.();
    return g.botManager.bots.map((bot) => ({
      armorTypeId: bot.mesh.userData?.armorTypeId,
      isHuman: !!bot.mesh.userData?.isHuman,
      isHero: !!bot.mesh.userData?.isHero,
      hasWeapon: !!bot._weaponMesh,
      isMelee: !!bot._isSwordBot,
      weaponId: bot._isSwordBot ? 'sword' : bot._botGun?.id,
    }));
  });

  const allowed = new Set(['vanguard', 'striker', 'phantom']);
  const firstSquadWeapons = new Set(roster.slice(0, 5).map((bot) => bot.weaponId));
  if (roster.length !== 7
      || roster.some((bot) => !allowed.has(bot.armorTypeId)
        || bot.isHuman || !bot.isHero || !bot.hasWeapon)
      || roster.filter((bot) => !bot.isMelee).length < 3
      || ['m4', 'm16', 'rifle', 'lmg', 'sword'].some((id) => !firstSquadWeapons.has(id))) {
    throw new Error(`invalid rendered roster: ${JSON.stringify(roster)}`);
  }
  await page.waitForTimeout(500);
  // The imported map can finish attaching a frame after the match becomes
  // playable. Reapply the isolated QA stage immediately before capture so a
  // late map root cannot cover the lineup.
  await page.evaluate(() => {
    const g = window.__game || window.game;
    const visibleBots = new Set(g.botManager.bots
      .filter((bot) => !bot._isSwordBot).map((bot) => bot.mesh));
    for (const child of g.world.scene.children) {
      child.visible = child === g.player.camera || child.isLight || visibleBots.has(child);
    }
    g.player.camera.position.set(0, 1.25, 4.2);
    g.player.camera.rotation.set(0, 0, 0);
    g.player.camera.updateMatrixWorld(true);
    for (const id of ['connect-screen', 'map-loading', 'hud', 'top-nav', 'nav-side',
      'share-game', 'social-icons', 'center-play']) {
      const element = document.getElementById(id);
      element?.classList.add('hidden');
      element?.style.setProperty('display', 'none', 'important');
    }
  });
  await page.screenshot({ path: output });
  console.log(`roster visual passed: ${roster.map((bot) => bot.armorTypeId).join(', ')} -> ${output}`);
} finally {
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
