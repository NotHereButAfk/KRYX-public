import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// This tests real UI and Game damage routing with deterministic injected enemy
// hits. Random bots are removed; no claim is made about stochastic target timing.
const output = resolve(process.env.KYX_SPAWN_OUTPUT || 'artifacts/spawn-protection');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] });
const report = { damageSource: 'Game._onPlayerDamaged fixture', pageErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('sio_settings', JSON.stringify({ quality: 'low', volume: 0 }));
    let locked = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Element.prototype.requestPointerLock = function () {
      locked = this;
      queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
      return Promise.resolve();
    };
    document.exitPointerLock = () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
  });
  await page.goto(process.env.KYX_URL || 'http://127.0.0.1:5997/?qa=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const g = window.__game || window.game;
    return g?.world?.currentMap && !g._startupInFlight
      && document.getElementById('connect-screen')?.classList.contains('hidden');
  }, null, { timeout: 120000 });
  await page.locator('#play-btn').click({ force: true });
  await page.waitForFunction(() => (window.__game || window.game)?.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__game || window.game;
    g._authNet?.disconnect?.(); g._authNet = null; g._netDriven = false;
    g.serverSim?.stop(); g.botManager.clear();
    window.__spawnQA = { updates: 0, hurt: 0, flashes: 0 };
    g.player.update = () => { window.__spawnQA.updates++; };
    const hurt = g.audio.playHurt.bind(g.audio), flash = g.hud.flashDamage.bind(g.hud);
    g.audio.playHurt = (...args) => { window.__spawnQA.hurt++; return hurt(...args); };
    g.hud.flashDamage = (...args) => { window.__spawnQA.flashes++; return flash(...args); };
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window.__game || window.game)?._menuOpen);
  await page.locator('#play-btn').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#play-btn').innerText(), 'CLICK TO RESUME');
  await page.waitForFunction(() => !(window.__game || window.game).player.spawnProtected);
  report.pausedDamage = await page.evaluate(() => {
    const g = window.__game || window.game;
    const before = g.player.health + g.player.shield;
    g._onPlayerDamaged(20);
    return { before, after: g.player.health + g.player.shield, menuOpen: g._menuOpen,
      deadline: g.player._spawnProtectionUntil, flash: g.hud.damageFlash.classList.contains('show') };
  });
  assert.equal(report.pausedDamage.after, report.pausedDamage.before - 20);
  assert.equal(report.pausedDamage.menuOpen, true);
  assert.equal(report.pausedDamage.flash, true);
  await page.screenshot({ path: resolve(output, 'resume-takes-damage.png') });
  await page.locator('#play-btn').click({ force: true });
  await page.waitForFunction(() => !(window.__game || window.game)._menuOpen);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window.__game || window.game)._menuOpen);
  assert.equal(await page.evaluate(() => (window.__game || window.game).player._spawnProtectionUntil), report.pausedDamage.deadline);
  await page.waitForTimeout(650);
  report.freshSpawn = await page.evaluate(() => {
    const g = window.__game || window.game, qa = window.__spawnQA;
    const start = performance.now();
    g._respawnPlayer();
    const now = performance.now(), deadline = g.player._spawnProtectionUntil;
    const before = g.player.health + g.player.shield;
    const hurt = qa.hurt, flashes = qa.flashes;
    g._onPlayerDamaged(17);
    return { start, now, deadline, before, after: g.player.health + g.player.shield,
      protected: g.player.spawnProtected, menuOpen: g._menuOpen,
      hurtDelta: qa.hurt - hurt, flashDelta: qa.flashes - flashes,
      flashVisible: g.hud.damageFlash.classList.contains('show'), updates: qa.updates };
  });
  const fresh = report.freshSpawn;
  assert(fresh.deadline >= fresh.start + 1999 && fresh.deadline <= fresh.now + 2001, 'spawn must grant exactly two wall-clock seconds');
  assert(fresh.deadline - fresh.now > 1500, 'spawn setup consumed most of protection');
  assert.equal(fresh.protected, true); assert.equal(fresh.menuOpen, true);
  assert.equal(fresh.after, fresh.before);
  assert.equal(fresh.hurtDelta, 0); assert.equal(fresh.flashDelta, 0); assert.equal(fresh.flashVisible, false);
  await page.waitForTimeout(2100);
  report.expiredWhilePaused = await page.evaluate(() => {
    const g = window.__game || window.game, qa = window.__spawnQA;
    const before = g.player.health + g.player.shield;
    const hurt = qa.hurt, flashes = qa.flashes;
    g._onPlayerDamaged(20);
    return { before, after: g.player.health + g.player.shield, protected: g.player.spawnProtected,
      menuOpen: g._menuOpen, deadline: g.player._spawnProtectionUntil,
      hurtDelta: qa.hurt - hurt, flashDelta: qa.flashes - flashes, updates: qa.updates };
  });
  const expired = report.expiredWhilePaused;
  assert.equal(expired.after, expired.before - 20);
  assert.equal(expired.protected, false); assert.equal(expired.menuOpen, true);
  assert.equal(expired.deadline, fresh.deadline);
  assert.equal(expired.hurtDelta, 1); assert.equal(expired.flashDelta, 1);
  assert.equal(expired.updates, fresh.updates, 'menu fixture must not advance Player.update');
  await page.screenshot({ path: resolve(output, 'respawn-protection-expired.png') });
  report.bypass = await page.evaluate(() => {
    const g = window.__game || window.game;
    g._respawnPlayer();
    const before = g.player.health + g.player.shield;
    g._onPlayerDamaged(30, null, null, true);
    const afterSelf = g.player.health + g.player.shield;
    const protectedAfterSelf = g.player.spawnProtected;
    g._onPlayerDamaged(afterSelf + 1, null, null, true);
    return { before, afterSelf, protectedAfterSelf, deadAfterHazard: g.player.isDead };
  });
  assert.equal(report.bypass.afterSelf, report.bypass.before - 30);
  assert.equal(report.bypass.protectedAfterSelf, true);
  assert.equal(report.bypass.deadAfterHazard, true);
  assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'));
  writeFileSync(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
