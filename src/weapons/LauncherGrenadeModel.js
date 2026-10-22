import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The same connected, blue grenade silhouette is used for local and replicated
// launcher rounds. Every part fits inside the shared 18 cm collision radius.
export function createLauncherGrenade() {
  const root = new THREE.Group();
  root.name = 'Blue launcher grenade';
  const blue = new THREE.MeshStandardMaterial({ color: 0x1676ed, roughness: .38,
    metalness: .35, emissive: 0x083cbb, emissiveIntensity: .28 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x142841, roughness: .55, metalness: .5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9ebdd7, roughness: .32, metalness: .7 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x61d9ff, emissive: 0x149dff,
    emissiveIntensity: 2, roughness: .3 });
  const add = (name, geometry, material, x=0, y=0, z=0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.position.set(x,y,z); root.add(mesh);
    return mesh;
  };
  add('Blue segmented body', new RoundedBoxGeometry(.23,.25,.15,1,.02), blue);
  for (const y of [-.065,0,.065]) {
    add('Armour groove', new RoundedBoxGeometry(.237,.016,.157,1,.006), dark,0,y,0);
  }
  for (const y of [-.032,.032]) {
    add('Blue visibility band', new RoundedBoxGeometry(.237,.012,.157,1,.004), glow,0,y,0);
  }
  add('Fuse cap', new THREE.CylinderGeometry(.035,.045,.04,10), dark,0,.133,0);
  add('Safety lever top', new THREE.BoxGeometry(.095,.015,.024), steel,.026,.15,0);
  const lever = add('Safety lever', new THREE.BoxGeometry(.016,.105,.024), steel,.089,.1,0);
  lever.rotation.z = .4;
  add('Fuse ring', new THREE.TorusGeometry(.023,.005,5,12), steel,-.042,.14,0);
  // Emissive paint stays visible without per-round lights or shadow passes.
  return root;
}
