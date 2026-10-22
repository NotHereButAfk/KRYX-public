// ═══════════════════════════════════════════════════════════════════════════
// The player / bot body: one skinned character, not a pile of parts.
//
// What changed and why
// ────────────────────
// The previous body was a set of rigid forms attached to pivot groups — a thigh
// tube, a knee ball, a calf tube — each rotating about its own joint. Every
// surface on it was smooth, and it still fell apart the moment a joint bent
// past about 60°, because smoothness within a part does nothing about the seam
// BETWEEN parts. At a crouch the leg read as two pipes sliding past each other.
//
// Here a limb is a single surface running hip → ankle, and it bends because its
// vertices are weighted between bones. Nothing slides past anything; the skin
// creases. That is the difference between a parts assembly and a character.
//
// ─── THE CONTRACT (do not move these) ────────────────────────────────────────
// Locomotion.js solves ground contact against a fixed leg chain, and
// RifleCarry.js IKs both arms against a fixed shoulder and fixed bone lengths.
// Neither derives anything from the mesh, so the body may be reshaped freely,
// but it has to be built on the same figure they solve against —
//
// every joint height, bone length and sole corner. They all come from
// Proportions.js — which is also where Locomotion and RifleCarry read them, so
// there is one figure rather than three copies of one.
//
// The rig object handed back exposes those joints under the names the animation
// already uses (legL/kneeL/ankleL/armL/elbowL/…), so applyWalkCycle(),
// applyRifleCarry() and Actions.js drive this body with no changes at all —
// they are setting bone rotations now instead of group rotations, and a bone is
// an Object3D like any other.
//
// `npm run test:mesh` measures every one of those numbers off the built body,
// plus the skinning itself: no unweighted vertex, no weight leaking across the
// gap between the legs, and joints that keep their volume when bent.
// ═══════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { getLowPolyPalette, makeBodyMaterials } from './LowPolyModels.js';
import * as BODY from './Proportions.js';
import { remapY, GIRTH as G, LEGACY as OLD } from './Proportions.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  chainWeights, loftSkinned, appendGeometry, newBuffer, toGeometry, sePoint,
} from './BodyGeometry.js';
import { attachUniversalAnimator } from './UniversalAnimations.js';

// Inverted-hull source: weld, re-smooth, push out along the normal. Welding
// keeps the contour continuous across a ring seam; the skin weights come along
// with it, so the outline deforms with the body rather than peeling off it.
function inflate(src, t) {
  let g = src.clone();
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++)
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  return g;
}

// ── Skeleton layout ──────────────────────────────────────────────────────────
// World-space rest positions. The four the animation drives are marked; the
// spine chain exists so the torso deforms as a torso rather than a barrel, and
// so there is somewhere to hang a future lean or aim twist.
const JOINTS = {
  root:      { at: [0, 0, 0],                          parent: null },
  hips:      { at: [0, BODY.PELVIS_Y, 0],              parent: 'root' },
  spine:     { at: [0, BODY.LUMBAR_Y, 0],              parent: 'hips' },
  chest:     { at: [0, BODY.THORAX_Y, 0],              parent: 'spine' },
  neck:      { at: [0, BODY.NECK_Y, 0],                parent: 'chest' },
  head:      { at: [0, BODY.HEAD_Y, 0],                parent: 'neck' },
  shoulderL: { at: [-BODY.SHOULDER_X, BODY.SHOULDER_Y, 0], parent: 'chest' },   // rig.armL
  elbowL:    { at: [-BODY.SHOULDER_X, BODY.ELBOW_Y, 0],    parent: 'shoulderL' },
  handL:     { at: [-BODY.SHOULDER_X, BODY.WRIST_Y, 0],    parent: 'elbowL' },
  shoulderR: { at: [BODY.SHOULDER_X, BODY.SHOULDER_Y, 0],  parent: 'chest' },   // rig.armR
  elbowR:    { at: [BODY.SHOULDER_X, BODY.ELBOW_Y, 0],     parent: 'shoulderR' },
  handR:     { at: [BODY.SHOULDER_X, BODY.WRIST_Y, 0],     parent: 'elbowR' },
  thighL:    { at: [-BODY.HIP_X, BODY.HIP_Y, 0],       parent: 'hips' },        // rig.legL
  kneeL:     { at: [-BODY.HIP_X, BODY.KNEE_Y, 0],      parent: 'thighL' },
  ankleL:    { at: [-BODY.HIP_X, BODY.ANKLE_Y, 0],     parent: 'kneeL' },
  thighR:    { at: [BODY.HIP_X, BODY.HIP_Y, 0],        parent: 'hips' },
  kneeR:     { at: [BODY.HIP_X, BODY.KNEE_Y, 0],       parent: 'thighR' },
  ankleR:    { at: [BODY.HIP_X, BODY.ANKLE_Y, 0],      parent: 'kneeR' },
};

// ── carrying the authored anatomy onto the new figure ────────────────────────
// The station tables below were shaped against the previous 2.21m figure. They
// are kept in that space and mapped, rather than 200 numbers being retyped:
// the map is piecewise-linear between the joints, so the quad belly, the calf
// and the ribcage taper land on the same part of the same bone instead of the
// whole body being uniformly squashed and every muscle drifting off its joint.
//
// Legs and arms need SEPARATE maps even though they overlap in height — the
// wrist sits between the knee and the hip, and a single global map would put it
// at 0.72 instead of 0.88.
const mapLeg   = remapY([[0, 0], [OLD.ANKLE_Y, BODY.ANKLE_Y],
                         [OLD.KNEE_Y, BODY.KNEE_Y], [OLD.HIP_Y, BODY.HIP_Y]]);
const mapArm   = remapY([[OLD.WRIST_Y, BODY.WRIST_Y], [OLD.ELBOW_Y, BODY.ELBOW_Y],
                         [OLD.SHOULDER_Y, BODY.SHOULDER_Y]]);
const mapTorso = remapY([[OLD.PELVIS_Y, BODY.PELVIS_Y], [OLD.LUMBAR_Y, BODY.LUMBAR_Y],
                         [OLD.THORAX_Y, BODY.THORAX_Y], [OLD.NECK_Y, BODY.NECK_Y],
                         [OLD.HEAD_Y, BODY.HEAD_Y]]);
const mapHead  = remapY([[OLD.CHIN_Y, BODY.CHIN_Y], [OLD.CROWN_Y, BODY.CROWN_Y]]);

/** Map a station table onto the new figure: heights by `m`, girth by GIRTH. */
function xf(tbl, m) {
  return tbl.map(q => ({
    ...q, y: m(q.y),
    rx: q.rx * G, rz: q.rz * G,
    dz: q.dz === undefined ? undefined : q.dz * G,
  }));
}

const BONE_ORDER = Object.keys(JOINTS);
const B = {};
BONE_ORDER.forEach((n, i) => { B[n] = i; });

function buildSkeleton() {
  const bones = {}, list = [];
  for (const name of BONE_ORDER) {
    const j = JOINTS[name];
    const bone = new THREE.Bone();
    bone.name = name;
    const p = j.parent ? JOINTS[j.parent].at : [0, 0, 0];
    bone.position.set(j.at[0] - p[0], j.at[1] - p[1], j.at[2] - p[2]);
    if (j.parent) bones[j.parent].add(bone);
    bones[name] = bone;
    list.push(bone);
  }
  return { root: bones.root, bones, list };
}

// ── Weight chains ────────────────────────────────────────────────────────────
// `band` is the half-height of the crease at that joint: how much flesh moves
// with it. Wider at a knee than a wrist, because a knee creases over more of
// the leg. These are the only tuning numbers in the skinning.
const legChain = (s) => [
  { y: BODY.HIP_Y,   bone: B['thigh' + s], band: 0.10 * G },
  { y: BODY.KNEE_Y,  bone: B['knee' + s],  band: 0.105 * G },
  { y: BODY.ANKLE_Y, bone: B['ankle' + s], band: 0.050 * G },
];
const armChain = (s) => [
  { y: BODY.SHOULDER_Y, bone: B['shoulder' + s], band: 0.085 * G },
  { y: BODY.ELBOW_Y,    bone: B['elbow' + s],    band: 0.080 * G },
  { y: BODY.WRIST_Y,    bone: B['hand' + s],     band: 0.045 * G },
];
const TORSO_CHAIN = [
  { y: BODY.HEAD_Y,   bone: B.head,  band: 0.045 * G },
  { y: BODY.NECK_Y,   bone: B.neck,  band: 0.055 * G },
  { y: BODY.THORAX_Y, bone: B.chest, band: 0.110 * G },
  { y: BODY.LUMBAR_Y, bone: B.spine, band: 0.110 * G },
  { y: BODY.PELVIS_Y, bone: B.hips,  band: 0.110 * G },
];

