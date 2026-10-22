import { themedWrap } from './ThemedWraps.js';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural canvas-based PBR + decal textures.
//
// Everything here is generated once and cached, so there are no external image
// assets to ship. Normal / roughness maps give every gun a tactile, hyper-real
// surface (brushed metal, pebbled polymer). Decal patterns are *seamless tiles*
// — because each gun is built from dozens of small primitives whose UVs are
// each 0..1, a tileable pattern reads correctly on every part.
// ---------------------------------------------------------------------------

const _cache = new Map();
function cached(key, make) {
  if (_cache.has(key)) return _cache.get(key);
  const tex = make();
  _cache.set(key, tex);
  return tex;
}

function makeCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finalize(canvas, { color = false, repeat = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ── PBR surface maps (shared by every weapon) ──────────────────────────────

// Brushed-metal normal map: fine horizontal scratches perturbing the surface.
export function metalNormalMap() {
  return cached('metalNormal', () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,255)'; // neutral normal
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * size;
      const len = 20 + Math.random() * 120;
      const x = Math.random() * size;
      const shade = 128 + (Math.random() - 0.5) * 70;
      ctx.strokeStyle = `rgb(${shade|0},${shade|0},255)`;
      ctx.globalAlpha = 0.18 + Math.random() * 0.22;
      ctx.lineWidth = Math.random() < 0.85 ? 1 : 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + (Math.random() - 0.5) * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return finalize(c, { repeat: 2 });
  });
}

// Roughness variation: subtle blotches + brush streaks so reflections shimmer.
export function metalRoughnessMap() {
  return cached('metalRough', () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(120,120,120)';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1600; i++) {
      const v = 90 + Math.random() * 110;
      ctx.fillStyle = `rgb(${v|0},${v|0},${v|0})`;
      ctx.globalAlpha = 0.25;
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillRect(x, y, 1 + Math.random() * 3, 1);
    }
    // wear patches (smoother / shinier)
    for (let i = 0; i < 18; i++) {
      const r = 8 + Math.random() * 26;
      const g = ctx.createRadialGradient(
        Math.random() * size, Math.random() * size, 0,
        Math.random() * size, Math.random() * size, r);
      g.addColorStop(0, 'rgba(60,60,60,0.5)');
      g.addColorStop(1, 'rgba(60,60,60,0)');
      ctx.fillStyle = g;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.globalAlpha = 1;
    return finalize(c, { repeat: 2 });
  });
}

// Pebbled polymer normal map for body/grip parts (fine stippled grain).
export function polymerNormalMap() {
  return cached('polymerNormal', () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5000; i++) {
      const shade = 128 + (Math.random() - 0.5) * 60;
      ctx.fillStyle = `rgb(${shade|0},${shade|0},255)`;
      ctx.globalAlpha = 0.4;
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
    return finalize(c, { repeat: 3 });
  });
}

// ── Themed decal patterns (seamless color tiles) ───────────────────────────

// FIRE — embers + flame tongues, used as both color map and emissive map.
function fireDecal() {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  // dark charred base
  ctx.fillStyle = '#0a0402';
  ctx.fillRect(0, 0, size, size);
  // rising flame tongues (drawn wrapped for tiling)
  const drawFlame = (x, baseY, h, w) => {
    const g = ctx.createLinearGradient(0, baseY, 0, baseY - h);
    g.addColorStop(0, '#fff2a0');
    g.addColorStop(0.35, '#ff8c1a');
    g.addColorStop(0.7, '#e02200');
    g.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, baseY);
    ctx.quadraticCurveTo(x - w * 0.3, baseY - h * 0.6, x, baseY - h);
    ctx.quadraticCurveTo(x + w * 0.3, baseY - h * 0.6, x + w, baseY);
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const h = 60 + Math.random() * 150;
    const w = 14 + Math.random() * 26;
    // draw at x and wrapped copies so the tile is seamless horizontally
    [x, x - size, x + size].forEach((xx) => drawFlame(xx, size + 10, h, w));
  }
  // embers
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#ffcc55' : '#ff5511';
    ctx.globalAlpha = 0.5 + Math.random() * 0.5;
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  ctx.globalAlpha = 1;
  return c;
}

// ANIME — kawaii pastel pattern: sakura petals, stars, hearts on pink.
function animeDecal() {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  // pastel gradient base
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#ff9ed6');
  bg.addColorStop(0.5, '#c79bff');
  bg.addColorStop(1, '#9ce0ff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const star = (x, y, r, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a2) * r * 0.45, y + Math.sin(a2) * r * 0.45);
    }
    ctx.closePath();
    ctx.fill();
  };
  const heart = (x, y, s, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s, y, x - s, y + s * 0.4);
    ctx.bezierCurveTo(x - s, y + s * 0.8, x, y + s, x, y + s * 1.2);
    ctx.bezierCurveTo(x, y + s, x + s, y + s * 0.8, x + s, y + s * 0.4);
    ctx.bezierCurveTo(x + s, y, x, y, x, y + s * 0.3);
    ctx.fill();
  };
  const petal = (x, y, r, col) => {
    ctx.fillStyle = col;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7,
        r * 0.5, r * 0.28, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe680';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  };

  for (let i = 0; i < 7; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 10 + Math.random() * 10;
    const k = Math.random();
    if (k < 0.4) petal(x, y, r, 'rgba(255,255,255,0.92)');
    else if (k < 0.7) star(x, y, r, 'rgba(255,255,160,0.95)');
    else heart(x, y, r, 'rgba(255,120,170,0.95)');
  }
  // sparkle dots
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillRect(x, y, 2, 2);
  }
  return c;
}

// ── Async image loader for the Sakura Waifu skin ──────────────────────────
// Tries to load real images to replace the procedural fallback:
//   Option A: textures/sakura/wrap.png — a single full sticker-bomb texture
//   Option B: textures/sakura/sticker_1.png … sticker_8.png — individual stickers
//             composited over the pastel gradient
// If nothing loads (404s), the procedural canvas stays as-is.
function _loadSakuraImages(canvas, ctx, size) {
  const base = import.meta.env?.BASE_URL || './';
  const wrapUrl = `${base}textures/sakura/wrap.png`;

  const tryWrap = new Image();
  tryWrap.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(tryWrap, 0, 0, size, size);
    const tex = _cache.get('decal_animegirl');
    if (tex) tex.needsUpdate = true;
  };
  tryWrap.onerror = () => {
    // No wrap.png — try individual sticker files
    const stickers = [];
    let pending = 0;
    for (let i = 1; i <= 8; i++) {
      const img = new Image();
      pending++;
      img.onload = () => { stickers.push(img); if (--pending === 0) _compositeStickers(canvas, ctx, size, stickers); };
      img.onerror = () => { if (--pending === 0 && stickers.length) _compositeStickers(canvas, ctx, size, stickers); };
      img.src = `${base}textures/sakura/sticker_${i}.png`;
    }
  };
  tryWrap.src = wrapUrl;
}

