import { createAuthoredSkinSlot } from './AuthoredSkins.js';

// All selectable finishes now have authored Reforged meshes. The embedded
// Default Reforged surfaces are the only loading/unequip fallback; never tint
// the retired armor or construct procedural helmet variants.
export function setupEvCosmetics(group, model, bones) {
  const materials = [], nativeMeshes = [];
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    nativeMeshes.push(mesh);
    materials.push(...[].concat(mesh.material));
  });
  const applyAuthored = createAuthoredSkinSlot(group, model, bones, nativeMeshes, materials);
  function apply(skin, finish) {
    return applyAuthored(finish?.model ? finish : skin?.model ? skin : null);
  }
  return { apply, materials, primary: materials[0] };
}