// ── Station tables ───────────────────────────────────────────────────────────
// Extra rings cluster around each joint: linear blend skinning pinches at a
// bend, and the cheap standard answer is more loops through the crease plus a
// touch of radius through it.
const LEG = [
  { y: 1.235, rx: 0.098, rz: 0.106, n: 2.2 },
  { y: 1.180, rx: 0.112, rz: 0.124, n: 2.2 },
  { y: 1.100, rx: 0.118, rz: 0.130, n: 2.2, dz: -0.006 },
  { y: 1.010, rx: 0.116, rz: 0.128, n: 2.2, dz: -0.008 },
  { y: 0.920, rx: 0.110, rz: 0.121, n: 2.2, dz: -0.008 },
  { y: 0.830, rx: 0.101, rz: 0.111, n: 2.2, dz: -0.006 },
  { y: 0.760, rx: 0.093, rz: 0.101, n: 2.2 },
  { y: 0.710, rx: 0.087, rz: 0.093, n: 2.15 },
  { y: 0.675, rx: 0.084, rz: 0.090, n: 2.15 },
  { y: 0.645, rx: 0.084, rz: 0.089, n: 2.10 },
  { y: 0.620, rx: 0.085, rz: 0.090, n: 2.10 },   // knee
  { y: 0.595, rx: 0.084, rz: 0.090, n: 2.10 },
  { y: 0.565, rx: 0.083, rz: 0.093, n: 2.10, dz: 0.006 },
  { y: 0.530, rx: 0.083, rz: 0.098, n: 2.10, dz: 0.012 },   // calf
  { y: 0.480, rx: 0.081, rz: 0.097, n: 2.10, dz: 0.014 },
  { y: 0.430, rx: 0.072, rz: 0.085, n: 2.10, dz: 0.011 },
  { y: 0.380, rx: 0.061, rz: 0.069, n: 2.10, dz: 0.006 },
  { y: 0.335, rx: 0.051, rz: 0.057, n: 2.10, dz: 0.002 },
  { y: 0.300, rx: 0.046, rz: 0.050, n: 2.10 },
  { y: 0.272, rx: 0.044, rz: 0.048, n: 2.10 },   // ankle
];
const ARM = [
  { y: 1.740, rx: 0.078, rz: 0.082, n: 2.15 },
  { y: 1.690, rx: 0.089, rz: 0.093, n: 2.15 },
  { y: 1.630, rx: 0.092, rz: 0.096, n: 2.10, dz: -0.004 },
  { y: 1.560, rx: 0.084, rz: 0.090, n: 2.10, dz: -0.006 },
  { y: 1.480, rx: 0.076, rz: 0.082, n: 2.10, dz: -0.005 },
  { y: 1.400, rx: 0.069, rz: 0.075, n: 2.10 },
  { y: 1.340, rx: 0.063, rz: 0.067, n: 2.10 },
  { y: 1.302, rx: 0.060, rz: 0.064, n: 2.10 },
  { y: 1.280, rx: 0.059, rz: 0.063, n: 2.10 },   // elbow
  { y: 1.258, rx: 0.060, rz: 0.065, n: 2.10 },
  { y: 1.220, rx: 0.065, rz: 0.071, n: 2.10 },
  { y: 1.170, rx: 0.063, rz: 0.069, n: 2.10 },
  { y: 1.100, rx: 0.057, rz: 0.062, n: 2.10 },
  { y: 1.030, rx: 0.049, rz: 0.054, n: 2.10 },
  { y: 0.965, rx: 0.041, rz: 0.046, n: 2.20 },
  { y: 0.925, rx: 0.036, rz: 0.042, n: 2.30 },   // wrist
];
const TORSO = [
  { y: 0.985, rx: 0.120, rz: 0.094, n: 2.6, w: 0.0 },
  { y: 1.060, rx: 0.152, rz: 0.112, n: 2.8, w: 0.1 },
  { y: 1.140, rx: 0.160, rz: 0.113, n: 2.8, w: 0.1 },
  { y: 1.210, rx: 0.148, rz: 0.106, n: 2.7, w: 0.2 },
  { y: 1.280, rx: 0.135, rz: 0.099, n: 2.6, w: 0.3 },
  { y: 1.340, rx: 0.131, rz: 0.097, n: 2.6, w: 0.4 },
  { y: 1.400, rx: 0.142, rz: 0.104, n: 2.7, w: 0.6 },
  { y: 1.460, rx: 0.157, rz: 0.112, n: 2.8, w: 0.9 },
  { y: 1.520, rx: 0.172, rz: 0.117, n: 2.9, w: 1.0 },
  { y: 1.580, rx: 0.178, rz: 0.117, n: 2.9, w: 1.0 },
  { y: 1.640, rx: 0.176, rz: 0.114, n: 2.9, w: 0.9 },
  { y: 1.690, rx: 0.156, rz: 0.105, n: 2.8, w: 0.6 },
  { y: 1.740, rx: 0.112, rz: 0.088, n: 2.5, w: 0.2 },
  { y: 1.800, rx: 0.068, rz: 0.062, n: 2.3, w: 0.0 },
];
// Boot, swept heel → toe. Built along +Y then laid down by a −90° X turn, so a
// station's rz is its height and dz its height above the floor. Every station
// has dz == rz, which puts the sole flat on y 0 across the whole footprint —
// the plane Locomotion's ground solve assumes.
const FOOT = [
  { y: 0.000, rx: 0.044, rz: 0.042, dz: 0.042, n: 2.6 },
  { y: 0.045, rx: 0.058, rz: 0.056, dz: 0.056, n: 2.8 },
  { y: 0.105, rx: 0.063, rz: 0.058, dz: 0.058, n: 3.0 },
  { y: 0.175, rx: 0.064, rz: 0.048, dz: 0.048, n: 3.2 },
  { y: 0.245, rx: 0.058, rz: 0.035, dz: 0.035, n: 3.2 },
  { y: 0.295, rx: 0.042, rz: 0.024, dz: 0.024, n: 3.0 },
];
const ANKLE = [
  { y: 0.085, rx: 0.063, rz: 0.064, n: 2.4 },
  { y: 0.165, rx: 0.058, rz: 0.059, n: 2.2 },
  { y: 0.245, rx: 0.055, rz: 0.057, n: 2.1 },
  { y: 0.300, rx: 0.048, rz: 0.051, n: 2.1 },
];
const HAND = [
  { y: 0.930, rx: 0.036, rz: 0.042, n: 2.3 },
  { y: 0.900, rx: 0.044, rz: 0.041, n: 2.6 },
  { y: 0.872, rx: 0.049, rz: 0.038, n: 2.9 },
  { y: 0.846, rx: 0.050, rz: 0.036, n: 3.0 },
  { y: 0.822, rx: 0.047, rz: 0.033, n: 3.0 },
];
const FINGER = [
  { y: 0.824, rx: 0.011, rz: 0.011, n: 2.4 },
  { y: 0.792, rx: 0.010, rz: 0.010, n: 2.4 },
  { y: 0.766, rx: 0.008, rz: 0.008, n: 2.4 },
];
// Chin → crown. High n through the face gives the skull a flat face plane and
// squared temples; the crown drops back toward 2.4 and rounds over.
const SKULL = [
  { y: 1.838, rx: 0.052, rz: 0.062, dz: -0.026, n: 2.6 },
  { y: 1.876, rx: 0.074, rz: 0.092, dz: -0.016, n: 2.9 },
  { y: 1.922, rx: 0.087, rz: 0.104, dz: -0.010, n: 3.1 },
  { y: 1.980, rx: 0.096, rz: 0.112, dz: -0.002, n: 3.2 },
  { y: 2.038, rx: 0.101, rz: 0.116, dz: 0.004, n: 3.0 },
  { y: 2.092, rx: 0.099, rz: 0.112, dz: 0.010, n: 2.7 },
  { y: 2.140, rx: 0.086, rz: 0.096, dz: 0.014, n: 2.5 },
  { y: 2.178, rx: 0.058, rz: 0.064, dz: 0.016, n: 2.4 },
];

