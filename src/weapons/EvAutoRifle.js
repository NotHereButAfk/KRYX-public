import * as THREE from 'three';

// The standalone export uses metres, +Y up and muzzle-forward -Z. Geometry
// and original hand/muzzle markers share the same baked normalization.
const receiverPlates = new Map();
function receiverPlate(side) {
  if (receiverPlates.has(side)) return receiverPlates.get(side);
  const shape = new THREE.Shape();
  // Longitudinal armour with a bevel at each end; preserve grip clearance.
  const profile = [[.29,.075],[.25,.115],[-.10,.115],[-.16,.085],[-.13,.045],[.24,.045]];
  profile.forEach(([z,y],i) => i ? shape.lineTo(z,y) : shape.moveTo(z,y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape,{depth:.004,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.002,bevelThickness:.001});
  geometry.rotateY(Math.PI/2); geometry.translate(side * .033,0,0);
  geometry.userData.shared = true;
  receiverPlates.set(side,geometry); return geometry;
}

export function buildEvAutoRifle(template, weaponDef) {
  const source = template?.getObjectByName('weapon_m4');
  if (!source) return null;
  const group = source.clone(true);
  const muzzle = group.getObjectByName('BIND_BULLET');
  const trigger = group.getObjectByName('BIND_RIGHTHAND');
  const support = group.getObjectByName('BIND_LEFTHAND');
  if (!muzzle || !trigger || !support) return null;
  group.updateWorldMatrix(true, true);
  const contact = (marker) => group.worldToLocal(marker.getWorldPosition(new THREE.Vector3())).toArray();
  const triggerPoint = contact(trigger);
  const supportPoint = contact(support);
  group.userData.weaponId = weaponDef.id;
  group.userData.weaponKind = weaponDef.kind;
  group.userData.modelSource = 'ev-original';
  group.userData.referenceRevision = 1;
  group.userData.authoredHandPose = {
    trigger: triggerPoint,
    support: supportPoint,
    reload: [triggerPoint[0] - 0.025, triggerPoint[1] - 0.13, triggerPoint[2] - 0.14],
    supportVisible: true,
    carry: 'rifle',
  };
  for (const side of [-1,1]) {
    const material = new THREE.MeshStandardMaterial({color:0x929096,roughness:.78,metalness:.22});
    material.userData.role = 'body';
    const plate = new THREE.Mesh(receiverPlate(side),material);
    plate.name = `reference_receiver_${side < 0 ? 'port' : 'starboard'}`;
    group.add(plate);
  }
  // Skins and the first-person depth pass mutate materials per instance.
  // Match the other starter guns: gray armour, dark steel and orange furniture from the recording.
  // Clone before recoloring so equipped finishes never mutate the source asset.
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.userData.shared = true;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone()) : object.material.clone();
    for (const material of [].concat(object.material)) {
      const role = material.userData.role;
      const palette = { body: 0x929096, metal: 0x45444a, accent: 0xed781d, energy: 0xc0ff24 };
      if (palette[role] !== undefined) material.color.setHex(palette[role]);
    }
    object.castShadow = true;
  });
  return { group, muzzle };
}
