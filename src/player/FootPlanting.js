import * as THREE from 'three';
// Keep a planted ankle stationary in world X/Z until the authored swing lifts
// it. The native clip still owns timing, ankle height and foot orientation.
export function createFootPlanting(group, bones, solveChain) {
  const root = new THREE.Vector3(), lastRoot = new THREE.Vector3();
  const feet = ['L','R'].map(side => ({side, anchor:new THREE.Vector3(), locked:false, blocked:false}));
  const point = new THREE.Vector3(), local = new THREE.Vector3(), hip = new THREE.Vector3(), knee = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), parent = new THREE.Quaternion();
  const correction = new THREE.Vector3(), target = new THREE.Vector3();
  let initialized=false;
  const reset = () => {initialized=false;for(const f of feet)f.locked=f.blocked=false;};
  function update(active, floor) {
    group.getWorldPosition(root);
    const moved=initialized?root.distanceTo(lastRoot):0;
    const stepped=initialized?Math.abs(root.y-lastRoot.y):0;
    lastRoot.copy(root);initialized=true;
    active = active && moved>1e-6 && moved<2 && stepped<.08;
    for(const f of feet) {
      const foot=bones[`Bip001_${f.side}_Foot`],thigh=bones[`Bip001_${f.side}_Thigh`],calf=bones[`Bip001_${f.side}_Calf`];
      foot.getWorldPosition(point);local.copy(point);group.worldToLocal(local);
      if(!active || local.y>floor+.04){f.locked=f.blocked=false;continue;}
      if(!f.locked && !f.blocked && local.y<floor+.018){f.anchor.copy(point);f.locked=true;}
      if(!f.locked)continue;
      thigh.getWorldPosition(hip);calf.getWorldPosition(knee);
      const reach=(hip.distanceTo(knee)+knee.distanceTo(point))*.985;
      f.anchor.y=point.y;
      if(hip.distanceTo(f.anchor)>reach){f.locked=false;f.blocked=true;continue;}
      foot.getWorldQuaternion(rotation);
      // Fade the planted constraint out before reach exhaustion. A hard release
      // snapped the slowed leg from its world anchor back to the authored pose.
      const reachRatio = hip.distanceTo(f.anchor) / reach;
      const reachWeight = 1 - THREE.MathUtils.smoothstep(reachRatio, .90, .995);
      const liftWeight = 1 - THREE.MathUtils.smoothstep(local.y, floor + .018, floor + .04);
      correction.copy(f.anchor).sub(point).clampLength(0, .30);
      target.copy(point).addScaledVector(correction, reachWeight * liftWeight);
      solveChain(thigh,calf,foot,target);
      foot.parent.getWorldQuaternion(parent).invert();foot.quaternion.copy(parent.multiply(rotation));
      foot.updateWorldMatrix(false,true);
    }
  }
  return {update,reset};
}