// Round a station stack's end over a dome instead of stopping at a flat disc.
function domed(st, top = 0, bottom = 0, steps = 3) {
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

const scaled = (st, k, useW) => (k === 1 ? st : st.map(q => ({
  ...q,
  rx: q.rx * (1 + (k - 1) * (useW ? (q.w ?? 1) : 1)),
  rz: q.rz * (1 + (k - 1) * (useW ? (q.w ?? 1) : 1) * 0.6),
})));

// Place a station stack in the world and weight it.
//  `sx`  the limb's x axis; `weightAt` maps a station's bind height to bones.
function place(st, sx, weightAt, sz = 0) {
  return st.map(q => ({
    y: q.y, rx: q.rx, rz: q.rz, n: q.n,
    x: sx, z: sz + (q.dz || 0),
    bones: weightAt(q.y),
  }));
}

// ── Armour ───────────────────────────────────────────────────────────────────
// Plates are hard surfaces and do not deform — each is bound rigidly to one
// bone, so a shin plate rides the shin exactly instead of bending with it. They
// wrap the form underneath rather than hovering over it as a slab: a plate is a
// partial ring lofted along the same superellipse as the limb, offset outward,
// with crisp side rims from duplicated corner vertices and ends that feather
// into the frame.
// Every plate is generated from the SAME station radii as the surface beneath
// it, so its inner face lands exactly on that surface — two coincident sheets,
// which is a depth fight, and on a cel-shaded body it reads as black mottling
// crawling over the armour. GAP lifts the whole plate clear of what it covers.
const PLATE_GAP = 0.003;
// The end rings taper the plate to an edge rather than stopping it square — but
// they must not taper to NOTHING. At zero the outer and inner arcs land on the
// same points, mergeVertices welds them, and computeVertexNormals averages two
// opposing normals into ~zero. The lit body does not care (it never sees those
// faces edge-on), but the inverted-hull outline pushes every vertex along its
// normal, and a garbage normal throws that vertex somewhere arbitrary — the
// hull then slashes across the plate as dark hatching. On a two-station trim
// strip EVERY ring is an end ring, which is why the thin rims hatched solid.
const PLATE_EDGE = 0.0035;
// Thinnest a plate may be. The inverted-hull outline pushes every vertex
// OUT_T along its normal, so a shell thinner than twice that has its two faces
// swapped by the hull and the hull swallows the plate — it renders as black
// hatching where a trim strip should be. Trim thickness is not a free choice;
// it is bounded below by the outline weight.
const OUT_T = 0.0062;
const TRIM  = 0.016;

function plateGeometry(st, a0, a1, t, seg) {
  // The arc is a SPAN, not a direction — but half the call sites mirror a side
  // by writing it backwards (`pa - out*half` … `pa + out*half` with out = −1).
  // Swept backwards the triangles come out wound the other way, so the plate's
  // normals point INTO the body: the lit pass then culls the face you are
  // looking at, and the inverted-hull outline pushes the hull the wrong way and
  // fills the hole. Run every arc in increasing order and the span is identical.
  if (a1 < a0) { const s = a0; a0 = a1; a1 = s; }
  const S = st.length, pos = [], idx = [];
  const desc = S > 1 && st[S - 1].y < st[0].y;
  const rings = st.map((q, s) => {
    const n = q.n ?? 2, x0 = q.x || 0, z0 = q.z || 0;
    const end = (s === 0 || s === S - 1);
    const off = PLATE_GAP + (end ? Math.min(t, PLATE_EDGE) : t);
    // A station may author its own angular span. This is what allows a plate to
    // flare over the muscle belly and taper toward a joint instead of reading
    // as one constant-width rectangular strip wrapped around a cylinder.
    const ringA0 = q.a0 ?? a0, ringA1 = q.a1 ?? a1;
    const arc = (o) => {
      const pts = [];
      for (let r = 0; r <= seg; r++) {
        const a = ringA0 + (ringA1 - ringA0) * (r / seg);
        const [x, z] = sePoint(a, q.rx + o, q.rz + o, n);
        pts.push([x0 + x, q.y, z0 + z]);
      }
      return pts;
    };
    const outer = arc(off), inner = arc(PLATE_GAP), ring = outer.slice();
    ring.push(outer[seg].slice(), inner[seg].slice());
    for (let r = seg; r >= 0; r--) ring.push(inner[r]);
    ring.push(inner[0].slice(), outer[0].slice());
    return ring;
  });
  const N = rings[0].length;
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  for (let s = 0; s < S - 1; s++) {
    for (let r = 0; r < N; r++) {
      // Same station-order rule as loftSkinned: a plate cut from a descending
      // table (a shin plate, a tasset, the cape) is wound the other way round.
      const a = s * N + r, b = s * N + (r + 1) % N;
      if (desc) idx.push(a, b, b + N, a, b + N, a + N);
      else idx.push(a, b + N, b, a, a + N, b + N);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const FRONT = -Math.PI / 2, BACK = Math.PI / 2;
const arc = (c, half) => [c - half, c + half];
const shapedArc = (st, center, halves) => st.map((q, i) => {
  const c = Array.isArray(center)
    ? center[Math.min(i, center.length - 1)]
    : center;
  const h = halves[Math.min(i, halves.length - 1)];
  return { ...q, a0: c - h, a1: c + h };
});

// Take a longitudinal facet from an already shaped plate. Adjacent bands share
// the same authored outline, so colour changes read as planes in one ceramic
// shell rather than extra pads glued on top of a trouser leg.
const arcBand = (st, from, to) => st.map(q => {
  const a0 = q.a0, span = q.a1 - q.a0;
  return { ...q, a0: a0 + span * from, a1: a0 + span * to };
});

// A trim strip that hugs ONE edge of a plate instead of covering half of it.
//
// Trims were being cut with `st.slice(2)` — three of a five-station plate, so
// 60% of every panel was pale trim and the armour read as two-tone stripes
// rather than a plate with a lit edge. This walks `frac` of the way back from
// the end station toward the previous one and lands three rings in that sliver:
// three because a two-ring plate is all end-rings and degenerates, and `frac`
// small because an edge highlight is an edge.
function edgeStrip(st, frac = 0.30, atEnd = true) {
  const i = atEnd ? st.length - 1 : 0, j = atEnd ? st.length - 2 : 1;
  const a = st[i], b = st[j];
  const lerp = (u) => {
    const q = { ...a };
    for (const k of ['y', 'rx', 'rz', 'z', 'dz']) {
      if (a[k] === undefined || b[k] === undefined) continue;
      q[k] = a[k] + (b[k] - a[k]) * u;
    }
    return q;
  };
  const out = [lerp(0), lerp(frac * 0.5), lerp(frac)];
  return atEnd ? out.reverse() : out;
}

// `o.lift` raises the plate's station radii before it is built — how a rim
// stacks ON another plate rather than through it. Without it a trim strip built
// from its parent's stations shares that parent's inner face and fights it.
// `o.hard` overrides the superellipse exponent: the station tables carry the
// exponent of the BODY under the plate (n ≈ 2.2, a round limb), so armour built
// straight off them comes out as an inflated pillow wrapped round the arm. A
// plate is a pressed sheet — it wants a flat face and a tight corner, which is
// a high exponent. This is the single biggest difference between armour that
// reads as armour and armour that reads as upholstery.
function addPlate(buf, st, sx, bone, o) {
  const lift = o.lift || 0;
  const placed = st.map(q => ({
    ...q, rx: q.rx + lift, rz: q.rz + lift,
    n: o.hard ?? q.n,
    x: sx, z: (q.z || 0) + (q.dz || 0),
  }));
  const g = plateGeometry(placed, o.a0, o.a1, o.t ?? 0.024, o.seg ?? 9);
  if (o.rot) { g.rotateX(o.rot[0] || 0); }
  if (o.at) g.translate(o.at[0], o.at[1], o.at[2]);
  appendGeometry(g, [[bone, 1]], buf);
  g.dispose();
}

function addBox(buf, w, h, d, x, y, z, bone, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  appendGeometry(g, [[bone, 1]], buf);
  g.dispose();
}

// An eight-sided, lightly bevelled hard-surface panel. BoxGeometry was useful
// for tiny hidden supports, but using it for every visible detail left the suit
// looking assembled from toy blocks. This produces clipped corners, a raised
// rim and real highlight-catching bevels while remaining cheap enough to merge
// into the same seven skinned draw calls as the rest of the body.
function addChamferedPanel(buf, w, h, d, x, y, z, bone, o = {}) {
  const c = Math.min(o.chamfer ?? Math.min(w, h) * 0.16, w * 0.34, h * 0.34);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + c, -h / 2);
  shape.lineTo(w / 2 - c, -h / 2);
  shape.lineTo(w / 2, -h / 2 + c);
  shape.lineTo(w / 2, h / 2 - c);
  shape.lineTo(w / 2 - c, h / 2);
  shape.lineTo(-w / 2 + c, h / 2);
  shape.lineTo(-w / 2, h / 2 - c);
  shape.lineTo(-w / 2, -h / 2 + c);
  shape.closePath();
  const bevel = Math.min(o.bevel ?? 0.0045, d * 0.24, c * 0.30);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d, steps: 1, curveSegments: 1,
    bevelEnabled: true, bevelSegments: 1,
    bevelSize: bevel, bevelThickness: bevel,
  });
  g.translate(0, 0, -d / 2);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(x, y, z);
  appendGeometry(g, [[bone, 1]], buf);
  g.dispose();
}

// A deliberately authored faceted plate.  The EV-style warrior needs large,
// irregular armour planes; an army of equally chamfered rectangles is what
// made the previous pass read as a kit-built robot.
function addPolygonPanel(buf, points, d, x, y, z, bone, o = {}) {
  const shape = new THREE.Shape();
  points.forEach(([px, py], i) => (i ? shape.lineTo(px, py) : shape.moveTo(px, py)));
  shape.closePath();
  const bevel = Math.min(o.bevel ?? 0.004, d * 0.24);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d, steps: 1, curveSegments: 1,
    bevelEnabled: bevel > 0, bevelSegments: 1,
    bevelSize: bevel, bevelThickness: bevel,
  });
  g.translate(0, 0, -d / 2);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(x, y, z);
  appendGeometry(g, [[bone, 1]], buf);
  g.dispose();
}

function addChevronPanel(buf, w, h, stroke, d, x, y, z, bone) {
  addPolygonPanel(buf, [
    [-w / 2, h / 2], [0, -h / 2], [w / 2, h / 2],
    [w / 2 - stroke, h / 2], [0, -h / 2 + stroke * 1.55],
    [-w / 2 + stroke, h / 2],
  ], d, x, y, z, bone, { bevel: 0.001 });
}

