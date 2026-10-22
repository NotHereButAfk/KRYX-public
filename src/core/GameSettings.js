const _KEY = 'sio_settings';

export const DEFAULTS = {
  sensitivity: 1.0,   // mouse-look scale multiplier
  volume:      0.5,   // master audio gain  0–1
  fov:         78,    // player camera field-of-view in degrees
  quality:     'medium', // 'low' | 'medium' | 'high'
  invertY:     false, // invert vertical look (mouse + touch)

  // ── accessibility (Phase 8) ──
  reduceMotion:  false,   // damp screen shake / bob / recoil camera / flashes
  reduceFlashes: false,   // cap full-screen flashes (photosensitivity safe)
  crosshairStyle:'cross', // 'cross' | 'dot' | 'circle' — shape, not just colour
  crosshairColor:'white', // ev.io-like neutral default; other accessible colours remain selectable
  colorblind:    'none',  // 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
  hudScale:      1.0,     // 0.8–1.4 — scales the whole HUD
  highContrast:  false,   // stronger panel/text contrast + outlines
  hitSound:      true,    // audio confirmation on hit (not just the visual mark)
};

// Crosshair colour tokens (contrast-safe on both bright + dark maps).
export const CROSSHAIR_COLORS = {
  cyan: '#33e0ff', green: '#54ff8a', white: '#ffffff',
  magenta: '#ff4dd2', yellow: '#ffe23a',
};

const RANGES = { sensitivity: [.3, 3], volume: [0, 1], fov: [60, 110], hudScale: [.8, 1.4] };
const CHOICES = {
  quality: ['low', 'medium', 'high'], crosshairStyle: ['cross', 'dot', 'circle'],
  crosshairColor: Object.keys(CROSSHAIR_COLORS),
  colorblind: ['none', 'protanopia', 'deuteranopia', 'tritanopia'],
};
function normalize(key, value) {
  if (RANGES[key]) return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(RANGES[key][0], Math.min(RANGES[key][1], value)) : DEFAULTS[key];
  if (CHOICES[key]) return CHOICES[key].includes(value) ? value : DEFAULTS[key];
  return typeof value === 'boolean' ? value : DEFAULTS[key];
}

export const GameSettings = {
  _d: null,

  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(_KEY) || '{}');
      const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      // Cyan was the old implicit default. Migrate it once to the measured
      // neutral reference while preserving every later explicit colour choice.
      if (!saved.playerScreenV2) {
        if (!saved.crosshairColor || saved.crosshairColor === 'cyan') saved.crosshairColor = 'white';
        saved.playerScreenV2 = true;
        localStorage.setItem(_KEY, JSON.stringify(saved));
      }
      this._d = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, normalize(key, saved[key] ?? DEFAULTS[key])]));
    }
    catch { this._d = { ...DEFAULTS }; }
    return this;
  },

  save() {
    try { localStorage.setItem(_KEY, JSON.stringify({ ...this._d, playerScreenV2: true })); return true; }
    catch { return false; }
  },

  snapshot() { if (!this._d) this.load(); return { ...this._d }; },

  get(key)        { if (!this._d) this.load(); return this._d[key] ?? DEFAULTS[key]; },
  set(key, value) { if (!this._d) this.load(); if (!Object.hasOwn(DEFAULTS, key)) return; this._d[key] = normalize(key, value); this.save(); },
};
