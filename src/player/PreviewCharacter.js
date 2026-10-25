import * as THREE from 'three';
import { buildEvCharacter, isEvCharacterReady } from './EvCharacter.js';
import { getSkin } from './skins.js';

// Character appearance has one active catalog. Retired armor IDs resolve to
// the current default instead of constructing an old mannequin or soldier.
export function resolveViewmodelPalette(skin, armorTypeId = 'vanguard', armorSkin = null) {
  const finish = armorSkin?.model ? armorSkin : skin?.model ? skin : getSkin('default');
  return {
    plate: new THREE.Color(finish.primary).multiplyScalar(0.92).getHex(),
    sleeve: new THREE.Color(finish.secondary).lerp(new THREE.Color(0x4b5766), 0.42).getHex(),
    glove: new THREE.Color(finish.secondary).lerp(new THREE.Color(0x303844), 0.28).multiplyScalar(0.72).getHex(),
    accent: finish.emissive ?? finish.primary,
  };
}

export function buildPreviewCharacter(skin, armorTypeId = 'vanguard', armorSkin = null, opts = {}) {
  const selected = skin?.model ? skin : getSkin('default');
  if (isEvCharacterReady()) return buildEvCharacter(selected, armorSkin);
  // Startup waits for the current rig before play. Menus and early network
  // peers may exist sooner; they upgrade in place once it is ready.
  const pending = new THREE.Group();
  pending.name = 'Character loading';
  pending.userData.loadingCharacter = true;
  pending.userData.armorTypeId = 'vanguard';
  return pending;
}

export function applySkinToCharacter(group, skin, armorSkin = null) {
  if (group.userData?.isEvCharacter) {
    group.userData.applyFinish(skin?.model ? skin : getSkin('default'), armorSkin);
  }
}

// ---------------------------------------------------------------------------
// Limb rigging for the third-person body
// ---------------------------------------------------------------------------
// The character is a flat collection of armour plates (named GLB nodes). To
// animate a walk cycle we regroup those plates into four pivots — left/right
// shoulder and left/right hip — so each limb can swing about its joint.
// Returns a rig object { armL, armR, legL, legR } or null when it can't rig
// (e.g. the procedural fallback, whose meshes are unnamed).
// ===========================================================================
const _ARM_RE = /uarm|farm|elbow|hand|shoulder|pau|pvs/i;
const _LEG_RE = /thigh|lleg|knee|boot|shinp|sole|grv|kn_|knsph|tpl|cg_/i;
// Lower-limb parts split off onto a second bone (elbow / knee) so limbs BEND
// instead of swinging rigid — the difference between a natural walk and a march.
const _ARM_LO = /farm|forearm|hand|elbow|wrist/i;
const _LEG_LO = /lleg|shin|calf|boot|sole|foot|toe|ankle|knee|grv|kn_|knsph/i;
// …and the foot splits off again onto a third bone (the ankle) so the sole can
// stay level through stance and push off at the end of it, instead of the whole
// foot rotating rigidly with the shin.
const _LEG_FT = /boot|sole|foot|toe|ankle/i;

export function rigCharacterLimbs(group) {
  try {
    // A skinned body arrives already rigged: its joints are bones, positioned
    // by construction, and re-parenting its meshes into pivot groups would tear
    // the skin off the skeleton. Hand back the rig it was built with.
    if (group.userData?.rig) return group.userData.rig;
    group.updateWorldMatrix(true, true);
    // Work in the GROUP's local space, not world space. Limbs are bucketed
    // left/right by their x, and callers rig AFTER placing the character — so
    // reading world positions meant a bot spawned at x=24 had every limb land
    // in the "right" bucket, the left ones came up empty, and rigging returned
    // null. Only characters standing near x=0 ever rigged.
    const _toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();

    const meshes = [];
    group.traverse((o) => { if (o.isMesh && o.name) meshes.push(o); });
    if (!meshes.length) return null; // procedural / unnamed — leave un-rigged

    // Each limb splits into an UPPER set (rides the root pivot) and a LOWER set
    // (rides the joint pivot, a child of the root).
    const buckets = {
      armL: { up: [], lo: [] }, armR: { up: [], lo: [] },
      legL: { up: [], lo: [], ft: [] }, legR: { up: [], lo: [], ft: [] },
    };
    const wp = new THREE.Vector3();
    for (const m of meshes) {
      m.getWorldPosition(wp).applyMatrix4(_toLocal);
      const side = wp.x < 0 ? 'L' : 'R';
      if (_ARM_RE.test(m.name) && Math.abs(wp.x) > 0.12) {
        buckets['arm' + side][_ARM_LO.test(m.name) ? 'lo' : 'up'].push(m);
      } else if (_LEG_RE.test(m.name) && Math.abs(wp.x) > 0.04) {
        const b = buckets['leg' + side];
        (_LEG_FT.test(m.name) ? b.ft : _LEG_LO.test(m.name) ? b.lo : b.up).push(m);
      }
    }

    // Build a limb chain: a root pivot at rootY, a joint (knee/elbow) pivot at
    // jointY parented to it, and — for legs — a third tip pivot (the ankle) at
    // tipY parented to the joint. Returns { root, joint, tip } or null if too
    // sparse.
    const makeLimb = (parts, rootY, jointY, tipY) => {
      const ft = parts.ft || [];
      const all = [...parts.up, ...parts.lo, ...ft];
      if (all.length < 2) return null;
      let ax = 0;
      for (const m of all) { m.getWorldPosition(wp).applyMatrix4(_toLocal); ax += wp.x; }
      ax /= all.length;
      const root = new THREE.Group();
      root.position.set(ax, rootY, 0);
      group.add(root);
      const joint = new THREE.Group();
      joint.position.set(0, jointY - rootY, 0);   // local to root → world (ax, jointY, 0)
      root.add(joint);
      let tip = null;
      if (tipY != null && ft.length) {
        tip = new THREE.Group();
        tip.position.set(0, tipY - jointY, 0);    // local to joint → world (ax, tipY, 0)
        joint.add(tip);
      }
      root.updateWorldMatrix(true, true);
      for (const m of parts.up) root.attach(m);    // attach() preserves world transform
      for (const m of parts.lo) joint.attach(m);
      for (const m of ft) (tip || joint).attach(m);
      return { root, joint, tip };
    };

    const legL = makeLimb(buckets.legL, 1.21, 0.62, 0.27);
    const legR = makeLimb(buckets.legR, 1.21, 0.62, 0.27);
    const armL = makeLimb(buckets.armL, 1.76, 1.28);
    const armR = makeLimb(buckets.armR, 1.76, 1.28);
    if (!legL || !legR || !armL || !armR) return null;

    // Back-compatible API: rig.legL/armL are the ROOT (hip/shoulder) pivots, so
    // existing `rig.legL.rotation.x = …` still swings the whole limb. The
    // .kneeL/.kneeR/.elbowL/.elbowR joints add the bend, and .ankleL/.ankleR
    // the foot roll (null on rigs whose feet couldn't be split out).
    const rig = {
      armL: armL.root, armR: armR.root, legL: legL.root, legR: legR.root,
      elbowL: armL.joint, elbowR: armR.joint, kneeL: legL.joint, kneeR: legR.joint,
      ankleL: legL.tip, ankleR: legR.tip,
    };
    group.userData.rig = rig;
    return rig;
  } catch (e) {
    console.warn('[rigCharacterLimbs] failed:', e.message);
    return null;
  }
}
