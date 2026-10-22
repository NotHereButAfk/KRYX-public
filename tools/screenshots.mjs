// Capture the screenshots used in README.md, straight from the real game.
//
//   npx vite --port 5994 --host 127.0.0.1 --strictPort &
//   node tools/screenshots.mjs
//
// Re-run this after any visual change rather than letting the README rot. The
// shots come from a live match driven headlessly, so they can't drift from
// what the game actually looks like.
//
// Two things make this work, both non-obvious:
//   · the play button needs a JS .click() — Playwright's actionability check
//     hangs on the canvas overlay
//   · headless never grants pointer lock, so the game's own onLockChange
//     handler re-opens the pause nav over the live match. HIDE() clears it,
//     and has to be re-applied after every interaction.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { TPS_DEFAULT_DISTANCE } from '../src/player/ThirdPersonCamera.js';

const URL = process.env.KYX_URL || 'http://127.0.0.1:5994/';
const OUT = process.env.KYX_SCREENSHOT_OUT || 'docs/screenshots';
const VIEW = { width: 1280, height: 720 };
const CAPTURE_SWORD = process.env.KYX_FIRST_PERSON_WEAPON === 'sword';

const HIDE = `(() => {
  ['top-nav','nav-side','share-game','social-icons','center-play']
    .forEach(id => {
      const element = document.getElementById(id);
      element?.classList.add('hidden');
      element?.style.setProperty('display', 'none', 'important');
    });
  const g = window.__game || window.game;
  if (g) g._menuOpen = false;
  return !!g;
})()`;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
         '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: VIEW });
// Chromium's headless mode does not grant pointer lock. The game correctly
// treats that rejection as Escape and pauses input, which used to make a
// production capture impossible unless the private Game instance was exposed.
// Emulate the browser contract before app code runs so public builds can be
// exercised through their real mouse/keyboard controls instead.
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
const closeBrowser = async () => {
  // Some Windows/SwiftShader runs leave a renderer waiting during shutdown.
  // The screenshots are already flushed at this point, so bound teardown and
  // let process.exit below clean up the child process if Chrome does not reply.
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
};
// CI/local QA runs are intentionally offline. Abort the optional Google font
// fetches so Playwright's screenshot font-readiness gate cannot wait forever.
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.abort());
if (process.env.KYX_BLOCK_SOLDIER === '1') {
  await page.route(/\/soldier\.glb(?:\?|$)/, (route) => route.abort());
}
if (process.env.KYX_ARMOR_TYPE) {
  await page.addInitScript((armorType) => {
    localStorage.setItem('sio_armor_arena_model_v2', '1');
    localStorage.setItem('sio_armor_type', armorType);
  }, process.env.KYX_ARMOR_TYPE);
}
page.on('pageerror', (e) => console.warn('  page error:', e.message));

const shot = async (name) => {
  await page.evaluate(HIDE);
  // Headless cannot own pointer lock. Let the rejection event finish reopening
  // its chrome, then hide it once more so the captured frame is the live match.
  await page.waitForTimeout(120);
  await page.evaluate(HIDE);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  ✓', name);
};
const pose = (js) => page.evaluate(`(() => {
  const g = window.__game || window.game;
  if (!g) return false;
  ${js}
  return true;
})()`);

console.log('loading', URL);
await page.goto(URL, { waitUntil: 'commit', timeout: 30000 });
await page.waitForSelector('#play-btn', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(Number(process.env.KYX_BOOT_WAIT || 6000));
if (process.env.KYX_SKIP_MENU !== '1') {
  await page.screenshot({ path: `${OUT}/menu.png` });      // chrome intentionally left in
  console.log('  ✓ menu');
}

await page.evaluate(`document.querySelector('#play-btn')?.click()`);

// GLBs take a while; wait for the HUD rather than guessing
let inGame = false;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(4000);
  inGame = await page.evaluate(`!document.getElementById('hud')?.classList.contains('hidden')`);
  if (inGame) break;
}
if (!inGame) { console.error('match never started'); await closeBrowser(); process.exit(1); }
console.log('  in match');

