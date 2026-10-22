import { chromium } from 'playwright';

const url = process.env.KYX_URL || 'http://127.0.0.1:5997/';
const screenshot = process.env.KYX_STARTUP_SHOT || '';
const mapScreenshot = process.env.KYX_MAP_LOADING_SHOT || '';
const mobileScreenshot = process.env.KYX_STARTUP_MOBILE_SHOT || '';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.fulfill({
  status: 200, contentType: 'text/css', body: '',
}));
// Software WebGL can spend seconds inside one menu fly-through frame on CI.
// This test targets the asynchronous startup state machine, so leave rendering
// to the dedicated visual/gameplay checks instead of starving its timers.
await page.addInitScript(() => {
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
});

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push({
    text: message.text(), url: message.location().url || '',
  });
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => failedRequests.push(`${request.url()} (${request.failure()?.errorText})`));

try {
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('#connect-screen:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => Boolean(window.__game || window.game), null, {
    timeout: 60000, polling: 100,
  });
  const connectSeenAt = Date.now();
  await page.waitForFunction(() => Number.parseInt(document.getElementById('boot-percent')?.textContent) > 0, null, {
    timeout: 5000, polling: 25,
  });
  if (screenshot) await page.screenshot({ path: screenshot });
  await page.waitForFunction(() => document.getElementById('connect-screen')?.classList.contains('hidden'), null, {
    timeout: 60000, polling: 25,
  });
  const mapStage = await page.evaluate(() => ({
    visible: !document.getElementById('map-loading')?.classList.contains('hidden'),
    phase: document.getElementById('ml-building')?.textContent,
    progress: document.getElementById('ml-progress-fill')?.style.width,
    gameProgress: document.getElementById('boot-progress-fill')?.style.width,
    earlyOptionalAssets: performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /(?:soldier|player|spartan|zombie|weapons(?:_authored)?|sidearm)\.glb|universal-animation-library|vendor\/quaternius\/scifi-weapons/i.test(name)),
  }));
  if (!mapStage.visible || mapStage.gameProgress !== '100%') {
    throw new Error(`combined match loader did not follow completed game loading: ${JSON.stringify(mapStage)}`);
  }
  if (!mapStage.earlyOptionalAssets.length) {
    throw new Error(`shared presentation assets were not preloaded at startup: ${JSON.stringify(mapStage.earlyOptionalAssets)}`);
  }
  if (mapScreenshot) await page.screenshot({ path: mapScreenshot });
  await page.waitForFunction(() => document.getElementById('map-loading')?.classList.contains('hidden'), null, {
    timeout: 60000, polling: 25,
  });
  const mapVisibleMs = await page.evaluate(() => performance.now() - window.__game._mapLoadingShownAt);
  if (mapVisibleMs < 300) throw new Error(`map loader skipped its handoff: ${mapVisibleMs}ms`);
  const readyAt = Date.now();
  const connectDuration = readyAt - connectSeenAt;
  if (connectDuration < 240 || connectDuration > 30000) {
    throw new Error(`startup handoff took ${connectDuration}ms`);
  }
  await page.waitForFunction(() => !document.getElementById('top-nav')?.classList.contains('hidden'), null, {
    timeout: 5000, polling: 50,
  });

  const completedLoader = await page.evaluate(() => ({
    phase: document.getElementById('boot-status')?.textContent,
    detail: document.getElementById('boot-detail')?.textContent,
    progress: document.getElementById('boot-progress-fill')?.style.width,
    percent: document.getElementById('boot-percent')?.textContent,
    mapHidden: document.getElementById('map-loading')?.classList.contains('hidden'),
  }));
  if (completedLoader.phase !== 'READY' || completedLoader.progress !== '100%'
      || completedLoader.percent !== '100%' || !completedLoader.mapHidden) {
    throw new Error(`startup loader did not finish truthfully: ${JSON.stringify(completedLoader)}`);
  }

  const combinedJoin = await page.evaluate(async () => {
    const game = window.__game || window.game;
    game._showServerJoining('deathmatch');
    const card = document.getElementById('map-loading');
    if (card.querySelector('.ml-name').textContent !== 'FINDING MATCH'
        || card.style.getPropertyValue('--ml-image').includes('url(')) {
      throw new Error('Joining must not flash a guessed or previous map');
    }
    const sequence = game._mapLoadingSequence;
    const shownAt = game._mapLoadingShownAt;
    await game._onAuthoritativeMap(game.world.currentMapId, {}, true);
    const continuous = game._mapLoadingSequence === sequence
      && game._mapLoadingShownAt === shownAt
      && !document.getElementById('map-loading').classList.contains('hidden');
    await game._finishServerJoining();
    return { continuous, hidden: document.getElementById('map-loading').classList.contains('hidden') };
  });
  if (!combinedJoin.continuous || !combinedJoin.hidden) {
    throw new Error(`lobby/map loading restarted or failed to finish: ${JSON.stringify(combinedJoin)}`);
  }

  // Exercise the actual post-match path, not just the map registry. A local
  // completed game must advance to a different arena, wait for that arena's
  // loader, and return to Click to Play without spawning behind the menu.
  const rotation = await page.evaluate(async () => {
    const game = window.__game || window.game;
    game._startGame('Rotation QA', game.selectedSkin.id, 'deathmatch', game.selectedArmorType);
    const before = game.world.currentMapId;
    game._showLeaderboard();
    await game._restart();
    return {
      before,
      after: game.world.currentMapId,
      state: game.state,
      loaderHidden: document.getElementById('map-loading')?.classList.contains('hidden'),
    };
  });
  if (rotation.before === rotation.after) {
    throw new Error(`completed game did not rotate maps: ${JSON.stringify(rotation)}`);
  }
  if (rotation.state !== 'menu' || !rotation.loaderHidden) {
    throw new Error(`rotated map did not return to the menu cleanly: ${JSON.stringify(rotation)}`);
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.fulfill({
    status: 200, contentType: 'text/css', body: '',
  }));
  await mobile.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await mobile.waitForSelector('#connect-screen:not(.hidden)', { timeout: 5000 });
  const mobileLayout = await mobile.evaluate(() => {
    const shell = document.querySelector('.boot-shell')?.getBoundingClientRect();
    const logo = document.querySelector('.boot-connect-logo')?.getBoundingClientRect();
    return {
      width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth,
      shellLeft: shell?.left, shellRight: shell?.right,
      logoWidth: logo?.width, logoLeft: logo?.left, logoRight: logo?.right,
      hudHidden: getComputedStyle(document.getElementById('hud')).display === 'none',
      navHidden: document.getElementById('top-nav')?.classList.contains('hidden'),
    };
  });
  if (mobileLayout.width !== 390 || mobileLayout.overflow !== 0
      || mobileLayout.shellLeft < 0 || mobileLayout.shellRight > 390
      || !mobileLayout.logoWidth || mobileLayout.logoLeft < 0 || mobileLayout.logoRight > 390
      || !mobileLayout.hudHidden || !mobileLayout.navHidden) {
    throw new Error(`mobile startup layout is not isolated/responsive: ${JSON.stringify(mobileLayout)}`);
  }
  if (mobileScreenshot) await mobile.screenshot({ path: mobileScreenshot });
  await mobile.close();
  const relevantConsoleErrors = consoleErrors.filter(({ text, url: source }) => (
    !/fonts\.(?:googleapis|gstatic)\.com/i.test(`${text} ${source}`)
  ));
  const relevantFailures = failedRequests.filter((request) => (
    !/fonts\.(?:googleapis|gstatic)\.com/i.test(request)
  ));
  if (relevantConsoleErrors.length || pageErrors.length || relevantFailures.length) {
    throw new Error(`browser errors: ${[
      ...relevantConsoleErrors.map(({ text }) => text), ...pageErrors, ...relevantFailures,
    ].join(' | ')}`);
  }

  console.log(`startup loading passed: branded boot -> real ${mapStage.phase} -> menu in ${connectDuration}ms; completed game rotated ${rotation.before} -> ${rotation.after}`);
} catch (error) {
  const state = await page.evaluate(() => ({
    map: document.getElementById('map-loading')?.className,
    connect: document.getElementById('connect-screen')?.className,
    nav: document.getElementById('top-nav')?.className,
    hasGame: Boolean(window.__game || window.game),
    ready: document.readyState,
  })).catch(() => ({}));
  throw new Error(`${error.message}; DOM=${JSON.stringify(state)}; errors=${[
    ...consoleErrors.map(({ text, url: source }) => `${text} @ ${source}`), ...pageErrors, ...failedRequests,
  ].join(' | ')}`);
} finally {
  await browser.close();
}
