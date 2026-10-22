// Pointer lock is a progressive enhancement. Embedded browsers, automation
// surfaces, cross-document canvas moves, or browser policy can reject it even
// after a real click. Consume both synchronous DOMExceptions and asynchronous
// promise rejections so the game remains playable through keyboard/UI fallback
// without producing an unhandled first-party console error.
export function requestPointerLockSafely(domElement, onError = () => {}) {
  if (!domElement?.requestPointerLock) return false;
  const fallback = () => {
    try { domElement.requestPointerLock()?.catch?.(onError); }
    catch { onError(); }
  };
  const rejected = error => {
    if (error?.name === 'NotSupportedError') fallback();
    else onError();
  };
  try {
    const pending = domElement.requestPointerLock({ unadjustedMovement: true });
    pending?.catch?.(rejected);
    return true;
  } catch (error) {
    if (error?.name === 'NotSupportedError') { fallback(); return true; }
    onError();
    return false;
  }
}

export class InputManager {
  constructor(domElement) {
    this.domElement = domElement;
    this.keys = new Set();
    this.mouseDown = false;
    this.rightMouseDown = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.pointerLocked = false;
    this.justPressed = new Set();

    // Only treat as mobile if it's a phone/tablet — NOT a touchscreen laptop.
    // Touch-capable laptops still have a mouse/trackpad (a "fine" pointer), so
    // requiring "coarse pointer AND no fine pointer" (or a mobile UA) keeps the
    // desktop experience (pointer lock + no on-screen controls) on those.
    const ua       = navigator.userAgent || '';
    const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(ua);
    const hasFine  = window.matchMedia?.('(any-pointer: fine)').matches ?? true;   // a mouse/trackpad exists
    const coarse   = window.matchMedia?.('(pointer: coarse)').matches ?? false;     // primary pointer is touch
    this.isMobile  = mobileUA || (coarse && !hasFine);
    this._virtualKeys = new Set();

    this._onKeyDown = (e) => {
      if (e.code === 'Escape' && !e.repeat) this.onEscape?.();
      // Tab is the in-game scoreboard — stop it from cycling focus / leaving the page.
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      if (Number.isFinite(e.movementX)) this.mouseDX += e.movementX;
      if (Number.isFinite(e.movementY)) this.mouseDY += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightMouseDown = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightMouseDown = false;
    };
    this._onWheel = (e) => {
      this.wheelDelta += Math.sign(e.deltaY);
    };
    this.onLockChange = null; // (locked: boolean) => void
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      this.mouseDX = this.mouseDY = 0;
      if (!this.pointerLocked) {
        this.mouseDown = false;
        this.rightMouseDown = false;
        this.keys.clear();
        this.justPressed.clear();
        this.mouseDX = this.mouseDY = 0;
      }
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._onBlur = () => {
      this.mouseDX = this.mouseDY = this.wheelDelta = 0;
      this.mouseDown = this.rightMouseDown = false;
      this.keys.clear(); this.justPressed.clear(); this._virtualKeys.clear();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  isDown(code) {
    return this.keys.has(code) || this._virtualKeys.has(code);
  }

  consumeJustPressed(code) {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  /**
   * Set a virtual key state from touch controls.
   * Also fires a justPressed event on the leading edge so consumeJustPressed works.
   */
  setVirtualKey(code, pressed) {
    if (pressed) {
      if (!this._virtualKeys.has(code) && !this.keys.has(code)) {
        this.justPressed.add(code);
      }
      this._virtualKeys.add(code);
    } else {
      this._virtualKeys.delete(code);
    }
  }

  requestPointerLock() {
    if (this.isMobile) return false;
    if (document.pointerLockElement === this.domElement) return true;
    return requestPointerLockSafely(this.domElement, () => this.onLockError?.());
  }

  exitPointerLock() {
    if (this.isMobile) return;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Call once per frame after consuming deltas. */
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.justPressed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
  }
}
