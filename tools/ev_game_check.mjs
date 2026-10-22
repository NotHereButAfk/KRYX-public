import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
let server, browser;
try {
  let url = process.env.KYX_URL;
  if (!url) {
    server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
      server: { host: '127.0.0.1', port: 0, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] } });
    await server.listen();
    url = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => {
    // Entering gameplay deliberately removes the banner, cancelling its in-flight navigation.
    if (request.url().startsWith('https://acceptable.a-ads.com/') && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(request.url() + ': ' + request.failure()?.errorText);
  });
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  // Model integration must not depend on third-party creative downloads cancelled at screen changes.
  await page.route('https://pagead2.googlesyndication.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('https://acceptable.a-ads.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Advertisement fixture</title>' }));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.previewCharacter?.userData?.isEvCharacter, null, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('#play-btn').click());
  await page.waitForFunction(() => window.__game?.state === 'playing', null, { timeout: 60000 });
  await page.waitForFunction(() => window.__game?.weaponSystem.models.get('m4')?.group.userData.modelSource === 'blender-arsenal', null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const game = window.__game;
    const { Avatar } = await import('/src/player/Avatar.js');
    const peer = new Avatar(game.world.scene);
    const peerPosition = game.player.position.clone();
    for (let i = 0; i < 60; i++) {
      peerPosition.z -= 1.2 / 60;
      peer.update(1 / 60, { position: peerPosition, yaw: 0, speed: 1.2, grounded: true, crouch: true, firing: true });
    }
    const result = {
      local: !!game._playerBody.userData.isEvCharacter,
      menu: !!game.previewCharacter.userData.isEvCharacter,
      bots: game.botManager.bots.map((bot) => !!bot.mesh.userData.isEvCharacter),
      remote: !!peer.group.userData.isEvCharacter,
      remoteAction: peer.group.userData.activeAnimation,
      rifle: game.weaponSystem.models.get('m4').group.userData.modelSource,
      remoteRifle: !!peer.group.getObjectByName('weapon_m4'),
      botHitMaterials: game.botManager.bots.every((bot) => bot.bodyMat === bot.mesh.userData.primaryMat && !!bot.bodyMat),
    };
    const { WeaponPreviewRenderer } = await import('/src/ui/WeaponPreviewRenderer.js');
    const { WEAPONS } = await import('/src/weapons/weaponDefs.js');
    const { renderWeaponSkinned } = await import('/src/ui/WeaponThumbnails.js');
    const { WEAPON_SKINS } = await import('/src/weapons/WeaponSkins.js');
    const m4 = WEAPONS.find((w) => w.id === 'm4');
    let sharedDisposals = 0, ownedDisposals = 0;
    const shared = new Set();
    game.weaponSystem.models.get('m4').group.traverse((o) => { if (o.isMesh) shared.add(o.geometry); });
    const disposed = () => sharedDisposals++;
    shared.forEach((geometry) => geometry.addEventListener('dispose', disposed));
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const preview = new WeaponPreviewRenderer(canvas);
    try {
      preview.loadWeapon(m4);
      const owned = new Set();
      preview._group.traverse((o) => { if (o.isMesh) owned.add(o.material); });
      owned.forEach((material) => material.addEventListener('dispose', () => ownedDisposals++));
      preview.loadWeapon(WEAPONS.find((w) => w.id === 'magnum'));
      preview.loadWeapon(m4);
      result.thumbnail = !!renderWeaponSkinned(m4, WEAPON_SKINS.find((s) => !s.decal));
    } finally {
      preview.dispose();
      shared.forEach((geometry) => geometry.removeEventListener('dispose', disposed));
    }
    Object.assign(result, { sharedDisposals, ownedDisposals });
    const bot = game.botManager.bots.find((b) => b.alive);
    bot.flashTimer = 0.12;
    bot.update(0.01, game.player, game.player.camera, () => {}, game.world);
    result.botHitFlash = bot.bodyMat.emissiveIntensity > 0 && bot.bodyMat.emissive.getHex() === 0xffffff;
    bot.die();
    for (let i = 0; i < 18; i++) bot.update(1 / 60, game.player, game.player.camera, () => {}, game.world);
    result.botDeath = bot.mesh.userData.activeAnimation;
    result.botDeathWeaponHidden = !bot.mesh.getObjectByName('Auto_Rifle_-_root').visible;
    bot.respawnAt(bot.position.clone());
    result.botRespawn = bot.mesh.userData.activeAnimation;
    peer.dispose();
    return result;
  });
  assert(result.local && result.menu && result.remote, JSON.stringify(result));
  assert(result.bots.length > 0 && result.bots.every(Boolean), 'all local bots must use the new default');
  assert.match(result.remoteAction, /Crouch Walk and Shoot/);
  assert.equal(result.rifle, 'blender-arsenal', 'first-person Auto Rifle must use the rebuilt arsenal model');
  assert(result.remoteRifle, 'remote players must carry the same rebuilt Auto Rifle');
  assert(result.botHitMaterials, 'bot hit feedback must target an owned armor material');
  assert.equal(result.sharedDisposals, 0, 'armory and thumbnails must retain the live rifle buffers');
  assert(result.ownedDisposals > 0, 'armory replacement must release its own materials');
  assert(result.thumbnail, 'the real skinned thumbnail path must render');
  assert(result.botHitFlash, 'damage feedback must visibly flash bot armor');
  assert.equal(result.botDeath, 'Death', 'bot update must drive the shared crumple pose');
  assert(result.botDeathWeaponHidden, 'dying bots must hide their weapon');
  assert.match(result.botRespawn, /Idle/, 'bot respawn clears the death pose');
  assert.deepEqual(errors, []);
  console.log('EV game integration passed:', JSON.stringify(result));
} finally { await browser?.close(); await server?.close(); }
