// ═══════════════════════════════════════════════════════════════════════════
// The hero chassis: hard-surface armour plates on the game's own skeleton.
//
// Built from src/player/heroParts.js, which tools/model_player.py generates
// out of the Blender build. Two things about that are deliberate:
//
// It is a DATA MODULE, not a .glb. The engine has no runtime asset load in the
// character path, and adding one would mean a fetch that can fail, a loader to
// wait on, and a body that pops in after the match starts. The generator emits
// the eight corners of every block and the bone table as JS; the geometry is
// assembled here at build time exactly the way HeroBody assembles its lofts.
//
// The parts arrive as ONE SkinnedMesh per material rather than 178 objects
// parented to bones. Same result on screen, but it is 6 draw calls instead of
// 178, it survives the same shared-geometry cache every other body uses, and
// every vertex carries a real weight — so the mesh gate's "no orphan vertices"
// and "no weight crossing between the legs" checks still mean something.
//
// ─── RIGID vs SKINNED ────────────────────────────────────────────────────────
// Every vertex is weighted 1.0 to exactly one bone. That is correct for this
// model and not a shortcut: these are hard plates, and blending a shin plate
// between knee and ankle would bend a steel greave. HeroBody's lofted body is
// the one that needs graded weights, and it still has them — this is a second
// chassis, not a replacement for that technique.
// ═══════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { getLowPolyPalette, makeBodyMaterials } from './LowPolyModels.js';
import * as BODY from './Proportions.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { newBuffer, toGeometry } from './BodyGeometry.js';
import { BONES, FACES, PARTS } from './heroParts.js';
// The authored table uses the original 1.70 m eye height. Scale bones and
// vertices together so fallback bodies keep the shared gameplay proportions.
const AUTHOR_SCALE = BODY.STATURE / 1.816;

// Material roles in heroParts.js map onto the palette every other body uses,
// so armour colours follow the equipped chassis rather than being baked in —
// the same model becomes the violet, azure and graphite variants.
//
// The Blender build carries three materials, which is what its brief asked
// for; the game wants four roles, because it needs somewhere to put the
// chassis IDENTITY colour. Mapping all the white plate onto one role loses
// that: the whole character comes out a single saturated hue again, which is
// the exact failure the palette work fixed. So the white plate is split here
// by part rather than by material — LIGHT is the substrate (shoulders, arms,
// greaves, helm crown) and IDENTITY is placed on it (chest, waist, thighs,
// face). Splitting on this side rather than in the .blend keeps the exported
// model at the three materials it was specified with.
const ROLE = { armor: 'bone', dark: 'frame', visor: 'glow' };

const IDENTITY = /^(Chest_Pec|Chest_Sternum|Torso_Side|Abdomen_Plate|Ab_Lame|Hip_Plate|Hip_Rear|Groin_Plate|Thigh_Plate|Thigh_Pod|Belt_Buckle|Helm_Face|Helm_Cheek|Back_Plate|Pack_Main|Visor_Rim)/;

// The Blender source contains an optional tactical accessory pass. On the
// shipping arena chassis those pieces turned the rear view into a rectangular
// backpack and added small fins/spikes that fought the clean, connected plate
// language of the map. Keep the structural back plate and forearm guards; omit
// only the detachable garnish when assembling the shared runtime mesh.
const OMIT_ARENA_PART = /^(Pack_|Antenna$|Crest_Fin|Forearm_Fin|Elbow_Spike)/;

function roleFor(part) {
  const base = ROLE[part.m] || 'bone';
  return (base === 'bone' && IDENTITY.test(part.n)) ? 'armor' : base;
}

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

const BONE_INDEX = new Map(BONES.map((b, i) => [b.name, i]));

function buildSkeleton() {
  const bones = {}, list = [];
  for (const def of BONES) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    const p = def.parent ? BONES.find(b => b.name === def.parent).at : [0, 0, 0];
    bone.position.set(def.at[0] - p[0], def.at[1] - p[1], def.at[2] - p[2]);
    bone.position.multiplyScalar(AUTHOR_SCALE);
    if (def.parent) bones[def.parent].add(bone);
    bones[def.name] = bone;
    list.push(bone);
  }
  return { root: bones.root, bones, list };
}

