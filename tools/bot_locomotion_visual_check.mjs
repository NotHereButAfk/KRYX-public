import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const url = process.env.KYX_URL || 'http://127.0.0.1:5997/?qa=1';
const outputDir = process.env.KYX_BOT_MOTION_DIR || 'artifacts/bot-locomotion';
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.abort());

try {
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('connect-screen')?.classList.contains('hidden'), null,
    { timeout: 90000 });
  await page.evaluate(() => document.getElementById('play-btn')?.click());
  await page.waitForFunction(() => (window.__game || window.game)?.state === 'playing', null,
    { timeout: 90000 });

  const probe = await page.evaluate(() => {
    const g = window.__game || window.game;
    g.serverSim?.stop();
    if (g.world._mapRoot) g.world._mapRoot.visible = false;
    if (g.world.currentMap?.root) g.world.currentMap.root.visible = false;
    g.world.scene.background?.set?.(0x10151d);
    g.world.scene.fog = null;
    g.player.position.set(0, 0, 7.5);
    g.player.yaw = 0;
    g.player.pitch = -0.03;
    g.player.camera.fov = 50;
    g.player.camera.updateProjectionMatrix();
    g.player.update = () => {
      g.player.camera.position.set(0, 1.45, 7.5);
      g.player.camera.rotation.order = 'YXZ';
      g.player.camera.rotation.set(-0.03, 0, 0);
      g.player.camera.updateMatrixWorld(true);
    };
    const fakeWorld = {
      spawnPoints: [{ x: 0, y: 0, z: 0, clone() { return { ...this }; } }],
      arenaHalf: 100, killY: -20, colliders: [], raycastMeshes: [],
      resolveCollisions() {}, groundHeightAt() { return 0; },
      queryGravLift() { return 0; }, queryTeleport() { return null; },
      raycastBoxHit() { return null; }, randomSpawnPoint() { return g.player.position.clone(); },
    };
    const dummy = { position: { x: 999, y: 0, z: 999 }, isDead: true };
    const visible = g.botManager.bots.slice(0, 5);
    visible.forEach((bot, index) => {
      bot.position.set((index - 2) * 1.65, 0, 0);
      bot.mesh.position.copy(bot.position);
      bot.mesh.rotation.set(0, 0, 0);
      bot.wanderTarget.set(bot.position.x, 0, -80);
      bot.wanderCooldown = 999;
      bot._targetEntity = null;
      bot._provoked = false;
      bot._provokedByPlayer = false;
      bot._lastSeenValid = false;
      bot.speed = 4.7 + index * 0.22;
      bot.healthBarGroup.visible = false;
    });
    const visibleMeshes = new Set(visible.map((bot) => bot.mesh));
    for (const child of g.world.scene.children) {
      child.visible = child === g.player.camera || child.isLight || visibleMeshes.has(child);
    }
    g.botManager.update = (dt) => {
      for (const bot of visible) bot.update(dt, dummy, g.player.camera, () => {}, fakeWorld);
    };
    if (g.weaponSystem.weaponMount) g.weaponSystem.weaponMount.scale.setScalar(0);
    g.nameplates.update = () => {};
    g.nameplates.container.style.display = 'none';
    for (const id of ['connect-screen', 'map-loading', 'hud', 'top-nav', 'nav-side',
      'share-game', 'social-icons', 'center-play', 'qa-follow-bot']) {
      document.getElementById(id)?.style.setProperty('display', 'none', 'important');
    }
    return visible.map((bot) => ({ id: bot.id, armor: bot.mesh.userData?.armorTypeId }));
  });

  for (let frame = 0; frame < 3; frame++) {
    await page.waitForTimeout(260);
    await page.screenshot({ path: join(outputDir, `walk-${frame + 1}.png`) });
  }
  const transforms = await page.evaluate(() => JSON.parse(document.getElementById('qa-runtime')?.textContent || '{}'));
  const bad = (transforms.bots || []).some((bot) => bot.alive
    && (!Number.isFinite(bot.pitch) || !Number.isFinite(bot.roll)
      || Math.abs(bot.pitch) > 0.5 || Math.abs(bot.roll) > 0.08));
  if (bad) throw new Error(`bot root left upright locomotion bounds: ${JSON.stringify(transforms.bots)}`);
  console.log(`bot locomotion visual passed: ${probe.length} moving soldiers -> ${outputDir}`);
} finally {
  await browser.close();
}