function _compositeStickers(canvas, ctx, size, stickers) {
  // Redraw gradient base
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0.0,  '#ff6eb4');
  bg.addColorStop(0.18, '#ff9a5c');
  bg.addColorStop(0.35, '#ffe14d');
  bg.addColorStop(0.52, '#8aff7a');
  bg.addColorStop(0.68, '#5ccfff');
  bg.addColorStop(0.85, '#b56aff');
  bg.addColorStop(1.0,  '#ff6eb4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Place stickers in a dense overlapping layout
  const positions = [
    [0.15, 0.15, 0.35], [0.65, 0.12, 0.32], [0.35, 0.4, 0.38],
    [0.8, 0.45, 0.3],   [0.1, 0.6, 0.33],   [0.55, 0.7, 0.35],
    [0.85, 0.8, 0.28],  [0.3, 0.85, 0.3],
  ];
  for (let i = 0; i < stickers.length; i++) {
    const [fx, fy, fs] = positions[i % positions.length];
    const img = stickers[i];
    const w = size * fs;
    const h = w * (img.height / img.width);
    const x = size * fx - w / 2;
    const y = size * fy - h / 2;
    ctx.save();
    ctx.translate(x + w/2, y + h/2);
    ctx.rotate((Math.random() - 0.5) * 0.3);
    ctx.drawImage(img, -w/2, -h/2, w, h);
    ctx.restore();
  }
  const tex = _cache.get('decal_animegirl');
  if (tex) tex.needsUpdate = true;
}

