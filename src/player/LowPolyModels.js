// ── Low-poly arena operatives — cel-shaded like the guns ─────────────────────
// Connected humanoid bodies with fabric/under-suit anatomy and shaped protective
// panels. The default uses a compact orange/grey arena silhouette; alternate
// bodies stay lighter and more ninja-like. All share the arsenal's illustrated
// finish: flat MeshToonMaterial bands plus a dark inverted-hull contour.
//
// Built with the procedural-body naming convention (boot_/lleg_/thigh_/knee_/
// uarm_/farm_/elbow_/hand_) so rigCharacterLimbs() walk-animates them for free.
//
// ANATOMY, not a parts bin. Everything organic — torso, thighs, calves, feet,
// arms, hands, skull — is ONE lofted surface per body part rather than a stack
// of boxes and capsules pushed into each other. A capsule butted against a box
// has a lighting seam at the join no matter how many segments either one has,
// and it is that seam, more than the polygon count, that reads as "blocky". The
// armour on top stays hard-surfaced, but each plate now WRAPS the form it sits
// on instead of hovering over it as a slab.
//
// ─── LOAD-BEARING NUMBERS ────────────────────────────────────────────────────
// rigCharacterLimbs() pivots the limbs at fixed heights and Locomotion.js solves
// ground contact against fixed leg geometry. Both read the mesh, neither is
// derived from it, so the skin may change but these may NOT:
//
//   hip    y 1.21     shoulder  y 1.76, |x| 0.27
//   knee   y 0.62     elbow     y 1.28
//   ankle  y 0.27     hand      y ~0.895   (UP_ARM 0.48, FOREARM 0.385)
//   sole   y 0, spanning z +0.10 (heel) → −0.20 (toe)
//
// Limb meshes must also average to |x| 0.27 (arms) / 0.11 (legs), because
// makeLimb() places each pivot at the mean x of the parts it collects — so any
// sideways offset belongs in the GEOMETRY, not in mesh.position. And bots tag
// head meshes by `mesh.position.y >= 1.90`, which is why lofted forms are baked
// around a meaningful origin instead of all sitting at y 0.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHeroBody } from './HeroBody.js';

export const LOWPOLY_IDS = ['vanguard', 'striker', 'phantom'];
export function isLowPolyId(id) { return LOWPOLY_IDS.includes(id); }

// ── Cel shading (identical technique to WeaponModels' authored-gun look) ─────
let _rampTex = null;
function _ramp() {
  if (_rampTex) return _rampTex;
  // Six bands rather than four: a rounded limb crosses far more of the ramp
  // than a flat plate does, and at four bands the terminator lands as three
  // wide steps that read as facets on a form that is actually smooth.
  //
  // The floor was at 150 — 59% brightness in the darkest band — to stop big
  // plates crushing to black under ACES. Combined with the emissive floors
  // below it left the body a total range of about a third of a stop, so every
  // form on it rendered flat: a shoulder, a chest plate and a thigh all came
  // out the same value and the character read as one inflated violet mass no
  // matter how the armour was shaped. Plates are separated by SHADING before
  // they are separated by colour, and there was no shading to do it with.
  const d = new Uint8Array([84, 122, 158, 192, 224, 255]);
  _rampTex = new THREE.DataTexture(d, 6, 1, THREE.RedFormat);
  _rampTex.minFilter = _rampTex.magFilter = THREE.NearestFilter;
  _rampTex.needsUpdate = true;
  return _rampTex;
}
function T(color, opts = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: _ramp() });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  m.userData.role = opts.role || 'body';
  return m;
}

// Dark contour outline — inverted hull: a back-face copy inflated along smoothed
// vertex normals gives every part a clean dark edge from any angle.
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x1c1e24, side: THREE.BackSide });
const _olCache = new WeakMap();
function _outlineGeo(src, t) {
  let g = _olCache.get(src);
  if (g) return g;
  g = src.clone();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++)
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  // Cached against the source geometry, so it outlives any one body too.
  g.userData.shared = true;
  _olCache.set(src, g);
  return g;
}
function _addOutlines(group, t = 0.011) {
  // Per-MODEL outline material (a clone), so a death fade / spawn fade that sets
  // opacity on one character's outlines doesn't touch every other character's.
  const olMat = OUTLINE_MAT.clone();
  group.userData.outlineMat = olMat;
  const hosts = [];
  group.traverse(o => { if (o.isMesh && o.material !== olMat) hosts.push(o); });
  for (const o of hosts) {
    const ol = new THREE.Mesh(_outlineGeo(o.geometry, t), olMat);
    ol.name = 'outline';
    ol.castShadow = false;
    ol.raycast = () => {};
    o.add(ol);
  }
}

