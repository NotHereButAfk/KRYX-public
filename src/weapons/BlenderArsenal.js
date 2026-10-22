// Authored in metres, +Y up, muzzle -Z. Markers and geometry share one frame.
export const BLENDER_ARSENAL = Object.freeze(Object.fromEntries(
  ['m4', 'magnum', 'battlerifle', 'energyshotgun', 'plasmarifle', 'rpg', 'concussion', 'uzi', 'levershotgun', 'sword', 'boltsniper']
    .map(id => [id, id === 'sword' ? '/models/arsenal-v1/sword.glb' : `/models/ev-default/${id}.glb${['rpg','uzi','concussion'].includes(id) ? '?v=muzzle-seat-6' : ''}`]),
));

export function buildBlenderWeapon(template, def) {
  const source = template?.getObjectByName(`weapon_${def.id}`);
  if (!source?.userData.authoredHandPose) return null;
  const group = source.clone(true);
  const muzzle = group.getObjectByName('BIND_BULLET');
  if (!muzzle) return null;
  Object.assign(group.userData, {
    weaponId: def.id, weaponKind: def.kind, modelSource: 'blender-arsenal',
  });
  group.traverse(obj => {
    if (!obj.isMesh) return;
    obj.geometry.userData.shared = true;
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(m => m.clone()) : obj.material.clone();
    obj.castShadow = true;
  });
  return { group, muzzle };
}