// ANIME GIRL — dense neko cat-girl sticker bomb. Every girl is a cat-girl with
// whiskers, varied expressions (wink, tongue, peace-sign), maneki-neko mascots,
// fish stickers, bells, paw prints — maximum kawaii Japanese cat-girl energy.
function animeGirlDecal() {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');

  _loadSakuraImages(c, ctx, size);

  // ── pink-dominant candy base ──
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0.0, '#ffb0d8'); bg.addColorStop(0.2, '#ffc8e8');
  bg.addColorStop(0.4, '#e0c0ff'); bg.addColorStop(0.6, '#b0d8ff');
  bg.addColorStop(0.8, '#ffc0e0'); bg.addColorStop(1.0, '#ffe0f0');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
  for (const [col, x, y] of [['#ff60b0',90,70],['#c060ff',400,100],['#60c0ff',150,380],['#ff80c0',380,400],['#ffa0d0',256,240]]) {
    const g = ctx.createRadialGradient(x, y, 4, x, y, 130);
    g.addColorStop(0, col + 'aa'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 130, 0, Math.PI * 2); ctx.fill();
  }

  // ── subtle diagonal stripe pattern ──
  ctx.save(); ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  for (let i = -size; i < size * 2; i += 18) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
  }
  ctx.restore();

  // ── reusable shapes ──
  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath(); ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  };
  const heart = (x, y, s, col) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y+s*0.3);
    ctx.bezierCurveTo(x,y,x-s,y,x-s,y+s*0.4); ctx.bezierCurveTo(x-s,y+s*0.8,x,y+s,x,y+s*1.2);
    ctx.bezierCurveTo(x,y+s,x+s,y+s*0.8,x+s,y+s*0.4); ctx.bezierCurveTo(x+s,y,x,y,x,y+s*0.3); ctx.fill();
  };
  const star5 = (x, y, r, col) => {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a=(i/5)*Math.PI*2-Math.PI/2,a2=a+Math.PI/5; ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r); ctx.lineTo(x+Math.cos(a2)*r*0.45,y+Math.sin(a2)*r*0.45); }
    ctx.closePath(); ctx.fill();
  };
  const star4 = (x, y, r, col) => {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a=(i/4)*Math.PI*2-Math.PI/4,a2=a+Math.PI/4; ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r); ctx.lineTo(x+Math.cos(a2)*r*0.28,y+Math.sin(a2)*r*0.28); }
    ctx.closePath(); ctx.fill();
  };
  const sakura = (x, y, r, col) => {
    ctx.fillStyle = col;
    for (let i = 0; i < 5; i++) { const a=(i/5)*Math.PI*2; ctx.beginPath(); ctx.ellipse(x+Math.cos(a)*r*0.7,y+Math.sin(a)*r*0.7,r*0.5,r*0.3,a,0,Math.PI*2); ctx.fill(); }
    ctx.fillStyle = '#ffe680'; ctx.beginPath(); ctx.arc(x,y,r*0.22,0,Math.PI*2); ctx.fill();
  };
  const bow = (x, y, s, col) => {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x-s*0.6,y,s*0.6,s*0.35,-0.3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+s*0.6,y,s*0.6,s*0.35,0.3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,s*0.22,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x-s*0.06,y-s*0.06,s*0.08,0,Math.PI*2); ctx.fill();
  };
  const pawPrint = (x, y, s, col) => {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x,y+s*0.2,s*0.4,s*0.3,0,0,Math.PI*2); ctx.fill();
    for (const [dx,dy] of [[-s*0.32,-s*0.15],[s*0.32,-s*0.15],[-s*0.14,-s*0.4],[s*0.14,-s*0.4]]) { ctx.beginPath(); ctx.arc(x+dx,y+dy,s*0.15,0,Math.PI*2); ctx.fill(); }
  };

  // Maneki-neko (beckoning cat) mascot
  const manekiNeko = (x, y, s) => {
    ctx.save(); ctx.translate(x, y);
    // body
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d06090'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, s*0.15, s*0.55, s*0.6, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // head
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, -s*0.35, s*0.45, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // ears
    for (const sx of [-1,1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath();
      ctx.moveTo(sx*s*0.3,-s*0.55); ctx.lineTo(sx*s*0.2,-s*0.85); ctx.lineTo(sx*s*0.48,-s*0.6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffb0c0'; ctx.beginPath();
      ctx.moveTo(sx*s*0.3,-s*0.58); ctx.lineTo(sx*s*0.24,-s*0.76); ctx.lineTo(sx*s*0.42,-s*0.6);
      ctx.closePath(); ctx.fill();
    }
    // raised paw
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.ellipse(s*0.42, -s*0.1, s*0.14, s*0.22, -0.2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // eyes (happy closed)
    ctx.strokeStyle = '#2a1830'; ctx.lineWidth = s*0.06; ctx.lineCap = 'round';
    for (const sx of [-1,1]) { ctx.beginPath(); ctx.arc(sx*s*0.18,-s*0.35,s*0.1,Math.PI*0.15,Math.PI*0.85); ctx.stroke(); }
    // blush
    ctx.fillStyle = 'rgba(255,130,160,0.6)';
    ctx.beginPath(); ctx.ellipse(-s*0.3,-s*0.22,s*0.08,s*0.04,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s*0.3,-s*0.22,s*0.08,s*0.04,0,0,Math.PI*2); ctx.fill();
    // nose + mouth
    ctx.fillStyle = '#ff7090'; ctx.beginPath(); ctx.arc(0,-s*0.28,s*0.04,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#c05070'; ctx.lineWidth = s*0.03;
    ctx.beginPath(); ctx.moveTo(-s*0.06,-s*0.22); ctx.lineTo(0,-s*0.18); ctx.lineTo(s*0.06,-s*0.22); ctx.stroke();
    // collar + bell
    ctx.strokeStyle = '#ff3060'; ctx.lineWidth = s*0.06;
    ctx.beginPath(); ctx.arc(0,-s*0.05,s*0.35,Math.PI*0.2,Math.PI*0.8); ctx.stroke();
    ctx.fillStyle = '#ffd700'; ctx.beginPath(); ctx.arc(0,s*0.2,s*0.1,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#c0a000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0,s*0.2,s*0.1,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#c0a000'; ctx.fillRect(-s*0.015,s*0.2,s*0.03,s*0.08);
    // koban coin
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.ellipse(s*0.42,-s*0.32,s*0.1,s*0.07,0.3,0,Math.PI*2); ctx.fill();
    ctx.restore();
  };

  // Cute fish sticker
  const fishSticker = (x, y, s, col) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate((Math.random()-0.5)*0.4);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0,0,s*0.7,s*0.35,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s*0.55,0); ctx.lineTo(s*0.9,-s*0.3); ctx.lineTo(s*0.9,s*0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a0a20'; ctx.beginPath(); ctx.arc(-s*0.25,-s*0.05,s*0.08,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-s*0.27,-s*0.08,s*0.035,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-s*0.15,s*0.08,s*0.06,Math.PI*0.1,Math.PI*0.9); ctx.stroke();
    ctx.restore();
  };

  // Cat-girl neko sticker — realistic anime style with face shading, detailed
  // eyes, hair gradients, neck/shoulders, and proper skin tone transitions.
  // expr: 0=normal, 1=wink, 2=tongue out, 3=>_< happy squint
  const catGirl = (x, y, s, hair, hairDark, eye, eyeDark, hairHL, shape, acc, expr) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random()-0.5)*0.15);

    // sticker background
    ctx.shadowColor = 'rgba(60,0,30,0.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    if (shape === 1) { ctx.beginPath(); ctx.arc(0,0,s*1.1,0,Math.PI*2); ctx.fill(); }
    else { roundRect(-s*1.05,-s*1.05,s*2.1,s*2.1,s*0.25); ctx.fill(); }
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = hair; ctx.lineWidth = 2.5;
    if (shape === 1) { ctx.beginPath(); ctx.arc(0,0,s*1.1,0,Math.PI*2); ctx.stroke(); }
    else { roundRect(-s*1.05,-s*1.05,s*2.1,s*2.1,s*0.25); ctx.stroke(); }

    // inner warm fill
    const cg = ctx.createRadialGradient(0,-s*0.2,2,0,s*0.1,s*1.1);
    cg.addColorStop(0,'#fff8fc'); cg.addColorStop(1,'#ffe4f0');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0,0,s*0.98,0,Math.PI*2); ctx.fill();

    const fy = -s*0.02;

    // ── neck + shoulders (visible bust-up) ──
    ctx.fillStyle = '#ffdcc8';
    ctx.beginPath(); ctx.moveTo(-s*0.14,fy+s*0.5); ctx.lineTo(-s*0.1,fy+s*0.7);
    ctx.quadraticCurveTo(-s*0.5,fy+s*0.72,-s*0.7,fy+s*0.85);
    ctx.lineTo(s*0.7,fy+s*0.85);
    ctx.quadraticCurveTo(s*0.5,fy+s*0.72,s*0.1,fy+s*0.7);
    ctx.lineTo(s*0.14,fy+s*0.5); ctx.closePath(); ctx.fill();
    // neck shadow
    const neckSh = ctx.createLinearGradient(0,fy+s*0.5,0,fy+s*0.65);
    neckSh.addColorStop(0,'rgba(200,140,120,0.25)'); neckSh.addColorStop(1,'rgba(200,140,120,0)');
    ctx.fillStyle = neckSh;
    ctx.beginPath(); ctx.moveTo(-s*0.14,fy+s*0.5); ctx.lineTo(-s*0.1,fy+s*0.65);
    ctx.lineTo(s*0.1,fy+s*0.65); ctx.lineTo(s*0.14,fy+s*0.5); ctx.closePath(); ctx.fill();
    // collar / top edge
    ctx.strokeStyle = hair; ctx.lineWidth = s*0.04; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-s*0.55,fy+s*0.82);
    ctx.quadraticCurveTo(-s*0.3,fy+s*0.68,0,fy+s*0.72);
    ctx.quadraticCurveTo(s*0.3,fy+s*0.68,s*0.55,fy+s*0.82); ctx.stroke();

    // ── cat ears ──
    for (const sx of [-1,1]) {
      // outer ear with gradient
      const earG = ctx.createLinearGradient(sx*s*0.3,-s*0.95,sx*s*0.5,-s*0.5);
      earG.addColorStop(0,hair); earG.addColorStop(1,hairDark);
      ctx.fillStyle = earG;
      ctx.beginPath(); ctx.moveTo(sx*s*0.44,-s*0.44); ctx.lineTo(sx*s*0.2,-s*0.95); ctx.lineTo(sx*s*0.74,-s*0.6); ctx.closePath(); ctx.fill();
      // inner ear
      ctx.fillStyle = '#ffb0c8';
      ctx.beginPath(); ctx.moveTo(sx*s*0.42,-s*0.48); ctx.lineTo(sx*s*0.26,-s*0.82); ctx.lineTo(sx*s*0.62,-s*0.58); ctx.closePath(); ctx.fill();
      // inner ear highlight
      ctx.fillStyle = 'rgba(255,200,220,0.5)';
      ctx.beginPath(); ctx.moveTo(sx*s*0.4,-s*0.52); ctx.lineTo(sx*s*0.3,-s*0.72); ctx.lineTo(sx*s*0.5,-s*0.56); ctx.closePath(); ctx.fill();
    }

    // ── back hair with gradient shading ──
    const hairG = ctx.createLinearGradient(0,fy-s*0.6,0,fy+s*0.5);
    hairG.addColorStop(0,hair); hairG.addColorStop(0.5,hairDark); hairG.addColorStop(1,hair);
    ctx.fillStyle = hairG;
    ctx.beginPath(); ctx.arc(0,fy-s*0.06,s*0.74,Math.PI,0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0,fy+s*0.2,s*0.74,s*0.6,0,0,Math.PI*2); ctx.fill();
    // flowing side locks with taper
    for (const sx of [-1,1]) {
      ctx.fillStyle = hairG;
      ctx.beginPath();
      ctx.moveTo(sx*s*0.52,fy-s*0.2);
      ctx.quadraticCurveTo(sx*s*0.85,fy+s*0.05,sx*s*0.78,fy+s*0.5);
      ctx.quadraticCurveTo(sx*s*0.72,fy+s*0.7,sx*s*0.58,fy+s*0.55);
      ctx.quadraticCurveTo(sx*s*0.62,fy+s*0.1,sx*s*0.52,fy-s*0.2);
      ctx.closePath(); ctx.fill();
    }
    // side-lock shine (stays low on the outer hair, away from the face)
    ctx.strokeStyle = hairHL; ctx.lineCap = 'round'; ctx.globalAlpha = 0.4;
    ctx.lineWidth = s*0.022;
    ctx.beginPath(); ctx.moveTo(-s*0.6,fy); ctx.quadraticCurveTo(-s*0.64,fy+s*0.2,-s*0.58,fy+s*0.42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.6,fy); ctx.quadraticCurveTo(s*0.64,fy+s*0.2,s*0.58,fy+s*0.42); ctx.stroke();
    // glossy shine band across the crown (above the forehead)
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = s*0.055;
    ctx.beginPath(); ctx.moveTo(-s*0.42,fy-s*0.32); ctx.quadraticCurveTo(0,fy-s*0.5,s*0.42,fy-s*0.32); ctx.stroke();
    // short crown strands
    ctx.globalAlpha = 0.35; ctx.lineWidth = s*0.025;
    for (const hx of [-0.28,-0.08,0.14,0.32]) {
      ctx.beginPath(); ctx.moveTo(hx*s,fy-s*0.5); ctx.quadraticCurveTo((hx+0.03)*s,fy-s*0.42,(hx+0.01)*s,fy-s*0.3); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ── face with skin tone gradient ──
    const skinG = ctx.createRadialGradient(-s*0.05,fy-s*0.1,s*0.1,0,fy+s*0.15,s*0.5);
    skinG.addColorStop(0,'#ffe8d8'); skinG.addColorStop(0.6,'#ffdcc8'); skinG.addColorStop(1,'#f0c8b0');
    ctx.fillStyle = skinG;
    ctx.beginPath(); ctx.ellipse(0,fy+s*0.06,s*0.47,s*0.48,0,0,Math.PI*2); ctx.fill();
    // chin shadow
    const chinSh = ctx.createRadialGradient(0,fy+s*0.42,s*0.05,0,fy+s*0.42,s*0.25);
    chinSh.addColorStop(0,'rgba(190,130,110,0.2)'); chinSh.addColorStop(1,'rgba(190,130,110,0)');
    ctx.fillStyle = chinSh; ctx.beginPath(); ctx.ellipse(0,fy+s*0.42,s*0.3,s*0.15,0,0,Math.PI*2); ctx.fill();
    // forehead shadow from bangs
    const bangSh = ctx.createLinearGradient(0,fy-s*0.1,0,fy+s*0.1);
    bangSh.addColorStop(0,'rgba(160,100,80,0.18)'); bangSh.addColorStop(1,'rgba(160,100,80,0)');
    ctx.fillStyle = bangSh; ctx.fillRect(-s*0.4,fy-s*0.08,s*0.8,s*0.18);

    // ── bangs (chunky manga) ──
    ctx.fillStyle = hairG; ctx.beginPath();
    ctx.moveTo(-s*0.5,fy-s*0.02);
    ctx.quadraticCurveTo(-s*0.42,fy-s*0.56,-s*0.1,fy-s*0.6);
    ctx.quadraticCurveTo(-s*0.04,fy-s*0.24,s*0.04,fy-s*0.6);
    ctx.quadraticCurveTo(s*0.42,fy-s*0.56,s*0.5,fy-s*0.02);
    ctx.quadraticCurveTo(s*0.34,fy-s*0.18,s*0.24,fy+s*0.06);
    ctx.quadraticCurveTo(s*0.15,fy-s*0.22,s*0.05,fy);
    ctx.quadraticCurveTo(0,fy-s*0.26,-s*0.05,fy);
    ctx.quadraticCurveTo(-s*0.15,fy-s*0.22,-s*0.24,fy+s*0.06);
    ctx.quadraticCurveTo(-s*0.34,fy-s*0.18,-s*0.5,fy-s*0.02);
    ctx.closePath(); ctx.fill();
    // bang highlights — short shine near the hairline only (above the eyes)
    ctx.strokeStyle = hairHL; ctx.lineWidth = s*0.022; ctx.globalAlpha = 0.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-s*0.24,fy-s*0.46); ctx.quadraticCurveTo(-s*0.2,fy-s*0.34,-s*0.24,fy-s*0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.16,fy-s*0.48); ctx.quadraticCurveTo(s*0.13,fy-s*0.36,s*0.16,fy-s*0.24); ctx.stroke();
    ctx.globalAlpha = 1;

    // ── EYES ──
    for (const sx of [-1,1]) {
      const ex = sx*s*0.2, ey = fy+s*0.08;
      const isWink = (expr === 1 && sx === 1);
      const isSquint = (expr === 3);

      if (isWink) {
        ctx.strokeStyle = '#1a0a20'; ctx.lineWidth = s*0.045; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(ex,ey,s*0.1,Math.PI*0.1,Math.PI*0.9); ctx.stroke();
        ctx.lineWidth = s*0.025;
        ctx.beginPath(); ctx.moveTo(ex+s*0.1,ey-s*0.02); ctx.lineTo(ex+s*0.15,ey-s*0.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex+s*0.07,ey-s*0.06); ctx.lineTo(ex+s*0.12,ey-s*0.13); ctx.stroke();
      } else if (isSquint) {
        ctx.strokeStyle = '#1a0a20'; ctx.lineWidth = s*0.04; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex-s*0.08,ey-s*0.05); ctx.lineTo(ex,ey+s*0.03); ctx.lineTo(ex+s*0.08,ey-s*0.05); ctx.stroke();
      } else {
        // upper lid (thick, shaped)
        ctx.fillStyle = '#1a0a20';
        ctx.beginPath();
        ctx.moveTo(ex-s*0.14,ey-s*0.04);
        ctx.quadraticCurveTo(ex,ey-s*0.2,ex+s*0.14,ey-s*0.02);
        ctx.quadraticCurveTo(ex,ey-s*0.12,ex-s*0.14,ey-s*0.04);
        ctx.closePath(); ctx.fill();
        // individual lashes (3 per eye)
        ctx.strokeStyle = '#1a0a20'; ctx.lineWidth = s*0.02; ctx.lineCap = 'round';
        const lashDir = sx;
        ctx.beginPath(); ctx.moveTo(ex+lashDir*s*0.12,ey-s*0.08); ctx.lineTo(ex+lashDir*s*0.18,ey-s*0.18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex+lashDir*s*0.08,ey-s*0.12); ctx.lineTo(ex+lashDir*s*0.13,ey-s*0.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex+lashDir*s*0.04,ey-s*0.14); ctx.lineTo(ex+lashDir*s*0.07,ey-s*0.21); ctx.stroke();
        // lower lashes
        ctx.lineWidth = s*0.012;
        ctx.beginPath(); ctx.moveTo(ex+lashDir*s*0.08,ey+s*0.14); ctx.lineTo(ex+lashDir*s*0.11,ey+s*0.18); ctx.stroke();
        // white of eye
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex,ey+s*0.02,s*0.12,s*0.16,0,0,Math.PI*2); ctx.fill();
        // iris with multi-layer gradient
        const ig1 = ctx.createRadialGradient(ex,ey-s*0.01,s*0.01,ex,ey+s*0.04,s*0.11);
        ig1.addColorStop(0,eye); ig1.addColorStop(0.5,eyeDark); ig1.addColorStop(1,'#0a0015');
        ctx.fillStyle = ig1; ctx.beginPath(); ctx.ellipse(ex,ey+s*0.03,s*0.095,s*0.13,0,0,Math.PI*2); ctx.fill();
        // iris ring highlight
        ctx.strokeStyle = eye; ctx.lineWidth = s*0.01; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.ellipse(ex,ey+s*0.03,s*0.07,s*0.1,0,0,Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 1;
        // pupil (vertical cat slit)
        ctx.fillStyle = '#050010'; ctx.beginPath(); ctx.ellipse(ex,ey+s*0.04,s*0.02,s*0.075,0,0,Math.PI*2); ctx.fill();
        // large highlight (upper left)
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex-s*0.04,ey-s*0.04,s*0.045,0,Math.PI*2); ctx.fill();
        // medium highlight (lower right)
        ctx.beginPath(); ctx.arc(ex+s*0.03,ey+s*0.08,s*0.022,0,Math.PI*2); ctx.fill();
        // tiny sparkle highlights
        ctx.beginPath(); ctx.arc(ex+sx*s*0.01,ey-s*0.01,s*0.012,0,Math.PI*2); ctx.fill();
        star4(ex-sx*s*0.03,ey+s*0.02,s*0.015,'rgba(255,255,255,0.8)');
        // lower lid line
        ctx.strokeStyle = '#1a0a20'; ctx.lineWidth = s*0.012;
        ctx.beginPath(); ctx.moveTo(ex-s*0.1,ey+s*0.13); ctx.quadraticCurveTo(ex,ey+s*0.17,ex+s*0.1,ey+s*0.13); ctx.stroke();
      }
    }

    // whiskers (delicate, curved, out toward the cheeks)
    ctx.strokeStyle = 'rgba(90,55,70,0.22)'; ctx.lineWidth = s*0.01; ctx.lineCap = 'round';
    for (const sx of [-1,1]) {
      for (let w = 0; w < 3; w++) {
        const wy = fy+s*(0.22+w*0.055);
        ctx.beginPath(); ctx.moveTo(sx*s*0.26,wy);
        ctx.quadraticCurveTo(sx*s*0.42,wy+(w-1)*s*0.02,sx*s*0.56,wy+(w-1)*s*0.05); ctx.stroke();
      }
    }

    // blush (soft gradient circles)
    for (const sx of [-1,1]) {
      const bg2 = ctx.createRadialGradient(sx*s*0.3,fy+s*0.24,s*0.01,sx*s*0.3,fy+s*0.24,s*0.08);
      bg2.addColorStop(0,'rgba(255,90,130,0.4)'); bg2.addColorStop(1,'rgba(255,90,130,0)');
      ctx.fillStyle = bg2; ctx.beginPath(); ctx.arc(sx*s*0.3,fy+s*0.24,s*0.08,0,Math.PI*2); ctx.fill();
    }

    // nose (subtle shadow + tiny dot)
    const noseSh = ctx.createRadialGradient(0,fy+s*0.2,0,0,fy+s*0.2,s*0.06);
    noseSh.addColorStop(0,'rgba(200,130,110,0.3)'); noseSh.addColorStop(1,'rgba(200,130,110,0)');
    ctx.fillStyle = noseSh; ctx.beginPath(); ctx.arc(0,fy+s*0.2,s*0.06,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f0a0a0'; ctx.beginPath(); ctx.arc(0,fy+s*0.22,s*0.015,0,Math.PI*2); ctx.fill();

    // mouth
    ctx.strokeStyle = '#c03060'; ctx.lineWidth = s*0.03; ctx.lineCap = 'round';
    if (expr === 2) {
      ctx.beginPath(); ctx.moveTo(-s*0.06,fy+s*0.3); ctx.lineTo(0,fy+s*0.33); ctx.lineTo(s*0.06,fy+s*0.3); ctx.stroke();
      ctx.fillStyle = '#ff8090'; ctx.beginPath(); ctx.ellipse(0,fy+s*0.36,s*0.035,s*0.04,0,0,Math.PI*2); ctx.fill();
    } else if (expr === 3) {
      ctx.beginPath(); ctx.moveTo(-s*0.08,fy+s*0.28);
      ctx.lineTo(-s*0.025,fy+s*0.33); ctx.lineTo(0,fy+s*0.3);
      ctx.lineTo(s*0.025,fy+s*0.33); ctx.lineTo(s*0.08,fy+s*0.28); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-s*0.06,fy+s*0.3); ctx.lineTo(0,fy+s*0.33); ctx.lineTo(s*0.06,fy+s*0.3); ctx.stroke();
    }
    // subtle lip color
    ctx.fillStyle = 'rgba(240,140,160,0.25)';
    ctx.beginPath(); ctx.ellipse(0,fy+s*0.31,s*0.05,s*0.02,0,0,Math.PI*2); ctx.fill();

    // accessory
    if (acc === 'bow') bow(s*0.36,fy-s*0.52,s*0.18,'#ff4090');
    else if (acc === 'bell') {
      ctx.fillStyle = '#ffd700'; ctx.beginPath(); ctx.arc(0,fy+s*0.58,s*0.07,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#c0a000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0,fy+s*0.58,s*0.07,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle = '#ff3060'; ctx.lineWidth = s*0.035;
      ctx.beginPath(); ctx.arc(0,fy+s*0.52,s*0.2,Math.PI*0.25,Math.PI*0.75); ctx.stroke();
    }
    else if (acc === 'star') star5(s*0.34,fy-s*0.5,s*0.13,'#ffd740');
    else if (acc === 'heart') heart(-s*0.34,fy-s*0.52,s*0.11,'#ff4080');
    else if (acc === 'fish') fishSticker(s*0.4,fy+s*0.6,s*0.18,'#80c0ff');
    ctx.restore();
  };

  // ── compose: fewer but LARGER stickers for more visible detail ──
  // [hair, hairDark, eye, eyeDark, hairHL, shape, accessory, expression]
  const P = [
    ['#ff60b8','#c03080','#7a3aff','#4a1ab0','#ffb0e0', 0,'bow',  0],
    ['#4aa0ff','#2060b0','#20a0ff','#1060a0','#a0d8ff', 1,'bell', 1],
    ['#ffc840','#c09020','#c08020','#806010','#fff0a0', 0,'star', 2],
    ['#2a2040','#18102a','#00c8b0','#008070','#6a5080', 1,'heart',3],
    ['#b860ff','#7030c0','#ff30a0','#c01070','#e0b0ff', 0,'fish', 0],
    ['#ff7080','#c04050','#d04060','#901030','#ffb0b8', 1,'bow',  1],
    ['#60ffc0','#30b080','#10a070','#087050','#b0ffe0', 0,'bell', 2],
    ['#e0a0ff','#a060c0','#9040d0','#602090','#f0d0ff', 1,'star', 3],
  ];
  const girls = [
    [90,  85,  72, 0], [350, 75,  66, 1], [200, 220, 78, 2],
    [430, 240, 60, 3], [80,  370, 68, 4], [320, 370, 74, 5],
    [460, 430, 56, 6], [180, 470, 62, 7],
  ];
  for (const [gx,gy,gs,pi] of girls) {
    const p = P[pi]; catGirl(gx,gy,gs,p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7]);
  }

  // maneki-neko mascots in gaps
  for (const [mx,my,ms] of [[256,38,22],[18,180,20],[490,240,18],[220,330,20],[440,460,18],[120,140,16]]) manekiNeko(mx,my,ms);

  // fish stickers
  for (const [fx,fy,fs,fc] of [[300,180,14,'#ffa0c0'],[50,360,12,'#a0d0ff'],[480,120,10,'#ffc080'],[200,480,12,'#c0a0ff']]) fishSticker(fx,fy,fs,fc);

  // paw prints (lots — it's a cat theme)
  for (let i = 0; i < 14; i++) pawPrint(Math.random()*size,Math.random()*size,6+Math.random()*6,['#ff80b0','#ffb0d0','#b070ff','#ffa0c0'][i%4]);

  // bows
  for (let i = 0; i < 8; i++) bow(Math.random()*size,Math.random()*size,5+Math.random()*5,['#ff4090','#ff70c0','#e060ff'][i%3]);

  // sakura blossoms
  for (let i = 0; i < 24; i++) sakura(Math.random()*size,Math.random()*size,6+Math.random()*10,['#ffb0d0','#ffc8e0','#ff90c0','#ffd0e8'][i%4]);

  // hearts everywhere
  for (let i = 0; i < 22; i++) heart(Math.random()*size,Math.random()*size,4+Math.random()*8,['rgba(255,50,120,0.9)','rgba(255,120,180,0.9)','rgba(200,60,255,0.8)','rgba(255,80,100,0.9)'][i%4]);

  // stars
  for (let i = 0; i < 16; i++) star5(Math.random()*size,Math.random()*size,4+Math.random()*7,'rgba(255,230,100,0.95)');

  // sparkle stars
  for (let i = 0; i < 24; i++) star4(Math.random()*size,Math.random()*size,3+Math.random()*6,['rgba(255,255,255,0.95)','rgba(255,200,255,0.9)','rgba(255,220,240,0.9)'][i%3]);

  // sparkle dust
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.5+Math.random()*0.5})`;
    ctx.fillRect(Math.random()*size,Math.random()*size,1.5+Math.random(),1.5+Math.random());
  }

  // Japanese text symbols + cat sounds
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const stamps = [['NYA~',100,50,'#ff3080'],['NEKO',400,150,'#b050ff'],['KAWAII',60,380,'#ff6090'],['LOVE',480,440,'#e050a0'],['MEOW',270,470,'#c060ff'],['UWU',380,340,'#ff80b0']];
  for (const [txt,sx,sy,col] of stamps) {
    ctx.save(); ctx.translate(sx,sy); ctx.rotate((Math.random()-0.5)*0.4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeText(txt,0,0);
    ctx.fillStyle = col; ctx.fillText(txt,0,0);
    ctx.restore();
  }

  return c;
}

// DRAGON — overlapping scales with a jade-green sheen.
function dragonDecal() {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b1f14';
  ctx.fillRect(0, 0, size, size);
  const sc = 26;
  for (let row = -1; row * sc * 0.6 < size; row++) {
    for (let col = -1; col * sc < size + sc; col++) {
      const x = col * sc + (row % 2 ? sc / 2 : 0);
      const y = row * sc * 0.6;
      const g = ctx.createRadialGradient(x, y - sc * 0.2, 1, x, y, sc * 0.7);
      g.addColorStop(0, '#3fae6a');
      g.addColorStop(0.6, '#176b39');
      g.addColorStop(1, '#0a2e1c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, sc * 0.62, 0, Math.PI, false);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,255,180,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  return c;
}

// CYBER — neon circuit traces + nodes on near-black, glows via emissive map.
function cyberDecal() {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#04080c';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2.4;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 8;
  ctx.lineCap = 'round';
  for (let i = 0; i < 44; i++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 2 + (Math.random() * 5 | 0);
    for (let s = 0; s < segs; s++) {
      if (Math.random() < 0.5) x += (Math.random() - 0.5) * 120;
      else y += (Math.random() - 0.5) * 120;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#bdffff';
    ctx.beginPath();
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  return c;
}

// CARBON — woven carbon-fibre twill.
function carbonDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(0, 0, size, size);
  const cell = 16;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const odd = ((x / cell) + (y / cell)) % 2 === 0;
      const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
      if (odd) { g.addColorStop(0, '#34373d'); g.addColorStop(1, '#15171b'); }
      else     { g.addColorStop(0, '#15171b'); g.addColorStop(1, '#34373d'); }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  return c;
}

// DIGICAMO — pixelated digital camouflage.
function digicamoDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  const cols = ['#3a4a2a', '#566b3a', '#222c18', '#7a8a55'];
  const px = 16;
  for (let y = 0; y < size; y += px) {
    for (let x = 0; x < size; x += px) {
      ctx.fillStyle = cols[(Math.random() * cols.length) | 0];
      ctx.fillRect(x, y, px, px);
    }
  }
  // scatter a few half-size pixels for a finer pattern
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = cols[(Math.random() * cols.length) | 0];
    ctx.fillRect((Math.random() * size) | 0, (Math.random() * size) | 0, px / 2, px / 2);
  }
  return c;
}

// HEXTECH — glowing hexagon honeycomb.
function hextechDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#06121a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#18e0ff';
  ctx.lineWidth = 1.4;
  ctx.shadowColor = '#18e0ff';
  ctx.shadowBlur = 5;
  const r = 22, h = Math.sqrt(3) * r;
  for (let row = -1; row * (h / 2) < size + h; row++) {
    for (let col = -1; col * (1.5 * r) < size + r; col++) {
      const x = col * 1.5 * r;
      const y = row * h + (col % 2 ? h / 2 : 0);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  return c;
}

// FROST — icy crystals + frost speckle.
function frostDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#0a2230');
  bg.addColorStop(1, '#123a4e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(190,235,255,0.85)';
  ctx.shadowColor = '#bdeeff';
  ctx.shadowBlur = 4;
  for (let i = 0; i < 9; i++) {
    const cx = Math.random() * size, cy = Math.random() * size, len = 18 + Math.random() * 28;
    for (let a = 0; a < 6; a++) {
      const ang = (Math.PI / 3) * a;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len;
      ctx.lineTo(ex, ey);
      // barbs
      ctx.lineTo(ex - Math.cos(ang - 0.5) * 6, ey - Math.sin(ang - 0.5) * 6);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang + 0.5) * 6, ey - Math.sin(ang + 0.5) * 6);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = 'rgba(220,245,255,0.6)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  return c;
}

// GALAXY — nebula clouds + starfield.
function galaxyDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#06030f';
  ctx.fillRect(0, 0, size, size);
  const clouds = ['#7a2ad0', '#2a5aff', '#d02a9a', '#2ab8ff'];
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 50 + Math.random() * 130;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, clouds[(Math.random() * clouds.length) | 0] + 'dd');
    g.addColorStop(1, 'rgba(6,3,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  for (let i = 0; i < 520; i++) {
    const b = Math.random();
    ctx.fillStyle = b > 0.9 ? '#dff0ff' : `rgba(255,255,255,${0.4 + b * 0.6})`;
    const s = b > 0.96 ? 3 : (b > 0.85 ? 2 : 1);
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  return c;
}

// GOLD FILIGREE — ornate damascus swirls on gold.
function goldDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#caa23a');
  bg.addColorStop(0.5, '#f3d678');
  bg.addColorStop(1, '#9c7a1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(90,60,8,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 8 + Math.random() * 22;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2; a += 0.3) {
      const rr = r * (0.6 + 0.4 * Math.sin(a * 3));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      a ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
  return c;
}

// SKULL — repeating skull motif.
function skullDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#14151a';
  ctx.fillRect(0, 0, size, size);
  const drawSkull = (x, y, s) => {
    ctx.fillStyle = '#d8d8d0';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - s * 0.7, y, s * 1.4, s * 1.1);
    ctx.fillStyle = '#14151a';
    ctx.beginPath(); ctx.arc(x - s * 0.4, y - s * 0.1, s * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s * 0.4, y - s * 0.1, s * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - s * 0.1, y + s * 0.2, s * 0.2, s * 0.4);
    for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * s * 0.22 - 1, y + s * 0.9, 2, s * 0.3);
  };
  const step = 64;
  for (let y = step / 2; y < size + step; y += step)
    for (let x = step / 2; x < size + step; x += step)
      drawSkull(x + ((y / step) % 2 ? step / 2 : 0), y, 14);
  return c;
}

// TOXIC — acid splatter + bubbles, glows green.
function toxicDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#0a1206';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 12 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#aaff33');
    g.addColorStop(0.6, '#3a9c1a');
    g.addColorStop(1, 'rgba(10,18,6,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = 'rgba(180,255,90,0.7)';
    ctx.lineWidth = 1;
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath(); ctx.arc(x, y, 1 + Math.random() * 4, 0, Math.PI * 2); ctx.stroke();
  }
  return c;
}

// LIGHTNING — branching electric arcs, glows.
function lightningDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#070a16';
  ctx.fillRect(0, 0, size, size);
  ctx.shadowColor = '#cdf5ff';
  ctx.shadowBlur = 10;
  ctx.lineCap = 'round';
  const bolt = (x, y, ang, len, w) => {
    if (len < 10 || w < 0.5) return;
    ctx.strokeStyle = w > 2.2 ? '#ffffff' : '#9fe4ff';
    ctx.lineWidth = w;
    const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    bolt(nx, ny, ang + (Math.random() - 0.5) * 1.1, len * 0.72, w * 0.72);
    if (Math.random() < 0.5) bolt(nx, ny, ang + (Math.random() - 0.5) * 1.6, len * 0.5, w * 0.5);
  };
  for (let i = 0; i < 9; i++) bolt(Math.random() * size, 0, Math.PI / 2 + (Math.random() - 0.5), 90, 3.6);
  ctx.shadowBlur = 0;
  return c;
}

// TIGER — orange coat with black stripes.
function tigerDecal() {
  const size = 256, c = makeCanvas(size), ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#ff9a2a');
  bg.addColorStop(1, '#e8761a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1a1208';
  for (let i = 0; i < 22; i++) {
    const y = Math.random() * size, x = Math.random() * size;
    const w = 4 + Math.random() * 8, h = 30 + Math.random() * 50, tilt = (Math.random() - 0.5) * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(w, h * 0.5, 0, h);
    ctx.quadraticCurveTo(-w * 0.4, h * 0.5, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  return c;
}

// HOLOGRAPHIC — iridescent rainbow foil with a brushed sheen. Glows.
function holographicDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  // diagonal rainbow sweep
  const g = ctx.createLinearGradient(0, 0, size, size);
  const stops = ['#ff2bd0', '#ff8a2b', '#fff52b', '#2bff7a', '#2bd8ff', '#6a4bff', '#ff2bd0'];
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // shimmering diagonal bands (foil refraction)
  for (let i = 0; i < 60; i++) {
    const off = (i / 60) * size * 1.6 - size * 0.3;
    const bg = ctx.createLinearGradient(off, 0, off + 40, size);
    bg.addColorStop(0, 'rgba(255,255,255,0)');
    bg.addColorStop(0.5, `rgba(255,255,255,${0.10 + Math.random() * 0.20})`);
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bg;
    ctx.save();
    ctx.translate(off, 0);
    ctx.rotate(0.6);
    ctx.fillRect(-size, -size, 30, size * 3);
    ctx.restore();
  }
  // fine sparkle
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  return c;
}

// CIRCUITNEON — dense glowing PCB: traces, pads, vias. Glows.
function circuitneonDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#02100a';
  ctx.fillRect(0, 0, size, size);
  const grid = 32;
  ctx.lineCap = 'square';
  ctx.shadowColor = '#1bff8a';
  ctx.shadowBlur = 6;
  // manhattan traces snapped to a grid for a dense PCB look
  for (let i = 0; i < 130; i++) {
    let gx = (Math.random() * (size / grid) | 0) * grid;
    let gy = (Math.random() * (size / grid) | 0) * grid;
    const horiz = Math.random() < 0.5;
    ctx.strokeStyle = Math.random() < 0.18 ? '#7bffd0' : '#15e07a';
    ctx.lineWidth = 1.6 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    let steps = 1 + (Math.random() * 4 | 0);
    let h = horiz;
    for (let s = 0; s < steps; s++) {
      if (h) gx += (Math.random() < 0.5 ? -1 : 1) * grid * (1 + (Math.random() * 3 | 0));
      else gy += (Math.random() < 0.5 ? -1 : 1) * grid * (1 + (Math.random() * 3 | 0));
      ctx.lineTo(gx, gy);
      h = !h;
    }
    ctx.stroke();
  }
  // solder pads / vias
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * (size / grid) | 0) * grid;
    const y = (Math.random() * (size / grid) | 0) * grid;
    ctx.fillStyle = '#9fffdd';
    ctx.beginPath(); ctx.arc(x, y, 2.6 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#02100a';
    ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
  return c;
}

// LAVA — cracked black basalt with glowing magma veins. Glows.
function lavaDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  // dark cracked rock base
  ctx.fillStyle = '#0c0503';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 80; i++) {
    const v = 10 + Math.random() * 24;
    ctx.fillStyle = `rgb(${v|0},${(v*0.6)|0},${(v*0.4)|0})`;
    ctx.globalAlpha = 0.4;
    const x = Math.random() * size, y = Math.random() * size, r = 8 + Math.random() * 30;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // glowing magma veins — branching cracks
  ctx.shadowColor = '#ff7b1a';
  ctx.shadowBlur = 12;
  const vein = (x, y, ang, len, w) => {
    if (len < 12 || w < 0.6) return;
    const g = ctx.createLinearGradient(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.addColorStop(0, '#fff0a0');
    g.addColorStop(0.5, '#ff7b1a');
    g.addColorStop(1, '#c41800');
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    vein(nx, ny, ang + (Math.random() - 0.5) * 1.0, len * 0.72, w * 0.72);
    if (Math.random() < 0.55) vein(nx, ny, ang + (Math.random() - 0.5) * 1.6, len * 0.6, w * 0.62);
  };
  for (let i = 0; i < 10; i++) vein(Math.random() * size, Math.random() * size, Math.random() * Math.PI * 2, 70, 4.5);
  // glowing embers
  ctx.shadowBlur = 6;
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#ffcc55' : '#ff5511';
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
  return c;
}

// ICE — refractive crystal facets with cool glints. Subtle glow.
function iceDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#9fd8ec');
  bg.addColorStop(0.5, '#cfeefb');
  bg.addColorStop(1, '#6fb6d8');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // crystalline facets — random triangles with refraction shading
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 24 + Math.random() * 70;
    const a0 = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.lineTo(x + Math.cos(a0 + 1 + Math.random()) * r, y + Math.sin(a0 + 1 + Math.random()) * r);
    ctx.closePath();
    const shade = 200 + Math.random() * 55;
    ctx.fillStyle = `rgba(${shade|0},${(shade+5)|0},255,${0.10 + Math.random() * 0.18})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // bright glints
  ctx.shadowColor = '#e6faff';
  ctx.shadowBlur = 6;
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  ctx.shadowBlur = 0;
  return c;
}

