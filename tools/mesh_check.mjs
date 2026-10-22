#!/usr/bin/env node
// Geometry gate for the player / bot body (src/player/HeroBody.js).
//
// The mesh is free to change; the numbers the ANIMATION reads off it are not.
// Locomotion.js solves ground contact against a fixed hip/knee/ankle chain and
// a fixed sole footprint, and RifleCarry.js IKs both arms against a fixed
// shoulder position and fixed bone lengths. None of it is derived from the
// body, so reshaping the body silently breaks the ground solve or takes the
// hands off the gun.
//
// The body is skinned now, which adds a second class of thing that breaks
// quietly: weights. A vertex with no influence collapses to the origin, a
// vertex weighted to the wrong leg gets dragged across the body when the other
// one swings, and a joint with too little geometry through it pinches shut when
// it bends. None of that throws — it just looks wrong in motion, which is
// exactly what a build gate is for.

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { buildHeroBody } from '../src/player/HeroBody.js';
import { buildBlockBody } from '../src/player/BlockBody.js';
import {
  LOWPOLY_IDS, buildLowPolyCharacter, isSharedGeometry,
} from '../src/player/LowPolyModels.js';
import { buildPreviewCharacter, rigCharacterLimbs } from '../src/player/PreviewCharacter.js';
import * as BODY from '../src/player/Proportions.js';

