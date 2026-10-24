import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { Nameplates } from '../src/ui/Nameplates.js';
import { isNameplateOccluded } from '../src/ui/NameplateOcclusion.js';
import { AuthNetBridge } from '../src/net/AuthNetBridge.js';
import { compareMatchRows } from '../src/core/MatchRows.js';
import { renderNameCosmetics } from '../src/ui/NameCosmetics.js';

// Count real presentation calls against a minimal DOM. This catches redundant
// setters even when the browser would ultimately paint the same result.
let writes = 0;
let nodes = 0;
let clock = 1;
class Element {
  constructor() {
    nodes++;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this._text = '';
    this._html = '';
    const css = new Map();
    this.style = new Proxy({
      getPropertyValue: key => css.get(key) || '',
      setProperty: (key, value) => { writes++; css.set(key, value); },
    }, {
      get: (target, key) => key in target ? target[key] : css.get(key) || '',
      set: (_, key, value) => { writes++; css.set(key, value); return true; },
    });
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: (...names) => {
        writes++;
        this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ');
      },
      remove: (...names) => { writes++; this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name),
    };
  }
  get textContent() { return this._text || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { writes++; this._text = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    writes++; this._html = value; this.children = [];
    // The local plate creates these two leaves through its static HTML.
    if (value.includes('np-nametext')) {
      for (const name of ['np-nametext', 'np-bar-fg']) {
        const child = new Element(); child.className = name; this.appendChild(child);
      }
    }
  }
  appendChild(child) { writes++; this.children.push(child); child.parentElement = this; return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  replaceChildren(...children) { writes++; this.children = []; this.append(...children); }
  setAttribute() { writes++; }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) return child;
      const nested = child.querySelector?.(selector); if (nested) return nested;
    }
    return null;
  }
  remove() {
    writes++;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
}
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
globalThis.document = {
  body: element('body'),
  createElement: () => new Element(),
  getElementById: id => elements.get(id) || null,
  querySelector: selector => elements.get(selector.slice(1)) || null,
  querySelectorAll: () => [],
};
globalThis.window = { innerWidth: 1600, innerHeight: 900 };
globalThis.performance = { now: () => clock };

const source = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
const context = vm.createContext({ document, compareMatchRows, renderNameCosmetics,
  isCrazyGames: () => false, SHIELD_PER_STACK: 25 });
vm.runInContext(source.slice(source.indexOf('function setText')).replace('export class HUD', 'class HUD') + '\nglobalThis.HUD = HUD;', context);
const hud = Object.create(context.HUD.prototype);
for (const key of ['healthBar', 'healthText', 'shieldWrap', 'shieldBar', 'shieldText', 'shieldStacks',
  'staminaBar', 'staminaText', 'weaponName', '_magazineText', '_reserveText', 'weaponWrap',
  'reloadText', 'reloadRing', 'reloadProgress', 'reloadTime', 'crosshair', 'hitmarker', 'killCount', 'scoreCount', 'dmTimer']) {
  hud[key] = new Element();
}
hud._slotEls = []; hud._slotAmmoEls = []; hud._activeSlot = 0;
const weapon = { name: 'Auto rifle', slots: [], currentIndex: 0, magAmmo: 30, reserveAmmo: 90, isMelee: false, isReloading: false };
hud._renderedWeaponSlots = weapon.slots;
const player = { health: 100, maxHealth: 100, shield: 0, maxShield: 0, stamina: 100, maxStamina: 100 };
hud.update(player, weapon, 0, 0); hud.showDMTimer('2:00');
let before = writes;
for (let i = 0; i < 600; i++) { hud.update(player, weapon, 0, 0); hud.showDMTimer('2:00'); }
assert.equal(writes - before, 0, 'idle HUD and unchanged timer must not mutate DOM every frame');
weapon.isReloading = true; weapon.reloadProgress = .5; weapon.reloadRemaining = 1;
hud.update(player, weapon, 1, 100);
assert.equal(hud.reloadRing.style.getPropertyValue('--reload-fraction'), '0.5');
assert.equal(hud.killCount.textContent, '1');
assert.equal(hud.reloadTime.textContent, '1.0s');

