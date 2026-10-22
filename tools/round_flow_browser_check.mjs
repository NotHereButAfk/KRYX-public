import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { makeAuthServer } from '../server/authserver.mjs';

const app = makeAuthServer({ targetPopulation: 2 });
await new Promise(resolve => app.http.listen(0, '127.0.0.1', resolve));
const address = `ws://127.0.0.1:${app.http.address().port}`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
// Rendering has separate visual tests. Keep WebGL map decoding real, but don't
// let software rendering starve the WebSocket/timer/menu lifecycle test.
await page.addInitScript(() => {
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  const request = Element.prototype.requestPointerLock;
  window.__captureAttempts = [];
  Element.prototype.requestPointerLock = function(...args) {
    window.__captureAttempts.push({ active: navigator.userActivation.isActive, at: performance.now() });
    return request.apply(this, args);
  };
});
let slow;
const until = async (fn, timeout = 10000) => {
  for (let i = 0; i < timeout / 25; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('server condition timed out');
};
try {
  console.log('[round flow] opening actual game');
  await page.goto(`http://127.0.0.1:5997/?authnet=${encodeURIComponent(address)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?._authNet?.ready, null, { timeout: 90000, polling: 50 });
  console.log('[round flow] server and map ready');
  await page.locator('#play-btn').click({ force: true });
  await page.waitForFunction(() => window.__game?.state === 'playing', null, {polling:50});
  const initial = await page.evaluate(() => ({ locked: !!document.pointerLockElement,
    attempts: window.__captureAttempts, menu: window.__game._menuOpen }));
  assert(initial.attempts.some(a => a.active), 'capture was not requested within the Play click');
  assert(initial.locked, 'initial Play did not capture the mouse');
  console.log('[round flow] native mouse capture works');

  for (let i = 0; i < 3; i++) {
    // Browser Escape exits pointer lock; the game must also handle Escape when
    // already unlocked. Exercise both notification routes independently.
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => window.__game._menuOpen, null, {polling:50});
    if (i === 0) {
      const effects = await page.evaluate(() => {
        const game = window.__game, weapons = game.weaponSystem;
        const from = game.player.position.clone(); from.y += 1.5;
        const to = from.clone(); to.z -= 60;
        weapons._spawnTracer(from, to, {});
        const tracer = weapons.tracers.at(-1);
        game._updatePlaying(1 / 60);
        const travelled = tracer.travelled;
        for (let tick = 0; tick < 60; tick++) game._updatePlaying(1 / 60);
        return { travelled, expired: !weapons.tracers.includes(tracer), menu: game._menuOpen };
      });
      assert(effects.travelled > 0 && effects.expired && effects.menu,
        'opening ESC menu froze a live tracer or closed the menu');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1050); // browser ESC cooldown before recapture
    await page.locator('#play-btn').click({ force: true });
    await page.waitForFunction(() => document.pointerLockElement && !window.__game._menuOpen, null, {polling:50});
  }

  slow = new WebSocket(address, { origin: 'http://localhost' });
  console.log('[round flow] resume loops passed, adding slow loader');
  let slowId;
  slow.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') slowId = m.you; if (m.t === 'ping') slow.send(JSON.stringify({t:'pong',id:m.id})); });
  await new Promise(resolve => slow.once('open', resolve));
  slow.send(JSON.stringify({ t: 'hello', name: 'Slow loader', readiness: true }));
  await until(() => slowId != null);
  const oldStart = app.room.matchStart;
  app.room.matchStart = Date.now() - app.room.matchDurationMs;
  const oldMap = await page.evaluate(() => window.__game.world.currentMapId);
  await until(() => !!app.room._postMatchUntil);
  await page.waitForFunction(() => window.__game?.state === 'leaderboard', null, { polling: 50 });
  const frozen = await page.evaluate(() => ({ map: window.__game.world.currentMapId,
    camera: window.__game.player.camera.position.toArray(),
    player: window.__game.player.position.toArray() }));
  assert(await page.evaluate(() => {
    const board = document.getElementById('scoreboard-overlay');
    const rect = board.querySelector('.sb-panel').getBoundingClientRect();
    return board.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), 'final scoreboard is not visible');
  assert(await page.evaluate(() => {
    const game = window.__game;
    const render = game.renderer.render;
    let worldCamera;
    game.renderer.render = function(scene, camera) {
      if (scene === game.world.scene) worldCamera = camera;
      return render.call(this, scene, camera);
    };
    try { game._loop(); } finally { game.renderer.render = render; }
    return worldCamera === game.menuCamera && !game.weaponSystem.weaponMount.visible;
  }), 'results did not use the map tour with the weapon hidden');
  assert(await page.evaluate(() => {
    const game=window.__game, before=game.menuCamera.position.clone();
    for(let i=0;i<120;i++) game._updateLeaderboard(0,1/60);
    return before.distanceTo(game.menuCamera.position) > .1;
  }), 'results camera remained frozen');
  await page.waitForTimeout(2000);
  assert.deepEqual(await page.evaluate(() => ({ map: window.__game.world.currentMapId,
    camera: window.__game.player.camera.position.toArray(),
    player: window.__game.player.position.toArray() })), frozen, 'results did not preserve the scene');
  assert.equal(frozen.map, oldMap);
  assert(app.room._postMatchUntil, 'results ended early');
  await until(() => !app.room._postMatchUntil && app.room.matchStart !== oldStart, 22000);
  await page.waitForFunction(() => !!window.__game?._authNet && window.__game._authNet._loadedRound === window.__game._authNet.client.matchStart,
    null, { timeout: 90000, polling: 50 });
  assert(await page.evaluate(() => document.getElementById('scoreboard-overlay').classList.contains('hidden')),
    'finished leaderboard covered next map loading');
  assert(app.room.players.get(slowId).mapReady === false);
  // Simulate a late load without waiting for real network bandwidth variation.
  slow.send(JSON.stringify({ t: 'ready', mapId: app.room.arena.id, matchStart: app.room.matchStart }));
  await page.waitForFunction(() => window.__game?.state === 'menu' && !window.__game?._roundGateVisible, null, {polling:50});
  assert(await page.evaluate(() => !document.pointerLockElement), 'Click to Play menu retained mouse capture');
  await page.locator('#play-btn').click({force:true});
  await page.waitForFunction(() => window.__game?.state === 'playing' && !!document.pointerLockElement,null,{timeout:30000,polling:50});
  assert.equal(app.room._roundWaiting, false);
  assert.deepEqual(errors, []);
  console.log('Browser round flow passed: native Play capture, ESC/Play x3, real map load readiness, slow-client wait, results tour, next-map menu and explicit Play recapture');
} catch (error) {
  console.error(error);
  console.error('runtime', await page.evaluate(() => ({ state: window.__game?.state,
    gate: window.__game?._authNet?.client?.roundGate, loaded: window.__game?._authNet?._loadedRound,
    map: window.__game?.world?.currentMapId, ready: window.__game?._authNet?.ready,
    boot: document.getElementById('boot-status')?.textContent })).catch(() => null), errors);
  throw error;
} finally {
  slow?.terminate(); await browser.close(); await app.close();
}
