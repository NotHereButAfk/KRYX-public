// Shared grenade flight. Seven swept probes approximate the small grenade volume.
// Bounded substeps and remaining-time rebounds handle thin walls and corners.
export const GRENADE_RADIUS=0.075;
export const LAUNCHER_GRENADE_RADIUS=0.18;
const OFFSETS=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export function stepGrenade(p, dt, raycast, launcher = false) {
  const radius=launcher ? LAUNCHER_GRENADE_RADIUS : GRENADE_RADIUS;
  const h=1/120;
  p.physicsRemainder=(p.physicsRemainder||0)+Math.max(0,dt);
  const steps=Math.floor((p.physicsRemainder+1e-10)/h);
  p.physicsRemainder-=steps*h;
  for(let i=0;i<steps;i++) {
    p.flightTime = (p.flightTime || 0) + h;
    if (p.impactTime != null) p.impactTime += h;
    let supported = false;
    p.vy-=18*h;
    let remaining=h;
    for(let bounce=0;bounce<3 && remaining>1e-6;bounce++) {
      const speed=Math.hypot(p.vx,p.vy,p.vz);
      if(speed<1e-8)break;
      const dx=p.vx/speed,dy=p.vy/speed,dz=p.vz/speed,length=speed*remaining;
      let hit=null;
      for(const [ox,oy,oz] of OFFSETS) {
        const candidate=raycast({x:p.x+ox*radius,y:p.y+oy*radius,z:p.z+oz*radius},dx,dy,dz,length);
        if(candidate && candidate.distance>=0 && candidate.distance<=length
          && (!hit || candidate.distance<hit.distance))hit=candidate;
      }
      const travel=hit ? hit.distance : length;
      p.x+=dx*travel;p.y+=dy*travel;p.z+=dz*travel;
      if(!hit)break;
      p.impactTime ??= 0;
      remaining-=travel/speed;
      const norm=Math.hypot(hit.nx,hit.ny,hit.nz)||1;
      const nx=hit.nx/norm,ny=hit.ny/norm,nz=hit.nz/norm;
      p.x+=nx*0.001;p.y+=ny*0.001;p.z+=nz*0.001;
      const into=p.vx*nx+p.vy*ny+p.vz*nz;
      if(into>=0)break;
      const resting=ny>0.65 && -into<1.25;
      if (resting) supported = true;
      const restitution=resting?0:(launcher ? 0.28 : 0.58);
      const friction=resting?Math.exp(-(launcher ? 10 : 3.5)*h):(launcher ? 0.65 : 0.88);
      p.vx=(p.vx-into*nx)*friction-into*nx*restitution;
      p.vy=(p.vy-into*ny)*friction-into*ny*restitution;
      p.vz=(p.vz-into*nz)*friction-into*nz*restitution;
      if(resting && Math.hypot(p.vx,p.vz)<0.12)p.vx=p.vz=0;
    }
    // Require sustained floor contact, never the zero velocity at an arc's apex.
    // Collision separation can leave a millimetre gap for a substep. Probe that
    // gap so resting contact doesn't alternate and endlessly reset the timer.
    if (!supported && Math.hypot(p.vx,p.vy,p.vz) < 0.2) {
      const floor = raycast({x:p.x,y:p.y-radius,z:p.z},0,-1,0,0.004);
      supported = !!floor && floor.ny > 0.65;
    }
    p.settledTime = supported && Math.hypot(p.vx,p.vy,p.vz) < 0.2
      ? (p.settledTime || 0) + h : 0;
  }
}

export const grenadeHasSettled = p => (p.settledTime || 0) >= 0.2;
// Settle normally; a short backup fuse prevents slopes/corners from keeping a
// live launcher round rolling forever. Unimpacted rounds have a five-second fuse.
export const launcherShouldExplode = p => grenadeHasSettled(p)
  || (p.impactTime ?? 0) >= 2 || (p.flightTime || 0) >= 5;