for (const id of ['scoreboard-overlay', 'sb-rows', 'sb-sub', 'sb-earned', 'sb-spectators', 'sb-performance']) element(id);
element('sb-earned').previousElementSibling = new Element();
const rows = Array.from({ length: 8 }, (_, i) => ({ name: `Player ${i}`, kills: 8 - i,
  deaths: i, score: 1000 - i * 100, isYou: i === 0, isBot: i > 1 }));
hud.showScoreboard(rows, 'Deathmatch');
const firstRow = element('sb-rows').children[0];
before = writes; const nodeCount = nodes;
for (let i = 0; i < 25; i++) hud.showScoreboard(rows.map(row => ({ ...row })), 'Deathmatch');
assert.equal(writes - before, 0, 'ten seconds of unchanged scoreboard polls must not rebuild any DOM');
assert.equal(nodes, nodeCount, 'unchanged scoreboard allocates no DOM nodes');
hud.showScoreboard(rows, 'Deathmatch', { shotsFired: 10, hits: 3 });
assert.equal(element('sb-rows').children[0], firstRow, 'performance stats must not rebuild unchanged score rows');
assert.match(element('sb-performance').textContent, /30\.0%/);
rows[7].kills = 20; rows[7].nameCosmetics = { badge: 'invalid' };
hud.showScoreboard(rows, 'Deathmatch', { shotsFired: 10, hits: 3 });
assert.match(element('sb-rows').children[0].textContent, /Player 7/, 'changed score reorders immediately');
hud.hideScoreboard(); hud.showScoreboard(rows, 'Deathmatch');
assert.equal(element('scoreboard-overlay').classList.contains('hidden'), false, 'cached rows still reopen');

const camera = new THREE.PerspectiveCamera(75, 1600 / 900, .1, 1000);
camera.position.set(0, 1.7, 0); camera.updateMatrixWorld(true);
const bots = Array.from({ length: 8 }, (_, i) => ({ alive: true, mesh: {}, health: 100, maxHealth: 100,
  position: new THREE.Vector3((i - 4) * .7, 0, -12), displayName: `Bot ${i}` }));
let visibilityChecks = 0;
const world = { _mapOctree: {}, raycastCollisionDistance: (_, far) => { visibilityChecks++; return far; } };
const plates = new Nameplates();
plates.update(camera, bots, world);
const visibility = plates._occlusion.get(bots[0]);
before = writes;
for (let i = 0; i < 600; i++) { clock += 1000 / 60; plates.update(camera, bots, world); }
assert.equal(writes - before, 0, 'stationary local plates must not rewrite display, origin, or transform');
assert.equal(plates._occlusion.get(bots[0]), visibility, 'occlusion records must be reused');
assert(visibilityChecks <= 808, 'nameplate occlusion must stay at or below 10 Hz per bot');
before = writes;
for (const bot of bots) bot.position.x += .1;
plates.update(camera, bots, world);
assert.equal(writes - before, 8, 'moving local plates use only one transform write each');
bots[0].health = 50; plates.update(camera, bots, world);
assert.equal(plates._labels.get(bots[0])._fg.style.width, '50%');
bots[0].alive = false; plates.update(camera, bots, world);
assert.equal(plates._labels.has(bots[0]), false, 'dead labels are removed');
plates.clear(); assert.equal(plates._occlusion.get(bots[1]), undefined, 'map clear invalidates occlusion');

// Drive the real authoritative remote update with lightweight avatars; only
// render/animation and audio are stubbed, not the nameplate presentation path.
const bridge = Object.create(AuthNetBridge.prototype);
const remote = { id: 1, isBot: true, alive: true, ready: true, name: 'Remote', health: 100,
  maxHealth: 100, x: 0, y: 0, z: -12, nameCosmetics: {} };
