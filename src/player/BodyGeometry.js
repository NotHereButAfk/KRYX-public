// ═══════════════════════════════════════════════════════════════════════════
// Skinned-surface construction for the player body.
//
// The body used to be a parts bin bolted onto pivot groups: a thigh tube, a
// knee ball, a calf tube, each rigid, each rotating about its own joint. Bend a
// knee past about 60° and it reads as exactly that — two pipes sliding past one
// another with a ball wedged in the gap. No amount of extra geometry fixes it,
// because the problem is that the surface is DISCONTINUOUS across the joint.
//
// So a limb is now ONE surface running from hip to ankle, and it bends because
// its vertices are weighted between bones. That is what a character model is.
//
// Two things here are deliberately not the usual approach:
//
//   1. Weights are DERIVED, not painted and not guessed from bone proximity.
//      Generic auto-skinning weights a vertex by its distance to nearby bone
//      segments, which on a humanoid bleeds across the gap between the thighs
//      (0.22 apart, limbs 0.1 thick — the inner thigh is nearly as close to the
//      far bone as its own). Here the surfaces are generated, so every vertex
//      already knows which limb it belongs to and how far along it sits. The
//      blend comes straight out of that: exact, symmetric, and with no chance
//      of a left-leg vertex picking up the right femur.
//
//   2. The blend is a smoothstep over a band around each joint, sized to the
//      flesh that actually creases there — wider at the knee than the wrist.
//      Linear blend skinning pinches at a bend, so joint bands also carry extra
//      cross-sections and a slight radius gain, which is the cheap standard
//      answer to the "candy wrapper" collapse.
// ═══════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';

// Superellipse cross-section, |x/rx|^n + |z/rz|^n = 1. One curve covers a round
// bicep (n 2), a ribcage that is wider than it is deep (n ~2.8) and the flat
// sole of a boot (n ~3.2) — see the station tables in HeroBody.js.
export function sePoint(a, rx, rz, n) {
  const e = 2 / n, ca = Math.cos(a), sa = Math.sin(a);
  return [Math.sign(ca) * rx * Math.pow(Math.abs(ca), e),
          Math.sign(sa) * rz * Math.pow(Math.abs(sa), e)];
}

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Weight a point between the bones of a limb chain, from where it sits along
 * that limb.
 *
 * @param {Array} chain  [{ y, bone, band }] joints from the top down. `band` is
 *   the half-height of the crease around that joint — how much flesh moves with
 *   it. A knee creases over a wider band than a wrist.
 * @param {number} y     height of the point in bind pose
 * @returns {Array} [[boneIndex, weight], ...] summing to 1
 */
export function chainWeights(chain, y) {
  // Above the first joint or below the last, the point belongs entirely to the
  // end bone — a hip vertex does not get pulled by the knee.
  if (y >= chain[0].y) return [[chain[0].bone, 1]];
  const last = chain[chain.length - 1];
  if (y <= last.y) return [[last.bone, 1]];

  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    if (y > b.y) {
      // Inside the crease band around b, hand over to b; above it, all a.
      const t = smoothstep((b.y + b.band - y) / (2 * b.band));
      return t <= 0 ? [[a.bone, 1]]
           : t >= 1 ? [[b.bone, 1]]
           : [[a.bone, 1 - t], [b.bone, t]];
    }
  }
  return [[last.bone, 1]];
}

/**
 * Loft a stack of superelliptical cross-sections into one welded, smooth
 * surface, carrying skin weights.
 *
 * Stations are { y, rx, rz, n, x, z, bones } where `bones` is the weight list
 * for that ring. Rings are welded around the seam and up the stack, so normals
 * run continuously over the whole form: the join between a thigh and a calf is
 * not a join at all, it is just more of the same surface.
 */
export function loftSkinned(stations, radial, out) {
  const S = stations.length;
  const base = out.pos.length / 3;
  for (const st of stations) {
    const n = st.n ?? 2, x0 = st.x || 0, z0 = st.z || 0;
    for (let r = 0; r < radial; r++) {
      const [px, pz] = sePoint((r / radial) * Math.PI * 2, st.rx, st.rz, n);
      out.pos.push(x0 + px, st.y, z0 + pz);
      pushWeights(out, st.bones);
    }
  }
  // Which way the stations run decides the winding, and the tables here run
  // BOTH ways — the torso and the skull are authored bottom-up, the legs and
  // arms top-down. Wound blind, every descending table comes out inside-out:
  // its faces point into the form, so the renderer culls the surface you are
  // looking at and shows you the inside of the far wall instead. On a tube that
  // is nearly invisible (the inside of a limb looks like the outside of one),
  // but the lighting is then computed from a normal pointing the wrong way, and
  // an inverted-hull outline built off those normals collapses inward and fills
  // the limb with black. Both were live on this body: the legs and arms were
  // lit inside-out from the day they were written.
  const desc = S > 1 && stations[S - 1].y < stations[0].y;
  for (let s = 0; s < S - 1; s++) {
    for (let r = 0; r < radial; r++) {
      const a = base + s * radial + r, b = base + s * radial + (r + 1) % radial;
      if (desc) out.idx.push(a, b, b + radial, a, b + radial, a + radial);
      else out.idx.push(a, b + radial, b, a, a + radial, b + radial);
    }
  }
  // Close each end onto its ring centre. The pole shares the rim's weights, so
  // a capped end deforms with the rest of the form rather than tearing off it.
  const cap = (s, up) => {
    const c = out.pos.length / 3, st = stations[s];
    out.pos.push(st.x || 0, st.y, st.z || 0);
    pushWeights(out, st.bones);
    const outward = desc ? !up : up;
    for (let r = 0; r < radial; r++) {
      const a = base + s * radial + r, b = base + s * radial + (r + 1) % radial;
      if (outward) out.idx.push(a, c, b); else out.idx.push(a, b, c);
    }
  };
  if (out.capTop !== false) cap(S - 1, true);
  if (out.capBottom !== false) cap(0, false);
  return { base, count: out.pos.length / 3 - base };
}

/** Append a box, rigidly weighted to one bone (armour does not deform). */
export function boxSkinned(w, h, d, x, y, z, bone, out, rot) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateX(rot[0]), g.rotateY(rot[1]), g.rotateZ(rot[2]);
  g.translate(x, y, z);
  appendGeometry(g, [[bone, 1]], out);
  g.dispose();
}

/** Append an arbitrary BufferGeometry with one rigid bone weight. */
export function appendGeometry(geo, bones, out) {
  const base = out.pos.length / 3;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    out.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    pushWeights(out, bones);
  }
  const index = geo.index;
  if (index) for (let i = 0; i < index.count; i++) out.idx.push(base + index.getX(i));
  else for (let i = 0; i < p.count; i++) out.idx.push(base + i);
}

// Four influences per vertex is the hardware limit three.js binds to; the
// derived weights above never need more than two, so the rest are zero.
function pushWeights(out, bones) {
  const b = bones || [[0, 1]];
  for (let i = 0; i < 4; i++) {
    out.skinIndex.push(b[i] ? b[i][0] : 0);
    out.skinWeight.push(b[i] ? b[i][1] : 0);
  }
}

/** A fresh accumulator for one material's worth of surface. */
export function newBuffer() {
  return { pos: [], idx: [], skinIndex: [], skinWeight: [] };
}

/** Finish an accumulator into a skinnable BufferGeometry. */
export function toGeometry(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.skinWeight, 4));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  return g;
}
