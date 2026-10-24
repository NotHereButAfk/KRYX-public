import * as THREE from 'three';

const flameGeometry = new THREE.ConeGeometry(.045,.26,6);
flameGeometry.translate(0,-.13,0); flameGeometry.rotateZ(Math.PI);
// Tip points down; top of the plume stays at the boot sole.
flameGeometry.translate(0,-.26,0);
flameGeometry.userData.shared = true;
export function createJumpJets(group,bones) {
  const jets = ['L','R'].map(side => {
    const root = new THREE.Group();root.name=`boot_jet_${side}`;root.visible=false;
    for(const [color,scale] of [[0x22bbff,1],[0xd9ffff,.58]]) {
      const material = new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
      const flame = new THREE.Mesh(flameGeometry,material);flame.scale.setScalar(scale);
      flame.raycast=()=>{};flame.userData.noHit=true;root.add(flame);
    }
    group.add(root);return {root,foot:bones[`Bip001_${side}_Foot`]};
  });
  const point = new THREE.Vector3();let elapsed=0;
  return {update(dt,remaining) {
    elapsed += dt;
    if (remaining > 0) group.updateWorldMatrix(true,false);
    for(const {root,foot} of jets) {
      root.visible=remaining>0;
      if(!root.visible)continue;
      foot.getWorldPosition(point);point.y-=.16;group.worldToLocal(point);root.position.copy(point);
      const strength=Math.min(1,remaining/.07);
      root.scale.set(1,(.8+.2*Math.sin(elapsed*70))*strength,1);
      for(const flame of root.children)flame.material.opacity=.8*strength;
    }
  }};
}
