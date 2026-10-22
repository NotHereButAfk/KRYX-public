import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run the production methods against a small DOM/timer fixture. Importing Game
// constructs browser-only rendering dependencies, which these state tests do
// not need. Method bodies below are extracted, never copied into the fixture.
const source = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
function productionMethod(name, bindings) {
  const pattern = new RegExp(`^  (?:async )?${name}\\(`, 'm');
  const start = source.search(pattern);
  assert(start >= 0, `Missing Game.${name}`);
  const end = source.indexOf('\n  }', start) + '\n  }'.length;
  assert(end > start, `Missing end of Game.${name}`);
  return Function(...Object.keys(bindings), `"use strict"; return ({${source.slice(start, end)}}).${name};`)(...Object.values(bindings));
}

function element() {
  const classes = new Set();
  return {
    dataset: {}, textContent: '', attributes: {},
    style: { setProperty(name, value) { this[name] = value; } },
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function fixture() {
  const ids = ['connect-screen', 'boot-status', 'boot-detail', 'boot-percent',
    'boot-progress-fill', 'boot-retry', 'map-loading', 'ml-building',
    'ml-progress-fill', 'ml-percent', 'ml-region', 'ml-mode', 'ml-players', 'ml-tip'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const bootBar = element(), mapBar = element(), mapName = element();
  nodes['connect-screen'].querySelector = () => bootBar;
  nodes['map-loading'].querySelector = selector => selector === '.ml-name' ? mapName : mapBar;
  nodes['boot-retry'].classList.add('hidden');
  const timers = { auto: false, nextId: 0, pending: new Map(), delays: [] };
  const bindings = {
    document: { getElementById: id => nodes[id] },
    performance: { now: () => 100 },
    setTimeout(callback, delay) {
      const id = ++timers.nextId;
      timers.pending.set(id, callback);
      timers.delays.push(delay);
      if (timers.auto) queueMicrotask(() => {
        if (timers.pending.delete(id)) callback();
      });
      return id;
    },
    clearTimeout: id => timers.pending.delete(id),
    authNetTargets: () => [],
    remainingLoadingMs: () => 0,
    location: { search: '' },
    MAX_PLAYERS: 8,
    getImportedMap: id => ({ id, name: 'Test Arena', loadingImage: '/arena.jpg' }),
  };
  const methods = ['_setStartupProgress', '_showStartupError', '_runConnectSequence',
    '_showServerJoining', '_showServerJoinError', '_showMapLoading', '_setMapLoadingPhase'];
  const game = Object.fromEntries(methods.map(name => [name, productionMethod(name, bindings)]));
  game._startupProgress = 0;
  return { game, nodes, bootBar, mapBar, mapName, timers };
}

// Reordered callbacks cannot decrease progress; a new attempt can start at zero.
{
  const { game, nodes, bootBar } = fixture();
  game._setStartupProgress('ASSETS', 74, 'Assets loaded');
  game._setStartupProgress('ASSETS', 26, 'Earlier asset finished late');
  assert.equal(nodes['boot-percent'].textContent, '74%');
  assert.equal(bootBar.attributes['aria-valuenow'], '74');
  assert.equal(nodes['connect-screen'].dataset.stage, 'assets');
  game._setStartupProgress('SYSTEMS', 82, 'Preparing gameplay');
  assert.equal(nodes['connect-screen'].dataset.stage, 'systems');
  game._setStartupProgress('READY', 100, 'Game ready');
  assert.equal(nodes['connect-screen'].dataset.stage, 'ready');
  assert.equal(bootBar.attributes['aria-valuetext'], '100% — Game ready');
}

// Actual startup resets progress, ignores callbacks after the asset phase, and
// finishes without waiting on an artificial minimum loading duration.
{
  const { game, nodes, timers } = fixture();
  timers.auto = true;
  let lateAsset, duringSystems, firstProgress;
  game._startupProgress = 100;
  const progress = game._setStartupProgress;
  game._setStartupProgress = function (...args) {
    progress.apply(this, args);
    firstProgress ??= this._startupProgress;
  };
  Object.assign(game, {
    _initialMapId: 'test',
    _startPresentationPreloads(callback) {
      lateAsset = callback;
      callback('player'); callback('weapons');
      return Promise.resolve();
    },
    _initAuth() {
      lateAsset('armor');
      duringSystems = nodes['boot-status'].textContent;
    },
    _ensureEnvironment() {}, _configureMapCamera() {}, _schedulePresentationPreloads() {},
    _finishServerJoining() { this._setMapLoadingPhase('Arena ready', 100, true); },
    world: { startInitialLoad: async () => ({}), previewPedestalPos: {} },
    previewCharacter: { position: { copy() {} } },
    renderer: { compileAsync: async () => {} },
    menu: { selectedModeId: 'deathmatch', showMain() {} },
  });
  await game._runConnectSequence();
  assert.equal(firstProgress, 0, 'a new attempt must reset the completed percentage');
  assert.equal(duringSystems, 'PREPARING MATCH...', 'late assets must not overwrite the systems phase');
  assert.equal(nodes['boot-status'].textContent, 'READY');
  const completed = [nodes['boot-status'].textContent, nodes['boot-percent'].textContent];
  lateAsset('zombies');
  assert.deepEqual([nodes['boot-status'].textContent, nodes['boot-percent'].textContent], completed);
  assert.equal(game._startupInFlight, false);
  assert.equal(nodes['connect-screen'].dataset.state, 'loading');
  assert.equal(nodes['connect-screen'].dataset.stage, 'ready');
  assert.equal(nodes['connect-screen'].classList.contains('hidden'), true);
  assert(timers.delays.every(delay => delay <= 240), 'startup must not add an artificial display hold');
}

// Retry is visible and automatic recovery remains scheduled. Disposed games
// cannot restart from a pending retry callback.
{
  const { game, nodes, timers } = fixture();
  let retries = 0;
  game._runConnectSequence = () => { retries += 1; };
  game._showStartupError(new Error('Failed asset request'));
  assert.equal(nodes['connect-screen'].dataset.state, 'retrying');
  assert.equal(nodes['boot-retry'].classList.contains('hidden'), false);
  assert.equal(timers.delays.at(-1), 2000);
  const retry = timers.pending.get(game._startupRetryTimer);
  retry(); assert.equal(retries, 1);
  game._disposed = true;
  retry(); assert.equal(retries, 1);
}

// Connection failure, reconnect, arena load and final readiness have distinct
// states; waiting for other players is never announced as ready.
{
  const { game, nodes, mapBar, mapName } = fixture();
  game._matchJoinPromise = Promise.resolve();
  game._showServerJoinError();
  assert.equal(nodes['map-loading'].dataset.state, 'retrying');
  assert.equal(mapName.textContent, 'CONNECTION INTERRUPTED');
  game._showServerJoining('deathmatch');
  assert.equal(nodes['map-loading'].dataset.state, 'loading');
  assert.equal(nodes['map-loading'].dataset.stage, 'joining');
  game._showMapLoading('deathmatch', 'test');
  assert.equal(nodes['map-loading'].dataset.stage, 'arena');
  assert.equal(nodes['ml-players'].textContent, 'Up to 8 players');
  assert(!nodes['ml-tip'].textContent.startsWith('TIP:'));
  game._setMapLoadingPhase('Waiting for other players', 100, false);
  assert.equal(nodes['map-loading'].dataset.stage, 'arena');
  assert.equal(nodes['map-loading'].classList.contains('ml-arena-ready'), false);
  assert.equal(mapBar.attributes['aria-valuetext'], '100% — Waiting for other players');
  game._setMapLoadingPhase('Arena ready', 100, true);
  assert.equal(nodes['map-loading'].dataset.stage, 'ready');
  assert.equal(nodes['ml-percent'].textContent, '100%');
  assert.equal(mapBar.attributes['aria-valuenow'], '100');
}

console.log('Loading progress passed: monotonic stages, late callbacks, per-attempt reset, retries, accessible progress and waiting states.');