// Geometry depends only on the chassis (the palette picks colours, not shapes),
// so it is built once and shared. Each body still gets its own bones and its
// own materials — they animate and fade independently.
let _cache = null;

function heroBlockGeometry() {
  if (_cache) return _cache;
  const bufs = {};
  const buf = (k) => (bufs[k] ||= newBuffer());

  for (const part of PARTS) {
    if (OMIT_ARENA_PART.test(part.n)) continue;
    // The source thigh plate protects only the front face. From the gameplay
    // camera that leaves two long black rectangles where a full arena exosuit
    // should have a segmented rear shell. Reuse the authored taper on the back
    // without changing the rig landmarks or the limb's collision footprint.
    const copies = /^Thigh_Plate\./.test(part.n) ? [0, 0.15] : [0];
    for (const zOffset of copies) {
      const b = buf(roleFor(part));
      const bone = BONE_INDEX.get(part.b);
      if (bone === undefined) throw new Error(`heroParts: unknown bone ${part.b}`);
      const base = b.pos.length / 3;
      for (let i = 0; i < 8; i++) {
        b.pos.push(part.v[i * 3] * AUTHOR_SCALE, part.v[i * 3 + 1] * AUTHOR_SCALE, (part.v[i * 3 + 2] + zOffset) * AUTHOR_SCALE);
        b.skinIndex.push(bone, 0, 0, 0);
        b.skinWeight.push(1, 0, 0, 0);
      }
      for (const [a, c, d, e] of FACES) {
        b.idx.push(base + a, base + c, base + d);
        b.idx.push(base + a, base + d, base + e);
      }
    }
  }

  const parts = [];
  for (const [key, b] of Object.entries(bufs)) {
    const geo = toGeometry(b);
    // A skinned mesh's bounding sphere is computed from the BIND pose, so a leg
    // thrown out in a slide reaches past it and shots silently miss a body that
    // is plainly there. One generous sphere around the whole character.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 2.0);
    geo.userData.shared = true;
    const outline = inflate(geo, 0.006);
    outline.userData.shared = true;
    parts.push({ key, geo, outline });
  }
  _cache = parts;
  return parts;
}

export function buildBlockBody(id = 'vanguard') {
  const M = makeBodyMaterials(getLowPolyPalette(id));
  const parts = heroBlockGeometry();

  const group = new THREE.Group();
  const { root, bones, list } = buildSkeleton();
  group.add(root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);

  const olMat = new THREE.MeshBasicMaterial({ color: 0x14161c, side: THREE.BackSide });
  const meshes = [], outlines = [];
  for (const { key, geo, outline } of parts) {
    const mesh = new THREE.SkinnedMesh(geo, M[key]);
    mesh.name = 'body_' + key;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    mesh.bind(skeleton);
    meshes.push(mesh);

    const ol = new THREE.SkinnedMesh(outline, olMat);
    ol.name = 'outline';
    ol.castShadow = false;
    ol.frustumCulled = false;
    ol.raycast = () => {};
    group.add(ol);
    ol.bind(skeleton);
    outlines.push(ol);
  }

  group.userData = {
    isLowPoly: true, isHero: true, isBlockBody: true, armorTypeId: id,
    headshotY: BODY.HEADSHOT_Y,
    primaryMat: M.armor, secondaryMat: M.armor2,
    outlineMat: olMat,
    skeleton, bones, meshes, outlines,
    // Exactly the names applyWalkCycle / applyRifleCarry / Actions already
    // drive, so this body needs no animation changes at all.
    rig: {
      legL: bones.thighL, legR: bones.thighR,
      kneeL: bones.kneeL, kneeR: bones.kneeR,
      ankleL: bones.ankleL, ankleR: bones.ankleR,
      armL: bones.shoulderL, armR: bones.shoulderR,
      elbowL: bones.elbowL, elbowR: bones.elbowR,
      hips: bones.hips, spine: bones.spine, chest: bones.chest, head: bones.head,
    },
  };
  return group;
}