let fails = 0;
const ok = (c, msg, detail = '') => {
  if (!c) fails++;
  console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${msg}${detail ? '   ' + detail : ''}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const P = (o) => o.getWorldPosition(new THREE.Vector3());
const boneIndex = (g, name) => g.userData.skeleton.bones.findIndex(b => b.name === name);

// The live roster must use the connected skinned body. Both implementations
// are tested below, so geometry correctness alone would not catch the runtime
// factory accidentally switching back to the pasted-parts block chassis.
{
  const runtime = buildLowPolyCharacter('vanguard');
  ok(runtime.userData?.isHero && !runtime.userData?.isBlockBody,
    'the live roster builds the connected weighted Hero body');
}

// The optional Soldier GLB can still be downloading when Play is pressed.
// Every selectable legacy kit must degrade to the same connected body, never
// the old procedural mannequin whose weapon and limbs visibly intersected.
for (const id of ['assault', 'recon', 'heavy', 'stealth']) {
  const runtime = buildPreviewCharacter(
    { primary: 0x777777, secondary: 0x222222 }, id, null, { allowHuman: false }
  );
  ok(runtime.userData?.isHero && !runtime.userData?.isBlockBody
      && runtime.userData?.fallbackForArmorType === id,
    `${id} Soldier loading fallback is the connected Hero body`);
}

// Deform a body by its skeleton and read a vertex back out — the same path the
// renderer and the raycaster take, so what this measures is what is drawn.
function skinnedPosition(mesh, i, out) {
  out.fromBufferAttribute(mesh.geometry.attributes.position, i);
  mesh.applyBoneTransform(i, out);
  return out;
}

for (const id of LOWPOLY_IDS) {
  console.log(`\n── ${id} ──`);
  const g = buildHeroBody(id);
  g.updateMatrixWorld(true);
  const rig = rigCharacterLimbs(g);
  const { meshes, bones } = g.userData;

  ok(!!rig && rig.legL && rig.armR, 'the body arrives already rigged');
  const expectedSilhouette = id === 'vanguard' ? 'compact-arena-warrior' : 'shinobi-operative';
  ok(g.userData?.isNinjaInspired && g.userData?.silhouetteStyle === expectedSilhouette,
    'the live connected body carries its authored silhouette contract');

  // ── the contract ───────────────────────────────────────────────────────────
  const hip = P(rig.legL), knee = P(rig.kneeL), ankle = P(rig.ankleL);
  const sh = P(rig.armR), el = P(rig.elbowR), hand = P(bones.handR);
  // Against Proportions.js, not against numbers typed in here. A harness with
  // its own copy of the figure goes on measuring the new body with the old
  // ruler, which is exactly what the gait harness did when this changed.
  ok(near(hip.y, BODY.HIP_Y, 1e-6) && near(Math.abs(hip.x), BODY.HIP_X, 1e-6),
     'hip on the figure', `${hip.x.toFixed(4)}, ${hip.y.toFixed(4)}`);
  ok(near(knee.y, BODY.KNEE_Y, 1e-6), 'knee on the figure', knee.y.toFixed(4));
  ok(near(ankle.y, BODY.ANKLE_Y, 1e-6), 'ankle on the figure', ankle.y.toFixed(4));
  ok(near(sh.y, BODY.SHOULDER_Y, 1e-6) && near(sh.x, BODY.SHOULDER_X, 1e-6),
     'shoulder on the figure', `${sh.x.toFixed(4)}, ${sh.y.toFixed(4)}`);
  ok(near(sh.y - el.y, BODY.UP_ARM, 1e-6), 'UP_ARM', (sh.y - el.y).toFixed(4));
  ok(near(el.y - hand.y, BODY.FOREARM, 1e-6), 'FOREARM', (el.y - hand.y).toFixed(4));
  ok(near(hip.y - knee.y, BODY.THIGH_L, 1e-6), 'THIGH_L', (hip.y - knee.y).toFixed(4));
  ok(near(knee.y - ankle.y, BODY.SHIN_L, 1e-6), 'SHIN_L', (knee.y - ankle.y).toFixed(4));

  // ── and the figure itself is a HUMAN one ───────────────────────────────────
  // The body used to be a 2.21m giant while Player.js put your eyes at 1.70m:
  // the character you saw was not the character you were. These are standard
  // adult landmark fractions, so a future reshape cannot quietly drift back
  // toward a mech.
  {
    // The head is found by BONE, not by which material buffer it landed in.
    // This used to look for a mesh called `body_bone`, which was only ever true
    // while the head was a bare skull — the moment it became a helmet the shell
    // moved to the armour buffer and the lookup returned undefined.
    // Only vertices bound ENTIRELY to the head bone: the top of the torso loft
    // is 74% head where it blends into the neck, and counting it would drag the
    // "chin" 6cm below the jaw and turn a 7.5-head figure into a 6-head one.
    // What is wanted is the head as a rigid object — the shell, cheeks, chin.
    const headBone = boneIndex(g, 'head');
    let crown = -Infinity, chin = Infinity, top = -Infinity;
    const q = new THREE.Vector3();
    for (const m of meshes) {
      const sp = m.geometry.attributes.position;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      for (let i = 0; i < sp.count; i++) {
        const on = (si.getX(i) === headBone && sw.getX(i) > 0.99)
                || (si.getY(i) === headBone && sw.getY(i) > 0.99)
                || (si.getZ(i) === headBone && sw.getZ(i) > 0.99)
                || (si.getW(i) === headBone && sw.getW(i) > 0.99);
        if (!on) continue;
        q.fromBufferAttribute(sp, i);
        crown = Math.max(crown, q.y); chin = Math.min(chin, q.y);
      }
    }
    for (const m of meshes) {
      const pp = m.geometry.attributes.position;
      for (let i = 0; i < pp.count; i++) { q.fromBufferAttribute(pp, i); top = Math.max(top, q.y); }
    }
    const CANON = { shoulder: [sh.y, 0.820], elbow: [el.y, 0.630], wrist: [hand.y, 0.485],
                    hip: [hip.y, 0.530], knee: [knee.y, 0.285], ankle: [ankle.y, 0.039],
                    // Vanguard's oversized helmet/jaw shell is presentation
                    // armour. Its skeleton, eyes and damage contract remain on
                    // human canon even though the visible shell is six-head heroic.
                    chin: [chin, id === 'vanguard' ? 0.839 : 0.870] };
    let worst = 0, worstAt = '';
    for (const [k, [a, frac]] of Object.entries(CANON)) {
      const d = Math.abs(a / top - frac);
      if (d > worst) { worst = d; worstAt = k; }
    }
    ok(worst < 0.02, 'every landmark sits on human canon',
       `worst ${(worst * 100).toFixed(1)}%H at the ${worstAt}`);
    const heads = top / (crown - chin);
    const compact = id === 'vanguard';
    ok(compact ? heads > 5.8 && heads < 6.7 : heads > 7.0 && heads < 8.0,
       compact ? 'the arena shell has compact six-head proportions' : 'the figure is seven and a half heads tall',
       `${heads.toFixed(2)} heads, stature ${top.toFixed(3)} m`);
    // The body you see has to be the body you are.
    ok(Math.abs(top * 0.936 - BODY.EYE_HEIGHT) < 0.05,
       'its eyes land where the camera already is',
       `${(top * 0.936).toFixed(3)} m vs Player.js ${BODY.EYE_HEIGHT} m`);
  }

  // ── the surface ────────────────────────────────────────────────────────────
  const v = new THREE.Vector3();
  let verts = 0, tris = 0, bad = 0, unweighted = 0, badSum = 0, crossLeg = 0;
  const footBox = new THREE.Box3();
  let bodyLow = Infinity;
  const boneNames = g.userData.skeleton.bones.map(b => b.name);
  const FOOT_BONES = new Set(['ankleL', 'ankleR']);
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    verts += pos.count;
    tris += m.geometry.index.count / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) bad++;
      bodyLow = Math.min(bodyLow, v.y);
      const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
      const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      const sum = w[0] + w[1] + w[2] + w[3];
      if (sum < 1e-6) unweighted++;
      else if (Math.abs(sum - 1) > 1e-4) badSum++;
      let onFoot = false;
      for (let k = 0; k < 4; k++) {
        if (w[k] < 1e-5) continue;
        const n = boneNames[idx[k]];
        if (FOOT_BONES.has(n)) onFoot = true;
        // A vertex on one leg must never be pulled by the other leg. Generic
        // proximity auto-skinning gets this wrong constantly — the femoral
        // heads are only 2 x 4.5%H apart and the thighs are thicker than that,
        // so an inner-thigh vertex is nearly as close to the far femur as its
        // own.
        //
        // The margin is the hip spacing, not a fixed 2cm: at human proportions
        // the thighs genuinely touch at the crotch and their surfaces cross the
        // midline, which is anatomy rather than a weight leak. Real bleed puts
        // vertices out at the FAR leg, well past this.
        if (/^(thigh|knee|ankle)L$/.test(n) && v.x > BODY.HIP_X) crossLeg++;
        if (/^(thigh|knee|ankle)R$/.test(n) && v.x < -BODY.HIP_X) crossLeg++;
      }
      if (onFoot && v.y < BODY.ANKLE_Y + 0.06) footBox.expandByPoint(v);
    }
  }
  console.log(`        ${meshes.length} skinned meshes, ${verts} verts, ${tris | 0} tris`);
  ok(bad === 0, 'no NaN positions', `${bad} bad`);
  ok(unweighted === 0, 'every vertex is weighted to at least one bone',
     `${unweighted} orphans`);
  ok(badSum === 0, 'every vertex\'s weights sum to 1', `${badSum} off`);
  ok(crossLeg === 0, 'no weight leaks across to the opposite leg', `${crossLeg} leaked`);

  // ── the surface faces outward ──────────────────────────────────────────────
  // Winding follows the order a station table is swept in, and the tables here
  // are authored both ways: torso and skull bottom-up, legs and arms top-down.
  // Swept blind, a descending table comes out INSIDE-OUT — and that failure is
  // nearly invisible to the eye, because the inside of a limb looks like the
  // outside of one. What it is not invisible to is anything that reads the
  // normal: the surface is lit from behind, and the inverted-hull outline,
  // which pushes each vertex ALONG its normal, collapses inward and fills the
  // limb with solid black. The legs, arms, tassets and cape were all shipping
  // inside-out.
  //
  // The test is the one the renderer performs: fire a ray in and check the
  // first thing it hits is a FRONT face. If it is not, back-face culling
  // throws that surface away and you are looking at the far wall.
  {
    const rc = new THREE.Raycaster();
    const probes = [];
    for (const y of [1.62, 1.36, 1.16, 0.90, 0.72, 0.40, 0.16])
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0.7, -0.7], [-0.7, 0.7]])
        probes.push([y, dx, dz]);
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    let flipped = 0, tested = 0, worst = '';
    for (const [y, dx, dz] of probes) {
      o.set(dx * 3, y, dz * 3);
      d.set(-dx, 0, -dz).normalize();
      rc.set(o, d);
      for (const m of meshes) m.material.side = THREE.DoubleSide;
      const either = rc.intersectObjects(meshes, false)[0];
      for (const m of meshes) m.material.side = THREE.FrontSide;
      const front = rc.intersectObjects(meshes, false)[0];
      if (!either) continue;
      tested++;
      const gap = front ? front.distance - either.distance : Infinity;
      if (gap > 0.004) {
        flipped++;
        if (!worst) worst = `y=${y} dir=(${dx},${dz}) on ${either.object.name}`;
      }
    }
    ok(flipped === 0, 'every surface faces outward — nothing is inside-out',
       `${flipped}/${tested} probes hit a back face first${worst ? ', first at ' + worst : ''}`);
  }

  // ── the ground plane Locomotion solves against ─────────────────────────────
  ok(near(footBox.min.y, 0, 0.004), 'sole sits on y = 0', `min ${footBox.min.y.toFixed(4)}`);
  ok(bodyLow > -0.004, 'nothing pokes through the floor', `lowest ${bodyLow.toFixed(4)}`);
  ok(Math.abs(footBox.min.z - BODY.TOE_Z) < 0.03,
     'the toe reaches where Locomotion plants it', footBox.min.z.toFixed(3));
  ok(Math.abs(footBox.max.z - BODY.HEEL_Z) < 0.03,
     'the heel reaches where Locomotion plants it', footBox.max.z.toFixed(3));

  // ── headshots ──────────────────────────────────────────────────────────────
  // There is no per-part head mesh to tag any more, so bots resolve head hits
  // by height. The threshold has to sit above the shoulders and below the chin,
  // or every chest hit is a headshot or none of them are.
  const hy = g.userData.headshotY;
  ok(typeof hy === 'number' && hy > BODY.SHOULDER_Y && hy < BODY.CHIN_Y + 0.02,
     'the head-hit height clears the shoulders and catches the skull', `${hy}`);
  {
    const src = readFileSync(new URL('../src/weapons/WeaponSystem.js', import.meta.url), 'utf8');
    ok(/headshotY/.test(src),
       'the shooting code reads that height rather than a per-mesh tag');
  }

  // ── deformation ────────────────────────────────────────────────────────────
  // Bend the knee hard and check the leg still behaves like a leg. Linear blend
  // skinning collapses at a bend if the joint is short of loops; the failure is
  // the limb pinching to a waist, which no other check would notice.
  {
    const ring = (mesh, yLo, yHi) => {
      const pos = mesh.geometry.attributes.position;
      let minX = Infinity, maxX = -Infinity, n = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.x > 0 || v.y < yLo || v.y > yHi) continue;   // left leg only
        n++;
      }
      return n;
    };
    ok(ring(meshes[0], BODY.KNEE_Y - 0.06, BODY.KNEE_Y + 0.06) > 40,
       'the knee carries enough loops to bend without pinching',
       `${ring(meshes[0], BODY.KNEE_Y - 0.06, BODY.KNEE_Y + 0.06)} verts through the crease`);

    // Linear blend skinning collapses a joint by averaging two rotated copies
    // of a vertex: the blended result is pulled off the surface and toward the
    // joint axis. So the thing to measure is the crease vertices' MEAN DISTANCE
    // FROM THE JOINT, which shrinks exactly when that happens.
    //
    // Two earlier versions of this check could not fail. Width across x cannot
    // move, because the knee is a hinge about x. Max pairwise distance cannot
    // move either, because it is invariant under rotation. Both reported
    // identical numbers straight and bent and would have passed any amount of
    // pinching.
    const creaseRadius = () => {
      const w = new THREE.Vector3();
      const j = P(rig.kneeL);
      let sum = 0, n = 0;
      for (const m of meshes) {
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (v.x > 0 || v.y > BODY.KNEE_Y + 0.06 || v.y < BODY.KNEE_Y - 0.06) continue;
          skinnedPosition(m, i, w);
          sum += w.distanceTo(j); n++;
        }
      }
      return n ? sum / n : 0;
    };
    g.updateMatrixWorld(true);
    const straight = creaseRadius();
    rig.legL.rotation.x = 0.6; rig.kneeL.rotation.x = -1.6;
    g.updateMatrixWorld(true);
    const bent = creaseRadius();
    ok(bent > straight * 0.82,
       'the knee keeps its volume through a hard bend',
       `mean crease radius ${(bent * 100).toFixed(2)} cm bent vs ${(straight * 100).toFixed(2)} cm straight`
       + ` (${((bent / straight - 1) * 100).toFixed(1)}%)`);
    rig.legL.rotation.x = 0; rig.kneeL.rotation.x = 0;
    g.updateMatrixWorld(true);
  }

  // ── the limb actually moves ────────────────────────────────────────────────
  {
    const before = new THREE.Vector3(), after = new THREE.Vector3();
    const m = meshes[0];
    // A vertex low on the left shin.
    let pick = -1;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.x < -0.04 && v.y > BODY.ANKLE_Y + 0.10 && v.y < BODY.ANKLE_Y + 0.16) { pick = i; break; }
    }
    ok(pick >= 0, 'found a shin vertex to test');
    if (pick >= 0) {
      g.updateMatrixWorld(true);
      skinnedPosition(m, pick, before);
      rig.kneeL.rotation.x = -1.2;
      g.updateMatrixWorld(true);
      skinnedPosition(m, pick, after);
      ok(before.distanceTo(after) > 0.08,
         'bending the knee carries the shin skin with it',
         `${before.distanceTo(after).toFixed(3)} m`);
      rig.kneeL.rotation.x = 0;
      g.updateMatrixWorld(true);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The BLOCK chassis — hard-surface plates, the body the game actually builds.
//
// Same contract as the lofted body, checked the same way. What is NOT checked
// is creasing: every vertex here is weighted 1.0 to one bone because these are
// rigid plates, so there is no crease to keep the volume of. What replaces it
// is the check that matters for a rigid body instead — that no part is left
// behind at the origin when its bone moves, which is the characteristic
// failure when parts are bulk-generated and one bone name is misspelt.
// ═══════════════════════════════════════════════════════════════════════════
for (const id of LOWPOLY_IDS) {
  console.log(`\n── block:${id} ──`);
  const g = buildBlockBody(id);
  g.updateMatrixWorld(true);
  const rig = rigCharacterLimbs(g);
  const { meshes, bones } = g.userData;

  const hip = P(rig.legL), knee = P(rig.kneeL), ankle = P(rig.ankleL);
  const sh = P(rig.armR), el = P(rig.elbowR), hand = P(bones.handR);
  ok(near(hip.y, BODY.HIP_Y, 1e-4) && near(Math.abs(hip.x), BODY.HIP_X, 1e-4),
     'hip on the figure', `${hip.x.toFixed(4)}, ${hip.y.toFixed(4)}`);
  ok(near(knee.y, BODY.KNEE_Y, 1e-4), 'knee on the figure', knee.y.toFixed(4));
  ok(near(ankle.y, BODY.ANKLE_Y, 1e-4), 'ankle on the figure', ankle.y.toFixed(4));
  ok(near(sh.y, BODY.SHOULDER_Y, 1e-4) && near(sh.x, BODY.SHOULDER_X, 1e-4),
     'shoulder on the figure', `${sh.x.toFixed(4)}, ${sh.y.toFixed(4)}`);
  ok(near(sh.y - el.y, BODY.UP_ARM, 1e-4), 'UP_ARM', (sh.y - el.y).toFixed(4));
  ok(near(el.y - hand.y, BODY.FOREARM, 1e-4), 'FOREARM', (el.y - hand.y).toFixed(4));
  ok(near(hip.y - knee.y, BODY.THIGH_L, 1e-4), 'THIGH_L', (hip.y - knee.y).toFixed(4));
  ok(near(knee.y - ankle.y, BODY.SHIN_L, 1e-4), 'SHIN_L', (knee.y - ankle.y).toFixed(4));

  const v = new THREE.Vector3();
  let verts = 0, tris = 0, unweighted = 0, badSum = 0, crossLeg = 0, low = Infinity;
  const boneNames = g.userData.skeleton.bones.map(b => b.name);
  const footBox = new THREE.Box3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    verts += pos.count; tris += m.geometry.index.count / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      low = Math.min(low, v.y);
      const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
      const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      const sum = w[0] + w[1] + w[2] + w[3];
      if (sum < 1e-6) unweighted++;
      else if (Math.abs(sum - 1) > 1e-4) badSum++;
      let onFoot = false;
      for (let k = 0; k < 4; k++) {
        if (w[k] < 1e-5) continue;
        const n = boneNames[idx[k]];
        if (n === 'ankleL' || n === 'ankleR') onFoot = true;
        if (/^(thigh|knee|ankle)L$/.test(n) && v.x > BODY.HIP_X) crossLeg++;
        if (/^(thigh|knee|ankle)R$/.test(n) && v.x < -BODY.HIP_X) crossLeg++;
      }
      if (onFoot && v.y < BODY.ANKLE_Y + 0.09) footBox.expandByPoint(v);
    }
  }
  console.log(`        ${meshes.length} skinned meshes, ${verts} verts, ${tris | 0} tris`);
  ok(unweighted === 0, 'every vertex is weighted', `${unweighted} orphans`);
  ok(badSum === 0, 'every vertex\'s weights sum to 1', `${badSum} off`);
  ok(crossLeg === 0, 'no weight leaks across to the opposite leg', `${crossLeg} leaked`);
  ok(Math.abs(footBox.min.y) < 0.006, 'sole sits on y = 0', `min ${footBox.min.y.toFixed(4)}`);
  ok(low > -0.006, 'nothing pokes through the floor', `lowest ${low.toFixed(4)}`);
  ok(typeof g.userData.headshotY === 'number'
     && g.userData.headshotY > BODY.SHOULDER_Y
     && g.userData.headshotY < BODY.CHIN_Y + 0.02, 'head-hit height is sane');

  // Nothing left behind: drive every bone the animation drives and confirm the
  // skin under it actually travels.
  {
    const w = new THREE.Vector3();
    const sample = (boneName) => {
      const bi = boneNames.indexOf(boneName);
      for (const m of meshes) {
        const si = m.geometry.attributes.skinIndex;
        for (let i = 0; i < si.count; i++) {
          if (si.getX(i) === bi) return [m, i];
        }
      }
      return null;
    };
    const driven = ['thighL', 'kneeL', 'ankleL', 'shoulderR', 'elbowR', 'handR',
                    'hips', 'spine', 'chest', 'head'];
    const stuck = [];
    for (const bn of driven) {
      const hit = sample(bn);
      if (!hit) { stuck.push(bn + '(no geometry)'); continue; }
      const [m, i] = hit;
      g.updateMatrixWorld(true);
      skinnedPosition(m, i, v);
      const before = v.clone();
      bones[bn].rotation.x -= 0.5;
      g.updateMatrixWorld(true);
      skinnedPosition(m, i, w);
      if (before.distanceTo(w) < 0.01) stuck.push(bn);
      bones[bn].rotation.x += 0.5;
      g.updateMatrixWorld(true);
    }
    ok(stuck.length === 0, 'every driven bone carries geometry with it',
       stuck.length ? stuck.join(', ') : `${driven.length} bones checked`);
  }
}

// ── shared buffers ───────────────────────────────────────────────────────────
// The outline hulls are still cached per shape; anything that tears down a
// character has to check before freeing, or one dispose empties every body.
console.log('\n── teardown ──');
for (const f of ['src/player/Avatar.js', 'src/ui/ArmorPreviewRenderer.js']) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const frees = /geometry.{0,3}dispose/.test(src);
  ok(!frees || /isSharedGeometry/.test(src),
     `${f} checks before disposing`, frees ? 'disposes' : 'never disposes');
}
ok(typeof isSharedGeometry === 'function', 'the shared-geometry tag is still exported');

console.log(fails ? `\n${fails} mesh check(s) FAILED` : '\nall mesh checks passed');
process.exit(fails ? 1 : 0);
