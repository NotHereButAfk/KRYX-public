import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { WEAPONS } from '../src/weapons/weaponDefs.js';

const URL = process.env.KYX_URL || 'http://127.0.0.1:5995/?qa=1';
const OUT = path.resolve(process.env.ADS_OUT || path.join(os.tmpdir(), 'kyx-ads'));

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') {
    console.log(`[browser ${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => console.log(`[browser pageerror] ${error.message}`));

try {
  await page.goto(URL, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('#play-btn', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => document.querySelector('#play-btn')?.click());
  await page.waitForFunction(() => {
    const g = window.__game || window.game;
    return g && !document.getElementById('hud')?.classList.contains('hidden');
  }, null, { timeout: 60000 });
  if (!process.env.SKIP_HUD_THUMBS) {
    await page.waitForFunction(() => {
      const thumbs = [...document.querySelectorAll('#weapon-slots .weapon-slot .ws-thumb')];
      return thumbs.length > 0
        && thumbs.every((thumb) => thumb.style.backgroundImage.includes('data:image/png'));
    }, null, { timeout: 8000 });
  }
  // The HUD becomes visible slightly before the first rendered map frame.
  // Wait through that handoff so the first firearm cannot produce a false
  // black capture while the later weapons appear healthy.
  await page.waitForTimeout(1500);

  const hudSlots = await page.evaluate(() => ({
    total: document.querySelectorAll('#weapon-slots .weapon-slot').length,
    withThumb: document.querySelectorAll('#weapon-slots .weapon-slot .ws-thumb').length,
    withRealModel: [...document.querySelectorAll('#weapon-slots .weapon-slot .ws-thumb')]
      .filter((thumb) => thumb.style.backgroundImage.includes('data:image/png')).length,
  }));
  if (!process.env.SKIP_HUD_THUMBS
      && (!hudSlots.total || hudSlots.withThumb !== hudSlots.total
        || hudSlots.withRealModel !== hudSlots.total)) {
    throw new Error(`in-match weapon inventory is incomplete: ${JSON.stringify(hudSlots)}`);
  }
  await page.screenshot({ path: path.join(OUT, 'inventory-hud.png') });

  const firearmIds = WEAPONS
    .filter((weapon) => weapon.kind !== 'melee')
    .filter((weapon) => !process.env.ADS_WEAPON || weapon.id === process.env.ADS_WEAPON)
    .map((weapon) => weapon.id);
  for (const weaponId of firearmIds) {
    await page.evaluate((id) => {
      const g = window.__game || window.game;
      const ws = g.weaponSystem;
      const firearm = ws.allWeapons.find((weapon) => weapon.id === id);
      const sword = ws.allWeapons.find((weapon) => weapon.id === 'sword');
      if (!firearm || firearm.kind === 'melee') throw new Error(`unknown firearm ${id}`);
      // setLoadout intentionally accepts only the five spawn weapons. This
      // visual audit must also exercise every map pickup, so install the exact
      // requested definition as the active slot instead of silently falling
      // back to the M4.
      ws.loadout = [firearm, sword].filter(Boolean);
      ws.currentIndex = 0;
      ws._rebuildKeyMap();
      ws._setActiveModel(0);
      g.input.rightMouseDown = false;
      g._menuOpen = false;
      g.menu?.hidePause?.();
      ['top-nav', 'nav-side', 'share-game', 'social-icons', 'center-play']
        .forEach((nodeId) => document.getElementById(nodeId)?.classList.add('hidden'));
    }, weaponId);
    await page.waitForTimeout(160);
    if (process.env.CAPTURE_HIP) {
      await page.screenshot({ path: path.join(OUT, `${weaponId}-hip.png`) });
    }
    await page.evaluate(() => { (window.__game || window.game).input.rightMouseDown = true; });
    await page.waitForFunction(() => (window.__game || window.game)?.weaponSystem?.scopeT > 0.98,
      null, { timeout: 8000 });
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(OUT, `${weaponId}.png`) });
    const state = await page.evaluate(() => {
      const ws = (window.__game || window.game).weaponSystem;
      const record = ws.models.get(ws.currentDef.id);
      record.group.updateWorldMatrix(true, true);
      const sightNdc = record.sight.clone().applyMatrix4(record.group.matrixWorld).project(ws.camera);
      return {
        weaponId: ws.currentDef.id,
        scoped: !!ws.currentDef.scoped,
        visible: ws.kickGroup.visible,
        fov: ws.camera.fov,
        mount: ws.weaponMount.position.toArray(),
        scale: ws.weaponMount.scale.x,
        sightNdc: sightNdc.toArray(),
      };
    });
    if (state.weaponId !== weaponId) {
      throw new Error(`${weaponId} audit rendered ${state.weaponId} instead`);
    }
    if (state.scoped) {
      if (Math.abs(state.fov - 28) > 0.25 || state.visible) {
        throw new Error(`${weaponId} scoped presentation is invalid: ${JSON.stringify(state)}`);
      }
    } else {
      if (!state.visible || Math.abs(state.fov - 52) > 0.25
          || Math.abs(state.sightNdc[0]) > 0.025
          || state.sightNdc[1] >= -0.35 || state.sightNdc[1] <= -0.58) {
        throw new Error(`${weaponId} does not preserve a clear ADS reticle: ${JSON.stringify(state)}`);
      }
    }
    console.log(`${weaponId}: ${JSON.stringify(state)}`);
    await page.evaluate(() => { (window.__game || window.game).input.rightMouseDown = false; });
    await page.waitForFunction(() => (window.__game || window.game)?.weaponSystem?.scopeT < 0.08,
      null, { timeout: 8000 });
  }
} finally {
  await browser.close();
}

console.log(`ADS captures written to ${OUT}`);