function addDisc(buf, radius, depth, x, y, z, bone, side) {
  const g = new THREE.CylinderGeometry(radius, radius * 0.92, depth, 10, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate(x + side * depth * 0.5, y, z);
  appendGeometry(g, [[bone, 1]], buf);
  g.dispose();
}

// ═══════════════════════════════════════════════════════════════════════════
// Geometry depends only on the chassis, never on the skeleton instance: the
// skin attributes hold bone INDICES, and those are fixed by BONE_ORDER. So the
// buffers are built once per chassis and shared by every body wearing it, while
// each body gets its own bones (they animate independently) and its own
// materials (a death fade must not fade everyone).
//
// This matters: welding and re-smoothing the outline hulls is most of the build
// cost, and without the cache a body costs ~60ms — half a second to spawn a
// lobby of bots.
const _heroCache = new Map();

function heroGeometry(id) {
  const hit = _heroCache.get(id);
  if (hit) return hit;
  const parts = buildHeroBuffers(id);
  for (const p of parts) {
    p.geo.userData.shared = true;
    if (p.outline) p.outline.userData.shared = true;
  }
  _heroCache.set(id, parts);
  return parts;
}

export function buildHeroBody(id = 'vanguard') {
  const pal = getLowPolyPalette(id);
  const M = makeBodyMaterials(pal);
  const parts = heroGeometry(id);

  const group = new THREE.Group();
  const { root, bones, list } = buildSkeleton();
  group.add(root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);

  const olMat = new THREE.MeshBasicMaterial({ color: 0x1c1e24, side: THREE.BackSide });
  const meshes = [], outlines = [];
  for (const { key, geo, outline } of parts) {
    const mesh = new THREE.SkinnedMesh(geo, M[key]);
    mesh.name = 'body_' + key;
    mesh.castShadow = mesh.receiveShadow = true;
    // Every chassis buffer owns the generous animated bounding sphere created
    // below. Let Three skip players behind the camera instead of skinning and
    // drawing the whole lobby every frame.
    mesh.frustumCulled = true;
    group.add(mesh);
    mesh.bind(skeleton);
    meshes.push(mesh);

    if (outline) {
      const ol = new THREE.SkinnedMesh(outline, olMat);
      ol.name = 'outline';
      ol.castShadow = false;
      ol.frustumCulled = true;
      ol.raycast = () => {};
      group.add(ol);
      ol.bind(skeleton);
      outlines.push(ol);
    }
  }

  group.userData = {
    isLowPoly: true, isHero: true, isNinjaInspired: true,
    silhouetteStyle: id === 'vanguard' ? 'compact-arena-warrior' : 'shinobi-operative',
    armorTypeId: id,
    // Headshots resolve by hit height, the way they already do for the rigged
    // human: a skinned body is a handful of merged meshes, so there is no
    // per-part head mesh left to tag. Measured off this skeleton — the skull
    // runs 1.84 to 2.23 and the neck sits below it.
    headshotY: BODY.HEADSHOT_Y,
    primaryMat: M.armor, secondaryMat: M.armor2,
    outlineMat: olMat,
    skeleton, bones, meshes, outlines,
    rig: {
      legL: bones.thighL, legR: bones.thighR,
      kneeL: bones.kneeL, kneeR: bones.kneeR,
      ankleL: bones.ankleL, ankleR: bones.ankleR,
      armL: bones.shoulderL, armR: bones.shoulderR,
      elbowL: bones.elbowL, elbowR: bones.elbowR,
      hips: bones.hips, spine: bones.spine, chest: bones.chest, head: bones.head,
      // The default arena chassis is authored around a low, loaded stance.
      // Locomotion reads this without changing the shared skeleton/IK contract.
      readyStance: id === 'vanguard' ? 1.25 : 0,
    },
  };
  attachUniversalAnimator(group);
  return group;
}

// ═══════════════════════════════════════════════════════════════════════════
function buildHeroBuffers(id) {
  const pal = getLowPolyPalette(id);
  const bulk = pal.bulk ?? 1;
  const arena = id === 'vanguard';
  // EV's default arena body is deliberately compact: the helmet is much taller
  // than an anatomical skull and nearly meets the shoulder yoke. Keep the bone,
  // eyes, hit height and camera contract untouched; only stretch rigid helmet
  // geometry downward from the fixed crown.
  const headY = (y) => {
    const mapped = mapHead(y);
    return arena ? BODY.CROWN_Y - (BODY.CROWN_Y - mapped) * 1.16 : mapped;
  };
  // The connected anatomy stays at the animation contract, while visible hard
  // plates pull inward for a fast, cloth-over-light-armour shinobi silhouette.
  // This helper is deliberately used only on rigid armour station tables: arm
  // lengths, shoulder pivots, hit height, and the weapon IK never move.
  const lightPlate = (st, radial = 0.86, depth = 0.91) => st.map(q => ({
    ...q, rx: q.rx * radial, rz: q.rz * depth,
  }));

  // One accumulator per material — the whole body ends up as a handful of
  // skinned draw calls instead of ~80 separate meshes.
  const bufs = {};
  const buf = (key) => (bufs[key] ||= newBuffer());

  // Authored tables carried onto the new figure.
  // The arena chassis keeps a visibly athletic thigh/calf under its plates.
  // Slim anatomy plus broad flat greaves was the combination that made the
  // lower body read as mechanical stilts.
  const legR = xf(scaled(LEG, bulk * (arena ? 1.06 : 1)), mapLeg);
  // A warrior frame needs visible deltoid/bicep mass between its plates.  The
  // previous slender arm loft made even good armour read like a robot bolted
  // onto a mannequin; the pivots and lengths remain exactly unchanged.
  const armR = xf(scaled(ARM, bulk * (arena ? 1.04 : 1)), mapArm);
  const torsoT = xf(scaled(TORSO, bulk, true), mapTorso);
  // The arena suit is intentionally closer to a six-head heroic proportion
  // than a tall human mannequin. The larger helmet is armour, not a larger hit
  // target: headshot height and the head bone remain unchanged.
  const skullT = xf(scaled(SKULL, arena ? 1.16 : 1), headY);
  const handT = xf(scaled(HAND, arena ? 1.03 : 1), mapArm);
  const fingerT = xf(scaled(FINGER, arena ? 1.02 : 1), mapArm);
  // The foot is swept along its own length, so its "y" is distance from the
  // heel: scaled to the new foot length, and its height by girth. The ankle is
  // 3.9% of stature off the floor now instead of 12.2%, so the boot shaft that
  // used to reach a third of the way up the shin is a boot shaft again.
  const footT = FOOT.map(q => ({ ...q,
    y: q.y * (BODY.FOOT_LEN / 0.30),
    rx: q.rx * G * (arena ? 1.32 : 1),
    // FOOT.rz becomes world-up after the -90deg foot laydown; keep that
    // dimension unchanged so the wider arena boot still plants on y=0.
    rz: q.rz * G, dz: q.dz * G }));
  const ankleMap = remapY([[0.085, BODY.ANKLE_Y * 0.42], [0.300, BODY.ANKLE_Y * 1.62]]);
  const ankleT = xf(scaled(ANKLE, arena ? 1.05 : 1), ankleMap);

  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -BODY.HIP_X : BODY.HIP_X;
    const ax = s === 'L' ? -BODY.SHOULDER_X : BODY.SHOULDER_X;
    const out = s === 'L' ? -1 : 1;
    const legW = (y) => chainWeights(legChain(s), y);
    const armW = (y) => chainWeights(armChain(s), y);
    const ankle = B['ankle' + s], knee = B['knee' + s];
    const thigh = B['thigh' + s], elbow = B['elbow' + s], hand = B['hand' + s];

    // ── leg: ONE surface, hip to ankle, creasing at the knee ──
    loftSkinned(place(legR, sx, legW), 22, buf('frame'));

    // Boot and ankle ride the ankle bone rigidly.
    {
      const g = newBuffer();
      loftSkinned(place(domed(footT, 0.6), 0, () => [[ankle, 1]]), 18, g);
      const geo = toGeometry(g);
      geo.rotateX(-Math.PI / 2);
      geo.translate(sx, 0, BODY.HEEL_Z);
      appendGeometry(geo, [[ankle, 1]], buf('steel'));
      geo.dispose();
    }
    loftSkinned(place(ankleT, sx, () => [[ankle, 1]], 0.012 * G), 14, buf('steel'));
    // Boot shaft. Rides the SHIN, not the foot: a boot's cuff stays with the leg
    // while the ankle rolls under it, and hanging it off the ankle bone would
    // swing 13cm of armour every heel strike.
    {
      const bootK = arena ? 1.24 : 1;
      const SHAFT = [
        { y: 0.106, rx: 0.050 * bootK, rz: 0.055 * bootK, n: 3.0 },
        { y: 0.152, rx: 0.055 * bootK, rz: 0.060 * bootK, n: 3.0 },
        { y: 0.198, rx: 0.058 * bootK, rz: 0.063 * bootK, n: 2.9 },
        { y: 0.234, rx: 0.052 * bootK, rz: 0.057 * bootK, n: 2.8 },
      ];
      addPlate(buf('bone'), SHAFT, sx, knee,
               { a0: arc(FRONT, 1.02)[0], a1: arc(FRONT, 1.02)[1],
                 t: 0.014, seg: 12, hard: 3.4 });
      addPlate(buf('armor2'), edgeStrip(SHAFT, 0.36, true), sx, knee,
               { a0: arc(FRONT, 1.02)[0], a1: arc(FRONT, 1.02)[1],
                 lift: 0.014, t: TRIM, seg: 12, hard: 3.4 });
      if (arena) {
        const bootEdge = shapedArc(SHAFT, FRONT + out * 0.76,
          [0.18, 0.26, 0.29, 0.17]);
        addPlate(buf('armor'), bootEdge, sx, knee,
                 { a0: FRONT + out * 0.76 - 0.28,
                   a1: FRONT + out * 0.76 + 0.28,
                   lift: 0.016, t: 0.012, seg: 4, hard: 3.8 });
      }
    }
    // Heel block — kept inside the sole footprint Locomotion plants, so the boot
    // reads chunky without moving the contact corners.
    addBox(buf('steel'), (arena ? 0.108 : 0.098) * G, 0.058, 0.064, sx, 0.031, 0.035, ankle);
    // Instep armour. Built in the boot's own upright frame and laid down with
    // it, so its arc (centred on the section's +Z, which becomes UP after the
    // turn) wraps the top of the foot rather than one side of it.
    {
      const st = footT.slice(1).map(q => ({ ...q, x: 0, z: q.dz }));
      const geo = plateGeometry(st, arc(BACK, 1.15)[0], arc(BACK, 1.15)[1], 0.020, 9);
      geo.rotateX(-Math.PI / 2);
      geo.translate(sx, 0, BODY.HEEL_Z);
      appendGeometry(geo, [[ankle, 1]], buf('bone'));
      geo.dispose();
    }
    addBox(buf('steel'), 0.104, 0.052, 0.062, sx, 0.030, -0.176, ankle);
    if (arena) {
      // Overlapping instep and toe shells turn the rectangular collision-safe
      // boot core into a tapered armored shoe. They sit above the sole, so the
      // locomotion contact footprint and floor tests remain unchanged.
      addChamferedPanel(buf('bone'), 0.176, 0.176, 0.022,
                        sx, 0.066, -0.105, ankle,
                        { chamfer: 0.022, bevel: 0.003, rx: -Math.PI / 2 });
      addChamferedPanel(buf('steel'), 0.136, 0.078, 0.014,
                        sx, 0.084, -0.174, ankle,
                        { chamfer: 0.015, bevel: 0.002, rx: -Math.PI / 2 });
      // Orange ankle bridge and separated pale toe facets give the boot the
      // strapped, load-bearing construction of warrior armour instead of a
      // smooth white shoe.
      addPolygonPanel(buf('armor'), [
        [-0.060, 0.026], [0.060, 0.026], [0.046, -0.026],
        [0.016, -0.010], [-0.016, -0.010], [-0.046, -0.026],
      ], 0.022, sx, 0.112, -0.160, ankle, { bevel: 0.003, rx: -Math.PI / 2 });
      for (const dx of [-0.048, 0, 0.048])
        addChamferedPanel(buf('bone'), 0.044, 0.050, 0.018,
                          sx + dx, 0.056, -0.208, ankle,
                          { chamfer: 0.009, bevel: 0.002, rx: -Math.PI / 2 });
    }

    // Leg armour
    // Down to just above the knee: the skirt now covers the top of the thigh,
    // so a plate that stops at mid-thigh leaves a bare band between the two.
    // Sculpted quadriceps shell: broad enough to read as authored armour, but
    // shifted toward the outside so the inner thigh remains a continuous human
    // form. A second curved face follows the same anatomy instead of floating
    // above it as a flat patch.
    const thighFront = arena
      ? shapedArc(lightPlate(legR.slice(1, 8), 0.98, 0.98),
          [0.48, 0.42, 0.34, 0.26, 0.19, 0.13, 0.08]
            .map(offset => FRONT + out * offset),
          [0.13, 0.25, 0.40, 0.49, 0.48, 0.39, 0.19])
      : legR.slice(1, 8).map(q => ({ ...q }));
    const thighCenter = arena ? FRONT + out * 0.17 : FRONT;
    if (arena) {
      const split = out > 0 ? 0.44 : 0.56;
      const outerBand = out > 0 ? arcBand(thighFront, split, 1) : arcBand(thighFront, 0, split);
      const innerBand = out > 0 ? arcBand(thighFront, 0, split) : arcBand(thighFront, split, 1);
      addPlate(buf('bone'), outerBand, sx, thigh,
               { a0: arc(thighCenter, 0.43)[0], a1: arc(thighCenter, 0.43)[1],
                 t: 0.019, seg: 4, hard: 3.6 });
      addPlate(buf('armor2'), innerBand, sx, thigh,
               { a0: arc(thighCenter, 0.43)[0], a1: arc(thighCenter, 0.43)[1],
                 t: 0.019, seg: 4, hard: 3.6 });
    } else {
      addPlate(buf('armor'), thighFront, sx, thigh,
               { a0: arc(thighCenter, 0.50)[0], a1: arc(thighCenter, 0.50)[1],
                 t: 0.030, hard: 3.4 });
    }
    // Shin plate. The slice matters: the first and last stations feather to zero
    // thickness, so the plate you SEE is the interior — cut it too short and the
    // shin loses the armour it had.
    const shinCenter = arena ? FRONT + out * 0.10 : FRONT;
    const shinShell = arena
      ? shapedArc(lightPlate(legR.slice(13, 19), 0.99, 0.99),
          [0.19, 0.15, 0.10, 0.05, 0.01, 0.00]
            .map(offset => FRONT + out * offset),
          [0.20, 0.43, 0.54, 0.49, 0.36, 0.17])
      : lightPlate(legR.slice(11, 18), 1, 1);
    if (arena) {
      const split = out > 0 ? 0.62 : 0.38;
      const outerBand = out > 0 ? arcBand(shinShell, split, 1) : arcBand(shinShell, 0, split);
      const frontBand = out > 0 ? arcBand(shinShell, 0, split) : arcBand(shinShell, split, 1);
      addPlate(buf('armor2'), outerBand, sx, knee,
               { a0: arc(shinCenter, 0.50)[0], a1: arc(shinCenter, 0.50)[1],
                 t: 0.020, seg: 4, hard: 3.65 });
      addPlate(buf('bone'), frontBand, sx, knee,
               { a0: arc(shinCenter, 0.50)[0], a1: arc(shinCenter, 0.50)[1],
                 t: 0.020, seg: 4, hard: 3.65 });
    } else {
      addPlate(buf('bone'), shinShell, sx, knee,
               { a0: arc(shinCenter, 0.62)[0], a1: arc(shinCenter, 0.62)[1],
                 t: 0.030, seg: 9, hard: 3.4 });
    }
    addPlate(buf(arena ? 'bone' : 'armor'), xf([
      { y: 0.530, rx: 0.078, rz: 0.086, n: 2.2 },
      { y: 0.575, rx: 0.090, rz: 0.098, n: 2.2 },
      { y: 0.620, rx: 0.094, rz: 0.102, n: 2.2 },
      { y: 0.665, rx: 0.091, rz: 0.098, n: 2.2 },
      { y: 0.710, rx: 0.079, rz: 0.086, n: 2.2 },
    ], mapLeg), sx, knee, { a0: arc(FRONT, arena ? 0.64 : 0.58)[0], a1: arc(FRONT, arena ? 0.64 : 0.58)[1],
                           t: (arena ? 0.022 : 0.030) * G, seg: arena ? 7 : 9,
                           hard: arena ? 3.2 : 3.4 });
    // This crest must be derived from legR, not the unscaled legacy station
    // table. The arena thigh is deliberately bulkier; using the old radii put
    // the orange shell *inside* the black anatomy and made the visible model
    // appear unchanged despite the added geometry.
    const outerThigh = shapedArc(lightPlate(legR.slice(1, 8), 1.02, 1.02),
      [0.52, 0.55, 0.59, 0.63, 0.68, 0.73, 0.77]
        .map(offset => FRONT + out * offset),
      [0.14, 0.25, 0.34, 0.38, 0.36, 0.29, 0.14]);
    addPlate(buf(arena ? 'armor' : 'glow'), outerThigh, sx, thigh,
             { a0: FRONT + out * 0.66 - 0.36, a1: FRONT + out * 0.66 + 0.36,
               lift: arena ? 0.020 : 0,
               t: arena ? 0.014 : 0.024, seg: 6, hard: 3.8 });
    if (arena) {
      // A narrow outer calf reinforcement reads as a protective pad while most
      // of the trouser leg remains visible in profile.
      const calfSide = shapedArc(lightPlate(legR.slice(13, 19), 1.00, 1.01),
        FRONT + out * 0.72, [0.14, 0.24, 0.30, 0.29, 0.22, 0.12]);
      const center = FRONT + out * 0.72;
      addPlate(buf('armor'), calfSide, sx, knee,
               { a0: center - 0.35, a1: center + 0.35,
                  t: 0.020, seg: 7, hard: 3.3 });
      addPlate(buf('armor2'), edgeStrip(calfSide, 0.24, true), sx, knee,
               { a0: center - 0.35, a1: center + 0.35,
                  lift: 0.020, t: TRIM, seg: 7, hard: 3.3 });
    }

    // Front tasset. Hung off the THIGH rather than the hips, which is the only
    // way a hanging plate this long survives a stride: rigid to the pelvis it
    // would be a fence the leg swings straight through, and 20cm below the hip
    // joint a 35° swing carries the thigh 10cm past where any hip-mounted panel
    // could stand off to. On the thigh it simply travels with the leg.
    if (!arena) {
      const TAS = [
        { y: 0.962, rx: 0.100, rz: 0.130, n: 2.4 },
        { y: 0.916, rx: 0.110, rz: 0.146, n: 2.4 },
        { y: 0.868, rx: 0.112, rz: 0.149, n: 2.4 },
        { y: 0.824, rx: 0.104, rz: 0.141, n: 2.4 },
      ];
      addPlate(buf('armor'), TAS, sx, thigh,
               { a0: arc(FRONT, 0.58)[0], a1: arc(FRONT, 0.58)[1],
                 t: 0.024, seg: 9, hard: 4.0 });
      addPlate(buf('armor2'), edgeStrip(TAS, 0.30, true), sx, thigh,
               { a0: arc(FRONT, 0.58)[0], a1: arc(FRONT, 0.58)[1],
                 lift: 0.024, t: TRIM, seg: 9, hard: 4.0 });
      addBox(buf('glow'), 0.022, 0.030, 0.016, sx, 0.910, -0.158, thigh);
    }

    // ── arm: ONE surface, shoulder to wrist, creasing at the elbow ──
    loftSkinned(place(armR, ax, armW), 18, buf('frame'));
    const forearmShell = arena ? lightPlate(armR.slice(9, 15), 1.10, 1.06)
      : armR.slice(9, 15).map(q => ({ ...q }));
    addPlate(buf(arena ? 'armor2' : 'bone'), forearmShell, ax, elbow,
              { a0: arc(FRONT, arena ? 0.94 : 0.78)[0], a1: arc(FRONT, arena ? 0.94 : 0.78)[1],
                t: arena ? 0.028 : 0.032, hard: arena ? 3.7 : 3.2 });
    addBox(buf(arena ? 'steel' : 'glow'), 0.020 * G, 0.060 * G, 0.014 * G,
           ax, mapArm(1.090), -0.086 * G, elbow);

    // Gauntlet: a cuff that flares out toward the wrist. Rigid to the forearm,
    // so it stays a hard shell while the skin under it creases at the elbow.
    {
      const CUFF = xf([
        { y: 1.096, rx: 0.062, rz: 0.067, n: 3.0 },
        { y: 1.040, rx: 0.058, rz: 0.063, n: 3.0 },
        { y: 0.982, rx: 0.052, rz: 0.057, n: 2.9 },
        { y: 0.938, rx: 0.046, rz: 0.051, n: 2.8 },
      ], mapArm);
      addPlate(buf(arena ? 'armor' : 'bone'), arena ? lightPlate(CUFF, 1.02, 1.02) : CUFF, ax, elbow,
               { a0: arc(FRONT, arena ? 1.10 : 1.06)[0], a1: arc(FRONT, arena ? 1.10 : 1.06)[1],
                 t: arena ? 0.016 : 0.014, seg: 12, hard: arena ? 3.5 : 3.4 });
      addPlate(buf('armor2'), edgeStrip(CUFF, 0.36, true), ax, elbow,
               { a0: arc(FRONT, 1.06)[0], a1: arc(FRONT, 1.06)[1],
                 lift: 0.014, t: TRIM, seg: 12, hard: 3.4 });
      addBox(buf('glow'), 0.018 * G, 0.050 * G, 0.016 * G,
             ax, mapArm(1.012), -0.062 * G, elbow);
      if (arena) {
        // A small protective glove plate and stitched-looking seams keep the
        // forearm recognizable without turning it into a mechanical gauntlet.
        addChamferedPanel(buf('armor'), 0.090, 0.116, 0.018,
                          ax, mapArm(1.050), -0.108, elbow,
                          { chamfer: 0.011, rz: -out * 0.030 });
        for (let i = -1; i <= 1; i++)
          addChamferedPanel(buf('glow'), 0.012, 0.008, 0.006,
                            ax + i * 0.018, mapArm(1.050), -0.132, elbow,
                            { chamfer: 0.003, bevel: 0.001 });
        addDisc(buf('steel'), 0.024, 0.014,
                ax + out * 0.065, BODY.ELBOW_Y, 0, elbow, out);
        addPolygonPanel(buf('armor'), [
          [-0.040, 0.074], [0.034, 0.062], [0.046, -0.050],
          [0.012, -0.082], [-0.040, -0.052],
        ].map(([gx, gy]) => [gx * out, gy]), 0.018,
        ax, mapArm(1.075), -0.130, elbow,
        { bevel: 0.003, rz: -out * 0.045 });
      }
    }

    // Hand + fingers, rigid to the hand bone.
    loftSkinned(place(domed(handT, 0, 0.8), ax, () => [[hand, 1]]), 16, buf(arena ? 'joint' : 'steel'));
    for (let f = 0; f < 3; f++) {
      loftSkinned(place(domed(fingerT, 0, 0.9), ax + (f - 1) * 0.026 * G,
                        () => [[hand, 1]], -0.026 * G), 8, buf(arena ? 'joint' : 'steel'));
    }

    // Deltoid + pauldron sit on the chest, so they stay put while the arm swings
    // under them — a shoulder only reads as armour if the muscle shows beneath.
    loftSkinned(place(xf([
      { y: 1.530, rx: 0.074, rz: 0.080, n: 2.2 },
      { y: 1.598, rx: 0.098, rz: 0.100, n: 2.3 },
      { y: 1.662, rx: 0.105, rz: 0.106, n: 2.4 },
      { y: 1.722, rx: 0.091, rz: 0.092, n: 2.4 },
      { y: 1.766, rx: 0.060, rz: 0.062, n: 2.3 },
    ], mapArm), ax * 0.945, () => [[B.chest, 1]]), 18, buf('frame'));
    // Low-profile overlapping shoulder guards. The former three broad exosuit
    // lames made the character read like a heavy mech. These sit close to the
    // deltoid so the arm can still shoulder every gun without becoming bulky.
    const px = ax * 0.945;
    const pa = out > 0 ? 0 : Math.PI;
    const lame = (st, half, t) => {
      const arenaShell = arena;
      const T = xf(lightPlate(st, arenaShell ? 1.04 : 0.86,
        arenaShell ? 1.02 : 0.91), mapArm);
      addPlate(buf(arenaShell ? 'armor' : 'bone'), T, px, B.chest,
               { a0: pa - out * half, a1: pa + out * half, t: t * G, seg: 11, hard: 4.0 });
      addPlate(buf(arenaShell ? 'steel' : 'armor2'), edgeStrip(T, 0.34, false), px, B.chest,
               { a0: pa - out * half, a1: pa + out * half,
                 lift: t * G, t: TRIM * G, seg: 11, hard: 4.0 });
      return T;
    };
    lame([                                  // fitted top guard
      { y: 1.512, rx: 0.100, rz: 0.104, n: 2.5 },
      { y: 1.550, rx: 0.117, rz: 0.119, n: 2.5 },
      { y: 1.602, rx: 0.111, rz: 0.113, n: 2.5 },
      { y: 1.662, rx: 0.109, rz: 0.110, n: 2.6 },
      { y: 1.716, rx: 0.095, rz: 0.096, n: 2.6 },
      { y: 1.762, rx: 0.064, rz: 0.066, n: 2.4 },
    ], arena ? 0.88 : 0.88, arena ? 0.022 : 0.022);
    lame([                                  // short lower guard
      { y: 1.512, rx: 0.104, rz: 0.108, n: 2.5 },
      { y: 1.548, rx: 0.124, rz: 0.126, n: 2.5 },
      { y: 1.592, rx: 0.129, rz: 0.131, n: 2.5 },
      { y: 1.642, rx: 0.125, rz: 0.126, n: 2.6 },
      { y: 1.692, rx: 0.114, rz: 0.115, n: 2.6 },
    ], arena ? 0.72 : 0.94, arena ? 0.018 : 0.020);
    if (arena) {
      // The reference uses a flared orange mantle over a visible dark deltoid,
      // not a rectangular shoulder pod.  Its asymmetrical six-point face gives
      // the silhouette a warrior's plated collar while leaving the arm human.
      const mantle = [
        [-0.056, -0.084], [0.036, -0.070], [0.052, 0.020],
        [0.023, 0.076], [-0.029, 0.066], [-0.064, -0.010],
      ].map(([mx, my]) => [mx * out, my]);
      addPolygonPanel(buf('armor'), mantle, 0.036,
                      px + out * 0.116, mapArm(1.660), -0.004, B.chest,
                      { bevel: 0.005, rz: -out * 0.10, ry: -out * 0.08 });
      addPolygonPanel(buf('bone'), [
        [-0.042 * out, 0.004], [0.042 * out, 0.004],
        [0.028 * out, 0.050], [-0.022 * out, 0.060],
      ], 0.016, px + out * 0.116, mapArm(1.704), -0.026, B.chest,
      { bevel: 0.003, rz: -out * 0.10, ry: -out * 0.08 });
      for (let i = 0; i < 3; i++)
        addChamferedPanel(buf('steel'), 0.050, 0.009, 0.006,
                          px + out * 0.116, mapArm(1.666 - i * 0.023), -0.028, B.chest,
                          { chamfer: 0.003, bevel: 0.001, rz: -out * 0.10 });
    }
    // A single restrained shoulder status mark keeps team identity readable.
    addBox(buf('glow'), 0.018 * G, 0.046 * G, 0.016 * G,
           px + out * 0.105 * G, mapArm(1.570), -0.052 * G, B.chest);

    // Upper-arm plate. Without it the whole arm between pauldron and gauntlet is
    // bare underframe, and the figure reads sleeveless.
    const upperArmShell = arena ? lightPlate(armR.slice(3, 7), 1.00, 1.00)
      : armR.slice(3, 7).map(q => ({ ...q }));
    addPlate(buf(arena ? 'armor2' : 'armor'), upperArmShell, ax, B['shoulder' + s],
             { a0: pa - out * (arena ? 0.56 : 0.68), a1: pa + out * (arena ? 0.56 : 0.68),
               t: arena ? 0.018 : 0.026, seg: arena ? 8 : 9, hard: arena ? 3.1 : 3.4 });
    if (arena) {
      // Faceted white bicep shield with an orange outer flare.  Both ride the
      // upper-arm bone, so they remain attached through aim and sprint poses.
      addPolygonPanel(buf('bone'), [
        [-0.048, 0.072], [0.046, 0.062], [0.056, -0.044],
        [0.020, -0.076], [-0.050, -0.052],
      ].map(([ux, uy]) => [ux * out, uy]), 0.020,
      ax, mapArm(1.488), -0.102, B['shoulder' + s],
      { bevel: 0.004, rz: -out * 0.035 });
      addPolygonPanel(buf('armor'), [
        [-0.022, 0.058], [0.032, 0.042], [0.036, -0.046],
        [0.004, -0.066], [-0.026, -0.030],
      ].map(([ux, uy]) => [ux * out, uy]), 0.014,
      ax + out * 0.050, mapArm(1.480), -0.098, B['shoulder' + s],
      { bevel: 0.003, rz: -out * 0.035 });
    }
  }

  // ── torso: one trunk, pelvis to neck, weighted up the spine ──
  loftSkinned(place(torsoT, 0, (y) => chainWeights(TORSO_CHAIN, y)), 26, buf('frame'));

  for (const s of [-1, 1]) {
    addPlate(buf(arena ? 'armor2' : 'armor'), torsoT.slice(0, 4), 0, B.hips,
             { a0: s > 0 ? -0.62 : Math.PI + 0.62,
               a1: s > 0 ? 0.62 : Math.PI - 0.62,
               t: arena ? 0.024 : 0.028, seg: arena ? 8 : 7 });
  }
  addBox(buf('glow'), 0.05 * G, 0.05 * G, 0.03 * G, 0, mapTorso(1.150), -0.104 * G, B.hips);

  // ── waist and skirt ────────────────────────────────────────────────────────
  // Everything from here down is authored in the FIGURE's own metres rather
  // than remapped from the old tables: it is new armour, not carried anatomy,
  // and it has to clear limbs whose swept volumes are known in this space.
  {
    const BELT = [
      { y: 1.010, rx: arena ? 0.112 : 0.120, rz: arena ? 0.086 : 0.090, n: arena ? 3.8 : 2.6 },
      { y: 1.048, rx: arena ? 0.118 : 0.127, rz: arena ? 0.090 : 0.095, n: arena ? 3.8 : 2.6 },
      { y: 1.086, rx: arena ? 0.114 : 0.122, rz: arena ? 0.088 : 0.092, n: arena ? 3.8 : 2.6 },
    ];
    addPlate(buf('steel'), BELT, 0, B.hips, { a0: -Math.PI, a1: Math.PI, t: 0.016, seg: 26 });
    addPlate(buf(arena ? 'armor2' : 'armor'), BELT, 0, B.hips,
             { a0: -Math.PI, a1: Math.PI, lift: 0.016, t: TRIM, seg: 26 });
    if (arena) {
      addPolygonPanel(buf('armor2'), [
        [-0.060, 0.056], [0.060, 0.056], [0.052, -0.022],
        [0.024, -0.088], [0, -0.104], [-0.024, -0.088], [-0.052, -0.022],
      ], 0.034, 0, 1.008, -0.118, B.hips, { bevel: 0.005 });
      addPolygonPanel(buf('bone'), [
        [-0.038, 0.030], [0.038, 0.030], [0.026, -0.036],
        [0, -0.056], [-0.026, -0.036],
      ], 0.012, 0, 1.018, -0.150, B.hips, { bevel: 0.003 });
    } else {
      addChamferedPanel(buf('armor2'), 0.070, 0.052, 0.026,
                        0, 1.048, -0.108, B.hips,
                        { chamfer: 0.006, bevel: 0.003 });
    }
    addBox(buf('glow'), 0.028, 0.028, 0.024, 0, 1.048, -0.110, B.hips, Math.PI / 4);
  }
  // Side tassets. These CAN hang off the pelvis — the thigh's lateral travel is
  // a couple of centimetres where its fore/aft travel is ten, so a side panel
  // standing 2cm proud of the widest point of the leg stays clear all cycle.
  {
    // 14cm of panel, not 22. The long version hung to mid-thigh the whole way
    // round and the figure read as wearing a skirt rather than hip armour — the
    // LENGTH did that, more than the width.
    const SIDE = arena ? [
      // Compact hip pods keep the waist pinched; the old long panels made the
      // character read as a human wearing a skirt.
      { y: 1.026, rx: 0.148, rz: 0.112, n: 3.4 },
      { y: 0.994, rx: 0.166, rz: 0.124, n: 3.5 },
      { y: 0.956, rx: 0.170, rz: 0.126, n: 3.5 },
      { y: 0.926, rx: 0.156, rz: 0.114, n: 3.4 },
    ] : [
      { y: 1.012, rx: 0.150, rz: 0.112, n: 2.6 },
      { y: 0.972, rx: 0.170, rz: 0.126, n: 2.6 },
      { y: 0.936, rx: 0.178, rz: 0.131, n: 2.5 },
      { y: 0.906, rx: 0.170, rz: 0.125, n: 2.5 },
    ];
    for (const s of [-1, 1]) {
      const c = s > 0 ? 0 : Math.PI;
      addPlate(buf(arena ? 'armor2' : 'armor'), SIDE, 0, B.hips,
               { a0: c - s * 0.56, a1: c + s * 0.56, t: 0.020, seg: 8, hard: 3.4 });
      addPlate(buf('armor2'), edgeStrip(SIDE, 0.30, true), 0, B.hips,
               { a0: c - s * 0.56, a1: c + s * 0.56,
                 lift: 0.020, t: TRIM, seg: 8, hard: 3.4 });
      addBox(buf('steel'), 0.014, 0.030, 0.018, s * 0.157, 0.966, -0.026, B.hips);
    }
    // Rear panel, tucked under the cape.
    addPlate(buf('armor'), SIDE, 0, B.hips,
             { a0: arc(BACK, 0.50)[0], a1: arc(BACK, 0.50)[1],
               t: 0.024, seg: 7, hard: 4.0 });
  }

  const abdomenBands = arena ? 1 : 3;
  for (let i = 0; i < abdomenBands; i++) {
    const y = 1.255 + i * 0.072;
    addPlate(buf(arena ? 'frame' : 'armor'), xf(scaled([
      { y: y - 0.034, rx: 0.116, rz: 0.090, n: 2.6 },
      { y: y - 0.014, rx: 0.122, rz: 0.094, n: 2.6 },
      { y: y + 0.014, rx: 0.123, rz: 0.095, n: 2.6 },
      { y: y + 0.030, rx: 0.116, rz: 0.090, n: 2.6 },
    ], bulk), mapTorso), 0, B.spine,
      { a0: arc(FRONT, 0.74)[0], a1: arc(FRONT, 0.74)[1], t: 0.022 * G, hard: 3.6 });
  }
  addBox(buf('glow'), 0.045 * G, 0.06 * G, 0.03 * G, 0, mapTorso(1.330), -0.116 * G, B.spine);
  if (arena) {
    // A narrow vest placket bridges chest and waist while leaving the fabric
    // sides visible. That keeps the trunk fitted instead of reading as a hard
    // mechanical carapace.
    addChamferedPanel(buf('frame'), 0.076, 0.178, 0.024,
                      0, mapTorso(1.360), -0.132, B.spine,
                      { chamfer: 0.014, bevel: 0.004 });
    addChamferedPanel(buf('armor'), 0.038, 0.046, 0.014,
                      0, mapTorso(1.420), -0.158, B.spine,
                      { chamfer: 0.008, bevel: 0.002 });
    // One low-profile webbing tab at the waist; repeated segmented ribs made
    // the abdomen look mechanical even after the limb armour was reduced.
    addChamferedPanel(buf('armor2'), 0.104, 0.016, 0.010,
                      0, mapTorso(1.274), -0.134, B.spine,
                      { chamfer: 0.004, bevel: 0.001 });
    // Faceted abdominal plates float over the flexible black core. They make
    // the waist read as an armoured athlete while leaving dark gaps for bend.
    for (let i = 0; i < 3; i++) {
      const y = mapTorso(1.392 - i * 0.074);
      const w = 0.146 - i * 0.010;
      addPolygonPanel(buf(i === 2 ? 'armor2' : 'bone'), [
        [-w / 2, 0.026], [w / 2, 0.026], [w * 0.43, -0.026],
        [0, -0.040], [-w * 0.43, -0.026],
      ], 0.014, 0, y, -0.158, B.spine,
      { bevel: 0.003 });
    }
    for (let i = -1; i <= 1; i++)
      addChamferedPanel(buf('glow'), 0.010, 0.026, 0.006,
                        i * 0.018, mapTorso(1.318), -0.178, B.spine,
                        { chamfer: 0.003, bevel: 0.001 });
  }

  // Scaled by `bulk` like the torso loft under it. Without that a heavy chassis
  // grows the trunk and leaves its own chest plates buried inside it — the plate
  // is still there, it is just under the skin, and the chest reads as bare
  // underframe from every angle.
  const chestShape = arena ? [
    // Broad faceted upper shell and pinched black abdomen reproduce the compact
    // inverted-wedge silhouette of the arena reference.
    { y: 1.440, rx: 0.128, rz: 0.104, n: 2.8 },
    { y: 1.492, rx: 0.156, rz: 0.114, n: 2.9 },
    { y: 1.548, rx: 0.178, rz: 0.124, n: 3.0 },
    { y: 1.604, rx: 0.188, rz: 0.128, n: 3.1 },
    { y: 1.652, rx: 0.180, rz: 0.122, n: 3.0 },
  ] : [
    { y: 1.450, rx: 0.148, rz: 0.107, n: 2.8 },
    { y: 1.505, rx: 0.164, rz: 0.115, n: 2.8 },
    { y: 1.565, rx: 0.176, rz: 0.119, n: 2.9 },
    { y: 1.618, rx: 0.176, rz: 0.117, n: 2.9 },
    { y: 1.660, rx: 0.164, rz: 0.110, n: 2.9 },
  ];
  const CHEST = xf(lightPlate(scaled(chestShape, bulk),
    arena ? 1.00 : 0.92, arena ? 0.98 : 0.94), mapTorso);
  for (const s of [-1, 1]) {
    addPlate(buf(arena ? 'armor' : 'armor'), CHEST, 0, B.chest,
             { a0: FRONT + s * 0.12, a1: FRONT + s * (arena ? 1.00 : 1.34),
               t: (arena ? 0.020 : 0.030) * G, seg: arena ? 10 : 12, hard: arena ? 3.2 : 4.2 });
  }
  if (arena) {
    // Two broad, irregular silver pectoral shields sit over the black athletic
    // trunk. Their shared orange sternum blade gives the torso one strong
    // warrior shape instead of a grid of small mechanical tiles.
    for (const s of [-1, 1]) {
      addPolygonPanel(buf('armor2'), [
        [-0.102 * s, 0.054], [0.062 * s, 0.066], [0.106 * s, 0.016],
        [0.070 * s, -0.066], [0.014 * s, -0.086], [-0.092 * s, -0.026],
      ], 0.022, s * 0.082, mapTorso(1.574), -0.150, B.chest,
      { bevel: 0.005, rz: -s * 0.035 });
    }
    addPolygonPanel(buf('armor'), [
      [-0.044, 0.108], [0.044, 0.108], [0.032, 0.014],
      [0.016, -0.108], [-0.016, -0.108], [-0.032, 0.014],
    ], 0.022, 0, mapTorso(1.558), -0.176, B.chest, { bevel: 0.004 });
  }
  addPlate(buf('frame'), CHEST.slice(0, 4), 0, B.chest,
           { a0: FRONT - 0.10, a1: FRONT + 0.10, t: 0.013 * G, seg: 3 });
  addBox(buf('glow'), 0.04 * G, 0.05 * G, 0.03 * G, 0, mapTorso(1.455), -0.138 * G, B.chest);
  {
    const YOKE = xf(scaled([
      { y: 1.638, rx: arena ? 0.180 : 0.176, rz: arena ? 0.120 : 0.117, n: arena ? 3.3 : 2.9 },
      { y: 1.672, rx: arena ? 0.172 : 0.168, rz: arena ? 0.114 : 0.112, n: arena ? 3.2 : 2.8 },
      { y: 1.706, rx: arena ? 0.152 : 0.150, rz: arena ? 0.104 : 0.102, n: arena ? 3.1 : 2.8 },
      { y: 1.736, rx: arena ? 0.120 : 0.116, rz: arena ? 0.092 : 0.090, n: arena ? 3.0 : 2.6 },
    ], bulk), mapTorso);
    const YA = { a0: -Math.PI * 1.32, a1: Math.PI * 0.32, seg: 22, hard: 3.4 };
    addPlate(buf(arena ? 'steel' : 'bone'), YOKE, 0, B.chest, { ...YA, t: (arena ? 0.018 : 0.024) * G });
    addPlate(buf('armor2'), edgeStrip(YOKE, 0.26, false), 0, B.chest,
             { ...YA, lift: 0.024 * G, t: TRIM });
    if (arena) {
      // Raised collar wings tuck the helmet into the shoulder wedge. Without
      // them the head floats above the torso like a mannequin on a long neck.
      for (const s of [-1, 1]) {
        addChamferedPanel(buf('armor'), 0.064, 0.088, 0.046,
                          s * 0.092, mapTorso(1.732), -0.024, B.chest,
                          { chamfer: 0.014, rz: s * 0.10, ry: -s * 0.12 });
        addChamferedPanel(buf('armor2'), 0.046, 0.032, 0.050,
                          s * 0.078, mapTorso(1.775), -0.018, B.chest,
                          { chamfer: 0.010, rz: s * 0.10, ry: -s * 0.12 });
      }
    }
  }
  addPlate(buf(arena ? 'armor2' : 'armor'), xf(scaled([
    { y: 1.440, rx: 0.144, rz: 0.106, n: 2.8 },
    { y: 1.500, rx: 0.162, rz: 0.115, n: 2.8 },
    { y: 1.580, rx: 0.178, rz: 0.119, n: 2.9 },
    { y: 1.650, rx: 0.168, rz: 0.112, n: 2.9 },
  ], bulk), mapTorso), 0, B.chest,
    { a0: arc(BACK, arena ? 0.42 : 0.52)[0], a1: arc(BACK, arena ? 0.42 : 0.52)[1],
      t: (arena ? 0.024 : 0.040) * G, seg: 6, hard: arena ? 3.2 : 3.8 });

  if (arena) {
    // Compact back carrier plus the two tall swept shoulder fins that define
    // the default arena chassis in profile and from the rear.
    addChamferedPanel(buf('steel'), 0.104, 0.206, 0.020,
                      0, mapTorso(1.530), 0.154, B.chest,
                      { chamfer: 0.017, bevel: 0.003 });
    addChamferedPanel(buf('armor2'), 0.044, 0.130, 0.010,
                      0, mapTorso(1.548), 0.176, B.chest,
                      { chamfer: 0.010, bevel: 0.002 });
    for (const s of [-1, 1]) {
      addChamferedPanel(buf('armor'), 0.110, 0.104, 0.018,
                        s * 0.096, mapTorso(1.592), 0.148, B.chest,
                        { chamfer: 0.018, rz: s * 0.11 });
      for (let i = 0; i < 2; i++)
        addChamferedPanel(buf('frame'), 0.038, 0.008, 0.006,
                          s * 0.096, mapTorso(1.574 + i * 0.030), 0.166, B.chest,
                          { chamfer: 0.003, bevel: 0.001 });
      // Tall solid shoulder crests are the defining rear silhouette.  The old
      // rail assembly looked like a backpack frame; this tapered fin reads as
      // ceremonial armour and matches the broad orange profile from the skin.
      const fin = [
        [-0.046, -0.090], [0.034, -0.072], [0.046, 0.044],
        [0.012, 0.098], [-0.034, 0.076], [-0.055, -0.006],
      ].map(([fx, fy]) => [fx * s, fy]);
      addPolygonPanel(buf('armor'), fin, 0.028,
                      s * 0.220, mapTorso(1.720), 0.112, B.chest,
                      { bevel: 0.005, rz: s * 0.10, ry: -s * 0.05 });
      addPolygonPanel(buf('bone'), [
        [-0.044 * s, 0.020], [0.044 * s, 0.020], [0.030 * s, 0.070],
        [-0.022 * s, 0.082],
      ], 0.014, s * 0.220, mapTorso(1.790), 0.130, B.chest,
      { bevel: 0.003, rz: s * 0.10, ry: -s * 0.05 });
      for (let i = 0; i < 3; i++)
        addChamferedPanel(buf('steel'), 0.060, 0.010, 0.008,
                          s * 0.220, mapTorso(1.724 - i * 0.026), 0.130, B.chest,
                          { chamfer: 0.003, bevel: 0.001, rz: s * 0.10 });
    }
    addChamferedPanel(buf('glow'), 0.010, 0.060, 0.006,
                      0, mapTorso(1.548), 0.190, B.chest,
                      { chamfer: 0.003, bevel: 0.001 });
  }

  // Narrow chamfered chest clasp instead of a rectangular superhero crest.
  addChamferedPanel(buf('steel'), 0.058, 0.098, 0.022,
                    0, 1.352, -0.156, B.chest, { chamfer: 0.012 });
  addChamferedPanel(buf('glow'), 0.018, 0.056, 0.010,
                    0, 1.352, -0.174, B.chest, { chamfer: 0.005, bevel: 0.002 });

  // ── cape ───────────────────────────────────────────────────────────────────
  // A shell, not a plane: plateGeometry already builds a wrapped surface with
  // thickness and rimmed edges, so the cape gets a visible edge and a lining
  // instead of being a one-sided sheet that disappears at a grazing angle.
  // Rigid to the chest — it hangs off the shoulders, and nothing below it is
  // load-bearing for the animation.
  // Keep the cape as the Phantom's silhouette feature. It used to cover every
  // chassis, including the default Vanguard, turning the normal rear gameplay
  // view into one flat black rectangle and hiding the rifle/arm pose we need to
  // read. Vanguard and Striker show their shaped back plate and waist instead.
  if (id === 'phantom') {
    const CAPE = [
      { y: 1.492, rx: 0.104, rz: 0.086, n: 2.6, dz: 0.052 },
      { y: 1.400, rx: 0.140, rz: 0.100, n: 2.6, dz: 0.056 },
      { y: 1.230, rx: 0.170, rz: 0.114, n: 2.7, dz: 0.060 },
      { y: 1.020, rx: 0.192, rz: 0.126, n: 2.7, dz: 0.062 },
      { y: 0.800, rx: 0.208, rz: 0.134, n: 2.8, dz: 0.064 },
      { y: 0.610, rx: 0.218, rz: 0.140, n: 2.8, dz: 0.066 },
      { y: 0.480, rx: 0.222, rz: 0.142, n: 2.8, dz: 0.068 },
    ];
    const CA = arc(BACK, 0.92);
    addPlate(buf('joint'), CAPE, 0, B.chest, { a0: CA[0], a1: CA[1], t: 0.016, seg: 16 });
    // A lit edge down both hems: an unbroken black shape has no silhouette of
    // its own against a dark map, and the cape is the biggest surface here.
    for (const s of [-1, 1])
      addPlate(buf('armor'), CAPE, 0, B.chest,
               { a0: BACK + s * 0.92, a1: BACK + s * 0.84, lift: 0.004, t: TRIM, seg: 2 });
    // Collar: the clasp the cape hangs from, over the trapezius.
    for (const s of [-1, 1])
      addBox(buf('armor2'), 0.056, 0.040, 0.052, s * 0.088, 1.452, 0.072, B.chest);
  }

  // ── head: compact arena helmet / wrapped tactical hood ─────────────────────
  // Vanguard wears a fitted tactical helmet and mask over a human head; the
  // alternate chassis retain the wrapped ninja treatment. Both share the same
  // head/eye hit contract.
  loftSkinned(place(domed(skullT, arena ? 0.52 : 0.55), 0, () => [[B.head, 1]]), 22, buf(arena ? 'armor2' : 'joint'));
  // Crown plate, hard-faced so the helm has flats and a temple corner rather
  // than being a bowl. Its trim is a band at the BROW, where a helmet's seam
  // actually is — a pale cap over the whole crown reads as a bald head.
  {
    const CROWN = skullT.slice(4).map(q => ({ ...q, z: q.dz }));
    const CA = { a0: -Math.PI, a1: Math.PI, seg: 22, hard: 3.8 };
    addPlate(buf(arena ? 'armor2' : 'armor'), CROWN, 0, B.head, { ...CA, t: (arena ? 0.016 : 0.014) * G });
    addPlate(buf('steel'), edgeStrip(CROWN, 0.18, false), 0, B.head,
             { ...CA, lift: 0.014 * G, t: TRIM });
  }
  addPlate(buf('joint'), skullT.slice(3, 5).map(q => ({ ...q, z: q.dz })), 0, B.head,
           { a0: -Math.PI, a1: Math.PI, t: 0.012 * G, seg: 22, hard: 3.4 });
  if (arena) {
    // A shallow rear helmet shell follows the skull rather than forming a
    // mechanical pod around the whole jaw.
    const REAR_HELM = skullT.slice(2, 6).map(q => ({ ...q, z: q.dz }));
    addPlate(buf('armor'), REAR_HELM, 0, B.head,
             { a0: arc(BACK, 0.92)[0], a1: arc(BACK, 0.92)[1],
               t: 0.016 * G, seg: 12, hard: 3.5 });
    addPlate(buf('armor2'), edgeStrip(REAR_HELM, 0.22, true), 0, B.head,
             { a0: arc(BACK, 0.92)[0], a1: arc(BACK, 0.92)[1],
               lift: 0.016 * G, t: TRIM, seg: 12, hard: 3.5 });
    addPolygonPanel(buf('bone'), [
      [-0.104 * G, 0.052 * G], [0.104 * G, 0.052 * G],
      [0.126 * G, -0.010 * G], [0.070 * G, -0.076 * G],
      [0, -0.096 * G], [-0.070 * G, -0.076 * G], [-0.126 * G, -0.010 * G],
    ], 0.024 * G, 0, headY(2.092), -0.124 * G, B.head,
    { bevel: 0.004 * G });
    addPolygonPanel(buf('armor2'), [
      [-0.062 * G, 0.030 * G], [0.062 * G, 0.030 * G],
      [0.050 * G, -0.026 * G], [0, -0.048 * G], [-0.050 * G, -0.026 * G],
    ], 0.012 * G, 0, headY(2.096), -0.148 * G, B.head,
    { bevel: 0.002 * G });
  }

  // Eye opening and lower face mask. The arena helmet uses one continuous lime
  // optic band inside a black cavity; it should never read as two human goggles.
  const operative = arena;
  if (operative) {
    // Deep pentagonal face shield with the skin's two unmistakable lime V
    // optics. A horizontal visor made the head read as a generic robot.
    addPolygonPanel(buf('joint'), [
      [-0.120 * G, 0.062 * G], [0.120 * G, 0.062 * G],
      [0.090 * G, -0.066 * G], [0, -0.112 * G], [-0.090 * G, -0.066 * G],
    ], 0.050 * G, 0, headY(1.982), -0.116 * G, B.head,
    { bevel: 0.004 * G });
    addChevronPanel(buf('glow'), 0.170 * G, 0.050 * G, 0.018 * G, 0.013 * G,
                    0, headY(2.010), -0.158 * G, B.head);
    addChevronPanel(buf('glow'), 0.132 * G, 0.042 * G, 0.016 * G, 0.013 * G,
                    0, headY(1.970), -0.162 * G, B.head);
    addPolygonPanel(buf('armor2'), [
      [-0.112 * G, 0.022 * G], [0.112 * G, 0.022 * G],
      [0.086 * G, 0.064 * G], [-0.086 * G, 0.064 * G],
    ], 0.020 * G, 0, headY(2.046), -0.146 * G, B.head,
    { bevel: 0.003 * G });
    for (const s of [-1, 1]) {
      addChamferedPanel(buf('armor'), 0.048 * G, 0.128 * G, 0.034 * G,
                        s * 0.126 * G, headY(1.966), -0.084 * G, B.head,
                        { chamfer: 0.008 * G, rz: -s * 0.04 });
      addDisc(buf('steel'), 0.030 * G, 0.018 * G,
              s * 0.126 * G, headY(1.960), -0.004 * G, B.head, s);
      addDisc(buf('joint'), 0.012 * G, 0.021 * G,
              s * 0.136 * G, headY(1.960), -0.004 * G, B.head, s);
    }
  } else {
    addBox(buf('frame'), 0.188 * G, 0.052 * G, 0.052 * G,
           0, mapHead(1.992), -0.104 * G, B.head);
    addBox(buf('glow'), 0.126 * G, 0.014 * G, 0.026 * G,
           0, mapHead(1.996), -0.132 * G, B.head);
  }
  addBox(buf('joint'), 0.182 * G, 0.130 * G, 0.060 * G, 0, headY(1.912), -0.082 * G, B.head);

  // Rear helmet strap / hood knot. It remains compact enough to follow a human
  // skull instead of reading as a battery block.
  addChamferedPanel(buf(arena ? 'frame' : 'armor2'), arena ? 0.046 * G : 0.070 * G,
                    arena ? 0.036 * G : 0.052 * G, arena ? 0.030 * G : 0.060 * G,
                    0, headY(1.960), 0.108 * G, B.head,
                    { chamfer: 0.008 * G, bevel: 0.002 * G });
  if (!operative) {
    addBox(buf('joint'), 0.050 * G, 0.250 * G, 0.020 * G, -0.040 * G, mapTorso(1.710), 0.132 * G, B.chest, -0.10);
    addBox(buf('joint'), 0.044 * G, 0.205 * G, 0.018 * G,  0.040 * G, mapTorso(1.720), 0.139 * G, B.chest,  0.13);
  } else {
    addChamferedPanel(buf('frame'), 0.108 * G, 0.038 * G, 0.030 * G,
                      0, mapTorso(1.744), 0.094 * G, B.chest,
                      { chamfer: 0.008 * G, bevel: 0.002 * G });
  }

  // Cheek guards + chin plate close the jaw.
  if (arena) {
    for (const s of [-1, 1]) {
      addChamferedPanel(buf('armor'), 0.060 * G, 0.150 * G, 0.054 * G,
                        s * 0.108 * G, headY(1.930), -0.052 * G, B.head,
                        { chamfer: 0.011 * G, rz: -s * 0.055, ry: -s * 0.05 });
      for (let i = 0; i < 2; i++)
        addChamferedPanel(buf('steel'), 0.020 * G, 0.010 * G, 0.006 * G,
                          s * 0.100 * G, headY(1.916 + i * 0.030), -0.088 * G, B.head,
                          { chamfer: 0.003 * G, bevel: 0.001 * G });
    }
    addChamferedPanel(buf('joint'), 0.126 * G, 0.058 * G, 0.034 * G,
                      0, headY(1.882), -0.098 * G, B.head,
                      { chamfer: 0.014 * G, bevel: 0.003 * G });
    addChamferedPanel(buf('armor'), 0.060 * G, 0.028 * G, 0.014 * G,
                      0, headY(1.872), -0.138 * G, B.head,
                      { chamfer: 0.007 * G, bevel: 0.002 * G });
  } else {
    for (const s of [-1, 1])
      addBox(buf('frame'), 0.040 * G, 0.130 * G, 0.104 * G,
             s * 0.088 * G, mapHead(1.932), -0.020 * G, B.head);
    addBox(buf('joint'), 0.118 * G, 0.052 * G, 0.056 * G,
           0, mapHead(1.884), -0.086 * G, B.head);
  }
  // Neck seal
  for (const s of [-1, 1])
    addBox(buf('steel'), 0.016 * G, 0.12 * G, 0.016 * G, (s * 0.048) * G, mapTorso(1.800), 0.036 * G, B.neck);

  const parts = [];
  for (const [key, b] of Object.entries(bufs)) {
    const geo = toGeometry(b);
    // Raycasts cull against the bounding sphere before testing triangles, and a
    // skinned mesh's is computed from the BIND pose — a leg thrown out in a
    // slide reaches past it and shots would silently miss a body plainly there.
    // One generous sphere around the whole character instead.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 2.0);
    // Outline weight. 11mm was chosen on the 2.21m body, where it was 0.5% of
    // stature and the body was a dozen big forms. On a 1.82m figure wearing
    // this many small plates it is a fat black rim on every one of them, and
    // the armour reads as dark first and violet second.
    // The default arena suit relies on real material/light response, matching
    // the reference's clean low-poly rendering. A black hull around every tiny
    // plate made its curved armour read as a pile of outlined blocks.
    parts.push({ key, geo, outline: arena ? null : inflate(geo, OUT_T) });
  }
  return parts;
}
