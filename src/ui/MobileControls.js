import { mobileIcon } from './MobileIcons.js';

export class MobileControls {
  constructor(input, callbacks = {}) {
    this.input = input;
    this.onMenu = callbacks.onMenu;
    this._touches = new Map();
    this._joyActive = false;
    const captions = {smoke:'SMOKE',menu:'MENU',reload:'RELOAD',aim:'AIM',grenade:'GRENADE',fire:'FIRE',swap:'WEAPON',slide:'CROUCH',timebomb:'BOMB',impulse:'BLAST',jump:'JUMP',ability:'TELEPORT'};
    const button = (role, label) => `<button type="button" class="mbtn mbtn-${role}" data-role="${role}" aria-label="${label}">${mobileIcon(role)}<span>${captions[role]}</span></button>`;
    this._el = document.createElement('div');
    this._el.id = 'mobile-controls';
    this._el.className = 'hidden';
    this._el.innerHTML = `<div id="joy-outer" aria-hidden="true"><div id="joy-inner"></div></div>
      ${button('menu', 'Open menu')}<div id="m-actions">
      ${button('smoke', 'Throw smoke grenade')}${button('reload', 'Reload')}${button('aim', 'Aim down sights')}
      ${button('grenade', 'Throw frag grenade')}${button('fire', 'Fire')}
      ${button('swap', 'Switch weapon')}${button('slide', 'Crouch or slide')}
      ${button('timebomb', 'Plant time bomb (V)')}${button('impulse', 'Knockback blast (E)')}${button('jump', 'Jump / double jump')}${button('ability', 'Use ability')}</div>`;
    document.body.appendChild(this._el);
    this._joyInner = this._el.querySelector('#joy-inner');
    for (const [event, handler] of [['touchstart', '_onStart'], ['touchmove', '_onMove'], ['touchend', '_onEnd'], ['touchcancel', '_onEnd']]) {
      this._el.addEventListener(event, e => this[handler](e), { passive: false });
    }
    this._resize = () => { this._reset(); this._updateJoyCenter(); };
    this._blur = () => this._reset();
    this._visibility = () => { if (document.hidden) this._reset(); };
    window.addEventListener('resize', this._resize);
    window.addEventListener('blur', this._blur);
    document.addEventListener('visibilitychange', this._visibility);
  }

  _updateJoyCenter() {
    const r = this._el.querySelector('#joy-outer').getBoundingClientRect();
    this._joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this._joyRadius = Math.max(24, r.width * .36);
  }

  _roleOf(touch) {
    const button = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-role]');
    if (button && this._el.contains(button)) return button.dataset.role;
    return touch.clientX < window.innerWidth * .44 ? 'joy' : 'look';
  }

  _onStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this._el.classList.contains('hidden')) break;
      let role = this._roleOf(t);
      if (role === 'joy' && this._joyActive) role = 'ignored';
      this._touches.set(t.identifier, { role, lastX: t.clientX, lastY: t.clientY });
      this._el.querySelector(`[data-role="${role}"]`)?.classList.add('pressed');
      const inp = this.input;
      switch (role) {
        case 'joy': this._joyActive = true; this._el.classList.add('moving'); this._updateJoy(t.clientX, t.clientY); break;
        case 'fire': inp.mouseDown = true; inp.justPressed.add('MobileFire'); break;
        case 'aim': inp.rightMouseDown = true; break;
        case 'slide': inp.setVirtualKey('KeyC', true); inp.justPressed.add('KeyC'); break;
        case 'jump': inp.justPressed.add('Space'); break;
        case 'swap': inp.justPressed.add('WeaponNext'); break;
        case 'reload': inp.justPressed.add('KeyR'); break;
        case 'smoke': inp.justPressed.add('KeyG'); break;
        case 'grenade': inp.justPressed.add('KeyU'); break;
        case 'timebomb': inp.justPressed.add('KeyV'); break;
        case 'impulse': inp.justPressed.add('KeyE'); break;
        case 'ability': inp.justPressed.add('KeyQ'); break;
        case 'menu': this.onMenu?.(); break;
      }
    }
  }

  _onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = this._touches.get(t.identifier);
      if (!rec) continue;
      if (rec.role === 'joy') this._updateJoy(t.clientX, t.clientY);
      else if (['look', 'fire', 'aim'].includes(rec.role)) {
        this.input.mouseDX += (t.clientX - rec.lastX) * 4;
        this.input.mouseDY += (t.clientY - rec.lastY) * 4;
      }
      rec.lastX = t.clientX; rec.lastY = t.clientY;
    }
  }

  _onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = this._touches.get(t.identifier);
      if (!rec) continue;
      this._touches.delete(t.identifier);
      if (e.type === 'touchcancel' && rec.role === 'fire') this.input.justPressed.delete('MobileFire');
      if ([...this._touches.values()].some(other => other.role === rec.role)) continue;
      if (rec.role === 'joy') this._releaseJoy();
      if (rec.role === 'fire') this.input.mouseDown = false;
      if (rec.role === 'aim') this.input.rightMouseDown = false;
      if (rec.role === 'slide') this.input.setVirtualKey('KeyC', false);
      this._el.querySelector(`[data-role="${rec.role}"]`)?.classList.remove('pressed');
    }
  }

  _updateJoy(cx, cy) {
    let dx = cx - this._joyCenter.x, dy = cy - this._joyCenter.y;
    const radius = this._joyRadius, dist = Math.hypot(dx, dy), dead = radius * .13;
    if (dist > radius) { dx *= radius / dist; dy *= radius / dist; }
    this._joyInner.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    for (const [key, pressed] of [['KeyW', -dy > dead], ['KeyS', dy > dead], ['KeyA', -dx > dead], ['KeyD', dx > dead], ['ShiftLeft', -dy > radius * .5 && Math.abs(dx) < radius * .75]]) this.input.setVirtualKey(key, pressed);
  }

  _releaseJoy() {
    this._joyActive = false;
    this._el.classList.remove('moving');
    this._joyInner.style.transform = 'translate(-50%, -50%)';
    for (const key of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']) this.input.setVirtualKey(key, false);
  }

  _reset() {
    this._releaseJoy();
    this.input.setVirtualKey('KeyC', false);
    this.input.mouseDown = this.input.rightMouseDown = false;
    for (const key of ['MobileFire', 'WeaponNext', 'Space', 'KeyQ', 'KeyR', 'KeyU', 'KeyG', 'KeyV', 'KeyE', 'KeyC']) this.input.justPressed.delete(key);
    this._touches.clear();
    this._el.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
  }
  show() { this._el.classList.remove('hidden'); this._updateJoyCenter(); }
  hide() { this._reset(); this._el.classList.add('hidden'); }
  dispose() {
    this.hide();
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('blur', this._blur);
    document.removeEventListener('visibilitychange', this._visibility);
    this._el.remove();
  }
}
