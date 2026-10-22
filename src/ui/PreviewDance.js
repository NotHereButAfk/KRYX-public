import * as T from 'three';
import { solveChain } from '../player/EvCharacter.js';

const restHands = new WeakMap();
function relaxedHands(group) {
  if (restHands.has(group)) return restHands.get(group);
  const poses = [];
  const seen = new Set();
  group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { bones, boneInverses } = mesh.skeleton;
    bones.forEach((bone, i) => {
      if (!/Bip001_[LR]_(Hand|Finger)/.test(bone.name) || seen.has(bone)) return;
      const parent = bones.indexOf(bone.parent);
      if (parent < 0) return;
      const local = boneInverses[parent].clone().multiply(boneInverses[i].clone().invert());
      poses.push([bone, new T.Quaternion().setFromRotationMatrix(local.extractRotation(local))]);
      seen.add(bone);
    });
  });
  restHands.set(group, poses);
  return poses;
}

// Preview-only, hand-authored scoop/side-step loop from the supplied dance reference.
// Targets are in character space so the animation works with every bound skin.
export function applyPreviewDance(group, seconds) {
  const bones = group.userData.bones;
  if (!bones?.Bip001_Pelvis) return;
  const phase = seconds * Math.PI * 2 * 1.65;
  const sway = Math.sin(phase * .5);
  const bounce = .5 - .5 * Math.cos(phase);
  const feet = ['L', 'R'].map(side => {
    const foot = bones[`Bip001_${side}_Foot`];
    return { side, foot, position: group.worldToLocal(foot.getWorldPosition(new T.Vector3())), orientation: foot.getWorldQuaternion(new T.Quaternion()) };
  });
  const pelvis = bones.Bip001_Pelvis;
  const hip = group.worldToLocal(pelvis.getWorldPosition(new T.Vector3()));
  hip.x += sway * .12;
  hip.y -= .14 + bounce * .085;
  pelvis.position.copy(pelvis.parent.worldToLocal(group.localToWorld(hip)));
  group.updateMatrixWorld(true);
  for (const {side, foot, position, orientation} of feet) {
    const sign = side === 'L' ? -1 : 1;
    const lift = Math.pow(Math.max(0, sign * sway), 3);
    position.x = sign * (.25 + lift * .035);
    position.y += lift * .035;
    position.z = lift * .035;
    solveChain(bones[`Bip001_${side}_Thigh`], bones[`Bip001_${side}_Calf`], foot, group.localToWorld(position), group.localToWorld(new T.Vector3(sign * .30 + sway * .05, .55, -.48)));
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(orientation));
  }
  // Keep the palms apart and elbows outward; the firearm carry's wrist twist
  // must not survive into an unarmed dance.
  for (const [bone, rotation] of relaxedHands(group)) bone.quaternion.copy(rotation);
  const head = group.worldToLocal(bones.Bip001_Head.getWorldPosition(new T.Vector3()));
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? -1 : 1;
    const coveringNose = side === 'L';
    const hand = bones['Bip001_' + side + '_Hand'];
    // Left hand holds over the nose; right hand reaches ahead with a tiny sweep.
    const target = coveringNose
      ? head.clone().add(new T.Vector3(-.075, -.035, -.16))
      : head.clone().add(new T.Vector3(.13 + .12 * Math.sin(phase), -.23, -.56));
    const elbow = group.localToWorld(new T.Vector3(head.x + sign * .40, head.y - .38, -.20));
    solveChain(bones['Bip001_' + side + '_UpperArm'], bones['Bip001_' + side + '_Forearm'], hand, group.localToWorld(target), elbow);
    const finger = bones['Bip001_' + side + '_Finger1'];
    if (finger) {
      hand.updateWorldMatrix(true, true);
      const origin = hand.getWorldPosition(new T.Vector3());
      const from = finger.getWorldPosition(new T.Vector3()).sub(origin).normalize();
      const to = group.localToWorld(new T.Vector3(coveringNose ? 1 : 0, coveringNose ? .12 : 0, coveringNose ? -.05 : -1)).sub(group.getWorldPosition(new T.Vector3())).normalize();
      const world = hand.getWorldQuaternion(new T.Quaternion());
      world.premultiply(new T.Quaternion().setFromUnitVectors(from, to));
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world));
    }
  }
  group.updateMatrixWorld(true);
}