// ── Palettes ─────────────────────────────────────────────────────────────────
// A character needs MATERIALS, not one colour at five brightnesses.
//
// The first violet pass tinted every slot violet — armour, trim, underframe,
// joints, and even the slot literally called `steel`. Five tints of one hue is
// not a palette, it is a monochrome, and a monochrome model reads as a single
// lump of plastic no matter how the forms underneath are shaped: with nothing
// but value separating a pauldron from the arm beneath it, the eye takes the
// whole silhouette as one object. Shading and shape cannot rescue that,
// because the problem is not contrast — it is that there is only one material.
//
// So the slots are different MATERIALS now, and only one of them is coloured:
//
//   armor   the identity colour — the only saturated hue on the body
//   bone    the light plate: pauldrons, gauntlets, shins, helm crown
//   armor2  a near-white trim, NEUTRAL, so a lit edge reads as a lit edge
//   frame   the undersuit: neutral near-black, no hue at all
//   joint   black, for recesses, the visor and the cape
//   steel   real gunmetal — hands, ankles, belt, fittings
//   glow    the accent
//
// The armour is deliberately split two-tone. Even with neutral blacks and
// greys elsewhere, armour that is ALL the identity colour still leaves ~70% of
// the visible character in one saturated hue, and it reads as dipped. Hero
// armour is mostly neutral plate with the colour placed on it — the colour is
// the identity, not the substrate.
//
// The armour reads MORE violet now than it did when everything was violet,
// which is the point: a hue needs something neutral next to it to be a hue.
const PALETTES = {
  // Neutral hard-surface blocks tie the default chassis to Rook's warm concrete
  // Compact arena operative: saturated orange impact armour over a near-black
  // undersuit, pale ceramic helmet/leg shells and a single acid-lime optic. The
  // colour blocking is intentionally bold enough to survive gameplay distance.
  vanguard: { armor: 0xff7208, armor2: 0xc4c6d4, frame: 0x202428, joint: 0x0d1013,
              steel: 0x555d66, bone: 0xe0e1eb, glow: 0xc7ff34, bulk: 1.06,
              finish: 'pbr' },  // compact arena operative
  striker:  { armor: 0x173c64, armor2: 0x6687a0, frame: 0x101821, joint: 0x070b10,
              steel: 0x263d50, bone: 0x48677d, glow: 0x32f0d3, bulk: 0.91 },  // frost shinobi
  phantom:  { armor: 0x292638, armor2: 0x716b7d, frame: 0x111016, joint: 0x060609,
              steel: 0x302d3c, bone: 0x554f62, glow: 0xff3d5e, bulk: 0.88 },  // night shinobi
};


// Shared with the first-person viewmodel so the arm seen by the owner uses the
// same armour/frame/joint/accent colours as their third-person cyborg.
export function getLowPolyPalette(id) {
  return PALETTES[id] || PALETTES.vanguard;
}