await pose(`
  g.pickupSystem?.dispose();
  g.pickupSystem = null;
  g.botManager?.clear();
  g.weaponSystem.setLoadout('m4', 'sword');
  g.weaponSystem.switchTo(${CAPTURE_SWORD ? 1 : 0});
  const spawn = (g.world.spawnPoints.find(p => p.y <= 3.1) || g.world.spawnPoints[0]).clone();
  spawn.spawnYaw = g.world.spawnPoints.find(p => p.y <= 3.1)?.spawnYaw
    ?? g.world.spawnPoints[0]?.spawnYaw;
  g.player.respawn(spawn);
  g.player.yaw = Number.isFinite(spawn.spawnYaw) ? spawn.spawnYaw : 0;
  g.player.pitch = -0.04;
`);
await page.waitForTimeout(1200);
await shot('first-person');
if (CAPTURE_SWORD) {
  // Freeze the action clock at authored phases. `shot()` deliberately waits
  // 120ms for browser chrome to settle, which otherwise advances a 450ms
  // sword attack far enough to mislabel recovery as the cut frame.
  await pose(`
    window.__kyxSwordCaptureRate = g.weaponSystem.currentDef.fireRate;
    g.weaponSystem.currentDef.fireRate = 999;
    g.weaponSystem.swingPhase = 0.12;
  `);
  await shot('sword-windup');
  await pose(`g.weaponSystem.swingPhase = 0.56;`);
  await shot('sword-cut');
  await pose(`
    g.weaponSystem.swingPhase = 1;
    g.weaponSystem.currentDef.fireRate = window.__kyxSwordCaptureRate;
    delete window.__kyxSwordCaptureRate;
  `);
  await shot('sword-recovered');
}

// Document the actual first third-person zoom notch. A stale 3.4m override made
// the player look much smaller here than during normal gameplay.
const setThirdPersonDirectly = await pose(`g.player._camDist = ${TPS_DEFAULT_DISTANCE};`);
if (!setThirdPersonDirectly) {
  // Production intentionally keeps the Game instance private. Exercise the
  // same first-wheel-notch path a player uses instead of relying on internals.
  await page.mouse.move(VIEW.width / 2, VIEW.height / 2);
  await page.mouse.wheel(0, 100);
}
await page.waitForTimeout(1200);
await shot('third-person');
if (process.env.KYX_CAPTURE_MODELS_ONLY === '1') {
  await closeBrowser();
  console.log('done →', OUT);
  process.exit(0);
}

// Stand in front of a living bot and confirm it's actually on screen before
// calling the shot "combat" — bots wander, so the naive placement often framed
// an empty concourse.
const framed = await page.evaluate(`(() => {
  const g = window.__game || window.game;
  g.player._camDist = 0;
  const THREE = g.world.scene.constructor;
  for (const b of g.botManager.bots.filter(x => x.alive)) {
    g.player.position.set(b.position.x, 0, b.position.z + 8);
    // yaw is a CAMERA yaw: the view direction is -(sin yaw, cos yaw), so to
    // look AT something the deltas go in negated.
    g.player.yaw = Math.atan2(-(b.position.x - g.player.position.x),
                              -(b.position.z - g.player.position.z));
    g.player.pitch = 0;
    g.player.camera.position.set(g.player.position.x, 1.7, g.player.position.z);
    g.player.camera.rotation.order = 'YXZ';
    g.player.camera.rotation.set(0, g.player.yaw, 0);
    g.player.camera.updateMatrixWorld(true);
    const v = b.mesh.position.clone(); v.y += 1.2;
    v.project(g.player.camera);
    if (Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.6 && v.z < 1) return b.displayName;
  }
  return null;
})()`);
console.log('  combat framing:', framed || 'NO BOT IN FRAME');
await page.waitForTimeout(1200);
await shot('combat');

await closeBrowser();
console.log('done →', OUT);
