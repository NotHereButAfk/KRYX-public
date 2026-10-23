import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real HUD methods without a renderer, browser or network. The
// import-only presentation dependencies are irrelevant to ability state.
const source = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
let domQueries = 0;
let writes = 0;
class Element {
  constructor(className = '') {
    this.className = className;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this._text = '';
    this._style = new Map();
    this.style = {
      getPropertyValue: name => this._style.get(name) || '',
      setProperty: (name, value) => { this._style.set(name, value); writes++; },
    };
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) { this.className += ` ${name}`; writes++; } },
      remove: name => { if (this.classList.contains(name)) { this.className = this.className.split(' ').filter(c => c !== name).join(' '); writes++; } },
      toggle: (name, active) => active ? this.classList.add(name) : this.classList.remove(name),
    };
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); writes++; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  setAttribute(key, value) { this.attributes.set(key, value); writes++; }
  getAttribute(key) { return this.attributes.get(key); }
  querySelector(selector) {
    domQueries++;
    const names = selector.split(',').map(value => value.trim().slice(1));
    return this.children.find(child => names.some(name => child.classList.contains(name))) || null;
  }
  closest(selector) {
    domQueries++;
    return this.classList.contains(selector.slice(1)) ? this : this.parentElement?.closest(selector) || null;
  }
}
const elements = new Map();
const root = new Element();
elements.set('hud', root);
root.appendChild(new Element('hud-vitals'));
const tiles = {};
for (const [kind, key] of [['smoke', 'G'], ['frag', 'U'], ['timebomb', 'V'], ['impulse', 'E']]) {
  const tile = new Element('grenade-slot');
  const counter = tile.appendChild(new Element());
  const keyLabel = tile.appendChild(new Element('grenade-label'));
  keyLabel.textContent = key;
  elements.set(`${kind}-count`, counter);
  tiles[kind] = tile;
  root.appendChild(tile);
}
const teleport = new Element('ability-indicator');
const teleportKey = teleport.appendChild(new Element('ability-key'));
teleportKey.textContent = 'Q';
teleport.appendChild(new Element('ability-name'));
elements.set('ability-q', teleport);
root.appendChild(teleport);
const context = vm.createContext({
  document: {
    getElementById: id => { domQueries++; return elements.get(id) || null; },
    createElement: () => new Element(),
    addEventListener() {},
  },
});
vm.runInContext(source.slice(source.indexOf('function setText')).replace('export class HUD', 'class HUD') + '\nglobalThis.HUD = HUD;', context);
const hud = new context.HUD();
const caption = tile => tile.children.find(child => child.classList.contains('ability-caption'));
const timer = tile => tile.children.find(child => child.classList.contains('ability-countdown'));
assert.equal(caption(teleport).textContent, 'TELEPORT');
assert.equal(caption(tiles.smoke).textContent, 'SMOKE');
assert.equal(caption(tiles.impulse).textContent, 'BLAST');

const queryCount = domQueries;
const cooldowns = { frag: 12.1, smoke: 0, timebomb: 5, impulse: 0 };
const charges = { timebomb: 0, impulse: 1 };
hud.updateGrenades(1, 2, cooldowns, charges);
hud.updateTeleport(.2, 12);
assert.equal(timer(tiles.frag).textContent, '13s', 'partial cooldowns round up, never claim ready early');
assert.equal(tiles.frag.dataset.abilityState, 'cooldown', 'a spare charge cannot hide a server cooldown');
assert.equal(tiles.smoke.dataset.abilityState, 'ready');
assert.match(tiles.smoke.getAttribute('aria-label'), /Smoke grenade, G, 2 charges, ready/);
assert.equal(elements.get('timebomb-count').textContent, '0', 'show authoritative bomb charges');
assert.equal(timer(tiles.timebomb).textContent, '5s');
assert.equal(teleport.dataset.abilityState, 'cooldown');
assert.equal(timer(teleport).textContent, '12s');

const stableWrites = writes;
for (let i = 0; i < 120; i++) {
  hud.updateGrenades(1, 2, cooldowns, charges);
  hud.updateTeleport(.2, 12);
}
assert.equal(writes, stableWrites, 'steady state must not rewrite DOM or styles each frame');
assert.equal(domQueries, queryCount, 'per-frame updates only use cached nodes');

hud.updateTeleport(1, 0);
hud.setAbilityTargeting(true);
assert.equal(teleport.dataset.abilityState, 'targeting');
assert.match(teleport.getAttribute('aria-label'), /click to teleport/);
hud.setAbilityTargeting(true, false);
assert.equal(teleport.dataset.abilityState, 'blocked');
assert.match(teleport.getAttribute('aria-label'), /destination blocked/);
hud.setAbilityTargeting(false);
assert.equal(teleport.dataset.abilityState, 'ready');
hud.updateTeleport(0, 15);
assert.equal(teleport.dataset.abilityState, 'cooldown', 'confirm switches immediately from aiming to cooldown');
assert.equal(timer(teleport).textContent, '15s');
hud.updateTeleport(1);
assert.equal(teleport.dataset.abilityState, 'ready', 'ratio-only callers remain supported');
assert.equal(timer(teleport).textContent, '');

hud.updateGrenades(0, 2, {}, { timebomb: 1, impulse: 1 });
assert.equal(tiles.frag.dataset.abilityState, 'empty');
assert.match(tiles.frag.getAttribute('aria-label'), /0 charges, no charges/);
hud.updateGrenades(2, 2, {}, { timebomb: 1, impulse: 1 });
assert.equal(tiles.frag.dataset.abilityState, 'ready');
assert.equal(timer(tiles.frag).textContent, '');
assert.equal(domQueries, queryCount, 'state transitions also avoid DOM queries');
console.log('Ability HUD passed: names/bindings, authoritative charges, cooldown seconds, targeting/blocked/cancel, and no steady-state DOM churn.');