const avatar = { group: new THREE.Group(), setWeapon() {}, update() {}, dispose() {} };
const record = { avatar, nameEl: new Element(), nameText: new Element(), healthFg: new Element(),
  pos: new THREE.Vector3(), footsteps: { update: () => null } };
bridge.remotes = new Map([[1, record]]); bridge._remoteSeen = new Set();
bridge._nameOrigin = new THREE.Vector3(); bridge._nameTarget = new THREE.Vector3();
bridge._remoteProject = new THREE.Vector3(); bridge._nameRaycaster = new THREE.Raycaster();
bridge._remoteAvatar = () => record;
bridge.player = { camera }; bridge.game = { world };
bridge.client = { remoteStates: () => [{ ...remote, nameCosmetics: { ...remote.nameCosmetics } }] };
bridge._syncRemotes(1 / 60);
const identityNode = record.nameText.children[0];
before = writes;
for (let i = 0; i < 600; i++) { clock += 1000 / 60; bridge._syncRemotes(1 / 60); }
assert.equal(writes - before, 0, 'stationary authoritative plates must not mutate DOM');
assert.equal(record.nameText.children[0], identityNode);
before = writes; remote.x = .1; bridge._syncRemotes(1 / 60);
assert.equal(writes - before, 1, 'moving authoritative plate only writes its transform');
assert.equal(record.nameEl.style.left, '', 'remote positioning does not touch layout properties per frame');
remote.x = 100; remote.name = 'Renamed'; remote.health = 40; bridge._syncRemotes(1 / 60);
assert.equal(record.nameEl.style.display, 'none');
assert.equal(record.nameText.textContent, 'Renamed', 'offscreen name stays current');
assert.equal(record.healthFg.style.width, '40%', 'offscreen health stays current');
remote.x = 0; bridge._syncRemotes(1 / 60);
assert.equal(record.nameEl.style.display, 'block');
bridge._syncRemotes(1 / 60, false); assert.equal(record.nameEl.style.display, 'none');
bridge._syncRemotes(1 / 60, true); assert.equal(record.nameEl.style.display, 'block');
remote.nameCosmetics.badge = 'badge:kills-1';
remote.nameCosmetics.title = 'title:kills-1';
remote.nameCosmetics.style = 'style:kills-2';
bridge._syncRemotes(1 / 60);
assert(record.nameText.querySelector('.identity-badge'), 'changed badge is rendered');
assert.equal(record.nameText.querySelector('.identity-title').textContent, 'Starfire Spark');
assert(record.nameText.querySelector('.lettering-2'), 'changed lettering is rendered');
remote.nameCosmetics = {};
bridge._syncRemotes(1 / 60);
assert.equal(record.nameText.querySelector('.identity-badge'), null, 'removed cosmetics are not cached forever');

const target = new THREE.Vector3(0, 2, -12);
const boxWorld = { raycastBoxHit: () => ({ distance: 4 }),
  get raycastMeshes() { throw Error('box blocker should skip mesh work'); } };
assert.equal(isNameplateOccluded(boxWorld, camera.position, target, new THREE.Raycaster()), true);
const meshCaster = new THREE.Raycaster();
let scratch;
let blocked = true;
meshCaster.intersectObjects = (_meshes, _recursive, output) => {
  if (scratch) assert.equal(output, scratch, 'mesh-hit scratch array is reused');
  assert.equal(output.length, 0, 'no stale hits from a previous visibility check');
  scratch = output;
  if (blocked) output.push({ distance: 4, object: {} });
  return output;
};
const meshWorld = { raycastMeshes: [{}] };
assert.equal(isNameplateOccluded(meshWorld, camera.position, target, meshCaster), true);
assert.equal(scratch.length, 0, 'finished query releases references to hit map objects');
blocked = false;
assert.equal(isNameplateOccluded(meshWorld, camera.position, target, meshCaster), false);
console.log('UI performance passed: 600 idle HUD/local/remote frames make zero DOM writes; moving plates use one transform write each; 25 unchanged scoreboard polls create zero nodes. Updates, occlusion, map resets and hidden/reopened panels remain correct.');
