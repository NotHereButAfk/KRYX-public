// Presentation-only angular inertia follows flight and rebound velocity.
export function tumbleGrenade(mesh, vx, vy, vz, dt) {
  if (!(dt>0)) return;
  const speed=Math.hypot(vx,vy,vz), horizontal=Math.hypot(vx,vz);
  const spin=Math.min(9,speed*1.6), rate=speed<.2?18:8;
  const targetX=horizontal>.001?vz/horizontal*spin:spin*.7;
  const targetZ=horizontal>.001?-vx/horizontal*spin:spin*.4;
  const state=mesh.userData.tumble??={x:0,z:0};
  const decay=Math.exp(-rate*dt);
  for(const [axis,target] of [['x',targetX],['z',targetZ]]){
    mesh.rotation[axis]+=target*dt+(state[axis]-target)*(1-decay)/rate;
    state[axis]=target+(state[axis]-target)*decay;
  }
}