// BLOODMOON — dark red marble veined with gold. Subtle glow on veins.
function bloodmoonDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  const bg = ctx.createRadialGradient(size * 0.5, size * 0.5, 10, size * 0.5, size * 0.5, size * 0.7);
  bg.addColorStop(0, '#5a0c10');
  bg.addColorStop(0.6, '#2c0608');
  bg.addColorStop(1, '#120203');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // dark marble swirls
  for (let i = 0; i < 50; i++) {
    ctx.strokeStyle = `rgba(${100 + Math.random()*60|0},10,14,${0.2 + Math.random()*0.3})`;
    ctx.lineWidth = 4 + Math.random() * 12;
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 120;
      ctx.quadraticCurveTo(x + 30, y - 30, x, y);
    }
    ctx.stroke();
  }
  // gold veins (faint glow)
  ctx.shadowColor = '#ffd86a';
  ctx.shadowBlur = 5;
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = '#f0c24a';
    ctx.lineWidth = 0.8 + Math.random() * 1.8;
    ctx.lineCap = 'round';
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  return c;
}

// MATRIX — falling green code glyphs on black. Glows.
function matrixDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#010803';
  ctx.fillRect(0, 0, size, size);
  const glyphs = 'ｱｲｳｴｵｶｷｸ0123456789ﾊﾋﾌﾍﾎ@#$%';
  const colW = 16;
  ctx.font = '14px monospace';
  ctx.textBaseline = 'top';
  ctx.shadowColor = '#28ff7a';
  for (let cx = 0; cx < size; cx += colW) {
    const head = Math.random() * size;
    const trail = 6 + (Math.random() * 14 | 0);
    for (let r = 0; r < trail; r++) {
      const y = (head - r * colW) ;
      const yy = ((y % size) + size) % size;
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      if (r === 0) { ctx.fillStyle = '#d8ffe6'; ctx.shadowBlur = 8; }
      else { const a = 1 - r / trail; ctx.fillStyle = `rgba(30,${200 + (a*55)|0},90,${a})`; ctx.shadowBlur = 4; }
      ctx.fillText(ch, cx + 1, yy);
    }
  }
  ctx.shadowBlur = 0;
  return c;
}

