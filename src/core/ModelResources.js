// Imported templates share buffers; instances own materials unless marked.
// Textures are loader/skin caches and are deliberately not disposed here.
export function isSharedGeometry(geometry) {
  return !!geometry?.userData?.shared;
}

export function disposeModel(root) {
  const geometries = new Set(), materials = new Set();
  root?.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry && !isSharedGeometry(o.geometry)) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && !m.userData.shared) materials.add(m);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  root?.removeFromParent();
}