export function makeBodyMaterials(pal) {
  const pbr = pal.finish === 'pbr';
  // Body materials carry a self-emissive floor so cel shadows keep their hue
  // instead of crushing to black on large flat plates under ACES tone mapping.
  const body = (hex, floor = 0.32, roughness = 0.6, metalness = 0.08) => {
    const m = pbr
      ? new THREE.MeshStandardMaterial({ color: hex, roughness, metalness })
      : T(hex);
    if (!pbr) {
      m.emissive = new THREE.Color(hex).multiplyScalar(floor);
      m.emissiveIntensity = 1;
    }
    m.userData.role = 'body';
    return m;
  };
  const red = pal.glow;
  const frame = body(pal.frame, 0.24, 0.84, 0.02);
  const bone = body(pal.bone, 0.16, 0.68, 0.06);
  // The arena warrior is intentionally faceted. Letting both its shaped
  // undersuit and ceramic planes catch separate highlights makes the anatomy
  // visible at gameplay distance instead of flattening into pants plus pads.
  if (pbr) {
    frame.flatShading = true;
    bone.flatShading = true;
  }
  return {
    armor:  body(pal.armor, 0.16, 0.48, 0.14),
    armor2: body(pal.armor2, 0.16, 0.62, 0.12),
    frame,
    joint:  body(pal.joint, 0.30, 0.96, 0.00),
    steel:  body(pal.steel, 0.16, 0.38, 0.46),
    bone,
    glow:   pbr
      ? Object.assign(new THREE.MeshStandardMaterial({
          color: new THREE.Color(red).multiplyScalar(0.22), emissive: red,
          emissiveIntensity: 2.2, roughness: 0.28, metalness: 0.08,
        }), { userData: { role: 'energy' } })
      : T(new THREE.Color(red).multiplyScalar(0.15).getHex(), { role: 'energy', emissive: red, emissiveIntensity: 1.5 }),
    eye:    pbr
      ? Object.assign(new THREE.MeshStandardMaterial({
          color: new THREE.Color(red).multiplyScalar(0.28), emissive: red,
          emissiveIntensity: 3.0, roughness: 0.22, metalness: 0.05,
        }), { userData: { role: 'energy' } })
      : T(new THREE.Color(red).multiplyScalar(0.2).getHex(),  { role: 'energy', emissive: red, emissiveIntensity: 2.2 }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Smooth-surface geometry
// ───────────────────────────────────────────────────────────────────────────
// A body part is a stack of cross-sections lofted into one welded surface. Each
// cross-section is a SUPERELLIPSE
//
//     |x/rx|^n + |z/rz|^n = 1
//
// which is the one primitive that covers everything here: n = 2 is an ellipse (a
// bicep), n ≈ 2.8 is a rounded rectangle (a ribcage, wider than it is deep), n ≈
// 3.2 is nearly a slab with soft corners (the sole of a boot). One family, so a
// thigh can flow into a knee and a calf without a single hard join, and the
// normals run continuously all the way up the limb.
// ═══════════════════════════════════════════════════════════════════════════

// Superellipse point at parameter `a`. a = 0 → +X (outboard), a = −π/2 → −Z
// (the body's front), a = +π/2 → +Z (its back).
function _se(a, rx, rz, n) {
  const e = 2 / n, ca = Math.cos(a), sa = Math.sin(a);
  return [Math.sign(ca) * rx * Math.pow(Math.abs(ca), e),
          Math.sign(sa) * rz * Math.pow(Math.abs(sa), e)];
}

// Loft a list of closed rings (each an array of [x,y,z], all the same length,
// ordered bottom → top) into one indexed, smooth-shaded surface.
//
// A ring may repeat a point to break the smoothing there: the quad spanning the
// duplicate is degenerate, contributes no normal, and so isolates the two faces
// either side of it. That is how the armour plates below get crisp rims without
// giving up the smooth curve across their faces.
function _loftRings(rings, cap = true) {
  const S = rings.length, N = rings[0].length, P = [], I = [];
  for (const ring of rings) for (const p of ring) P.push(p[0], p[1], p[2]);
  for (let s = 0; s < S - 1; s++) {
    for (let r = 0; r < N; r++) {
      const a = s * N + r, b = s * N + (r + 1) % N;
      I.push(a, b + N, b, a, a + N, b + N);
    }
  }
  if (cap) {
    // Fan each end to the ring's own centroid. The fan reuses the rim vertices,
    // so the cap shades into the wall rather than ringing it with a hard edge.
    const fan = (s, up) => {
      const c = P.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (const p of rings[s]) { cx += p[0]; cy += p[1]; cz += p[2]; }
      P.push(cx / N, cy / N, cz / N);
      for (let r = 0; r < N; r++) {
        const a = s * N + r, b = s * N + (r + 1) % N;
        if (up) I.push(a, c, b); else I.push(a, b, c);
      }
    };
    fan(S - 1, true);
    fan(0, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

// Stations → closed superelliptical rings.
function _bodyRings(st, radial) {
  return st.map((q) => {
    const ring = [], n = q.n ?? 2, x0 = q.x || 0, z0 = q.z || 0;
    for (let r = 0; r < radial; r++) {
      const [x, z] = _se((r / radial) * Math.PI * 2, q.rx, q.rz, n);
      ring.push([x0 + x, q.y, z0 + z]);
    }
    return ring;
  });
}

// Close a loft's end over a dome instead of stopping at a flat disc, by
// appending stations that shrink along a quarter circle.
function _dome(st, top = 0, bottom = 0, steps = 3) {
  let out = st;
  if (bottom > 0) {
    const e = st[0], h = Math.min(e.rx, e.rz) * bottom, pre = [];
    for (let k = steps; k >= 1; k--) {
      const a = (k / (steps + 1)) * Math.PI / 2;
      pre.push({ ...e, y: e.y - h * Math.sin(a), rx: e.rx * Math.cos(a), rz: e.rz * Math.cos(a) });
    }
    out = pre.concat(out);
  }
  if (top > 0) {
    const e = st[st.length - 1], h = Math.min(e.rx, e.rz) * top;
    out = out.slice();
    for (let k = 1; k <= steps; k++) {
      const a = (k / (steps + 1)) * Math.PI / 2;
      out.push({ ...e, y: e.y + h * Math.sin(a), rx: e.rx * Math.cos(a), rz: e.rz * Math.cos(a) });
    }
  }
  return out;
}

// An armour plate that WRAPS the form underneath it: the same superellipse
// stations, swept over an angular arc only, offset outward by `t`.
//
// Modelled as a box, a plate reads as cargo strapped to a tube; following the
// surface is the whole difference between that and armour. The plate feathers to
// zero thickness at its top and bottom station, which both closes the surface
// (no cap needed) and blends it into the frame at the ends, while the two side
// rims stay crisp via duplicated corner vertices.
function _plateRings(st, a0, a1, t, seg) {
  const S = st.length;
  return st.map((q, s) => {
    const n = q.n ?? 2, x0 = q.x || 0, z0 = q.z || 0;
    const off = (s === 0 || s === S - 1) ? 0 : t * (q.k ?? 1);
    const arc = (o) => {
      const pts = [];
      for (let r = 0; r <= seg; r++) {
        const a = a0 + (a1 - a0) * (r / seg);
        const [x, z] = _se(a, q.rx + o, q.rz + o, n);
        pts.push([x0 + x, q.y, z0 + z]);
      }
      return pts;
    };
    const outer = arc(off), inner = arc(0);
    const ring = outer.slice();
    ring.push(outer[seg].slice(), inner[seg].slice());          // crisp rim at a1
    for (let r = seg; r >= 0; r--) ring.push(inner[r]);
    ring.push(inner[0].slice(), outer[0].slice());              // crisp rim at a0
    return ring;
  });
}

// ── Geometry cache ───────────────────────────────────────────────────────────
// Shapes depend only on their station list, so every character after the first
// of a given chassis reuses the buffers — which also lets the outline hull's
// WeakMap cache hit, and that (mergeVertices on every part) is the expensive
// half of building a body.
//
// Cached buffers are marked `userData.shared` and every teardown path has to
// honour it — one avatar calling dispose() on a buffer that eight other bodies
// are still drawing from empties all of them at once.
const _geoCache = new Map();
function _geo(key, make) {
  let g = _geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; _geoCache.set(key, g); }
  return g;
}

/** True for geometry owned by the shared cache — do NOT dispose it. */
export function isSharedGeometry(geo) { return !!geo?.userData?.shared; }

const _shift = (st, dy) => st.map(q => ({ ...q, y: q.y - dy }));
// Scale a station list's radii — used for the per-chassis `bulk`, with an
// optional per-station weight so a heavier chassis broadens across the chest
// without also inflating the neck and the waist.
const _bulk = (st, k) => (k === 1 ? st
  : st.map(q => ({ ...q, rx: q.rx * (1 + (k - 1) * (q.w ?? 1)),
                         rz: q.rz * (1 + (k - 1) * (q.w ?? 1) * 0.6) })));

/**
 * Add a lofted body part.
 *
 * @param {object} o
 *   y0      the mesh's own origin height — geometry is baked relative to it, so
 *           `mesh.position.y` stays meaningful (bots tag head parts by it)
 *   x, z    where the part sits; keep x on the limb axis so the rig's pivot
 *           lands where Locomotion expects, and put any sideways shape offset
 *           in the stations instead
 *   rot     optional [rx, ry, rz]
 */
function loft(g, st, mat, o = {}) {
  const { y0 = 0, x = 0, z = 0, radial = 20, top = 0, bottom = 0, name, rot } = o;
  const local = _dome(_shift(st, y0), top, bottom);
  const geo = _geo(`L${radial}|${JSON.stringify(local)}`,
                   () => _loftRings(_bodyRings(local, radial)));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y0, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (name) m.name = name;
  g.add(m);
  return m;
}

/** Add an armour plate wrapping the surface described by `st`. */
function plate(g, st, mat, o = {}) {
  const { y0 = 0, x = 0, z = 0, a0, a1, t = 0.024, seg = 9, name, rot } = o;
  const local = _shift(st, y0);
  const geo = _geo(`P${a0.toFixed(3)},${a1.toFixed(3)},${t},${seg}|${JSON.stringify(local)}`,
                   () => _loftRings(_plateRings(local, a0, a1, t, seg), false));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y0, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (name) m.name = name;
  g.add(m);
  return m;
}

// ── Remaining hard primitives (rivets, teeth, glow nubs, eye sockets) ────────
// Cached like the lofts are, so a body shares every buffer it uses, not most.
const box = (w, h, d, m) =>
  new THREE.Mesh(_geo(`B${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), m);
const cyl = (r, h, m, s = 12) =>
  new THREE.Mesh(_geo(`C${r},${h},${s}`, () => new THREE.CylinderGeometry(r, r, h, s)), m);
const sph = (r, m, w = 16, h = 12) =>
  new THREE.Mesh(_geo(`S${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)), m);
function put(g, mesh, x, y, z, rx = 0, ry = 0, rz = 0, name) {
  mesh.position.set(x, y, z);
  if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
  if (name) mesh.name = name;
  g.add(mesh);
  return mesh;
}
// red glow nub
function glowAt(g, M, x, y, z, w = 0.05, h = 0.05, d = 0.03) { put(g, box(w, h, d, M.glow), x, y, z); }

// Arcs on the superellipse, named for readability. FRONT is −Z.
const FRONT = -Math.PI / 2, BACK = Math.PI / 2, OUT = 0;
const arc = (centre, half) => [centre - half, centre + half];

// ═══════════════════════════════════════════════════════════════════════════
// Station tables — the actual anatomy
// ═══════════════════════════════════════════════════════════════════════════

// Hip 1.21 → knee 0.62. Quad bellies out at the top and tapers into the knee.
const THIGH = [
  { y: 1.215, rx: 0.100, rz: 0.108, n: 2.2 },
  { y: 1.140, rx: 0.113, rz: 0.125, n: 2.2 },
  { y: 1.050, rx: 0.117, rz: 0.129, n: 2.2, z: -0.006 },
  { y: 0.940, rx: 0.111, rz: 0.122, n: 2.2, z: -0.008 },
  { y: 0.830, rx: 0.100, rz: 0.110, n: 2.2, z: -0.006 },
  { y: 0.730, rx: 0.089, rz: 0.097, n: 2.2 },
  { y: 0.655, rx: 0.080, rz: 0.085, n: 2.2 },
];
// Knee 0.62 → ankle 0.27. Calf sits BEHIND the shin bone, which is what stops a
// leg from reading as a broom handle.
const CALF = [
  { y: 0.640, rx: 0.079, rz: 0.085, n: 2.1 },
  { y: 0.570, rx: 0.085, rz: 0.099, n: 2.1, z: 0.011 },
  { y: 0.500, rx: 0.083, rz: 0.098, n: 2.1, z: 0.015 },
  { y: 0.430, rx: 0.071, rz: 0.083, n: 2.1, z: 0.011 },
  { y: 0.360, rx: 0.056, rz: 0.063, n: 2.1, z: 0.004 },
  { y: 0.300, rx: 0.047, rz: 0.051, n: 2.1 },
];
// Ankle column — part of the FOOT group, so it rolls with the toe-off.
const ANKLE = [
  { y: 0.085, rx: 0.063, rz: 0.064, n: 2.4 },
  { y: 0.165, rx: 0.058, rz: 0.059, n: 2.2 },
  { y: 0.245, rx: 0.055, rz: 0.057, n: 2.1 },
  { y: 0.320, rx: 0.050, rz: 0.053, n: 2.1 },
];
// The boot, swept HEEL → TOE (built along +Y, then laid down by a −90° X turn,
// so a station's `rz` is its height and `z` its height above the floor).
// Every station has z == rz, which puts the sole exactly on y = 0 across the
// whole footprint — the plane Locomotion's ground solve assumes.
const FOOT = [
  { y: 0.000, rx: 0.044, rz: 0.042, z: 0.042, n: 2.6 },
  { y: 0.045, rx: 0.058, rz: 0.056, z: 0.056, n: 2.8 },
  { y: 0.105, rx: 0.063, rz: 0.058, z: 0.058, n: 3.0 },
  { y: 0.175, rx: 0.064, rz: 0.048, z: 0.048, n: 3.2 },
  { y: 0.245, rx: 0.058, rz: 0.035, z: 0.035, n: 3.2 },
  { y: 0.295, rx: 0.042, rz: 0.024, z: 0.024, n: 3.0 },
];
// Pelvic floor → neck root, in one piece. Wide hips, cut waist, deep chest,
// clavicle shelf, traps sweeping up to the neck. `w` weights the chassis bulk.
const TORSO = [
  { y: 1.000, rx: 0.128, rz: 0.098, n: 2.6, w: 0.0 },
  { y: 1.080, rx: 0.156, rz: 0.114, n: 2.8, w: 0.1 },
  { y: 1.160, rx: 0.160, rz: 0.112, n: 2.8, w: 0.1 },
  { y: 1.240, rx: 0.141, rz: 0.101, n: 2.7, w: 0.2 },
  { y: 1.320, rx: 0.132, rz: 0.097, n: 2.6, w: 0.3 },
  { y: 1.400, rx: 0.143, rz: 0.105, n: 2.7, w: 0.6 },
  { y: 1.480, rx: 0.161, rz: 0.114, n: 2.8, w: 0.9 },
  { y: 1.560, rx: 0.177, rz: 0.119, n: 2.9, w: 1.0 },
  { y: 1.630, rx: 0.179, rz: 0.116, n: 2.9, w: 1.0 },
  { y: 1.690, rx: 0.158, rz: 0.106, n: 2.8, w: 0.6 },
  { y: 1.740, rx: 0.112, rz: 0.088, n: 2.5, w: 0.2 },
  { y: 1.790, rx: 0.070, rz: 0.064, n: 2.3, w: 0.0 },
];
// Shoulder pivot is 1.76; the bicep starts under the static deltoid cap at 1.70
// so it never slides out from under it at extreme swings.
const UARM = [
  { y: 1.700, rx: 0.086, rz: 0.090, n: 2.1 },
  { y: 1.625, rx: 0.091, rz: 0.095, n: 2.1, z: -0.004 },
  { y: 1.540, rx: 0.083, rz: 0.089, n: 2.1, z: -0.006 },
  { y: 1.450, rx: 0.074, rz: 0.081, n: 2.1, z: -0.005 },
  { y: 1.370, rx: 0.066, rz: 0.072, n: 2.1 },
  { y: 1.300, rx: 0.058, rz: 0.062, n: 2.1 },
];
// Elbow 1.28 → wrist ~0.91, flexor mass just below the elbow.
const FARM = [
  { y: 1.280, rx: 0.058, rz: 0.062, n: 2.1 },
  { y: 1.210, rx: 0.067, rz: 0.073, n: 2.1 },
  { y: 1.130, rx: 0.062, rz: 0.068, n: 2.1 },
  { y: 1.040, rx: 0.050, rz: 0.055, n: 2.1 },
  { y: 0.960, rx: 0.041, rz: 0.046, n: 2.2 },
  { y: 0.912, rx: 0.036, rz: 0.042, n: 2.3 },
];
// A palm is wide and thin, not a cube.
const HAND = [
  { y: 0.918, rx: 0.038, rz: 0.044, n: 2.3 },
  { y: 0.888, rx: 0.047, rz: 0.040, n: 2.8 },
  { y: 0.856, rx: 0.050, rz: 0.036, n: 3.0 },
  { y: 0.826, rx: 0.047, rz: 0.033, n: 3.0 },
];
const FINGER = [
  { y: 0.826, rx: 0.011, rz: 0.011, n: 2.4 },
  { y: 0.790, rx: 0.010, rz: 0.010, n: 2.4 },
  { y: 0.762, rx: 0.009, rz: 0.009, n: 2.4 },
];
const NECK = [
  { y: 1.720, rx: 0.062, rz: 0.060, n: 2.3 },
  { y: 1.790, rx: 0.056, rz: 0.055, n: 2.2 },
  { y: 1.850, rx: 0.055, rz: 0.056, n: 2.2 },
];
// Chin → crown. The face stations run a HIGH n on purpose: a rounded-rectangle
// cross-section gives the skull a flat face plane, flat temples and a squared
// jaw — the terminator read — while the crown drops back toward n 2.4 and
// rounds over. Push it all round and the head becomes an egg, which is what the
// first pass at this did.
const SKULL = [
  { y: 1.838, rx: 0.052, rz: 0.062, z: -0.026, n: 2.6 },   // chin
  { y: 1.876, rx: 0.074, rz: 0.092, z: -0.016, n: 2.9 },   // jaw
  { y: 1.922, rx: 0.087, rz: 0.104, z: -0.010, n: 3.1 },   // cheekbone
  { y: 1.980, rx: 0.096, rz: 0.112, z: -0.002, n: 3.2 },   // eye line
  { y: 2.038, rx: 0.101, rz: 0.116, z:  0.004, n: 3.0 },   // brow / temple
  { y: 2.092, rx: 0.099, rz: 0.112, z:  0.010, n: 2.7 },   // cranium
  { y: 2.140, rx: 0.086, rz: 0.096, z:  0.014, n: 2.5 },
  { y: 2.178, rx: 0.058, rz: 0.064, z:  0.016, n: 2.4 },   // crown
];

// ── Metal SKULL head — the signature terminator face ─────────────────────────
function _skull(g, M) {
  // Cranium + jaw as one continuous form, so the face is a face rather than a
  // sphere sitting on a box.
  loft(g, SKULL, M.bone, { y0: 2.00, radial: 22, top: 0.55 });
  // Machined cranial cap, seamed onto the skull — a smooth head with no seam is
  // just an egg no matter how well the face underneath is modelled. Same metal
  // as the skull, though: a contrasting cap reads as a helmet, not as a cranium.
  plate(g, SKULL.slice(4), M.bone,
        { y0: 2.00, a0: -Math.PI, a1: Math.PI, t: 0.012, seg: 22 });
  plate(g, SKULL.slice(3, 6), M.joint,
        { y0: 2.00, a0: -Math.PI, a1: Math.PI, t: 0.005, seg: 22 });   // the seam itself
  // Rivets along the seam
  for (const s of [-1, 1]) put(g, box(0.026, 0.026, 0.026, M.joint), s * 0.076, 2.100, 0.024);
  put(g, box(0.026, 0.026, 0.026, M.joint), 0, 2.156, -0.030);
  // Brow ridge, deep eye-socket recess, glowing optics
  put(g, box(0.182, 0.030, 0.05, M.joint), 0, 2.026, -0.098);
  put(g, box(0.166, 0.056, 0.040, M.joint), 0, 1.982, -0.106);
  for (const s of [-1, 1]) glowAt(g, M, s * 0.045, 1.982, -0.124, 0.05, 0.036, 0.03);
  // Temple frames + nose ridge
  for (const s of [-1, 1]) put(g, box(0.034, 0.148, 0.112, M.frame), s * 0.094, 1.992, 0.006);
  put(g, box(0.028, 0.058, 0.038, M.bone), 0, 1.928, -0.108);
  // Jaw seam — the hinge line that separates the mandible from the skull
  plate(g, SKULL.slice(0, 3), M.joint,
        { y0: 2.00, a0: -Math.PI, a1: Math.PI, t: 0.006, seg: 20 });
  // Bared metal teeth (individual segments → a grin)
  put(g, box(0.126, 0.046, 0.030, M.joint), 0, 1.886, -0.098);
  put(g, box(0.112, 0.030, 0.026, M.steel), 0, 1.889, -0.104);
  for (let i = 0; i < 6; i++)
    put(g, box(0.006, 0.032, 0.022, M.joint), -0.05 + i * 0.02, 1.889, -0.112);
  // Neck + its actuator rods
  loft(g, NECK, M.frame, { y0: 1.79, radial: 16 });
  for (const s of [-1, 1]) put(g, cyl(0.016, 0.12, M.steel, 8), s * 0.048, 1.800, 0.036);
}

// ── Shared endoskeleton body — HUMAN anatomy (muscle frame + armour plates) ──
function _endoBase(g, M, cfg) {
  const { bulk = 1.0 } = cfg;
  const AW = M.armor, A2 = M.armor2, FR = M.frame, JT = M.joint;
  const thigh = _bulk(THIGH, bulk), uarm = _bulk(UARM, bulk);

  // ── Legs (left −0.11 / right +0.11) ────────────────────────────────────────
  // Muscle first, then plates that wrap it. Every mesh sits at x = ±0.11 so the
  // hip pivot lands exactly on the limb axis; the outer thigh light's sideways
  // offset lives in its stations, not in its position.
  for (const [sx, sd] of [[-0.11, 'L'], [0.11, 'R']]) {
    const out = sd === 'L' ? -1 : 1;

    // Foot: heel at z +0.10, toe at z −0.20, sole flat on y 0.
    loft(g, FOOT, JT, { x: sx, z: 0.10, rot: [-Math.PI / 2, 0, 0], top: 0.6,
                        radial: 18, name: `boot_${sd}` });
    plate(g, FOOT.slice(1), AW, { x: sx, z: 0.10, rot: [-Math.PI / 2, 0, 0],
                                  a0: arc(BACK, 1.15)[0], a1: arc(BACK, 1.15)[1],
                                  t: 0.020, name: `boot_${sd}_a` });   // instep armour
    put(g, box(0.104, 0.052, 0.062, AW), sx, 0.030, -0.176, 0, 0, 0, `boot_${sd}_t`);  // toe cap
    loft(g, ANKLE, JT, { x: sx, y0: 0.20, z: 0.012, radial: 14, name: `boot_${sd}_u` });

    // Shin + calf
    loft(g, CALF, FR, { x: sx, y0: 0.46, radial: 18, name: `lleg_${sd}` });
    plate(g, CALF.slice(0, 5), AW, { x: sx, y0: 0.46, a0: arc(FRONT, 1.02)[0],
                                     a1: arc(FRONT, 1.02)[1], t: 0.026,
                                     name: `lleg_${sd}_p` });

    // Knee
    put(g, sph(0.084, JT, 16, 12), sx, 0.622, 0.002, 0, 0, 0, `knee_${sd}`);
    plate(g, [{ y: 0.552, rx: 0.078, rz: 0.082, n: 2.2 },
              { y: 0.600, rx: 0.087, rz: 0.090, n: 2.2 },
              { y: 0.645, rx: 0.088, rz: 0.091, n: 2.2 },
              { y: 0.692, rx: 0.078, rz: 0.082, n: 2.2 }], AW,
          { x: sx, y0: 0.62, a0: arc(FRONT, 0.95)[0], a1: arc(FRONT, 0.95)[1],
            t: 0.028, name: `knee_${sd}_p` });
    put(g, box(0.048, 0.042, 0.026, M.glow), sx, 0.628, -0.112, 0, 0, 0, `knee_${sd}_g`);

    // Thigh
    loft(g, thigh, FR, { x: sx, y0: 0.94, radial: 20, name: `thigh_${sd}` });
    plate(g, thigh.slice(1, 6), AW, { x: sx, y0: 0.94, a0: arc(FRONT, 0.78)[0],
                                      a1: arc(FRONT, 0.78)[1], t: 0.026,
                                      name: `thigh_${sd}_p` });
    plate(g, [{ y: 0.880, rx: 0.107, rz: 0.118, n: 2.2 },
              { y: 0.930, rx: 0.112, rz: 0.123, n: 2.2 },
              { y: 0.990, rx: 0.115, rz: 0.127, n: 2.2 },
              { y: 1.040, rx: 0.112, rz: 0.124, n: 2.2 }], M.glow,
          { x: sx, y0: 0.94, a0: out > 0 ? -0.30 : Math.PI + 0.30,
            a1: out > 0 ? 0.30 : Math.PI - 0.30, t: 0.014, seg: 5,
            name: `thigh_${sd}_gl` });                                  // outer thigh light
  }

  // ── Torso: one lofted trunk, pelvis to neck root ───────────────────────────
  loft(g, _bulk(TORSO, bulk), FR, { y0: 1.40, radial: 26 });

  // Hip plates
  for (const s of [-1, 1]) {
    plate(g, TORSO.slice(0, 4), AW,
          { y0: 1.40, a0: s > 0 ? -0.62 : Math.PI + 0.62, a1: s > 0 ? 0.62 : Math.PI - 0.62,
            t: 0.028, seg: 7 });
  }
  glowAt(g, M, 0, 1.150, -0.104, 0.05, 0.05, 0.03);

  // Abdominal plates — stacked, each wrapping the waist
  for (let i = 0; i < 3; i++) {
    const y = 1.255 + i * 0.072;
    plate(g, [{ y: y - 0.034, rx: 0.130, rz: 0.096, n: 2.6 },
              { y: y - 0.014, rx: 0.136, rz: 0.100, n: 2.6 },
              { y: y + 0.014, rx: 0.137, rz: 0.101, n: 2.6 },
              { y: y + 0.030, rx: 0.130, rz: 0.096, n: 2.6 }], A2,
          { y0: 1.30, a0: arc(FRONT, 0.95)[0], a1: arc(FRONT, 0.95)[1], t: 0.022 });
  }
  glowAt(g, M, 0, 1.330, -0.116, 0.045, 0.06, 0.03);

  // Pectorals — one broad plate per side sweeping from the sternum round to the
  // armpit. They stop short of the centre line on purpose: the dark frame
  // between them IS the sternum groove, which reads as a chest rather than as a
  // bib the moment the two halves stop touching.
  const CHEST = [{ y: 1.450, rx: 0.148, rz: 0.107, n: 2.8 },
                 { y: 1.505, rx: 0.164, rz: 0.115, n: 2.8 },
                 { y: 1.565, rx: 0.176, rz: 0.119, n: 2.9 },
                 { y: 1.618, rx: 0.176, rz: 0.117, n: 2.9 },
                 { y: 1.660, rx: 0.164, rz: 0.110, n: 2.9 }];
  for (const s of [-1, 1]) {
    plate(g, CHEST, AW, { y0: 1.55, a0: FRONT + s * 0.13, a1: FRONT + s * 1.02,
                          t: 0.030, seg: 9 });
  }
  // A thin dark keel sunk into the groove, so the split has an edge to it.
  plate(g, CHEST.slice(0, 4), FR, { y0: 1.55, a0: FRONT - 0.10, a1: FRONT + 0.10,
                                    t: 0.013, seg: 3 });
  glowAt(g, M, 0, 1.455, -0.138, 0.04, 0.05, 0.03);

  // Clavicle collar — rings the whole chest opening and carries the value up to
  // the shoulders, which is what keeps the upper body from going to a black mass.
  plate(g, [{ y: 1.638, rx: 0.176, rz: 0.117, n: 2.9 },
            { y: 1.672, rx: 0.168, rz: 0.112, n: 2.8 },
            { y: 1.706, rx: 0.150, rz: 0.102, n: 2.8 },
            { y: 1.736, rx: 0.116, rz: 0.090, n: 2.6 }], A2,
        { y0: 1.68, a0: -Math.PI * 1.32, a1: Math.PI * 0.32, t: 0.024, seg: 22 });

  // Back unit
  plate(g, [{ y: 1.440, rx: 0.144, rz: 0.106, n: 2.8 },
            { y: 1.500, rx: 0.162, rz: 0.115, n: 2.8 },
            { y: 1.580, rx: 0.178, rz: 0.119, n: 2.9 },
            { y: 1.650, rx: 0.168, rz: 0.112, n: 2.9 }], FR,
        { y0: 1.55, a0: arc(BACK, 0.52)[0], a1: arc(BACK, 0.52)[1], t: 0.040, seg: 6 });

  // ── Deltoids + draping pauldron armour (STATIC — they stay on the shoulder
  //    while the arm swings under them) ──────────────────────────────────────
  for (const [sx, sd] of [[-0.255, 'L'], [0.255, 'R']]) {
    const out = sd === 'L' ? -1 : 1;
    // Deltoid muscle
    loft(g, [{ y: 1.530, rx: 0.074, rz: 0.080, n: 2.2 },
             { y: 1.598, rx: 0.098, rz: 0.100, n: 2.3 },
             { y: 1.662, rx: 0.105, rz: 0.106, n: 2.4 },
             { y: 1.722, rx: 0.091, rz: 0.092, n: 2.4 },
             { y: 1.766, rx: 0.060, rz: 0.062, n: 2.3 }], FR,
         { x: sx, y0: 1.66, radial: 18, top: 0.7 });
    // Pauldron — a plate DRAPED over the outboard face, flaring at its lower
    // edge. Swept right round the deltoid it just makes a white sphere; the
    // shoulder only reads as armour when the dark muscle shows under it.
    const PAUL = [{ y: 1.512, rx: 0.100, rz: 0.104, n: 2.5 },
                  { y: 1.550, rx: 0.117, rz: 0.119, n: 2.5 },
                  { y: 1.602, rx: 0.111, rz: 0.113, n: 2.5 },
                  { y: 1.662, rx: 0.109, rz: 0.110, n: 2.6 },
                  { y: 1.716, rx: 0.095, rz: 0.096, n: 2.6 },
                  { y: 1.762, rx: 0.064, rz: 0.066, n: 2.4 }];
    const pa = out > 0 ? 0 : Math.PI;
    plate(g, PAUL, AW, { x: sx, y0: 1.66, a0: pa - out * 1.06, a1: pa + out * 1.06,
                         t: 0.030, seg: 11 });
    plate(g, PAUL.slice(0, 3), A2, { x: sx, y0: 1.66, a0: pa - out * 1.06,
                                     a1: pa + out * 1.06, t: 0.040, seg: 11 });
    glowAt(g, M, sx + out * 0.05, 1.630, -0.088, 0.04, 0.04, 0.03);
  }

  // ── Arms (left −0.27 / right +0.27) ────────────────────────────────────────
  for (const [sx, sd] of [[-0.27, 'L'], [0.27, 'R']]) {
    loft(g, uarm, FR, { x: sx, y0: 1.50, radial: 18, name: `uarm_${sd}` });
    put(g, sph(0.060, JT, 14, 10), sx, 1.280, 0.004, 0, 0, 0, `elbow_${sd}`);
    loft(g, FARM, FR, { x: sx, y0: 1.09, radial: 18, name: `farm_${sd}` });
    plate(g, FARM.slice(0, 5), AW, { x: sx, y0: 1.09, a0: arc(FRONT, 1.25)[0],
                                     a1: arc(FRONT, 1.25)[1], t: 0.028,
                                     name: `farm_${sd}_p` });
    put(g, box(0.028, 0.085, 0.022, M.glow), sx, 1.090, -0.092, 0, 0, 0, `farm_${sd}_g`);
    loft(g, HAND, JT, { x: sx, y0: 0.895, radial: 16, bottom: 0.8, name: `hand_${sd}` });
    // Fingers, offset symmetrically about the hand so the arm pivot's mean x
    // stays exactly on ±0.27.
    for (let f = 0; f < 3; f++) {
      loft(g, FINGER.map(q => ({ ...q, x: (f - 1) * 0.026, z: -0.026 })), JT,
           { x: sx, y0: 0.795, radial: 8, bottom: 0.9, name: `hand_${sd}_f${f}` });
    }
  }

  _skull(g, M);
}

function _build(id) {
  const pal = PALETTES[id] || PALETTES.vanguard;
  const M = makeBodyMaterials(pal);
  const g = new THREE.Group();
  _endoBase(g, M, { bulk: pal.bulk });
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  _addOutlines(g);
  g.userData = { isLowPoly: true, armorTypeId: id, primaryMat: M.armor, secondaryMat: M.armor2 };
  return g;
}

// ── Public builder ───────────────────────────────────────────────────────────
// Ship the connected, graded-weight surface. The rigid block chassis remains
// available through BlockBody.js for tooling/comparison, but it reads as armor
// pieces pasted onto a mannequin in the normal third-person view.
export function buildLowPolyCharacter(id = 'vanguard') {
  return buildHeroBody(id);
}

/**
 * The lofted, graded-weight body. Kept and still gated: it is the technique
 * for anything organic, and the block chassis is not a replacement for it —
 * a limb that has to CREASE at a joint still needs weights blended along its
 * length, which rigid plates cannot do.
 */
export function buildLoftedCharacter(id = 'vanguard') {
  return buildHeroBody(id);
}

/** The previous parts-on-pivots body, kept for comparison. */
export function buildSegmentedCharacter(id = 'vanguard') {
  return _build(id);
}