// CAMO_URBAN — sharp angular urban camouflage.
function camoUrbanDecal() {
  const size = 512, c = makeCanvas(size), ctx = c.getContext('2d');
  const cols = ['#c8ccd2', '#8a9099', '#4a4f57', '#23262b'];
  ctx.fillStyle = cols[0];
  ctx.fillRect(0, 0, size, size);
  // angular blotches, drawn wrapped for tiling
  const blob = (x, y, col, scale) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    const pts = 5 + (Math.random() * 4 | 0);
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = scale * (0.5 + Math.random() * 0.8);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const col = cols[1 + (Math.random() * (cols.length - 1) | 0)];
    const sc = 18 + Math.random() * 46;
    [[0,0],[size,0],[-size,0],[0,size],[0,-size]].forEach(([dx,dy]) => blob(x+dx, y+dy, col, sc));
  }
  return c;
}

// Neutral patterned wraps multiply against each skin's authored palette.
function rarePattern(kind) {
  const c = makeCanvas(512), ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = '#f4f6fa'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#172634'; ctx.fillStyle = '#294258'; ctx.lineWidth = 9;
  for (let y = -128; y < 384; y += 64) {
    for (let x = -128; x < 384; x += 64) {
      ctx.beginPath();
      if (kind === 'circuit') {
        ctx.moveTo(x, y+12); ctx.lineTo(x+34, y+12); ctx.lineTo(x+34, y+44); ctx.lineTo(x+64, y+44); ctx.stroke();
        ctx.fillRect(x+27,y+5,14,14);
      } else if (kind === 'orbit') {
        ctx.arc(x+32,y+32,23,0,Math.PI*1.6); ctx.stroke();
        ctx.fillRect(x+12,y+9,11,11);
      } else if (kind === 'shards') {
        ctx.moveTo(x,y);ctx.lineTo(x+51,y+13);ctx.lineTo(x+14,y+56);ctx.closePath();ctx.fill();
      } else if (kind === 'weave') {
        ctx.fillRect(x,y+10,46,13);ctx.fillRect(x+10,y+32,13,32);
      } else {
        ctx.moveTo(x,y+8);ctx.lineTo(x+32,y+36);ctx.lineTo(x+64,y+8);ctx.stroke();
      }
    }
  }
  return c;
}

// Engraved legendary motifs retain the palette rather than baking in a tint.
function legendaryPattern(kind) {
  const c = makeCanvas(512), ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = '#f4e9c9'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#596879'; ctx.lineWidth = .7;
  for (let i = -256; i < 512; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke();
  }
  ctx.strokeStyle = '#273142'; ctx.lineWidth = 5;
  for(let y=-128;y<384;y+=128) for(let x=-128;x<384;x+=128) {
    ctx.beginPath();
    if(kind==='regalia') {
      ctx.moveTo(x+16,y+40);ctx.lineTo(x+36,y+78);ctx.lineTo(x+64,y+25);ctx.lineTo(x+92,y+78);ctx.lineTo(x+112,y+40);ctx.lineTo(x+104,y+98);ctx.lineTo(x+24,y+98);ctx.closePath();ctx.stroke();
      ctx.strokeRect(x+31,y+104,66,8);
    } else if(kind==='feather') {
      ctx.moveTo(x+16,y+112);ctx.quadraticCurveTo(x+28,y+30,x+110,y+16);ctx.quadraticCurveTo(x+105,y+99,x+16,y+112);ctx.stroke();
      for(let n=0;n<4;n++){ctx.beginPath();ctx.moveTo(x+26+n*17,y+102-n*17);ctx.lineTo(x+29+n*24,y+56-n*11);ctx.stroke();}
    } else if(kind==='constellation') {
      ctx.moveTo(x+10,y+26);ctx.lineTo(x+63,y+40);ctx.lineTo(x+104,y+96);ctx.lineTo(x+36,y+110);ctx.stroke();
      for(const [u,v] of [[10,26],[63,40],[104,96],[36,110]]) {ctx.fillStyle='#f6f8fa';ctx.fillRect(x+u-5,y+v-5,10,10);}
    } else if(kind==='scale') {
      for(let n=0;n<3;n++){ctx.beginPath();ctx.moveTo(x+n*42,y+8);ctx.quadraticCurveTo(x+n*42+58,y+58,x+n*42,y+114);ctx.quadraticCurveTo(x+n*42-58,y+58,x+n*42,y+8);ctx.stroke();}
    } else {
      ctx.arc(x+64,y+64,41,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(x+64,y+64,63,15,-.5,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#f0f4f8';ctx.fillRect(x+60,y+13,8,13);
    }
  }
  return c;
}

const DECALS = {
  ...Object.fromEntries(['fire','water','garden','toxic','neko'].flatMap(t => ['paint','premium'].map(tier => [`theme_${t}_${tier}`, () => themedWrap(t,tier==='premium')]))),
  ...Object.fromEntries(['regalia','feather','constellation','scale','eclipse'].map(k => ['legend_'+k, () => legendaryPattern(k)])),
  ...Object.fromEntries(['circuit','orbit','shards','weave','chevron'].map(k => ['rare_'+k, () => rarePattern(k)])),
  fire:        fireDecal,
  anime:       animeDecal,
  animegirl:   animeGirlDecal,
  dragon:      dragonDecal,
  cyber:       cyberDecal,
  carbon:      carbonDecal,
  digicamo:    digicamoDecal,
  hextech:     hextechDecal,
  frost:       frostDecal,
  galaxy:      galaxyDecal,
  gold:        goldDecal,
  skull:       skullDecal,
  toxic:       toxicDecal,
  lightning:   lightningDecal,
  tiger:       tigerDecal,
  // ── new high-quality decals ──
  holographic: holographicDecal,
  circuitneon: circuitneonDecal,
  lava:        lavaDecal,
  ice:         iceDecal,
  bloodmoon:   bloodmoonDecal,
  matrix:      matrixDecal,
  camo_urban:  camoUrbanDecal,
};

// Returns a seamless color CanvasTexture for the given decal type (cached).
// The anime-girl wrap is a designed composition (idol faces, KAWAII FORCE
// banner) rather than a fine repeating pattern, so it maps at repeat 1 to keep
// the art large and legible; everything else tiles at 2 for surface density.
export function decalTexture(type) {
  return cached('decal_' + type, () => {
    const make = DECALS[type];
    if (!make) return null;
    const repeat = type.startsWith('theme_') || type === 'animegirl' || (type.startsWith('rare_') || type.startsWith('legend_')) ? 1 : 2;
    return finalize(make(), { color: true, repeat });
  });
}
